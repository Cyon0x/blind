import Link from "next/link";
import { notFound } from "next/navigation";
import { Iris } from "@/components/Iris";
import { StatePill } from "@/components/StatePill";
import { FundingPanel } from "@/components/FundingPanel";
import { ClaimFlow } from "@/components/ClaimFlow";
import { QrPanel } from "@/components/QrPanel";
import { currentSession } from "@/lib/session";
import { getPaymentByReference, listPaymentEvents, getReceiptForPayment } from "@/lib/store";
import { claimLinkFor } from "@/lib/payments";
import { paymentView, settlementWording } from "@/lib/views";
import { beldexConfig } from "@/lib/beldex/config";
import { appUrl } from "@/lib/session";
import { formatBdx } from "@/lib/beldex/units";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PaymentDetailPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const session = await currentSession();
  if (!session) notFound();
  const payment = await getPaymentByReference(reference);
  if (!payment) notFound();
  const isParticipant = payment.creator_user_id === session.user.id || payment.counterparty_user_id === session.user.id;
  if (!isParticipant) notFound();

  const view = paymentView(payment, session.user.id);
  const events = await listPaymentEvents(payment.id);
  const [payerReceipt, recipientReceipt] = await Promise.all([
    getReceiptForPayment(payment.id, "payer"),
    getReceiptForPayment(payment.id, "recipient"),
  ]);
  const claimLink =
    payment.kind === "pay" && (view.role === "creator" || view.role === "counterparty")
      ? await claimLinkFor(payment, session.user.id)
      : { url: null, resealable: false, sealedOnly: true, reason: null };
  const addressedElsewhere =
    payment.kind === "pay" &&
    view.role === "creator" &&
    payment.counterparty_user_id !== null &&
    ["created", "awaiting_deposit", "funded"].includes(payment.status);
  const base = appUrl();
  const shareUrl =
    payment.kind === "pay"
      ? claimLink.url
      : `${base}/r/${payment.reference}`;

  return (
    <div className="stack gap-8 pt-4">
      <nav className="flex items-center gap-3">
        <Link href="/dashboard/payments" className="pill whitespace-nowrap">
          ← Payments
        </Link>
        <span className="figure text-[12px] faint whitespace-nowrap">{payment.reference}</span>
      </nav>

      <section className="grid gap-6 lg:grid-cols-[1.3fr_.7fr]">
        <div className="panel stack gap-5">
          <span className="label">{payment.kind === "pay" ? "Blind Pay" : "Blind Request"}</span>
          <div className="flex flex-wrap items-baseline gap-4">
            <h1 className="display text-[clamp(38px,7vw,72px)]">{formatBdx(payment.amount_atomic)} BDX</h1>
            <StatePill status={payment.status} label={view.statusLabel} />
          </div>
          {payment.description ? <p className="muted text-[17px]">{payment.description}</p> : null}
          <p className="text-[15px]">{settlementWording(view)}</p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail k="Your side" v={view.role === "creator" ? (payment.kind === "pay" ? "payer" : "recipient") : "recipient"} />
            <Detail k="Created" v={timeAgo(payment.created_at)} />
            <Detail k="Funding" v={payment.deposit_tx_hash ? `${payment.deposit_confirmations} conf · ${payment.deposit_tx_hash.slice(0, 12)}…` : "not seen yet"} />
            <Detail k="Payout" v={payment.payout_tx_hash ? `${payment.payout_confirmations} conf · ${payment.payout_tx_hash.slice(0, 12)}…` : "not sent yet"} />
            <Detail k="Invoice ref" v={payment.invoice_ref ?? "not set"} />
            <Detail k="Expiry" v={payment.expires_at ? new Date(payment.expires_at).toISOString().slice(0, 16).replace("T", " ") : "none"} />
          </dl>
        </div>

        <div className="stack gap-6">
          <div className="panel stack items-center gap-4">
            <span className="label">Share</span>
            {shareUrl ? (
              <QrPanel
                value={shareUrl}
                size={180}
                caption={
                  payment.kind === "pay"
                    ? "Scanning this claims the payment into a Beldex wallet."
                    : "Scanning this opens the request so someone can pay it."
                }
              />
            ) : (
              <>
                <Iris state="latent" size={110} />
                <p className="faint text-center text-[13px]">
                  {addressedElsewhere
                    ? "This payment is addressed to another Blind account. Its claim link is sealed with Blind and only they can open it, the payer is never handed the credential."
                    : "The claim link is sealed on this deployment and can be re-displayed from Step 2 once the payment is funded."}
                </p>
              </>
            )}
          </div>
          <div className="panel stack gap-3">
            <span className="label">Custody, in one line</span>
            <p className="faint text-[13px]">{view.custody.fundsAtRest}</p>
            <p className="faint text-[13px]">
              The escrow can spend a deposit only to the address recorded by the claim that owns it. Blind cannot pay
              your deposit to anyone else, and does not learn your wallet&apos;s balance.
            </p>
          </div>
        </div>
      </section>

      {payment.kind === "pay" && view.role === "creator" ? (
        <section className="panel">
          <FundingPanel
            reference={payment.reference}
            amountDisplay={formatBdx(payment.amount_atomic)}
            amountAtomic={payment.amount_atomic}
            status={payment.status}
            depositIntegratedAddress={payment.deposit_integrated_address}
            claimUrl={claimLink.url}
            confirmations={payment.deposit_confirmations}
            required={beldexConfig().confirmationsForSettlement}
            payoutTxHash={payment.payout_tx_hash}
            explorerUrl={view.explorerUrl}
            expiresAt={payment.expires_at}
            escrowConfigured={beldexConfig().escrowEnabled}
            kind="pay"
            payoutMode={payment.payout_mode}
          />
        </section>
      ) : null}

      {payment.kind === "pay" && view.role === "counterparty" ? (
        <section className="panel stack gap-5">
          <span className="label">Your side</span>
          <ClaimFlow
            reference={payment.reference}
            amountDisplay={formatBdx(payment.deposit_amount_atomic ?? payment.amount_atomic)}
            status={payment.status}
            nettype={beldexConfig().nettype}
            escrowConfigured={beldexConfig().escrowEnabled}
            explorerUrl={view.explorerUrl}
            sealedClaimUrl={claimLink.url}
          />
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel stack gap-4">
          <span className="label">What happened, in order</span>
          {events.length === 0 ? (
            <p className="faint text-[14px]">No events recorded yet.</p>
          ) : (
            <ol className="stack gap-3">
              {events.map((event, index) => (
                <li key={`${event.event}-${index}`} className="flex items-baseline justify-between gap-4">
                  <span className="figure text-[13px]">{event.event}</span>
                  <span className="faint text-[12px]">{timeAgo(event.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="panel stack gap-4">
          <span className="label">Receipts</span>
          {!payerReceipt && !recipientReceipt ? (
            <p className="faint text-[14px]">
              Receipts are issued when the payout has been verified. Blind will not issue one for money it cannot see
              settle.
            </p>
          ) : (
            <ul className="stack gap-3">
              {[
                { receipt: payerReceipt, label: "payer receipt" },
                { receipt: recipientReceipt, label: "recipient receipt" },
              ]
                .filter((entry) => entry.receipt)
                .map((entry) => (
                  <li key={entry.label} className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[14px]">{entry.label}</span>
                    <span className="flex gap-2">
                      <Link href={`/verify/${entry.receipt?.reference}`} className="pill">
                        verify
                      </Link>
                      <a href={`/api/receipts/${entry.receipt?.reference}/pdf`} className="pill">
                        PDF
                      </a>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="faint text-[13px]">{k}</dt>
      <dd className="figure m-0 text-[13px]">{v}</dd>
    </div>
  );
}
