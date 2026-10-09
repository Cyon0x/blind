"use client";

import { useState } from "react";
import { post } from "@/lib/client";
import { useBeldex } from "@/lib/useBeldex";

type Props = {
  reference: string;
  amountDisplay: string;
  amountAtomic: string;
  mode: "escrow" | "direct";
  depositIntegratedAddress: string | null;
  payoutAddress: string | null;
  escrowConfigured: boolean;
  explorerUrl: string | null;
};

/**
 * Paying a Blind Request.
 *
 * Escrow mode: the payer's wallet sends to a one-time escrow address, and Blind
 * forwards the money to the address its creator named. Direct mode: the payer's
 * wallet sends straight to the recipient, which is why direct mode says plainly
 * that the recipient's address is visible.
 */
export function RequestPayPanel(props: Props) {
  const wallet = useBeldex();
  const [phase, setPhase] = useState<"idle" | "confirm" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const destination = props.mode === "escrow" ? props.depositIntegratedAddress : props.payoutAddress;

  async function send() {
    if (!destination) return;
    setPhase("sending");
    setError(null);
    setNotice(null);
    const sent = await wallet.send({
      to: destination,
      amountAtomic: props.amountAtomic,
      idempotencyKey: props.reference,
    });
    if (!sent.ok) {
      setError(sent.error);
      setPhase(sent.unknownOutcome ? "sending" : "idle");
      return;
    }
    setTxHash(sent.txHash);
    if (props.mode === "escrow") {
      const confirmed = await post<{ detail: string; changed: boolean }>(`/api/requests/${props.reference}/fund`);
      setNotice(
        confirmed.ok
          ? `${confirmed.data.detail} Your wallet signed ${sent.txHash.slice(0, 16)}…`
          : `Your wallet signed ${sent.txHash.slice(0, 16)}… Blind could not check the escrow yet: ${confirmed.error}`
      );
    } else {
      const reported = await post<{ ok: boolean }>(`/api/requests/${props.reference}/direct`, { action: "payer_sent" });
      setNotice(
        reported.ok
          ? "Your wallet signed the payment. The recipient has been told to check their own wallet, Blind cannot verify a direct payment."
          : `Your wallet signed it, but Blind could not record the report: ${reported.error}`
      );
    }
    setPhase("idle");
  }

  async function checkNow() {
    setNotice(null);
    const result = await post<{ detail: string }>(`/api/requests/${props.reference}/fund`);
    setNotice(result.ok ? result.data.detail : result.error);
  }

  return (
    <div className="stack gap-5">
      {props.mode === "escrow" && !props.escrowConfigured ? (
        <p className="error-text">
          Blind&rsquo;s escrow signer is not configured on this deployment, so this request cannot take a deposit right now.
        </p>
      ) : null}

      {destination ? (
        <>
          <div className="stack gap-2">
            <span className="label">{props.mode === "escrow" ? "send to this one-time address" : "send to this address"}</span>
            <code className="field figure break-all text-[13px]">{destination}</code>
            <p className="faint text-[13px]">
              {props.mode === "escrow"
                ? "It says nothing about who you are paying, the escrow forwards the money to them."
                : "This is the recipient's own address, which is what direct mode means."}
            </p>
          </div>

          {phase === "confirm" ? (
            <div role="dialog" aria-modal="true" aria-label="Confirm the payment" className="panel stack gap-4">
              <span className="label">Confirm</span>
              <p className="text-[16px]">
                Your wallet will be asked to sign{" "}
                <strong className="figure">
                  {props.amountDisplay} BDX
                </strong>{" "}
                and send it to
              </p>
              <code className="figure break-all text-[13px]">{destination}</code>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn btn-primary" onClick={send}>
                  Open my wallet and sign
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setPhase("idle")}>
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setPhase("confirm")}
              disabled={phase === "sending" || wallet.phase === "probing"}
            >
              {phase === "sending" ? "Waiting for your wallet…" : "Pay with my Beldex wallet"}
            </button>
          )}

          {txHash ? <code className="figure break-all text-[12px] faint">{txHash}</code> : null}
          {props.mode === "escrow" ? (
            <button type="button" className="btn btn-ghost" onClick={checkNow}>
              I sent it, check the escrow now
            </button>
          ) : null}
          {wallet.error ? <p className="error-text">{wallet.error}</p> : null}
        </>
      ) : (
        <p className="muted text-[15px]">{props.mode === "escrow" ? "The escrow has not produced a deposit address yet." : "This request has no payout address on record."}</p>
      )}

      {notice ? <p className="muted text-[14px]">{notice}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {props.explorerUrl && txHash ? (
        <a className="pill" href={`${props.explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer noopener">
          open in the explorer
        </a>
      ) : null}
    </div>
  );
}
