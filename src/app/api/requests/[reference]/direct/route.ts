import { handle, json, fail, readJson } from "@/lib/api";
import { requireMutation } from "@/lib/session";
import { markDirectRequestPaid, recipientConfirmsDirect } from "@/lib/payments";
import { getPaymentByReference } from "@/lib/store";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

type Body = { action?: "payer_sent" | "recipient_received"; payerWalletAddress?: string };

/**
 * Direct requests have no escrow, so the two parties report the outcome and
 * Blind says exactly that instead of claiming chain verification.
 */
export async function POST(request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    const session = await requireMutation();
    const { reference } = await ctx.params;
    const body = await readJson<Body>(request);
    const payment = await getPaymentByReference(reference);
    if (!payment || payment.kind !== "request") return fail(404, "not_found", "That request does not exist.");
    if (payment.payout_mode !== "direct") return fail(409, "escrow_request", "This request settles through the escrow.");

    if (body.action === "recipient_received") {
      const updated = await recipientConfirmsDirect({ reference, userId: session.user.id });
      return json({ ok: true, confirmed: true, payment: paymentView(updated, session.user.id) });
    }
    const updated = await markDirectRequestPaid({
      reference,
      payerUserId: session.user.id,
      payerWalletAddress: body.payerWalletAddress ?? null,
    });
    return json({ ok: true, reported: true, payment: paymentView(updated, session.user.id) });
  });
}
