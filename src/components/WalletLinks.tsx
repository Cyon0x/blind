"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { del, post } from "@/lib/client";
import { useBeldex } from "@/lib/useBeldex";

/**
 * Two honest ways to attach an address: prove one with a wallet signature, or
 * paste one and accept that Blind cannot prove you own it.
 */
export function WalletLinks() {
  const wallet = useBeldex();
  const router = useRouter();
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function prove() {
    setBusy("prove");
    setError(null);
    setNotice(null);
    const result = await wallet.signIn("link");
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "The proof did not verify.");
      return;
    }
    setNotice("Ownership proven. Blind now treats this address as yours.");
    router.refresh();
  }

  async function paste() {
    setBusy("paste");
    setError(null);
    setNotice(null);
    const result = await post<{ ok: boolean; error?: string }>("/api/wallets", { address: pasted.trim() });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("Address saved as unverified. Blind will use it as a payout destination you named.");
    setPasted("");
    router.refresh();
  }

  async function remove(address: string) {
    setBusy("remove");
    await del(`/api/wallets?address=${encodeURIComponent(address)}`);
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="stack gap-4">
      <button type="button" className="btn btn-primary" onClick={prove} disabled={busy !== null}>
        {busy === "prove" ? "Waiting for your wallet…" : "Prove a wallet address"}
      </button>
      <div className="stack gap-2">
        <span className="label">or paste one</span>
        <div className="flex gap-2">
          <input
            className="field"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder="bx…"
            spellCheck={false}
            aria-label="Paste a Beldex address to save as an unverified payout destination"
          />
          <button type="button" className="btn btn-ghost" onClick={paste} disabled={busy !== null || pasted.trim().length < 90}>
            Save
          </button>
        </div>
        <span className="faint text-[13px]">
          A pasted address is recorded as unverified: Blind can check its structure and network, not that you hold it.
        </span>
      </div>
      {notice ? <p className="text-develop text-[14px]">{notice}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      <details className="stack gap-2">
        <summary className="label">remove an address</summary>
        <div className="stack gap-2 pt-2">
          <input
            className="field"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder="address to remove"
            spellCheck={false}
            aria-label="Address to remove from your saved destinations"
          />
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => remove(pasted.trim())}
            disabled={busy !== null || pasted.trim().length < 90}
          >
            Remove
          </button>
        </div>
      </details>
    </div>
  );
}
