import { NextResponse, type NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { AuthError } from "@/lib/session";
import { appUrl, currentSession, originAllowed } from "@/lib/session";
import { callbackPath, googleAuthUrl, googleConfigured, newState, pkcePair, xAuthUrl, xConfigured } from "@/lib/auth";
import { consumeRateLimit, createOauthState } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Begins an OAuth sign-in. `?link=1` attaches the provider to the signed-in
 * account instead of creating or switching accounts.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  return handle(async () => {
    const { provider } = await ctx.params;
    if (provider !== "google" && provider !== "x") throw new AuthError("Unknown sign-in provider.", 404);

    const origin = request.headers.get("origin");
    if (origin && !originAllowed(origin)) throw new AuthError("Cross-site sign-in refused.", 403);

    const host = request.headers.get("host");
    const base = appUrl(host);
    const limit = await consumeRateLimit(`oauth:start:${host ?? "unknown"}:${provider}`, 40, 60_000);
    if (!limit.allowed) return NextResponse.redirect(`${base}/signin?error=rate_limited`, { status: 302 });

    if (provider === "google" && !googleConfigured()) {
      return NextResponse.redirect(`${base}/signin?error=google_not_configured`, { status: 302 });
    }
    if (provider === "x" && !xConfigured()) {
      return NextResponse.redirect(`${base}/signin?error=x_not_configured`, { status: 302 });
    }

    const wantsLink = request.nextUrl.searchParams.get("link") === "1";
    const session = wantsLink ? await currentSession() : null;

    const state = newState();
    const { verifier, challenge } = pkcePair();
    const redirectUri = `${base}${callbackPath(provider)}`;
    await createOauthState({
      state,
      provider,
      codeVerifier: verifier,
      redirectTo: request.nextUrl.searchParams.get("next"),
      linkUserId: session?.user.id ?? null,
      ttlMs: 10 * 60 * 1000,
    });

    const url =
      provider === "google"
        ? googleAuthUrl({ redirectUri, state, challenge })
        : xAuthUrl({ redirectUri, state, challenge });
    return NextResponse.redirect(url, { status: 302 });
  });
}
