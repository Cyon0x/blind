import { isBdxNettype, type BdxNettype } from "./nettype";

/**
 * Every Beldex endpoint the app talks to is configuration, never a constant:
 * the same build must be able to run against regtest, testnet or mainnet.
 */
export type BeldexConfig = {
  nettype: BdxNettype;
  daemonUrl: string | null;
  /** Read-only fallback for chain evidence when no daemon is reachable. */
  explorerApiUrl: string | null;
  walletRpcUrl: string | null;
  escrowEnabled: boolean;
  confirmationsForSettlement: number;
  explorerUrl: string | null;
};

/**
 * Beldex publishes no public testnet daemon, but it does publish the explorer
 * that is synced to testnet, and that explorer answers the settlement question.
 * Devnet has no published explorer at all, so it stays null.
 */
const DEFAULT_EXPLORER_API: Partial<Record<BdxNettype, string>> = {
  testnet: "https://testnet.beldex.dev",
};

const DEFAULT_EXPLORER: Partial<Record<BdxNettype, string>> = {
  mainnet: "https://explorer.beldex.io",
  testnet: "https://testnet.beldex.dev",
};

function env(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function beldexConfig(): BeldexConfig {
  const configured = env("BDX_NETWORK");
  // Testnet is the default on purpose: an unconfigured deployment should fail
  // safe (no real value at risk) rather than quietly touch mainnet.
  const nettype: BdxNettype = isBdxNettype(configured) ? configured : "testnet";
  const confirmations = Number.parseInt(env("BDX_CONFIRMATIONS") ?? "10", 10);
  return {
    nettype,
    daemonUrl: env("BDX_DAEMON_URL"),
    explorerApiUrl: env("BDX_EXPLORER_API_URL") ?? DEFAULT_EXPLORER_API[nettype] ?? null,
    walletRpcUrl: env("BDX_WALLET_RPC_URL"),
    escrowEnabled: Boolean(env("BDX_WALLET_RPC_URL")),
    confirmationsForSettlement: Number.isFinite(confirmations) && confirmations > 0 ? confirmations : 10,
    explorerUrl: env("BDX_EXPLORER_URL") ?? DEFAULT_EXPLORER[nettype] ?? null,
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
export const DAEMON_USER = () => env("BDX_DAEMON_USER");
export const DAEMON_PASSWORD = () => env("BDX_DAEMON_PASSWORD");
