import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import * as store from "./store";
import type { UserRow } from "./store";
import { siteHost } from "./site";

export const SESSION_COOKIE = "blind_session";
export const CSRF_COOKIE = "blind_csrf";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const CSRF_HEADER = "x-blind-csrf";

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 24) {
    throw new Error("AUTH_SECRET is not set (or is too short). Sessions cannot be signed without it.");
  }
  return value;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Links the CSRF token to the session, so a token from another session is useless. */
export function csrfTokenFor(sessionToken: string): string {
  return createHmac("sha256", secret()).update(`csrf:${sessionToken}`).digest("base64url");
}

export type SessionContext = {
  user: UserRow;
  sessionId: string;
  sessionToken: string;
  csrfToken: string;
};

export async function startSession(input: { userId: string; userAgent?: string | null; ipHash?: string | null }): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await store.createSessionRow({
    userId: input.userId,
    tokenHash: hashToken(token),
    userAgent: input.userAgent ?? null,
    ipHash: input.ipHash ?? null,
    ttlMs: SESSION_TTL_MS,
  });
  return token;
}

export async function setSessionCookies(token: string): Promise<void> {
  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  jar.set(CSRF_COOKIE, csrfTokenFor(token), {
    httpOnly: false, // the browser has to be able to echo it back in a header
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function currentSession(): Promise<SessionContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await store.sessionByTokenHash(hashToken(token));
  if (!row) return null;
  return {
    user: row,
    sessionId: row.session_id,
    sessionToken: token,
    csrfToken: csrfTokenFor(token),
  };
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const row = await store.sessionByTokenHash(hashToken(token));
    if (row) await store.revokeSession(row.session_id);
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/**
 * Everything a state-changing route must confirm before it acts: same-origin,
 * a session, and a CSRF token that belongs to that session.
 */
export async function requireSession(): Promise<SessionContext> {
  const session = await currentSession();
  if (!session) throw new AuthError("Sign in to continue.", 401);
  if (session.user.status !== "active") throw new AuthError("This account is not active.", 403);
  return session;
}

export async function assertSameOrigin(): Promise<void> {
  const list = await headers();
  const origin = list.get("origin");
  if (!origin) return; // same-origin form posts from the app itself carry none
  if (!originAllowed(origin)) throw new AuthError("Cross-site request refused.", 403);
}

export async function requireCsrf(session: SessionContext): Promise<void> {
  const list = await headers();
  const provided = list.get(CSRF_HEADER) ?? list.get("x-csrf-token");
  if (!provided) throw new AuthError("Missing CSRF token.", 403);
  const expected = session.csrfToken;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthError("CSRF token does not match.", 403);
}

export async function requireMutation(): Promise<SessionContext> {
  await assertSameOrigin();
  const session = await requireSession();
  await requireCsrf(session);
  return session;
}

/** APP_URL, localhost, and Vercel preview aliases of this project. */
export function originAllowed(origin: string): boolean {
  const configured = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (configured && origin === configured) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    if (url.protocol === "https:" && url.hostname.endsWith(".vercel.app")) return true;
    return false;
  } catch {
    return false;
  }
}

export async function requestContext() {
  const list = await headers();
  const ip = list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? list.get("x-real-ip") ?? null;
  return {
    userAgent: list.get("user-agent"),
    // Hashed, never stored raw: enough to correlate abuse, not to identify a person.
    ipHash: ip ? createHmac("sha256", secret()).update(ip).digest("hex").slice(0, 32) : null,
    origin: list.get("origin"),
    host: list.get("host"),
  };
}

export function appUrl(fallbackHost?: string | null): string {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (fallbackHost) {
    const scheme = fallbackHost.startsWith("localhost") || fallbackHost.startsWith("127.") ? "http" : "https";
    return `${scheme}://${fallbackHost}`;
  }
  return "http://localhost:3000";
}

/** The domain an auth statement must be bound to (host only, no scheme). */
export function authDomain(fallbackHost?: string | null): string {
  try {
    return new URL(appUrl(fallbackHost)).host;
  } catch {
    return "localhost:3000";
  }
}

/**
 * Every host a wallet statement may be bound to for this request.
 *
 * The wallet signs the origin the browser is actually on, so the request host is
 * ground truth — but only when it is a host this app actually serves, so a
 * spoofed Host header cannot decide which site we are. The configured APP_URL is
 * included too, because a payment link or an OAuth round trip can land the user
 * back on it.
 *
 * Empty when neither names a host we serve, which makes the caller refuse every
 * statement rather than trust the Host header as proof of identity.
 */
export function authDomains(fallbackHost?: string | null): string[] {
  // Read the configured URL directly rather than through appUrl(), which falls
  // back to the request host: that fallback would let an attacker-supplied Host
  // header become the value we compare against.
  const configured = siteHost(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "");
  const requestHost = fallbackHost ? siteHost(fallbackHost) : null;
  const served = requestHost && originAllowed(`https://${requestHost}`) ? requestHost : null;
  return [...new Set([configured, served].filter((host): host is string => host !== null))];
}
