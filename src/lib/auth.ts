import { createHash, randomBytes } from "node:crypto";
import { beldexConfig } from "./beldex/config";
import { verifyAuthStatement } from "./beldex/sig";
import { decodeAddress } from "./beldex/address";
import * as store from "./store";
import { AuthError } from "./session";
import type { UserRow } from "./store";

/* ------------------------------------------------------------------ config */

export type ProviderId = "google" | "x";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function xConfigured(): boolean {
  return Boolean(process.env.X_CLIENT_ID && (process.env.X_CLIENT_SECRET || process.env.X_USE_PKCE === "1"));
}

export function providerStatus() {
  return [
    {
      id: "google" as ProviderId,
      label: "Google",
      configured: googleConfigured(),
      missing: googleConfigured() ? [] : ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    },
    {
      id: "x" as ProviderId,
      label: "X",
      configured: xConfigured(),
      missing: xConfigured() ? [] : ["X_CLIENT_ID", "X_CLIENT_SECRET"],
    },
  ];
}

export function callbackPath(provider: ProviderId): string {
  return `/api/auth/${provider}/callback`;
}

/* -------------------------------------------------------------------- PKCE */

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

/* ------------------------------------------------------------------ Google */

export function googleAuthUrl(opts: { redirectUri: string; state: string; challenge: string }): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleIdentity = {
  provider: "google";
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

export async function exchangeGoogleCode(code: string, verifier: string, redirectUri: string): Promise<GoogleIdentity> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    throw new AuthError(`Google refused the sign-in (${response.status}).`, 400);
  }
  const tokens = (await response.json()) as { id_token?: string; access_token?: string };
  if (!tokens.id_token) throw new AuthError("Google did not return an identity token.", 400);

  const claims = decodeJwtPayload(tokens.id_token);
  const issuer = String(claims.iss ?? "");
  if (issuer !== "https://accounts.google.com" && issuer !== "accounts.google.com") {
    throw new AuthError("Google identity token has an unexpected issuer.", 400);
  }
  if (Number(claims.exp ?? 0) * 1000 < Date.now()) throw new AuthError("Google identity token has expired.", 400);
  if (String(claims.aud ?? "") !== process.env.GOOGLE_CLIENT_ID) {
    throw new AuthError("Google identity token was issued for another client.", 400);
  }
  const subject = String(claims.sub ?? "");
  if (!subject) throw new AuthError("Google identity token carried no subject.", 400);

  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  const emailVerified =
    claims.email_verified === true || claims.email_verified === "true" || issuerVerified(claims);
  return {
    provider: "google",
    providerAccountId: subject,
    email,
    emailVerified,
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
  };
}

function issuerVerified(claims: Record<string, unknown>): boolean {
  // Google only sets hd/email for verified Workspace and consumer accounts; a
  // missing flag is treated as unverified rather than assumed good.
  return claims.email_verified === undefined ? false : true;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Google identity token is malformed.", 400);
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new AuthError("Google identity token payload is not JSON.", 400);
  }
}

/* ------------------------------------------------------------------------ X */

export function xAuthUrl(opts: { redirectUri: string; state: string; challenge: string }): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID as string,
    redirect_uri: opts.redirectUri,
    scope: xScopes(),
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

/**
 * Blind reads exactly one X field: the handle from `users/me`. The default scope
 * is therefore `users.read` alone — asking for anything else would be collecting
 * permission it has no use for. `X_SCOPES` exists because a given X app may not
 * be allowed to grant even that until its user-authentication settings are set.
 */
export function xScopes(): string {
  const configured = process.env.X_SCOPES;
  return configured && configured.trim() ? configured.trim() : "users.read";
}

export type XIdentity = {
  provider: "x";
  providerAccountId: string;
  handle: string | null;
  name: string | null;
  picture: string | null;
};

export async function exchangeXCode(code: string, verifier: string, redirectUri: string): Promise<XIdentity> {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: process.env.X_CLIENT_ID as string,
  });
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  };
  // Confidential clients authenticate with Basic; public clients use PKCE only.
  // X_USE_PKCE=1 forces the public-client path even when a secret is present,
  // which is what to set if the app was created as a public/native client.
  if (process.env.X_CLIENT_SECRET && process.env.X_USE_PKCE !== "1") {
    const basic = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64");
    init.headers = { ...(init.headers as Record<string, string>), authorization: `Basic ${basic}` };
  }
  const response = await fetch("https://api.twitter.com/2/oauth2/token", init);
  if (!response.ok) {
    throw new AuthError(`X refused the sign-in (${response.status}).`, 400);
  }
  const tokens = (await response.json()) as { access_token?: string };
  if (!tokens.access_token) throw new AuthError("X did not return an access token.", 400);

  const profileResponse = await fetch(
    "https://api.twitter.com/2/users/me?user.fields=username,name,profile_image_url,verified",
    { headers: { authorization: `Bearer ${tokens.access_token}` } }
  );
  if (!profileResponse.ok) {
    // Sign-in still works without profile fields: the handle is optional and the
    // UI says so rather than pretending we know who this is.
    throw new AuthError(
      `X did not allow reading this account's profile (${profileResponse.status}). Blind needs the users.read scope.`,
      400
    );
  }
  const payload = (await profileResponse.json()) as {
    data?: { id?: string; username?: string; name?: string; profile_image_url?: string };
  };
  const subject = payload.data?.id;
  if (!subject) throw new AuthError("X returned no account id.", 400);
  return {
    provider: "x",
    providerAccountId: String(subject),
    handle: payload.data?.username ? `@${payload.data.username}` : null,
    name: payload.data?.name ?? null,
    picture: payload.data?.profile_image_url ?? null,
  };
}

/* ------------------------------------------------------- identity → account */

export type Identity = GoogleIdentity | XIdentity;

export type SignInResult = { user: UserRow; created: boolean; linked: boolean };

/**
 * Resolves an OAuth identity to a Blind account.
 *
 *  - an identity that is already linked signs into its account;
 *  - a Google identity whose *verified* email matches an existing account is
 *    linked to it rather than creating a second account for the same person;
 *  - anything else creates a new account.
 *
 * Usernames are never the identifier: the link table and the internal UUID are.
 */
export async function resolveIdentity(identity: Identity): Promise<SignInResult> {
  const existing = await store.findLinkedAccount(identity.provider, identity.providerAccountId);
  if (existing) {
    const user = await store.getUserById(existing.user_id);
    if (!user) throw new AuthError("This account was removed.", 403);
    if (user.status !== "active") throw new AuthError("This account is not active.", 403);
    return { user, created: false, linked: false };
  }

  if (identity.provider === "google" && identity.email && identity.emailVerified) {
    const { one } = await import("./db");
    const match = await one<{ user_id: string }>(
      `select user_id from linked_accounts
        where provider = 'google' and lower(email) = $1
        order by created_at
        limit 1`,
      [identity.email]
    );
    if (match) {
      const user = await store.getUserById(match.user_id);
      if (user) {
        await store.attachLinkedAccount({
          userId: user.id,
          provider: identity.provider,
          providerAccountId: identity.providerAccountId,
          handle: null,
          email: identity.email,
          profile: identity.provider === "google" ? { name: identity.name, picture: identity.picture } : {},
        });
        await store.audit({ actorUserId: user.id, action: "auth.account_linked", subject: identity.provider });
        return { user, created: false, linked: true };
      }
    }
  }

  const user = await store.createUser({
    displayName: identity.name,
    avatarUrl: identity.picture,
  });
  await store.attachLinkedAccount({
    userId: user.id,
    provider: identity.provider,
    providerAccountId: identity.providerAccountId,
    handle: identity.provider === "x" ? identity.handle : null,
    email: identity.provider === "google" ? identity.email : null,
    profile:
      identity.provider === "google"
        ? { name: identity.name, picture: identity.picture }
        : { name: identity.name, picture: identity.picture, handle: identity.handle },
  });
  await store.audit({ actorUserId: user.id, action: "auth.account_created", subject: identity.provider });
  return { user, created: true, linked: false };
}

/* -------------------------------------------------------------- wallet auth */

/**
 * Wallet sign-in. The nonce is issued by this server and consumed exactly once;
 * the statement the wallet signed must be bound to this app's own domain, name
 * the address that signed it, and be fresh. Verification is local, pure
 * arithmetic (src/lib/beldex/sig.ts) — the app never asks the wallet to reveal
 * anything and never sees a spend key.
 */
export async function verifyWalletSignIn(input: {
  statement: string;
  signature: string;
  expectedDomain: string;
  /** 'link' attaches the proven address to the signed-in account instead. */
  purpose?: "signin" | "link";
  linkUserId?: string | null;
}): Promise<SignInResult & { address: string }> {
  if (input.purpose === "link") {
    if (!input.linkUserId) throw new AuthError("Sign in before proving a wallet.", 401);
    const linkCheck = verifyAuthStatement({
      text: input.statement,
      signature: input.signature,
      nettype: beldexConfig().nettype,
      expectedDomain: input.expectedDomain,
    });
    if (!linkCheck.valid) throw new AuthError(`Wallet signature rejected: ${linkCheck.reason}`, 401);
    const linkDecoded = decodeAddress(linkCheck.fields.address, beldexConfig().nettype);
    if (!linkDecoded.ok) throw new AuthError(`Wallet address rejected: ${linkDecoded.reason}`, 401);
    const linkConsumed = await store.consumeAuthChallenge(linkCheck.fields.nonce, "link");
    if (!linkConsumed) throw new AuthError("This challenge was already used or has expired.", 401);
    const linkedUser = await store.getUserById(input.linkUserId);
    if (!linkedUser) throw new AuthError("This account was removed.", 403);
    await store.upsertWallet({
      userId: linkedUser.id,
      nettype: beldexConfig().nettype,
      address: linkCheck.fields.address,
      source: "extension",
      ownershipProven: true,
    });
    await store.attachLinkedAccount({
      userId: linkedUser.id,
      provider: "wallet",
      providerAccountId: `${beldexConfig().nettype}:${linkCheck.fields.address}`,
      handle: null,
      email: null,
      profile: { nettype: beldexConfig().nettype, address: linkCheck.fields.address, proof: linkCheck.framing },
    });
    await store.audit({ actorUserId: linkedUser.id, action: "wallet.ownership_proven", subject: beldexConfig().nettype });
    await store.notify({
      userId: linkedUser.id,
      kind: "security",
      title: "Wallet ownership proven",
      body: "A Beldex wallet signature confirmed you control the address now linked to this account.",
    });
    return { user: linkedUser, created: false, linked: true, address: linkCheck.fields.address };
  }

  const config = beldexConfig();
  const check = verifyAuthStatement({
    text: input.statement,
    signature: input.signature,
    nettype: config.nettype,
    expectedDomain: input.expectedDomain,
  });
  if (!check.valid) throw new AuthError(`Wallet signature rejected: ${check.reason}`, 401);

  const decoded = decodeAddress(check.fields.address, config.nettype);
  if (!decoded.ok) throw new AuthError(`Wallet address rejected: ${decoded.reason}`, 401);

  const consumed = await store.consumeAuthChallenge(check.fields.nonce, "signin");
  if (!consumed) throw new AuthError("This sign-in challenge was already used or has expired.", 401);

  const address = check.fields.address;
  const { one } = await import("./db");
  const wallet = await one<{ user_id: string }>(
    "select user_id from wallets where nettype = $1 and address = $2",
    [config.nettype, address]
  );

  if (wallet) {
    const user = await store.getUserById(wallet.user_id);
    if (!user) throw new AuthError("This wallet's account was removed.", 403);
    if (user.status !== "active") throw new AuthError("This account is not active.", 403);
    await store.upsertWallet({ userId: user.id, nettype: config.nettype, address, ownershipProven: true });
    return { user, created: false, linked: false, address };
  }

  const user = await store.createUser({ displayName: null, avatarUrl: null });
  await store.upsertWallet({ userId: user.id, nettype: config.nettype, address, ownershipProven: true });
  await store.attachLinkedAccount({
    userId: user.id,
    provider: "wallet",
    providerAccountId: `${config.nettype}:${address}`,
    handle: null,
    email: null,
    profile: { nettype: config.nettype, address },
  });
  await store.audit({ actorUserId: user.id, action: "auth.wallet_account_created", subject: config.nettype });
  return { user, created: true, linked: false, address };
}
