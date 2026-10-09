import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Iris } from "@/components/Iris";
import { StatePill } from "@/components/StatePill";
import { CopyField } from "@/components/CopyField";
import { QrPanel } from "@/components/QrPanel";
import { RequestPayPanel } from "@/components/RequestPayPanel";
import { SiteFooter, SiteHeader } from "@/components/Chrome";
import { appUrl, currentSession } from "@/lib/session";
import { requestPayerTarget, sweepExpired } from "@/lib/payments";
import { getPaymentByReference } from "@/lib/store";
import { paymentView, settlementWording } from "@/lib/views";
import { beldexConfig, beldexStatus } from "@/lib/beldex/config";
import { formatBdx } from "@/lib/beldex/units";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const payment = await getPaymentByReference(reference);
  return {
    title: payment?.description ? `Pay: ${payment.description}` : "Pay a Blind request",
    robots: { index: false, follow: false },
  };
}

export default async function RequestPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  await sweepExpired().catch(() => 0);
  const payment = await getPaymentByReference(reference);
  if (!payment) notFound();
  if (payment.kind === "pay") redirect(`/claim/${payment.reference}`);

  const session = await currentSession();
  const view = paymentView(payment, session?.user.id ?? null);
  const config = beldexConfig();
  const status = beldexStatus();
  const target = requestPayerTarget(payment);
  const isCreator = view.role === "creator";
  const shareUrl = `${appUrl()}/r/${payment.reference}`;

  return (
    <>
      <SiteHeader signedIn={Boolean(session)} />
      <main id="main" className="wrap-shell grid items-start gap-12 py-10 lg:grid-cols-[1.1fr_.9fr] lg:py-16">
        <div className="stack gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="label">Blind Request</span>
            <StatePill status={payment.status} label={view.statusLabel} />
            <span className="figure text-[12px] muted">{payment.reference}</span>
          </div>
          <h1 className="display text-[clamp(38px,7vw,68px)]">{formatBdx(payment.amount_atomic)} BDX</h1>
          {payment.description ? <p className="muted text-[17px]">{payment.description}</p> : null}
          {payment.invoice_ref ? <p className="faint text-[13px]">invoice ref {payment.invoice_ref}</p> : null}
          <p className="text-[15px]">{settlementWording(view)}</p>
          <ul className="stack gap-2 muted text-[15px]">
            <li>Nobody here is asked for a name, an email or an account.</li>
            <li>
              {target.mode === "escrow"
                ? "You pay a one-time escrow address; Blind forwards the money to the person who asked. Your wallet is not photographed."
                : "This request pays the recipient's own address directly. That address is visible to you, it is what direct mode costs."}
            </li>
            <li>Blind never stores your wallet&rsquo;s history or balance.</li>
          </ul>
          <p className="faint text-[13px]">{view.custody.fundsAtRest}</p>
        </div>

        <div className="panel stack gap-6">
          {isCreator ? (
            <div className="stack gap-5">
              <span className="label">This is your request</span>
              <p className="muted text-[15px]">
                Share this link or QR code. Nobody who opens it learns your address, your balance or your other payments.
              </p>
              <CopyField label="request link" value={shareUrl} />
              <QrPanel value={shareUrl} size={180} caption="Scanning opens this request so someone can pay it." />
              <Link className="btn btn-ghost" href={`/dashboard/payments/${payment.reference}`}>
                Open it in your dashboard
              </Link>
            </div>
          ) : target.open ? (
            <RequestPayPanel
              reference={payment.reference}
              amountDisplay={formatBdx(payment.amount_atomic)}
              amountAtomic={payment.amount_atomic}
              mode={target.mode}
              depositIntegratedAddress={target.depositIntegratedAddress}
              payoutAddress={target.payoutAddress}
              escrowConfigured={config.escrowEnabled}
              explorerUrl={config.explorerUrl}
            />
          ) : (
            <div className="stack gap-4 items-start">
              <Iris state={view.statusTone} size={80} />
              <p className="text-[16px]">{target.reason ?? "This request cannot be paid right now."}</p>
              <p className="faint text-[13px]">
                Nothing was charged. If you already sent money, the recipient can see it in their own dashboard and in the
                escrow.
              </p>
              <Link className="pill" href="/signin">
                sign in to keep track of payments
              </Link>
            </div>
          )}
        </div>
      </main>
      <SiteFooter nettype={status.nettype} daemon={status.daemon} escrow={status.escrow} />
    </>
  );
}
