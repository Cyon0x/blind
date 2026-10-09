import { handle, json } from "@/lib/api";
import { currentSession } from "@/lib/session";
import { claimLinkFor } from "@/lib/payments";
import { getPaymentByReference, listPaymentEvents } from "@/lib/store";
import { paymentView } from "@/lib/views";
import { fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * A payment's own page. Anyone holding the reference may read the amount and
 * state (that is what a shared link is), but the shaping in paymentView keeps
 * every participant's addresses and identity out of it.
 */
export async function GET(request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    const { reference } = await ctx.params;
    const payment = await getPaymentByReference(reference);
    if (!payment) return fail(404, "not_found", "That payment does not exist.");
    const session = await currentSession();
    const view = paymentView(payment, session?.user.id ?? null);
    const claimLink = session
      ? await claimLinkFor(payment, session.user.id)
      : { url: null, resealable: false, sealedOnly: true, reason: null };
    const events =
      view.role === "creator" || view.role === "counterparty"
        ? await listPaymentEvents(payment.id)
        : [];
    return json({ ok: true, payment: view, claimLink, events });
  });
}
