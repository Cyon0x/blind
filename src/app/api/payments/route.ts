import { handle, json, readJson } from "@/lib/api";
import { appUrl, authDomain, requireMutation, requireSession } from "@/lib/session";
import { PaymentError, createPay, createRequest, sweepExpired } from "@/lib/payments";
import { toAtomic } from "@/lib/beldex/units";
import { getUserByUsername, listPaymentsForUser } from "@/lib/store";
import { paymentView } from "@/lib/views";
import { beldexConfig } from "@/lib/beldex/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const session = await requireSession();
    await sweepExpired().catch(() => 0);
    const payments = await listPaymentsForUser(session.user.id);
    return json({
      nettype: beldexConfig().nettype,
      payments: payments.map((payment) => paymentView(payment, session.user.id)),
    });
  });
}

type Body = {
  kind?: "pay" | "request";
  amount?: string;
  description?: string;
  invoiceRef?: string;
  expiresInHours?: number;
  payoutAddress?: string;
  payoutMode?: "escrow" | "direct";
  /** Address a Blind Pay to a username instead of handing the link to the payer. */
  toUsername?: string;
};

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireMutation();
    const body = await readJson<Body>(request);
    const host = request.headers.get("host");
    const base = appUrl(host);

    if (!body.amount) throw new PaymentError("An amount is required.");
    let amountAtomic: bigint;
    try {
      amountAtomic = toAtomic(body.amount);
    } catch (error) {
      throw new PaymentError(error instanceof Error ? error.message : "That amount is not valid.");
    }
    if (amountAtomic <= 0n) throw new PaymentError("The amount must be greater than zero.");
    const maxAtomic = BigInt(process.env.BDX_MAX_PAYMENT_ATOMIC ?? "1000000000000000");
    if (amountAtomic > maxAtomic) throw new PaymentError("That amount is above the limit this deployment accepts.");

    const kind = body.kind === "request" ? "request" : "pay";

    // A username payment: the claim link is delivered to that account, never to
    // the payer. Blind resolves the handle to an internal id — the handle itself
    // never becomes an identifier, and no address is ever published.
    let addressedToUserId: string | null = null;
    let addressedTo: string | null = null;
    if (kind === "pay" && body.toUsername) {
      const wanted = body.toUsername.trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(wanted)) throw new PaymentError("That is not a Blind username.");
      const target = await getUserByUsername(wanted);
      if (!target || !target.public_profile) {
        throw new PaymentError(`No public Blind profile matches @${wanted}.`, 404);
      }
      if (target.id === session.user.id) throw new PaymentError("You cannot address a payment to yourself.");
      if (target.status !== "active") throw new PaymentError("That account cannot receive payments.", 409);
      addressedToUserId = target.id;
      addressedTo = wanted;
    }

    const common = {
      userId: session.user.id,
      amountAtomic,
      description: body.description?.slice(0, 280) ?? null,
      invoiceRef: body.invoiceRef?.slice(0, 64) ?? null,
      expiresInHours: body.expiresInHours,
      appUrl: base,
    };

    if (kind === "pay") {
      const created = await createPay({ ...common, addressedToUserId });
      return json({
        ok: true,
        payment: paymentView(created.payment, session.user.id),
        claim: created.claim,
        addressedTo,
      });
    }

    if (!body.payoutAddress) throw new PaymentError("A payout address is required to request money.");
    const created = await createRequest({
      ...common,
      payoutAddress: body.payoutAddress,
      payoutMode: body.payoutMode === "direct" ? "direct" : "escrow",
    });
    return json({
      ok: true,
      payment: paymentView(created.payment, session.user.id),
      request: { url: created.url, checksumVerified: created.checksumVerified, domain: authDomain(host) },
    });
  });
}
