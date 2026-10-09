"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Iris } from "@/components/Iris";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest is safe to log: it is a hash, not the error's contents, and it
    // lets an operator find the matching server-side entry.
    console.error("[blind] page error", error.digest ?? "(no digest)");
  }, [error]);

  return (
    <main id="main" className="wrap-shell grid min-h-[70vh] place-items-center py-16">
      <div className="panel stack max-w-[560px] items-start gap-5">
        <Iris state="dead" size={110} title="Aperture shut: something did not develop" />
        <span className="label">Something went wrong</span>
        <h1 className="display text-[clamp(28px,4.4vw,44px)]">Blind could not finish that.</h1>
        <p className="muted text-[15px]">
          Nothing was moved: Blind only reports a payment as settled once it sees it on the chain. Try again, and if it
          keeps failing the payment is still where it was.
        </p>
        {error.digest ? <p className="faint text-[13px]">reference {error.digest}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <Link href="/dashboard" className="btn btn-ghost">
            Go to your dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
