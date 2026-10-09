"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBeldex } from "@/lib/useBeldex";

type Provider = { id: "google" | "x"; label: string; configured: boolean; missing: string[] };

export function SignInPanel({ providers, next }: { providers: Provider[]; next?: string }) {
  const wallet = useBeldex();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function walletSignIn() {
    setBusy("wallet");
    setError(null);
    setNote(null);
    const result = await wallet.signIn("signin");
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "The wallet could not sign you in.");
      return;
    }
    setNote("Signed in with your wallet signature. Taking you to the dashboard…");
    router.push(next && next.startsWith("/") ? next : "/dashboard");
    router.refresh();
  }

  return (
    <div className="stack gap-6">
      <div className="stack gap-3">
        {providers.map((provider) => {
          const href = `/api/auth/${provider.id}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
          return provider.configured ? (
            <a key={provider.id} href={href} className="btn btn-ghost w-full justify-between">
              <span>Continue with {provider.label}</span>
              <span aria-hidden>→</span>
            </a>
          ) : (
            <div key={provider.id} className="stack gap-2">
              <div
                aria-disabled="true"
                className="field flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 opacity-70"
              >
                <span className="figure text-[13px] uppercase tracking-[0.06em]">
                  Continue with {provider.label}
                </span>
                <span className="label">not configured</span>
              </div>
              <p className="faint text-[13px]">
                This deployment has no {provider.label} credentials yet. Add {provider.missing.join(" and ")} and set the
                callback to <code>/api/auth/{provider.id}/callback</code>.
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1" style={{ background: "var(--rule)" }} />
        <span className="label">or prove a wallet</span>
        <span className="h-px flex-1" style={{ background: "var(--rule)" }} />
      </div>

      <button
        type="button"
        className="btn btn-primary w-full"
        onClick={walletSignIn}
        disabled={busy === "wallet" || wallet.phase === "probing"}
      >
        {busy === "wallet" ? "Waiting for your wallet…" : "Sign in with a wallet"}
      </button>
      <p className="faint text-[13px]">
        This asks the wallet to sign a single statement bound to this domain. Blind verifies the signature itself, no
        account, no password, and nothing about your balance leaves the wallet.
      </p>

      {wallet.phase === "absent" ? (
        <p className="error-text">
          No Beldex Wallet extension answered in this browser. Install it, or use Google or X instead.
        </p>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
      {note ? <p className="text-develop">{note}</p> : null}
    </div>
  );
}
