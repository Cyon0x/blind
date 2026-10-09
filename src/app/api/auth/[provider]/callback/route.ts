import { NextResponse, type NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { AuthError, appUrl, requestContext, setSessionCookies, startSession } from "@/lib/session";
import { callbackPath, exchangeGoogleCode, exchangeXCode, googleConfigured, resolveIdentity, xConfigured } from "@/lib/auth";
import { attachLinkedAccount, audit, consumeOauthState, notify } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const host = request.headers.get("host");
  const base = appUrl(host);
  if (provider !== "google" && provider !== "x") {
    return NextResponse.redirect(`${base}/signin?error=unknown_provider`, { status: 302 });
  }
  const params = request.nextUrl.searchParams;
  const error = params.get("error");
  if (error) {
    return NextResponse.redirect(`${base}/signin?error=${encodeURIComponent(error)}`, { status: 302 });
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return NextResponse.redirect(`${base}/signin?error=missing_code`, { status: 302 });
  }

  return handle(async () => {
    // The state row is consumed by the same statement that reads it, so a
    // replayed callback URL cannot start a second session.
    const stored = await consumeOauthState(state, provider);
    if (!stored) throw new AuthError("This sign-in link is no longer valid. Start again.", 400);

    const redirectUri = `${base}${callbackPath(provider)}`;
    const identity =
      provider === "google"
        ? await (async () => {
            if (!googleConfigured()) throw new AuthError("Google sign-in is not configured.", 503);
            return exchangeGoogleCode(code, stored.code_verifier, redirectUri);
          })()
        : await (async () => {
            if (!xConfigured()) throw new AuthError("X sign-in is not configured.", 503);
            return exchangeXCode(code, stored.code_verifier, redirectUri);
          })();

    const context = await requestContext();

    if (stored.link_user_id) {
      await attachLinkedAccount({
        userId: stored.link_user_id,
        provider: identity.provider,
        providerAccountId: identity.providerAccountId,
        handle: identity.provider === "x" ? identity.handle : null,
        email: identity.provider === "google" ? identity.email : null,
        profile:
          identity.provider === "google"
            ? { name: identity.name, picture: identity.picture }
            : { name: identity.name, picture: identity.picture, handle: identity.handle },
      });
      await audit({ actorUserId: stored.link_user_id, action: "auth.provider_linked", subject: identity.provider, ipHash: context.ipHash });
      return NextResponse.redirect(`${base}/dashboard/settings?linked=${identity.provider}`, { status: 302 });
    }

    const result = await resolveIdentity(identity);
    const token = await startSession({ userId: result.user.id, userAgent: context.userAgent, ipHash: context.ipHash });
    await setSessionCookies(token);
    await audit({
      actorUserId: result.user.id,
      action: result.created ? "auth.signin_new_account" : "auth.signin",
      subject: identity.provider,
      ipHash: context.ipHash,
    });
    if (result.created) {
      await notify({
        userId: result.user.id,
        kind: "welcome",
        title: "Welcome to Blind",
        body: "Pick a username, then link a Beldex wallet so you can send and claim payments.",
      });
    }
    const next = stored.redirect_to && stored.redirect_to.startsWith("/") ? stored.redirect_to : null;
    const destination = next ?? (result.user.username ? "/dashboard" : "/onboarding");
    return NextResponse.redirect(`${base}${destination}`, { status: 302 });
  });
}
