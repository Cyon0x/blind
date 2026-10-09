"use client";

import { formatAtomic } from "@/lib/format";
import { useBeldex } from "@/lib/useBeldex";

/**
 * The wallet strip. It reports only what the wallet actually answered: a
 * connected address, a balance the wallet chose to share, or the reason it could
 * not. There is no placeholder balance anywhere in this component.
 */
export function WalletBar({ compact = false }: { compact?: boolean }) {
  const wallet = useBeldex();
  const balance = wallet.balance ? formatAtomic(wallet.balance.unlocked) : null;

  return (
    <div className="panel !py-4 !px-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span
          className={`inline-block h-[10px] w-[10px] rounded-full ${wallet.phase === "connected" ? "bg-develop" : "bg-safelight safelight-pulse"}`}
          aria-hidden
        />
        <div className="stack">
          <span className="label">Beldex wallet</span>
          <span className="figure text-[13px]">
            {wallet.phase === "probing"
              ? "looking for the extension…"
              : wallet.phase === "absent"
                ? "extension not installed"
                : wallet.phase === "connected" && wallet.address
                  ? `${wallet.address.slice(0, 10)}…${wallet.address.slice(-6)}`
                  : wallet.phase === "connecting"
                    ? "waiting for approval…"
                    : "available"}
          </span>
        </div>
      </div>

      {!compact && wallet.phase === "connected" ? (
        <div className="stack items-end">
          <span className="label">Spendable</span>
          <span className="figure text-[15px]">
            {balance ? `${balance} BDX${wallet.balance?.approximate ? " (approx.)" : ""}` : "wallet did not report a balance"}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {wallet.phase === "connected" ? (
          <>
            <button type="button" className="btn btn-ghost !py-3 !px-5" onClick={() => wallet.refreshBalance()}>
              Refresh
            </button>
            <button type="button" className="btn btn-ghost !py-3 !px-5" onClick={() => wallet.disconnect()}>
              Disconnect
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary !py-3 !px-5"
            onClick={() => wallet.connect()}
            disabled={wallet.phase === "probing" || wallet.phase === "connecting"}
          >
            {wallet.phase === "connecting" ? "Approving…" : "Connect wallet"}
          </button>
        )}
      </div>

      {wallet.phase === "absent" ? (
        <p className="faint w-full text-[13px]">
          Blind talks to the Beldex Wallet extension (<code>@bdxi/web3js</code>). Install it to send and claim money from
          this browser. Everything else on the page works without it.
        </p>
      ) : null}
      {wallet.locked ? (
        <p className="w-full error-text">
          Your wallet is locked. Open the Beldex Wallet extension, enter its password, then try again.
        </p>
      ) : null}
      {wallet.error ? <p className="w-full error-text">{wallet.error}</p> : null}
    </div>
  );
}
