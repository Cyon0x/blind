import Link from "next/link";
import { Iris } from "@/components/Iris";
import { SiteFooter, SiteHeader } from "@/components/Chrome";
import { beldexConfig, beldexStatus } from "@/lib/beldex/config";
import { ESCROW_CUSTODY_DISCLOSURE } from "@/lib/beldex/escrow";
import { currentSession } from "@/lib/session";
import { databaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

const FRAMES = [
  { ref: "bp_9Qx2", amount: "12.5 BDX", state: "latent", note: "link created" },
  { ref: "br_4mT7", amount: "180 BDX", state: "developing", note: "deposit confirmed" },
  { ref: "bp_1kJ8", amount: "0.75 BDX", state: "fixed", note: "settled · 11 conf" },
  { ref: "br_7Zp3", amount: "42 BDX", state: "latent", note: "waiting to be paid" },
  { ref: "bp_5Vn1", amount: "3.2 BDX", state: "dead", note: "expired, refunded" },
  { ref: "bp_2Hs6", amount: "950 BDX", state: "developing", note: "claim in progress" },
] as const;

export default async function LandingPage() {
  const session = await currentSession();
  const status = beldexStatus();
  const config = beldexConfig();

  return (
    <>
      <SiteHeader signedIn={Boolean(session)} />

      <main id="main">
        <section className="wrap-shell grid items-center gap-12 py-10 lg:grid-cols-[1.15fr_.85fr] lg:py-20">
          <div className="stack gap-7">
            <span className="label">Privacy payments · Beldex</span>
            <h1 className="display text-[clamp(44px,7.2vw,86px)]">
              Money that stays
              <br />
              latent until
              <br />
              someone claims it.
            </h1>
            <p className="muted max-w-[560px] text-[18px]">
              Blind sends a payment as a link. The money waits in escrow, the recipient opens the link, and neither
              side is handed the other&rsquo;s wallet address. Beldex hides the amounts on chain; Blind removes the
              address exchange from the conversation.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href={session ? "/dashboard" : "/signin"} className="btn btn-primary">
                {session ? "Open your dashboard" : "Start with Google or X"}
              </Link>
              <Link href="#how" className="btn btn-ghost">
                How a payment moves
              </Link>
            </div>
            <p className="faint max-w-[520px] text-[13px]">
              Sign in with Google, with X, or with a Beldex wallet signature. Blind asks for no seed phrase, no view
              key, and no private key, ever.
            </p>
          </div>

          <div className="relative flex justify-center">
            <Iris state="developing" size={330} title="The Blind aperture: closed while a payment is private, open once it settles" />
          </div>
        </section>

        <section className="wrap-shell sprocket py-4">
          {/* The scroller is the outer element; the animated track lives inside it,
              so a very long strip never widens the page itself. */}
          <div className="scroll-x">
            <div className="ticker-track flex gap-4" style={{ width: "max-content" }}>
              {[...FRAMES, ...FRAMES].map((frame, index) => (
                <article key={`${frame.ref}-${index}`} className="panel !px-6 !py-5 min-w-[240px]">
                  <div className="flex items-center justify-between gap-4">
                    <span className="figure text-[13px] muted">{frame.ref}</span>
                    <Iris state={frame.state} size={22} animate={false} />
                  </div>
                  <p className="figure mt-4 text-[26px]">{frame.amount}</p>
                  <p className="faint text-[12px]">{frame.note}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="wrap-shell grid gap-6 py-20 md:grid-cols-2">
          <article className="panel stack gap-4">
            <span className="label">Blind Pay</span>
            <h2 className="display text-[34px]">Fund it now, hand it over later.</h2>
            <p className="muted text-[16px]">
              You pick an amount and Blind creates a one-time deposit address. Your wallet sends the money; Blind sees
              it arrive, counts confirmations, and hands you a link with the claim secret in the URL fragment: the part
              a browser never sends to a server.
            </p>
            <ol className="stack gap-2 text-[15px] muted">
              <li>1. Deposit lands on a fresh escrow subaddress.</li>
              <li>2. The recipient opens the link and connects a Beldex wallet.</li>
              <li>3. Their wallet approves a payout to their own address.</li>
              <li>4. Blind verifies the payout against the chain and issues both receipts.</li>
            </ol>
          </article>

          <article className="panel stack gap-4">
            <span className="label">Blind Request</span>
            <h2 className="display text-[34px]">Ask to be paid without publishing your address.</h2>
            <p className="muted text-[16px]">
              The request link carries an amount and a description, not your address. Whoever pays sends to a one-time
              escrow address; the money is forwarded to your wallet. The payer&rsquo;s wallet never learns where it went,
              and you never learn where it came from.
            </p>
            <ol className="stack gap-2 text-[15px] muted">
              <li>1. You name an amount and a payout address Blind verifies.</li>
              <li>2. You share a link or QR code built from the request reference.</li>
              <li>3. The payer approves one transaction, to the escrow.</li>
              <li>4. Blind forwards it and records the settlement hash.</li>
            </ol>
          </article>
        </section>

        <section id="privacy" className="wrap-shell py-10">
          <h2 className="display max-w-[720px] text-[clamp(30px,5vw,54px)]">
            What Blind can see, written down before you use it.
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <article className="panel stack gap-3">
              <span className="label">Blind does not get</span>
              <ul className="stack gap-2 text-[15px] muted">
                {ESCROW_CUSTODY_DISCLOSURE.serverCannotLearn.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                <li>your seed phrase, spend key or view key: there is no code path that could accept them</li>
              </ul>
            </article>
            <article className="panel stack gap-3">
              <span className="label">Blind does get</span>
              <ul className="stack gap-2 text-[15px] muted">
                {ESCROW_CUSTODY_DISCLOSURE.serverCanLearn.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                <li>a sealed copy of each claim secret, so you can re-copy a link you own</li>
              </ul>
            </article>
            <article className="panel stack gap-3">
              <span className="label">The custody, named</span>
              <p className="text-[15px] muted">{ESCROW_CUSTODY_DISCLOSURE.fundsAtRest}</p>
              <p className="faint text-[13px]">
                Beldex has no on-chain scripts, so a claimable link cannot be trustless. Blind makes the window
                explicit: one fresh address per payment, a payout only to the destination the claim recorded, and a hot
                balance cap checked before every send.
              </p>
            </article>
          </div>
        </section>

        <section className="wrap-shell py-16">
          <div className="panel stack gap-5">
            <span className="label">Right now, on this deployment</span>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Database" value={databaseConfigured ? "connected" : "embedded (development)"} />
              <Stat label="Verification node" value={status.daemon === "configured" ? "configured" : "not configured"} />
              <Stat label="Escrow signer" value={status.escrow === "configured" ? "configured" : "not configured: Blind Pay cannot fund"} />
              <Stat label="Confirmations required" value={String(config.confirmationsForSettlement)} />
            </div>
            <p className="faint text-[13px]">
              Blind prints its own missing pieces. When the escrow signer is absent, the funding buttons say so instead
              of pretending a payment exists.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter nettype={status.nettype} daemon={status.daemon} escrow={status.escrow} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack gap-1">
      <span className="label">{label}</span>
      <span className="figure text-[15px]">{value}</span>
    </div>
  );
}
