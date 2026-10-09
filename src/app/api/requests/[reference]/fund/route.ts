import { handle, json, fail, limited } from "@/lib/api";
import { assertSameOrigin, currentSession } from "@/lib/session";
import { PaymentError, refreshFunding } from "@/lib/payments";
import { getPaymentByReference, setCounterparty } from "@/lib/store";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

/**
 * "I sent it — check now" for the payer of an escrow request.
 *
 * A payer does not need a Blind account, so this is same-origin and rate-limited
 * rather than session-gated. That is safe because it is a *read* of the escrow
 * wallet: the state only advances when the deposit is really visible and the
 * chain agrees, and the transition itself is a conditional UPDATE, so two tabs
 * (or two payers) cannot fund it twice.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    await assertSameOrigin();
    const throttle = await limited("request:fund", 60, 60_000);
    if (throttle) return throttle;
    const { reference } = await ctx.params;
    const payment = await getPaymentByReference(reference);
    if (!payment || payment.kind !== "request") return fail(404, "not_found", "That payment request is not valid.");
    if (payment.payout_mode !== "escrow") {
      return fail(409, "direct_request", "This request pays the recipient's own address directly; there is no escrow to fund.");
    }
    if (payment.status !== "awaiting_payment") {
      throw new PaymentError(`This request is already ${payment.status}.`, 409);
    }
    const session = await currentSession();
    if (session) await setCounterparty(payment.id, session.user.id);

    const result = await refreshFunding(payment);
    return json({
      ok: true,
      changed: result.changed,
      detail: result.detail,
      depositConfirmations: result.depositConfirmations,
      required: result.required,
      payment: paymentView(result.payment, session?.user.id ?? null),
    });
  });
}
