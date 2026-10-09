import { handle, json, fail } from "@/lib/api";
import { requireMutation } from "@/lib/session";
import { refundClaim } from "@/lib/payments";
import { getPaymentByReference } from "@/lib/store";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

/** Takes back an unclaimed payment to an address the payer controls. */
export async function POST(request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    const session = await requireMutation();
    const { reference } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { address?: string };
    if (!body.address) return fail(400, "missing_address", "A refund address is required.");
    const payment = await getPaymentByReference(reference);
    if (!payment) return fail(404, "not_found", "That payment does not exist.");
    const outcome = await refundClaim({ reference, userId: session.user.id, toAddress: body.address });
    return json({
      ok: true,
      detail: outcome.detail,
      payoutTxHash: outcome.payoutTxHash,
      payment: paymentView(outcome.payment, session.user.id),
    });
  });
}
