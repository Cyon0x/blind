import { handle, json, limited, readJson } from "@/lib/api";
import { AuthError, appUrl, authDomains, currentSession, requestContext, setSessionCookies, startSession } from "@/lib/session";
import { verifyWalletSignIn } from "@/lib/auth";
import { audit, notify } from "@/lib/store";

export const dynamic = "force-dynamic";

type Body = { statement?: string; signature?: string; purpose?: "signin" | "link" };

export async function POST(request: Request) {
  return handle(async () => {
    const throttle = await limited("wallet:verify", 40, 60_000);
    if (throttle) return throttle;
    const body = await readJson<Body>(request);
    if (!body.statement || !body.signature) throw new AuthError("A wallet statement and signature are required.", 400);

    const host = request.headers.get("host");
    const purpose = body.purpose === "link" ? "link" : "signin";
    const existing = purpose === "link" ? await currentSession() : null;
    const result = await verifyWalletSignIn({
      statement: body.statement,
      signature: body.signature,
      expectedDomains: authDomains(host),
      purpose,
      linkUserId: existing?.user.id ?? null,
    });
    if (purpose === "link") return json({ ok: true, linked: true, address: result.address });
    const context = await requestContext();
    const token = await startSession({ userId: result.user.id, userAgent: context.userAgent, ipHash: context.ipHash });
    await setSessionCookies(token);
    await audit({
      actorUserId: result.user.id,
      action: result.created ? "auth.wallet_signin_new_account" : "auth.wallet_signin",
      subject: "wallet",
      ipHash: context.ipHash,
    });
    if (result.created) {
      await notify({
        userId: result.user.id,
        kind: "welcome",
        title: "Welcome to Blind",
        body: "Your wallet is linked. Pick a username so people can request payments from you.",
      });
    }
    return json({
      ok: true,
      created: result.created,
      redirectTo: result.user.username ? "/dashboard" : "/onboarding",
      url: appUrl(host),
    });
  });
}
