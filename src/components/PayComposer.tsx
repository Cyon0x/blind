"use client";

import { useState } from "react";
import Link from "next/link";
import { post } from "@/lib/client";
import { toAtomicString } from "@/lib/format";

type Created = {
  payment: { reference: string };
  claim: { url: string; secret: string; resealable: boolean } | null;
};

/**
 * Creating a Blind Pay. The client only decides the amount and the words; the
 * deposit destination and the claim secret come from the server, and the link
 * is shown with its secret after the fragment so it is never logged.
 */
export function PayComposer({ escrowConfigured }: { escrowConfigured: boolean }) {
  const [amount, setAmount] = useState("1");
  const [description, setDescription] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [expiresInHours, setExpiresInHours] = useState("72");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    let atomic: string;
    try {
      atomic = toAtomicString(amount).toString();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "That amount is not valid.");
      return;
    }
    const result = await post<Created>("/api/payments", {
      kind: "pay",
      amount,
      description: description || undefined,
      invoiceRef: invoiceRef || undefined,
      expiresInHours: Number(expiresInHours) || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreated(result.data);
  }

  if (created) {
    return (
      <div className="stack gap-5">
        <span className="label">Payment created</span>
        <p className="muted text-[15px]">
          Now fund it. Blind has reserved a fresh escrow address for{" "}
          <code>{created.payment.reference}</code>.
        </p>
        <Link href={`/dashboard/payments/${created.payment.reference}`} className="btn btn-primary">
          Fund this payment
        </Link>
        <p className="faint text-[13px]">
          {created.claim?.resealable
            ? "Your claim link is stored sealed, so you can come back for it later."
            : "Copy the claim link when you fund it, this deployment cannot re-display it afterwards."}
        </p>
      </div>
    );
  }

  return (
    <form
      className="stack gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {!escrowConfigured ? (
        <p className="error-text">
          Blind&rsquo;s escrow signer is not configured on this deployment, so a funded link cannot be created yet.
        </p>
      ) : null}
      <div className="stack gap-2">
        <label className="label" htmlFor="pay-amount">
          amount in BDX
        </label>
        <input
          id="pay-amount"
          className="field field-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
        />
        <p className="faint text-[13px]">
          Beldex amounts are settled in BDX. Blind does not show a fiat equivalent it cannot price reliably.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="stack gap-2">
          <span className="label">what is it for</span>
          <input
            className="field"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={140}
            placeholder="Friday dinner"
          />
        </label>
        <label className="stack gap-2">
          <span className="label">invoice reference</span>
          <input
            className="field"
            value={invoiceRef}
            onChange={(event) => setInvoiceRef(event.target.value)}
            maxLength={64}
            placeholder="INV-1042"
          />
        </label>
      </div>
      <label className="stack gap-2">
        <span className="label">expires after (hours, empty for no expiry)</span>
        <input
          className="field"
          value={expiresInHours}
          onChange={(event) => setExpiresInHours(event.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          placeholder="72"
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy || !escrowConfigured}>
        {busy ? "Reserving an address…" : "Create the payment"}
      </button>
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  );
}
