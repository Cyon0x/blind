import { handle, json, fail, limited } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { claimLinkFor } from "@/lib/payments";
import { claimSealingConfigured } from "@/lib/seal";
import { audit, getPaymentByReference } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Re-displays a claim link to someone entitled to hold it: the payer who
 * created it, or the Blind account a username payment was addressed to. The
 * secret is stored sealed and this is the only route that ever unwraps it.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    const throttle = await limited("claim:link", 60, 60_000);
    if (throttle) return throttle;
    const session = await requireSession();
    const { reference } = await ctx.params;
    const payment = await getPaymentByReference(reference);
    if (!payment) return fail(404, "not_found", "That payment does not exist.");
    const entitled = payment.creator_user_id === session.user.id || payment.counterparty_user_id === session.user.id;
    if (!entitled) return fail(403, "forbidden", "This claim link is not yours to display.");
    const link = await claimLinkFor(payment, session.user.id);
    if (!link.url) {
      return json({
        ok: false,
        resealable: false,
        sealingConfigured: claimSealingConfigured(),
        error: link.reason ?? "This link cannot be displayed.",
      });
    }
    await audit({
      actorUserId: session.user.id,
      action: payment.creator_user_id === session.user.id ? "claim.link_disclosed" : "claim.link_disclosed_addressee",
      subject: payment.reference,
    });
    return json({ ok: true, url: link.url, resealable: link.resealable, sealingConfigured: true });
  });
}
