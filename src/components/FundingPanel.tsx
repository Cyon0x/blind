"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyField } from "./CopyField";
import { post, get } from "@/lib/client";
import { useBeldex } from "@/lib/useBeldex";
import { shortAddress, untilLabel } from "@/lib/format";

type Props = {
  reference: string;
  amountDisplay: string;
  amountAtomic: string;
  status: string;
  depositIntegratedAddress: string | null;
  claimUrl: string | null;
  confirmations: number;
  required: number;
  payoutTxHash: string | null;
  explorerUrl: string | null;
  expiresAt: string | null;
  escrowConfigured: boolean;
  kind: "pay" | "request";
  payoutMode: "escrow" | "direct";
};

/**
 * The working half of Blind Pay.
 *
 * Three real operations live here and each one reports exactly what happened:
 *   * fund   , the wallet extension signs a send to this payment's own deposit
 *               address, carrying the payment reference as an idempotency key so
 *               a retry cannot pay twice;
 *   * verify , asks Blind to re-read the escrow wallet and the chain;
 *   * claim  , hands the payer their own link back (the secret is stored sealed).
 */
export function FundingPanel(props: Props) {
  const wallet = useBeldex();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [claimUrl, setClaimUrl] = useState<string | null>(props.claimUrl);
  const [refundAddress, setRefundAddress] = useState("");
  const [showRefund, setShowRefund] = useState(false);

  const funded = ["funded", "claim_pending", "payout_submitted", "settled", "refunding", "refunded"].includes(props.status);
  const settled = props.status === "settled";

  async function sendFromWallet() {
    if (!props.depositIntegratedAddress) return;
    setBusy("send");
    setError(null);
    setNotice(null);
    const result = await wallet.send({
      to: props.depositIntegratedAddress,
      amountAtomic: props.amountAtomic,
      idempotencyKey: props.reference,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`Your wallet signed ${result.txHash.slice(0, 16)}… Blind is now watching the escrow for it.`);
    await checkFunding(result.txHash);
  }

  async function checkFunding(knownTxHash?: string) {
    setBusy("check");
    setError(null);
    const result = await post<{ ok: boolean; changed: boolean; detail: string; depositConfirmations: number }>(
      `/api/payments/${props.reference}/funding`
    );
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(
      knownTxHash
        ? `${result.data.detail}`
        : result.data.detail
    );
    router.refresh();
  }

  async function checkSettlement() {
    setBusy("settle");
    setError(null);
    const result = await post<{ ok: boolean; settled: boolean; detail: string; untrustedNode: boolean | null }>(
      `/api/payments/${props.reference}/settlement`
    );
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(
      result.data.settled
        ? `Settled and verified${result.data.untrustedNode ? " (a bootstrap node answered, worth a second look)" : ""}.`
        : `Not final yet: ${result.data.detail}`
    );
    router.refresh();
  }

  async function revealLink() {
    setBusy("link");
    setError(null);
    const result = await get<{ ok: boolean; url?: string; error?: string; sealingConfigured: boolean }>(
      `/api/payments/${props.reference}/claim-link`
    );
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.data.ok || !result.data.url) {
      setError(
        result.data.error ??
          "This deployment has no BDX_CLAIM_KEY, so the secret was shown once at creation and cannot be recovered."
      );
      return;
    }
    setClaimUrl(result.data.url);
    setNotice("Link recovered from its sealed copy. Anyone holding it can claim the money.");
  }

  async function refund() {
    setBusy("refund");
    setError(null);
    const result = await post<{ ok: boolean; detail: string }>(`/api/payments/${props.reference}/refund`, {
      address: refundAddress.trim(),
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(result.data.detail);
    setShowRefund(false);
    router.refresh();
  }

  return (
    <div className="stack gap-5">
      {error ? <p className="error-text">{error}</p> : null}
      {notice ? <p className="muted text-[14px]">{notice}</p> : null}

      {!props.escrowConfigured && props.kind === "pay" ? (
        <div className="panel stack gap-2">
          <span className="label">Escrow unavailable</span>
          <p className="muted text-[15px]">
            This deployment has no <code>BDX_WALLET_RPC_URL</code>, so Blind cannot hold a deposit for this payment. The
            payment record exists, but nothing can be funded until an escrow wallet is connected.
          </p>
        </div>
      ) : null}

      {!funded && props.escrowConfigured ? (
        <div className="stack gap-5">
          <div className="stack gap-2">
            <span className="label">Step 1 · Fund the escrow</span>
            <p className="muted text-[15px]">
              Send exactly {props.amountDisplay} BDX to this payment&rsquo;s own deposit address. It is a fresh address
              used for nothing else, with a payment id that belongs only to this payment.
            </p>
          </div>
          {props.depositIntegratedAddress ? (
            <>
              <CopyField
                label="deposit address (integrated)"
                value={props.depositIntegratedAddress}
                note={`${shortAddress(props.depositIntegratedAddress, 12, 8)} · Blind counts ${props.required} confirmations before this becomes claimable.`}
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={sendFromWallet}
                  disabled={busy !== null || wallet.phase === "probing"}
                >
                  {busy === "send" ? "Waiting for your wallet…" : "Send with my Beldex wallet"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => checkFunding()} disabled={busy !== null}>
                  {busy === "check" ? "Checking the escrow…" : "I sent it, check now"}
                </button>
              </div>
              <p className="faint text-[13px]">
                Sending from another wallet? Paste the address above there. Blind will only mark this funded when the
                escrow wallet can see the money and the chain agrees on{" "}
                {props.required} confirmations.
              </p>
            </>
          ) : (
            <p className="faint text-[13px]">
              The escrow has not produced a deposit address for this payment yet. Reload in a moment, or check the
              escrow signer in Wallet &amp; security.
            </p>
          )}
        </div>
      ) : null}

      {funded && !settled ? (
        <div className="stack gap-4">
          <div className="stack gap-2">
            <span className="label">Step 2 · Hand over the link</span>
            <p className="muted text-[15px]">
              The money is in escrow with {props.confirmations} confirmations. Share this link with whoever should be
              able to claim it. The secret lives after the <code>#</code>, which means a browser never sends it to a
              server, including ours.
            </p>
          </div>
          {claimUrl ? (
            <CopyField
              label="claim link"
              value={claimUrl}
              note="Anyone who has this link can claim the money. Send it over a channel you trust."
            />
          ) : (
            <button type="button" className="btn btn-ghost" onClick={revealLink} disabled={busy !== null}>
              {busy === "link" ? "Opening the sealed copy…" : "Show my claim link again"}
            </button>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn btn-ghost" onClick={checkSettlement} disabled={busy !== null}>
              {busy === "settle" ? "Checking the chain…" : "Check claim status"}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setShowRefund((value) => !value)}>
              {showRefund ? "Cancel refund" : "Take the money back"}
            </button>
          </div>
          {showRefund ? (
            <div className="stack gap-3">
              <label className="stack gap-2">
                <span className="label">refund to this address</span>
                <input
                  className="field"
                  value={refundAddress}
                  onChange={(event) => setRefundAddress(event.target.value)}
                  placeholder="bx…"
                  spellCheck={false}
                />
              </label>
              <p className="faint text-[13px]">
                A refund is only possible while nobody has claimed, and at least an hour after funding so a recipient
                who is mid-claim is not robbed by it.
              </p>
              <button
                type="button"
                className="btn btn-danger"
                onClick={refund}
                disabled={busy !== null || refundAddress.trim().length < 90}
              >
                {busy === "refund" ? "Sending the refund…" : "Refund to this address"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {props.payoutTxHash ? (
        <div className="stack gap-2">
          <span className="label">Payout transaction</span>
          <code className="figure text-[13px] break-all">{props.payoutTxHash}</code>
          <div className="flex flex-wrap items-center gap-3">
            <span className="faint text-[13px]">
              {props.confirmations} of {props.required} confirmations
            </span>
            {props.explorerUrl ? (
              <a
                className="pill"
                href={`${props.explorerUrl}/tx/${props.payoutTxHash}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open in the explorer
              </a>
            ) : null}
            {!settled ? (
              <button type="button" className="pill" onClick={checkSettlement} disabled={busy !== null}>
                {busy === "settle" ? "checking…" : "re-check"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {props.expiresAt ? <p className="faint text-[13px]">{untilLabel(props.expiresAt) ?? ""}</p> : null}
    </div>
  );
}
