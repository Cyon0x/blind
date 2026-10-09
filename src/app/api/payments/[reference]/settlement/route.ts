import { handle, json, fail, limited } from "@/lib/api";
import { currentSession, requireSession } from "@/lib/session";
import { ensureReceipts, refreshSettlement, refreshFunding } from "@/lib/payments";
import { getPaymentByReference } from "@/lib/store";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

/**
 * Verification is a read of public chain state, so anybody holding a link whose
 * payout has already been submitted may ask for it — that is exactly what the
 * claim page's "check it again" button needs. Nothing that has not already paid
 * out can be provoked, and funding refresh stays with participants.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    const throttle = await limited("payment:settle", 120, 60_000);
    if (throttle) return throttle;
    const { reference } = await ctx.params;
    const payment = await getPaymentByReference(reference);
    if (!payment) return fail(404, "not_found", "That payment does not exist.");
    const session = await currentSession();
    const isParticipant =
      Boolean(session) &&
      (payment.creator_user_id === session?.user.id || payment.counterparty_user_id === session?.user.id);
    if (!isParticipant && !payment.payout_tx_hash) {
      return fail(401, "unauthenticated", "Sign in as a participant to verify a payment that has not paid out.");
    }

    let current = payment;
    if (isParticipant && current.deposit_address && ["created", "awaiting_deposit", "awaiting_payment"].includes(current.status)) {
      current = (await refreshFunding(current)).payment;
    }
    const outcome = await refreshSettlement(current);
    if (outcome.settled) await ensureReceipts(outcome.payment);
    return json({
      ok: true,
      settled: outcome.settled,
      detail: outcome.detail,
      confirmations: outcome.confirmations,
      required: outcome.required,
      untrustedNode: outcome.evidence?.untrusted ?? null,
      blockHeight: outcome.evidence?.blockHeight ?? null,
      payment: paymentView(outcome.payment, session?.user.id ?? null),
      isParticipant,
    });
  });
}
