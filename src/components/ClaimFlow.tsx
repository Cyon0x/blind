"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { post } from "@/lib/client";
import { useBeldex } from "@/lib/useBeldex";
import { shortAddress } from "@/lib/format";

type Props = {
  reference: string;
  amountDisplay: string;
  status: string;
  nettype: string;
  escrowConfigured: boolean;
  explorerUrl: string | null;
  /** Present when the server already holds the link (a username payment addressed to you). */
  sealedClaimUrl: string | null;
};

type Outcome = {
  status: string;
  detail: string;
  payoutTxHash: string | null;
  confirmations: number;
  required: number;
};

const CLAIMABLE = new Set(["funded"]);
const MOVING = new Set(["claim_pending", "payout_submitted"]);

/**
 * The recipient's half of Blind Pay.
 *
 * The claim secret arrives in the URL fragment, which the browser never sends
 * to any server, including Blind's. This component reads it on the client,
 * keeps it in memory only, and posts it once inside the claim request itself.
 */
export function ClaimFlow({ reference, amountDisplay, status, nettype, escrowConfigured, explorerUrl, sealedClaimUrl }: Props) {
  const wallet = useBeldex();
  const [secret, setSecret] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState<"idle" | "confirm" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const fromFragment = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
    const fromSealed = sealedClaimUrl && sealedClaimUrl.includes("#") ? sealedClaimUrl.split("#")[1] : "";
    setSecret(fromFragment || fromSealed || null);
  }, [sealedClaimUrl]);

  useEffect(() => {
    if (wallet.address && !address) setAddress(wallet.address);
  }, [wallet.address, address]);

  useEffect(() => {
    if (phase !== "confirm") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPhase("idle");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const claimable = CLAIMABLE.has(status);
  const moving = MOVING.has(status);
  const settled = status === "settled";
  const dead = ["expired", "cancelled", "failed", "refunded"].includes(status);
  const addressLooksValid = /^[^0-9]{1,4}[1-9A-HJ-NP-Za-km-z]{88,110}$/.test(address.trim());

  const headline = useMemo(() => {
    if (settled) return "This payment is done.";
    if (moving) return "This payment has already been claimed and is on its way.";
    if (dead) return "This payment can no longer be claimed.";
    if (!claimable) return "This payment is not funded yet.";
    return `You have ${amountDisplay} BDX waiting.`;
  }, [settled, moving, dead, claimable, amountDisplay]);

  async function claim() {
    if (!secret) {
      setError("This link is missing its claim secret. Use the whole link, including everything after the #.");
      return;
    }
    setPhase("sending");
    setError(null);
    const result = await post<{ status: string; detail: string; payoutTxHash: string | null; confirmations: number; required: number }>(
      `/api/claims/${reference}`,
      { secret, payoutAddress: address.trim() }
    );
    if (!result.ok) {
      setError(result.error);
      setPhase("idle");
      return;
    }
    setOutcome({
      status: result.data.status,
      detail: result.data.detail,
      payoutTxHash: result.data.payoutTxHash,
      confirmations: result.data.confirmations,
      required: result.data.required,
    });
    setPhase("done");
  }

  async function checkSettlement() {
    setChecking(true);
    const result = await post<{ settled: boolean; detail: string; confirmations: number }>(`/api/payments/${reference}/settlement`);
    setChecking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOutcome((current) => ({
      status: result.data.settled ? "settled" : (current?.status ?? "payout_submitted"),
      detail: result.data.settled ? "Settled and verified against the Beldex chain." : `Not final yet: ${result.data.detail}`,
      payoutTxHash: current?.payoutTxHash ?? null,
      confirmations: result.data.confirmations,
      required: current?.required ?? 0,
    }));
  }

  if (phase === "done" && outcome) {
    const finished = outcome.status === "settled";
    return (
      <div className="stack gap-5">
        <span className="label">{finished ? "Settled" : "Claim submitted"}</span>
        <p className="text-[16px]">{outcome.detail}</p>
        {outcome.payoutTxHash ? (
          <div className="stack gap-2">
            <span className="label">payout transaction</span>
            <code className="figure break-all text-[13px]">{outcome.payoutTxHash}</code>
            <span className="faint text-[13px]">
              {outcome.confirmations} of {outcome.required} confirmations
            </span>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {!finished ? (
            <button type="button" className="btn btn-ghost" onClick={checkSettlement} disabled={checking}>
              {checking ? "Checking the chain…" : "Check it again"}
            </button>
          ) : null}
          {outcome.payoutTxHash && explorerUrl ? (
            <a className="btn btn-ghost" href={`${explorerUrl}/tx/${outcome.payoutTxHash}`} target="_blank" rel="noreferrer noopener">
              Open in the explorer
            </a>
          ) : null}
          <Link className="btn btn-ghost" href="/dashboard/receipts">
            Go to receipts
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stack gap-6">
      <div className="stack gap-2">
        <span className="label">Blind Pay · {reference}</span>
        <h1 className="display text-[clamp(34px,6vw,58px)]">{headline}</h1>
        {moving || settled || dead ? null : (
          <p className="muted text-[16px]">
            Blind is holding it in escrow. Name a Beldex address and the escrow pays it out, to you, once, and to
            nobody else.
          </p>
        )}
      </div>

      {!secret && !settled && !moving && !dead ? (
        <p className="error-text">
          This page needs the link&rsquo;s full secret (the part after the <code>#</code>). Copy the link again exactly as it
          was sent to you.
        </p>
      ) : null}

      {!escrowConfigured ? (
        <p className="error-text">
          This deployment has no escrow signer configured, so it cannot release funds right now. The money is safe; Blind
          simply cannot move it until an operator restores the signer.
        </p>
      ) : null}

      {claimable && escrowConfigured ? (
        phase === "confirm" ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm the claim"
            className="panel stack gap-4"
          >
            <span className="label">Confirm</span>
            <p className="text-[16px]">
              Blind&rsquo;s escrow will send <strong className="figure">{amountDisplay} BDX</strong> to
            </p>
            <code className="figure break-all text-[13px]">{address.trim()}</code>
            <p className="faint text-[13px]">
              A network fee is deducted from the escrowed amount. A Beldex payout is irreversible once it is mined.
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn btn-primary" onClick={claim}>
                Send it to this address
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setPhase("idle")}>
                Not yet
              </button>
            </div>
          </div>
        ) : (
          <div className="stack gap-4">
            <label className="stack gap-2">
              <span className="label">payout address</span>
              <input
                className="field figure"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder={`a ${nettype} Beldex address`}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            {wallet.address && wallet.address !== address.trim() ? (
              <button type="button" className="pill" onClick={() => setAddress(wallet.address as string)}>
                use my connected wallet ({shortAddress(wallet.address)})
              </button>
            ) : null}
            {!wallet.address ? (
              <div className="stack gap-3 items-start">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => wallet.connect()}
                  disabled={wallet.phase === "probing" || wallet.phase === "connecting"}
                >
                  {wallet.phase === "connecting" ? "Approving…" : "Connect the Beldex wallet extension"}
                </button>
                <p className="faint text-[13px]">
                  Or paste any address you control. Blind never asks for a seed phrase, and this page never sends the
                  secret to a server until you press the button.
                </p>
                {wallet.error ? <p className="error-text">{wallet.error}</p> : null}
              </div>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setPhase("confirm")}
              disabled={phase === "sending" || !addressLooksValid}
            >
              {phase === "sending" ? "Claiming…" : `Claim ${amountDisplay} BDX`}
            </button>
            <p className="faint text-[13px]">
              Blind checks that the address is a well-formed {nettype} address before it spends anything.
            </p>
          </div>
        )
      ) : null}

      {moving ? (
        <div className="stack gap-3">
          <p className="muted text-[15px]">
            Someone already claimed this link, so Blind will not pay a second time. If that was you, the transaction is
            below.
          </p>
          <button type="button" className="btn btn-ghost" onClick={checkSettlement} disabled={checking}>
            {checking ? "Checking the chain…" : "Check its status"}
          </button>
        </div>
      ) : null}

      {dead ? (
        <p className="muted text-[15px]">
          {status === "expired"
            ? "Nobody claimed this in time and the claim window closed. Ask the payer to send a new link, or to take the money back."
            : "This payment was withdrawn by the payer or failed. Nothing can be claimed from it."}
        </p>
      ) : null}

      {settled ? (
        <p className="muted text-[15px]">
          The payout was verified against the Beldex chain. The payer&rsquo;s receipt and yours are both available from your
          receipts page if you hold a Blind account.
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
