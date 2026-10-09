"use client";

import { useState } from "react";
import Link from "next/link";
import { post } from "@/lib/client";
import { toAtomicString } from "@/lib/format";
import { useBeldex } from "@/lib/useBeldex";

type Created = {
  payment: { reference: string };
  request: { url: string; checksumVerified: boolean };
};

/**
 * Creating a Blind Request. The payout address is the recipient's own business:
 * in escrow mode the payer never sees it, which is the whole point of the
 * feature. Direct mode hands it to the payer's wallet and says so.
 */
export function RequestComposer({ escrowConfigured, nettype }: { escrowConfigured: boolean; nettype: string }) {
  const wallet = useBeldex();
  const [amount, setAmount] = useState("25");
  const [description, setDescription] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [payoutAddress, setPayoutAddress] = useState("");
  const [payoutMode, setPayoutMode] = useState<"escrow" | "direct">("escrow");
  const [expiresInHours, setExpiresInHours] = useState("168");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      toAtomicString(amount);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "That amount is not valid.");
      return;
    }
    const result = await post<Created>("/api/payments", {
      kind: "request",
      amount,
      description: description || undefined,
      invoiceRef: invoiceRef || undefined,
      expiresInHours: Number(expiresInHours) || undefined,
      payoutAddress,
      payoutMode,
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
      <div className="stack gap-4">
        <span className="label">Request created</span>
        <code className="field figure break-all text-[13px]">{created.request.url}</code>
        <div className="flex flex-wrap gap-3">
          <Link href={`/dashboard/payments/${created.payment.reference}`} className="btn btn-primary">
            Open the request page
          </Link>
          <Link href="/dashboard/request" className="btn btn-ghost" onClick={() => setCreated(null)}>
            Create another
          </Link>
        </div>
        <p className="faint text-[13px]">
          {payoutMode === "escrow"
            ? "The link carries no address: payers send to a one-time escrow address and Blind forwards it to you."
            : "Direct mode: whoever pays this link sees your address in their wallet, and no escrow is involved."}
        </p>
        {created.request.checksumVerified ? null : (
          <p className="error-text">
            Blind could not verify this address&rsquo;s checksum. Your wallet will re-validate it before any money
            moves, so double-check it yourself.
          </p>
        )}
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
      <div className="stack gap-2">
        <label className="label" htmlFor="req-amount">
          amount to request
        </label>
        <input
          id="req-amount"
          className="field field-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="stack gap-2">
          <span className="label">what is it for</span>
          <input
            className="field"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={140}
            placeholder="Logo work, first half"
          />
        </label>
        <label className="stack gap-2">
          <span className="label">invoice reference</span>
          <input
            className="field"
            value={invoiceRef}
            onChange={(event) => setInvoiceRef(event.target.value)}
            maxLength={64}
            placeholder="INV-1043"
          />
        </label>
      </div>
      <label className="stack gap-2">
        <span className="label">pay me at ({nettype})</span>
        <div className="flex gap-2">
          <input
            className="field"
            value={payoutAddress}
            onChange={(event) => setPayoutAddress(event.target.value)}
            placeholder="bx…"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn btn-ghost !whitespace-nowrap"
            onClick={async () => {
              await wallet.connect();
              const connected = wallet.address;
              if (connected) setPayoutAddress(connected);
            }}
          >
            Use my wallet
          </button>
        </div>
        <span className="faint text-[13px]">
          Paste a fresh address or subaddress for this request if you have one, reusing a receiving address links your
          requests together on chain.
        </span>
      </label>
      <fieldset className="stack gap-3">
        <legend className="label">how payment reaches you</legend>
        <label className="flex items-start gap-3">
          <input
            type="radio"
            name="payoutMode"
            checked={payoutMode === "escrow"}
            onChange={() => setPayoutMode("escrow")}
            disabled={!escrowConfigured}
          />
          <span className="stack gap-1">
            <span className="text-[15px]">Through the escrow (private)</span>
            <span className="faint text-[13px]">
              The payer sends to a one-time escrow address and never learns your address. Requires Blind&rsquo;s escrow
              signer, {escrowConfigured ? "configured here" : "not configured here"}.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="radio"
            name="payoutMode"
            checked={payoutMode === "direct"}
            onChange={() => setPayoutMode("direct")}
          />
          <span className="stack gap-1">
            <span className="text-[15px]">Direct to my wallet</span>
            <span className="faint text-[13px]">
              No escrow, no custody, but the payer&rsquo;s wallet sees your address, and only you can confirm the money
              arrived.
            </span>
          </span>
        </label>
      </fieldset>
      <label className="stack gap-2">
        <span className="label">expires after (hours, empty for none)</span>
        <input
          className="field"
          value={expiresInHours}
          onChange={(event) => setExpiresInHours(event.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy || payoutAddress.trim().length < 90}>
        {busy ? "Creating the request…" : "Create the request link"}
      </button>
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  );
}
