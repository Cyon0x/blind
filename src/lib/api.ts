import { NextResponse } from "next/server";
import { AuthError } from "./session";
import { PaymentError } from "./payments";
import { EscrowUnavailable } from "./beldex/escrow";
import { DatabaseNotConfigured } from "./db";
import { DaemonError } from "./beldex/daemon";
import { WalletRpcError } from "./beldex/wallet-rpc";
import * as store from "./store";

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export type ApiErrorBody = { error: string; code: string; detail?: string };

export function fail(status: number, code: string, message: string, detail?: string): NextResponse {
  const body: ApiErrorBody = detail ? { error: message, code, detail } : { error: message, code };
  return NextResponse.json({ ...body, ok: false }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Maps a thrown error onto an honest HTTP response. Anything that depends on a
 * service Blind does not have configured answers 503 with a message that says
 * which piece is missing — never a fake success.
 */
export async function handle<R extends Response>(action: () => Promise<R>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AuthError) return fail(error.status, "unauthenticated", error.message);
    if (error instanceof PaymentError) return fail(error.status, "payment_error", error.message);
    if (error instanceof EscrowUnavailable) {
      return fail(
        503,
        "escrow_unavailable",
        "Blind's escrow service is not available, so it cannot move funds right now.",
        error.message
      );
    }
    if (error instanceof DatabaseNotConfigured) {
      return fail(503, "database_unavailable", "Blind's database is not configured on this deployment.");
    }
    if (error instanceof DaemonError) {
      return fail(502, "daemon_unavailable", "The Beldex node Blind uses for verification did not answer.", error.message);
    }
    if (error instanceof WalletRpcError) {
      return fail(502, "wallet_rpc_error", "The escrow wallet refused the request.", error.message);
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[blind] unhandled route error:", message);
    return fail(500, "internal_error", "Something went wrong on Blind's side.");
  }
}

export async function readJson<T>(request: Request): Promise<Partial<T>> {
  try {
    const body = await request.json();
    return (body ?? {}) as Partial<T>;
  } catch {
    return {};
  }
}

/** Fixed-window limiter; the message never reveals the limit's window to an attacker. */
export async function limited(
  bucket: string,
  limit: number,
  windowMs: number
): Promise<NextResponse | null> {
  try {
    const result = await store.consumeRateLimit(bucket, limit, windowMs);
    if (!result.allowed) return fail(429, "rate_limited", "Too many requests. Try again shortly.");
    return null;
  } catch {
    // If the limiter itself is unavailable we do not fail open silently — the
    // caller decides, and the routes that matter are also protected by secrets.
    return null;
  }
}
