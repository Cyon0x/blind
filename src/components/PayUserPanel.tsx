"use client";

import { useState } from "react";
import Link from "next/link";
import { get, post } from "@/lib/client";
import { useBeldex } from "@/lib/useBeldex";
import { toAtomicString } from "@/lib/format";

type Created = { reference: string };
type CreatorView = {
  payment: { reference: string; status: string; deposit: { integratedAddress: string | null; address: string | null } | null };
};

/**
 * Paying a Blind username.
 *
 * Blind resolves @handle to an account, creates a payment addressed to it, and
 * never shows the payer a claim link, the money can only be released into that
 * account once it is funded.
 */
export function PayUserPanel({ username, displayName }: { username: string; displayName: string | null }) {
  const wallet = useBeldex();
  const [amount, setAmount] = useState("1");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function create() {
    let atomic: string;
    try {
      atomic = toAtomicString(amount).toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That amount is not valid.");
      return;
    }
    if (BigInt(atomic) <= 0n) {
      setError("The amount must be greater than zero.");
      return;
    }
    setBusy("create");
    setError(null);
    const result = await post<{ payment: { reference: string }; addressedTo: string | null }>("/api/payments", {
      kind: "pay",
      amount,
      description: description || undefined,
      toUsername: username,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreated({ reference: result.data.payment.reference });
    setStatus("created");
    await loadDeposit(result.data.payment.reference);
  }

  async function loadDeposit(reference: string) {
    const result = await get<CreatorView>(`/api/payments/${reference}`);
    if (!result.ok) return;
    setDepositAddress(result.data.payment.deposit?.integratedAddress ?? null);
    setStatus(result.data.payment.status);
  }

  async function send() {
    if (!created || !depositAddress) return;
    setBusy("send");
    setError(null);
    const sent = await wallet.send({ to: depositAddress, amountAtomic: toAtomicString(amount).toString(), idempotencyKey: created.reference });
    if (!sent.ok) {
      setBusy(null);
      setError(sent.error);
      return;
    }
    setNotice(`Your wallet signed ${sent.txHash.slice(0, 16)}… Blind is watching the escrow.`);
    await check();
  }

  async function check() {
    if (!created) return;
    setBusy("check");
    const result = await post<{ detail: string; changed: boolean }>(`/api/payments/${created.reference}/funding`);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(result.data.detail);
    await loadDeposit(created.reference);
  }

  if (created) {
    const funded = status !== null && !["created", "awaiting_deposit"].includes(status);
    return (
      <div className="stack gap-5">
        <span className="label">{funded ? "Funded" : "Fund this payment"}</span>
        <p className="muted text-[15px]">
          {funded
            ? `Blind is holding it for ${displayName ? displayName : `@${username}`}. Only they can claim it.`
            : `Send the BDX to Blind's one-time escrow address. ${displayName ? displayName : `@${username}`} gets it once it is funded, and the link is never handed to you.`}
        </p>
        {depositAddress ? (
          <div className="stack gap-2">
            <span className="label">escrow deposit address</span>
            <code className="field figure break-all text-[13px]">{depositAddress}</code>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {depositAddress && !funded ? (
            <button type="button" className="btn btn-primary" onClick={send} disabled={busy !== null || wallet.phase === "probing"}>
              {busy === "send" ? "Waiting for your wallet…" : "Send with my Beldex wallet"}
            </button>
          ) : null}
          {!funded ? (
            <button type="button" className="btn btn-ghost" onClick={check} disabled={busy !== null}>
              {busy === "check" ? "Checking the escrow…" : "I sent it, check now"}
            </button>
          ) : null}
          <Link className="btn btn-ghost" href={`/dashboard/payments/${created.reference}`}>
            Open the payment
          </Link>
        </div>
        {notice ? <p className="muted text-[14px]">{notice}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {wallet.error ? <p className="error-text">{wallet.error}</p> : null}
      </div>
    );
  }

  return (
    <form
      className="stack gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        create();
      }}
    >
      <label className="stack gap-2">
        <span className="label">amount (BDX)</span>
        <input
          className="field field-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          aria-label="Amount in BDX"
        />
      </label>
      <label className="stack gap-2">
        <span className="label">what is it for (optional)</span>
        <input className="field" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy !== null}>
        {busy === "create" ? "Creating the payment…" : `Pay ${displayName ? displayName : `@${username}`}`}
      </button>
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  );
}
