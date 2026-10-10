import Image from "next/image";
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
                <section className="hero" aria-labelledby="hero-title">
          <div className="hero-media">
            <div className="hero-shutter">
              <Image
                src="/blind-hero.jpg"
                alt="Two iridescent hands holding a luminous eye whose pupil is a camera aperture"
                fill
                priority
                sizes="100vw"
                quality={88}
                className="object-cover"
              />
            </div>
          </div>
          <div className="hero-scrim" aria-hidden="true" />

          <div className="wrap-shell hero-inner">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <span className="label">Privacy payments · Beldex</span>
              <span className="label">
                {config.nettype} · {status.escrow === "configured" ? "signer live" : "signer not configured"}
              </span>
            </div>

            <div>
              <h1 id="hero-title" className="hero-word">
                {"Blind".split("").map((letter, index) => (
                  <span key={letter} className="hero-letter" style={{ animationDelay: `${160 + index * 90}ms` }}>
                    {letter}
                  </span>
                ))}
              </h1>
              <p className="hero-rule">
                <span className="label">Send · claim · settle</span>
              </p>
            </div>

            <div className="hero-copy stack gap-5">
              <p className="hero-lede">Send and receive payments with absolute privacy.</p>
              <p className="muted hero-sub">
                Protect your financial history. Send and receive digital cash on Beldex without exposing your balances
                or transaction records. The recipient is never handed your wallet address; you are never handed theirs.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={session ? "/dashboard" : "/signin"} className="btn btn-primary">
                  Get started
                </Link>
                <Link href="#how" className="btn btn-ghost">
                  See how a payment moves
                </Link>
              </div>
              <p className="faint text-[13px]">
                Google, X, or a Beldex wallet signature. Blind asks for no seed phrase, no view key and no private key
                — it has no field for one.
              </p>
            </div>
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


        <section className="wrap-shell grid-contact pt-8">
          <Trust
            title="No address exchange"
            body="The payer never receives the recipient's wallet address, and the recipient never receives the payer's. A link carries a reference, not a wallet."
          />
          <Trust
            title="No seed phrase, ever"
            body="Blind has no field for a seed phrase, a view key or a private key. Signing in is a signature from your own wallet, not a secret handed over."
          />
          <Trust
            title="Custody in the open"
            body="A link anyone can claim needs somebody to hold a key while the payment is in flight. Blind names that custodian in writing before you use it."
          />
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

        <section className="wrap-shell py-14">
          <div className="panel stack items-start gap-6 !px-[clamp(24px,4.4vw,56px)]">
            <span className="label">Ready when you are</span>
            <h2 className="display max-w-[640px] text-[clamp(30px,4.6vw,52px)]">Send your first private payment.</h2>
            <p className="muted max-w-[560px] text-[17px]">
              Create a link that waits for whoever you send it to, or ask to be paid without publishing your address.
              Neither side ends up holding the other&rsquo;s wallet history.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={session ? "/dashboard" : "/signin"} className="btn btn-primary">
                {session ? "Open your dashboard" : "Get started"}
              </Link>
              <Link href="#privacy" className="btn btn-ghost">
                What Blind can see
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter nettype={status.nettype} daemon={status.daemon} escrow={status.escrow} />
    </>
  );
}

function Trust({ title, body }: { title: string; body: string }) {
  return (
    <article className="panel stack gap-3">
      <h2 className="display text-[22px]">{title}</h2>
      <p className="muted text-[15px]">{body}</p>
    </article>
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
