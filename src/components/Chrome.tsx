import Link from "next/link";
import { Iris } from "./Iris";

/** Every marketing surface wears the same frame: an iris, a wordmark, two doors. */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    /* The nav is allowed to wrap and the secondary link drops out under 640px:
       at 390px a three-item row used to push the page 106px wider than the
       viewport, which cut the right edge off every line of text on the page. */
    <header className="wrap-shell flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-5">
      <Link href="/" className="flex min-w-0 items-center gap-3 no-underline">
        <Iris state="developing" size={34} animate={false} />
        <span className="wordmark text-ink text-[20px]">Blind</span>
      </Link>
      <nav className="flex items-center gap-2">
        <Link href="/#privacy" className="pill hidden sm:inline-flex">
          Privacy
        </Link>
        <Link href={signedIn ? "/dashboard" : "/signin"} className="btn btn-ghost !px-4 !py-3">
          {signedIn ? "Open dashboard" : "Sign in"}
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter({ nettype, daemon, escrow }: { nettype: string; daemon: string; escrow: string }) {
  return (
    <footer className="wrap-shell rule-row mt-24 py-10">
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="stack gap-2 max-w-[380px]">
          <span className="wordmark text-[15px]">Blind</span>
          <p className="muted text-[14px]">
            A payment app for Beldex. Deposits sit in an escrow Blind controls until they are claimed, that custody
            is written down in docs/PRIVACY_THREAT_MODEL.md, not hidden.
          </p>
        </div>
        <div className="stack gap-2">
          <span className="label">Network</span>
          <span className="figure text-[14px]">{nettype}</span>
          <span className="faint text-[13px]">verification node: {daemon}</span>
          <span className="faint text-[13px]">escrow signer: {escrow}</span>
        </div>
        <div className="stack gap-2">
          <span className="label">Read more</span>
          <span className="faint text-[13px]">docs/PAYMENT_FLOWS.md</span>
          <span className="faint text-[13px]">docs/SECURITY.md</span>
          <span className="faint text-[13px]">docs/BELDEX_INTEGRATION.md</span>
        </div>
      </div>
      <p className="faint mt-8 text-[12px]">
        Blind never asks for a seed phrase. It cannot: it has no field for one, and the wallet extension never exposes
        one.
      </p>
    </footer>
  );
}
