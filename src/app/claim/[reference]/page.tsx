import Link from "next/link";
import { notFound } from "next/navigation";
import { Iris } from "@/components/Iris";
import { StatePill } from "@/components/StatePill";
import { ClaimFlow } from "@/components/ClaimFlow";
import { SiteFooter, SiteHeader } from "@/components/Chrome";
import { currentSession } from "@/lib/session";
import { claimLinkFor, sweepExpired } from "@/lib/payments";
import { getPaymentByReference } from "@/lib/store";
import { paymentView } from "@/lib/views";
import { beldexConfig, beldexStatus } from "@/lib/beldex/config";
import { formatBdx } from "@/lib/beldex/units";

export const dynamic = "force-dynamic";
export const metadata = { title: "Claim a payment", robots: { index: false, follow: false } };

export default async function ClaimPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  await sweepExpired().catch(() => 0);
  const payment = await getPaymentByReference(reference);
  if (!payment || payment.kind !== "pay") notFound();

  const session = await currentSession();
  const view = paymentView(payment, session?.user.id ?? null);
  const config = beldexConfig();
  const status = beldexStatus();
  const link = session ? await claimLinkFor(payment, session.user.id) : { url: null, resealable: false, sealedOnly: true, reason: null };

  return (
    <>
      <SiteHeader signedIn={Boolean(session)} />
      <main id="main" className="wrap-shell grid items-start gap-12 py-10 lg:grid-cols-[.85fr_1.15fr] lg:py-16">
        <div className="stack gap-6">
          <Iris state={view.statusTone} size={200} title="The aperture: closed until this payment is claimed, open once it settles" />
          <div className="flex flex-wrap items-center gap-3">
            <StatePill status={payment.status} label={view.statusLabel} />
            <span className="figure text-[12px] muted">{payment.reference}</span>
          </div>
          <h2 className="display text-[clamp(26px,4vw,40px)]">Blind can move this money. Blind does not know who you are.</h2>
          <ul className="stack gap-2 muted text-[15px]">
            <li>The claim secret sits after the <code>#</code>, so your browser never sends it anywhere until you claim.</li>
            <li>You choose the address the money lands in. Blind is never told who owns it.</li>
            <li>The payer is not told that address either, not by Blind.</li>
            <li>
              Amount and asset: <strong className="figure">{formatBdx(view.amountDisplay ? payment.amount_atomic : "0")} BDX</strong>
              {payment.description ? <> · {payment.description}</> : null}
            </li>
          </ul>
          <p className="faint text-[13px]">{view.custody.fundsAtRest}</p>
          <p className="faint text-[13px]">
            Read <Link href="/#privacy" className="underline">what Blind can and cannot see</Link> before you claim.
          </p>
        </div>

        <div className="panel stack gap-6">
          <ClaimFlow
            reference={payment.reference}
            amountDisplay={formatBdx(payment.deposit_amount_atomic ?? payment.amount_atomic)}
            status={payment.status}
            nettype={config.nettype}
            escrowConfigured={config.escrowEnabled}
            explorerUrl={config.explorerUrl}
            sealedClaimUrl={link.url}
          />
        </div>
      </main>
      <SiteFooter nettype={status.nettype} daemon={status.daemon} escrow={status.escrow} />
    </>
  );
}
