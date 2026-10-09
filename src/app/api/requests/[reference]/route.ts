import { handle, json, fail, limited } from "@/lib/api";
import { currentSession } from "@/lib/session";
import { requestPayerTarget, sweepExpired } from "@/lib/payments";
import { getPaymentByReference } from "@/lib/store";
import { paymentView } from "@/lib/views";
import { beldexConfig } from "@/lib/beldex/config";

export const dynamic = "force-dynamic";

/**
 * A request as a payer sees it.
 *
 * The amount, the words and the state are public to anyone holding the link —
 * that is what a shared request is. `target` adds only what a payer needs in
 * order to pay: a one-time escrow address in escrow mode, or the recipient's own
 * address in direct mode. Neither reveals who the recipient is.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    const throttle = await limited("request:read", 120, 60_000);
    if (throttle) return throttle;
    await sweepExpired().catch(() => 0);
    const { reference } = await ctx.params;
    const payment = await getPaymentByReference(reference);
    if (!payment || payment.kind !== "request") return fail(404, "not_found", "That payment request is not valid.");
    const session = await currentSession();
    const view = paymentView(payment, session?.user.id ?? null);
    return json({
      ok: true,
      payment: view,
      target: requestPayerTarget(payment),
      nettype: beldexConfig().nettype,
      escrowConfigured: beldexConfig().escrowEnabled,
      viewer: session ? { signedIn: true, isCreator: payment.creator_user_id === session.user.id } : { signedIn: false },
    });
  });
}
