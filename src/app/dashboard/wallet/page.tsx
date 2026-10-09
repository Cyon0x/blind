import Link from "next/link";
import { Iris } from "@/components/Iris";
import { WalletBar } from "@/components/WalletBar";
import { WalletLinks } from "@/components/WalletLinks";
import { currentSession } from "@/lib/session";
import { listLinkedAccounts, listSessions, listWallets } from "@/lib/store";
import { beldexConfig } from "@/lib/beldex/config";
import { chainSource } from "@/lib/beldex/chain";
import { escrowHealth } from "@/lib/beldex/escrow";
import { shortAddress, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wallet & security" };

export default async function WalletPage() {
  const session = await currentSession();
  if (!session) return null;
  const config = beldexConfig();
  const source = chainSource();
  const [wallets, accounts, sessions, escrow] = await Promise.all([
    listWallets(session.user.id),
    listLinkedAccounts(session.user.id),
    listSessions(session.user.id),
    escrowHealth(),
  ]);

  return (
    <div className="stack gap-8 pt-4">
      <header className="stack gap-3">
        <span className="label">Wallet &amp; security</span>
        <h1 className="display text-[clamp(28px,4vw,44px)]">What Blind holds, and what it does not.</h1>
      </header>

      <WalletBar />

      <section className="panel stack gap-4">
        <span className="label">Network</span>
        <Row k="Beldex network" v={config.nettype} />
        <Row k="Confirmations before Blind calls a payment settled" v={String(config.confirmationsForSettlement)} />
        <Row k="Chain evidence" v={source ?? "not configured"} />
        <Row
          k="Evidence is trusted"
          v={source === "daemon" ? "yes, a node Blind was pointed at" : source === "explorer" ? "no, a third-party explorer" : "nothing to trust"}
        />
        {config.explorerUrl ? (
          <p className="faint text-[13px]">
            Anything Blind reports as settled on {config.nettype} is read from{" "}
            {source === "explorer" ? "the explorer" : "your node"}.{" "}
            <a className="underline" href={config.explorerUrl} target="_blank" rel="noreferrer noopener">
              Open {config.explorerUrl.replace(/^https?:\/\//, "")}
            </a>
          </p>
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel stack gap-4">
          <span className="label">Your addresses on Blind</span>
          {wallets.length === 0 ? (
            <p className="faint text-[14px]">
              No wallet linked. You can still receive a payout to any address you paste at claim time.
            </p>
          ) : (
            <ul className="stack gap-3">
              {wallets.map((wallet) => (
                <li key={wallet.address} className="stack gap-1">
                  <span className="figure break-all text-[13px]">{shortAddress(wallet.address, 14, 10)}</span>
                  <span className="faint text-[12px]">
                    {wallet.nettype} ·{" "}
                    {wallet.ownership_proven_at
                      ? `ownership proven ${timeAgo(wallet.ownership_proven_at)}`
                      : "added without a signature proof"} · last seen {timeAgo(wallet.last_seen_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <WalletLinks />
        </div>

        <div className="panel stack gap-4">
          <span className="label">Escrow signer</span>
          <Row k="Configured" v={escrow.configured ? "yes" : "no"} />
          <Row k="Reachable" v={escrow.reachable ? "yes" : "no"} />
          <Row k="Wallet open" v={escrow.walletOpen ? "yes" : "no"} />
          <Row k="Hot balance" v={escrow.totalBalanceAtomic ? `${escrow.totalBalanceAtomic} atomic` : "unknown"} />
          <Row k="Spendable balance" v={escrow.unlockedBalanceAtomic ? `${escrow.unlockedBalanceAtomic} atomic` : "unknown"} />
          <Row k="Hot cap" v={escrow.hotCapAtomic ? `${escrow.hotCapAtomic} atomic` : "not set"} />
          <Row k="Within cap" v={escrow.withinHotCap === null ? "unknown" : escrow.withinHotCap ? "yes" : "NO, pause payouts"} />
          <p className="faint text-[13px]">{escrow.detail}</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="panel stack gap-4">
          <span className="label">Sign-in methods</span>
          <ul className="stack gap-3">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-baseline justify-between gap-3">
                <span className="text-[15px]">{account.provider === "x" ? "X" : account.provider === "google" ? "Google" : "Wallet"}</span>
                <span className="faint figure text-[12px]">
                  {account.handle ?? account.profile?.address?.toString().slice(0, 14) ?? account.email ?? "linked"}
                </span>
              </li>
            ))}
          </ul>
          <p className="faint text-[13px]">
            Google sign-in stores the email on your account record only; it is never shown on a profile or a payment
            link. X handles are private unless you publish them in Settings.
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="pill" href="/api/auth/google/start?link=1">
              link Google
            </a>
            <a className="pill" href="/api/auth/x/start?link=1">
              link X
            </a>
          </div>
        </div>

        <div className="stack gap-6">
          <div className="panel stack gap-4">
            <span className="label">Active sessions</span>
            <ul className="stack gap-3">
              {sessions.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="faint text-[13px] max-w-[280px] truncate">{entry.user_agent ?? "unknown device"}</span>
                  <span className="figure text-[12px]">seen {timeAgo(entry.last_seen_at)}</span>
                </li>
              ))}
            </ul>
            <p className="faint text-[13px]">Sessions expire after 30 days and can be revoked by signing out.</p>
          </div>

          <div className="panel stack gap-3 items-start">
            <Iris state="fixed" size={90} />
            <span className="label">Recovery</span>
            <p className="faint text-[13px]">
              Blind has no seed phrase to recover: your wallet&rsquo;s is the only one that exists, and Blind never sees
              it. Losing the wallet means losing the wallet. Blind can recover your <em>account</em>, username,
              payment records, receipts, through Google or X, because none of that depends on your keys.
            </p>
            <Link href="/dashboard/settings" className="pill">
              account settings
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="faint text-[13px]">{k}</span>
      <span className="figure text-[13px]">{v}</span>
    </div>
  );
}
