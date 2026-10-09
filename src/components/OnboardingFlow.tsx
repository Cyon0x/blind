"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { post } from "@/lib/client";
import { useBeldex } from "@/lib/useBeldex";

/**
 * Two steps, both optional except the username: claim a handle, then (if the
 * extension is present) prove a wallet. Nothing here asks for a seed or a key.
 */
export function OnboardingFlow({ initialUsername }: { initialUsername: string | null }) {
  const router = useRouter();
  const wallet = useBeldex();
  const [username, setUsername] = useState(initialUsername ?? "");
  const [available, setAvailable] = useState<null | { ok: boolean; reason: string | null }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"name" | "wallet" | "done">("name");

  async function check(next: string) {
    setUsername(next);
    setAvailable(null);
    if (!/^[a-z0-9_]{3,20}$/.test(next.toLowerCase())) return;
    const result = await (await import("@/lib/client")).get<{ available: boolean; reason: string | null }>(
      `/api/username?u=${encodeURIComponent(next.toLowerCase())}`
    );
    if (result.ok) setAvailable({ ok: result.data.available, reason: result.data.reason });
  }

  async function saveName() {
    setBusy("name");
    setError(null);
    const result = await post<{ ok: boolean; error?: string }>("/api/profile", { username });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.ok === false) {
      setError(result.data.error ?? "That username could not be saved.");
      return;
    }
    setStep("wallet");
  }

  async function proveWallet() {
    setBusy("wallet");
    setError(null);
    const result = await wallet.signIn("link");
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "The wallet proof did not verify.");
      return;
    }
    setStep("done");
  }

  async function finish(skipWallet = false) {
    setBusy("finish");
    await post("/api/profile", { completeOnboarding: true });
    setBusy(null);
    if (skipWallet) router.push("/dashboard?wallet=skipped");
    else router.push("/dashboard");
    router.refresh();
  }

  if (step === "done") {
    return (
      <div className="stack gap-6">
        <p className="text-develop">Wallet ownership proven. That address is now the one Blind pays you at.</p>
        <button type="button" className="btn btn-primary" onClick={() => finish(false)} disabled={busy === "finish"}>
          {busy === "finish" ? "Opening…" : "Go to the dashboard"}
        </button>
      </div>
    );
  }

  if (step === "wallet") {
    return (
      <div className="stack gap-6">
        <div className="stack gap-2">
          <span className="label">Step 2 of 2</span>
          <h2 className="display text-[28px]">Link a Beldex wallet</h2>
          <p className="muted text-[15px]">
            The wallet signs one domain-bound statement. Blind verifies it against the address itself, so a pasted
            address can never claim to be yours.
          </p>
        </div>
        {wallet.phase === "connected" && wallet.address ? (
          <p className="figure text-[13px]">connected: {wallet.address.slice(0, 12)}…{wallet.address.slice(-6)}</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={proveWallet}
            disabled={busy === "wallet" || wallet.phase === "probing"}
          >
            {busy === "wallet" ? "Waiting for your wallet…" : "Prove with my wallet"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => finish(true)} disabled={busy === "finish"}>
            Do this later
          </button>
        </div>
        {wallet.phase === "absent" ? (
          <p className="faint text-[13px]">
            No Beldex Wallet extension answered. You can link an address later from Wallet settings, or paste one to
            receive payments.
          </p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="stack gap-6">
      <div className="stack gap-2">
        <span className="label">Step 1 of 2</span>
        <h2 className="display text-[28px]">Claim a username</h2>
        <p className="muted text-[15px]">
          People will ask you for money at this handle instead of an address. It is public; your wallet is not.
        </p>
      </div>
      <label className="stack gap-2">
        <span className="label">blind username</span>
        <div className="flex items-center gap-2">
          <span className="figure muted text-[18px]">@</span>
          <input
            className="field"
            value={username}
            onChange={(event) => check(event.target.value)}
            placeholder="cyon"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
          />
        </div>
      </label>
      {available ? (
        <p className={available.ok ? "text-develop" : "error-text"}>
          {available.ok ? `@${username.toLowerCase()} is yours if you take it now.` : available.reason}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={saveName}
          disabled={busy === "name" || !/^[a-z0-9_]{3,20}$/.test(username.toLowerCase()) || available?.ok === false}
        >
          {busy === "name" ? "Saving…" : "Take this username"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setStep("wallet")}>
          Skip for now
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
