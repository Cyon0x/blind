import { handle, json, fail } from "@/lib/api";
import { requireMutation } from "@/lib/session";
import { refreshFunding } from "@/lib/payments";
import { getPaymentByReference } from "@/lib/store";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

/**
 * Re-reads the escrow wallet and the chain, then advances the state if the
 * evidence supports it. Safe to call repeatedly; the transition itself is a
 * conditional UPDATE, so two tabs cannot double-fund anything.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    const session = await requireMutation();
    const { reference } = await ctx.params;
    const payment = await getPaymentByReference(reference);
    if (!payment) return fail(404, "not_found", "That payment does not exist.");
    if (payment.creator_user_id !== session.user.id) return fail(403, "forbidden", "Only the payer can refresh funding.");
    const result = await refreshFunding(payment);
    return json({
      ok: true,
      changed: result.changed,
      detail: result.detail,
      depositConfirmations: result.depositConfirmations,
      required: result.required,
      payment: paymentView(result.payment, session.user.id),
    });
  });
}
