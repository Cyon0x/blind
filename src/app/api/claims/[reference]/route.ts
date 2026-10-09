import { handle, json, fail, limited, readJson } from "@/lib/api";
import { assertSameOrigin, currentSession } from "@/lib/session";
import { claimPayment } from "@/lib/payments";
import { getPaymentByReference } from "@/lib/store";
import { paymentView } from "@/lib/views";
import { beldexConfig } from "@/lib/beldex/config";

export const dynamic = "force-dynamic";

/** What a claim page may know before the secret is presented. */
export async function GET(_request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    const { reference } = await ctx.params;
    const payment = await getPaymentByReference(reference);
    if (!payment || payment.kind !== "pay") return fail(404, "not_found", "That payment link is not valid.");
    const session = await currentSession();
    return json({ ok: true, payment: paymentView(payment, session?.user.id ?? null), nettype: beldexConfig().nettype });
  });
}

type Body = { secret?: string; payoutAddress?: string };

/**
 * The claim itself. The link holder may have no Blind account, so the secret is
 * the credential: it is hashed and compared inside the state transition. The
 * same-origin check and a rate limit are the only other gates, and a wrong
 * secret is indistinguishable from an unknown one.
 */
export async function POST(request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    await assertSameOrigin();
    const throttle = await limited("claim:attempt", 30, 60_000);
    if (throttle) return throttle;
    const { reference } = await ctx.params;
    const body = await readJson<Body>(request);
    if (!body.secret) return fail(400, "missing_secret", "This link is missing its claim secret.");
    if (!body.payoutAddress) return fail(400, "missing_address", "A Beldex address is required to receive the payment.");

    const session = await currentSession();
    const outcome = await claimPayment({
      reference,
      secret: body.secret,
      payoutAddress: body.payoutAddress,
      claimerUserId: session?.user.id ?? null,
    });

    return json({
      ok: true,
      status: outcome.status,
      detail: outcome.detail,
      payoutTxHash: outcome.payoutTxHash,
      confirmations: outcome.confirmations,
      required: outcome.required,
      payment: paymentView(outcome.payment, session?.user.id ?? null),
    });
  });
}
