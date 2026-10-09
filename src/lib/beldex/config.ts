import { isBdxNettype, type BdxNettype } from "./nettype";

/**
 * Every Beldex endpoint the app talks to is configuration, never a constant:
 * the same build must be able to run against regtest, testnet or mainnet.
 */
export type BeldexConfig = {
  nettype: BdxNettype;
  daemonUrl: string | null;
  walletRpcUrl: string | null;
  escrowEnabled: boolean;
  confirmationsForSettlement: number;
  explorerUrl: string | null;
};

function env(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function beldexConfig(): BeldexConfig {
  const configured = env("BDX_NETWORK");
  const nettype: BdxNettype = isBdxNettype(configured) ? configured : "mainnet";
  const confirmations = Number.parseInt(env("BDX_CONFIRMATIONS") ?? "10", 10);
  return {
    nettype,
    daemonUrl: env("BDX_DAEMON_URL"),
    walletRpcUrl: env("BDX_WALLET_RPC_URL"),
    escrowEnabled: Boolean(env("BDX_WALLET_RPC_URL")),
    confirmationsForSettlement: Number.isFinite(confirmations) && confirmations > 0 ? confirmations : 10,
    explorerUrl: env("BDX_EXPLORER_URL") ?? (nettype === "mainnet" ? "https://explorer.beldex.io" : null),
  };
}

export const WALLET_RPC_USER = () => env("BDX_WALLET_RPC_USER");
export const WALLET_RPC_PASSWORD = () => env("BDX_WALLET_RPC_PASSWORD");
export const ESCROW_WALLET_NAME = () => env("BDX_ESCROW_WALLET") ?? "blind-escrow";
export const ESCROW_ACCOUNT_INDEX = () => Number.parseInt(env("BDX_ESCROW_ACCOUNT") ?? "0", 10) || 0;

/** True when the daemon can be asked about chain state (settlement evidence). */
export function daemonConfigured(): boolean {
  return beldexConfig().daemonUrl !== null;
}

export function escrowConfigured(): boolean {
  return beldexConfig().escrowEnabled;
}

/** Human-readable status used by the UI and by /api/health. */
export function beldexStatus() {
  const config = beldexConfig();
  return {
    nettype: config.nettype,
    confirmationsForSettlement: config.confirmationsForSettlement,
    daemon: config.daemonUrl ? "configured" : "missing",
    escrow: config.walletRpcUrl ? "configured" : "missing",
    explorerUrl: config.explorerUrl,
  };
}
