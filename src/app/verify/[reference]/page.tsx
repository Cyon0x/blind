import Link from "next/link";
import { notFound } from "next/navigation";
import { Iris } from "@/components/Iris";
import { CopyField } from "@/components/CopyField";
import { SiteFooter, SiteHeader } from "@/components/Chrome";
import { currentSession } from "@/lib/session";
import { getReceiptByReference } from "@/lib/store";
import { receiptIntegrityCheck, receiptView } from "@/lib/views";
import { beldexStatus } from "@/lib/beldex/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify a receipt", robots: { index: false, follow: false } };

export default async function VerifyPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const receipt = await getReceiptByReference(reference);
  if (!receipt) notFound();

  const session = await currentSession();
  const view = receiptView(receipt);
  const integrity = receiptIntegrityCheck(receipt);
  const status = beldexStatus();

  const fields = Object.entries(receipt.payload ?? {}).filter(([key]) => key !== "reference");

  return (
    <>
      <SiteHeader signedIn={Boolean(session)} />
      <main id="main" className="wrap-shell grid items-start gap-10 py-10 lg:grid-cols-[1fr_1fr] lg:py-16">
        <div className="stack gap-6">
          <Iris state={receipt.settlement_verified ? "fixed" : "developing"} size={190} title="The aperture: open only when settlement was verified" />
          <div className="stack gap-2">
            <span className="label">Receipt · {receipt.side} side</span>
            <h1 className="display text-[clamp(30px,5vw,48px)]">{view.amountDisplay} BDX</h1>
            <span className="figure text-[12px] muted">{receipt.reference}</span>
          </div>
          <p className="text-[16px]">
            {receipt.settlement_verified
              ? `Blind matched this receipt against the Beldex chain with ${receipt.settlement_confirmations} confirmations.`
              : "Blind has no chain-verified settlement for this receipt. Treat it as a record of what was reported, not as proof."}
          </p>
          <div className="panel stack gap-3">
            <span className="label">Integrity</span>
            <p className="text-[15px]">
              {integrity.matches
                ? "The stored fields still hash to the value Blind recorded when it issued this receipt."
                : "These fields no longer match the recorded hash, so this copy has been altered."}
            </p>
            <span className="faint text-[13px]">
              SHA-256 over the sorted receipt fields. Integrity is not a signature, and it is not a zero-knowledge proof:
              it detects edits, it does not settle a payment.
            </span>
          </div>
          <CopyField label="recorded integrity hash" value={receipt.integrity_hash} mono />
          {view.settlementTxHash ? (
            <div className="stack gap-2">
              <span className="label">settlement transaction</span>
              <code className="figure break-all text-[13px]">{view.settlementTxHash}</code>
              {view.explorerHref ? (
                <a className="pill" href={view.explorerHref} target="_blank" rel="noreferrer noopener">
                  open in the explorer
                </a>
              ) : null}
            </div>
          ) : null}
          <a className="btn btn-ghost" href={`/api/receipts/${receipt.reference}/pdf`}>
            Download the PDF
          </a>
          <p className="faint text-[13px]">
            A receipt names neither party&rsquo;s wallet: {receipt.side === "payer" ? "the recipient's" : "the payer's"} address and
            identity are not part of it.
          </p>
        </div>

        <div className="panel stack gap-4">
          <span className="label">What the receipt records</span>
          <dl className="stack gap-3">
            <Row k="Payment reference" v={String(receipt.payload?.reference ?? "not recorded")} />
            <Row k="Asset" v={receipt.asset} />
            <Row k="Amount" v={`${view.amountDisplay} BDX`} />
            <Row k="Side" v={receipt.side} />
            <Row k="Issued" v={new Date(view.issuedAt).toISOString().slice(0, 19).replace("T", " ")} />
            <Row k="Block height" v={view.blockHeight ?? "not recorded"} />
            <Row k="Confirmations" v={String(receipt.settlement_confirmations)} />
            <Row k="Verified" v={receipt.settlement_verified ? "yes" : "no"} />
          </dl>
          {fields.length > 0 ? (
            <details className="stack gap-2">
              <summary className="label">raw fields</summary>
              <pre className="figure overflow-x-auto text-[12px] faint">{JSON.stringify(receipt.payload, null, 2)}</pre>
            </details>
          ) : null}
          <p className="faint text-[13px]">
            Lost the original link? A receipt is a bearer document: whoever holds its reference can read it. Ask the
            other side for the link if you need it.
          </p>
          <Link className="pill" href={session ? "/dashboard/receipts" : "/signin"}>
            {session ? "all your receipts" : "sign in"}
          </Link>
        </div>
      </main>
      <SiteFooter nettype={status.nettype} daemon={status.daemon} escrow={status.escrow} />
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="faint text-[13px]">{k}</dt>
      <dd className="figure m-0 text-[13px]">{v}</dd>
    </div>
  );
}
