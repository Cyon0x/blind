import { beldexConfig } from "./config";
import { BdxDaemon, type DaemonInfo, type TransactionEvidence } from "./daemon";
import { BdxExplorerApi } from "./explorer-api";

/**
 * The one place Blind asks "what does the chain say?".
 *
 * Two backends satisfy the same read-only contract:
 *
 *   daemon   — `BDX_DAEMON_URL`, a node Blind talks JSON-RPC to. Preferred, and
 *              the only source that can see the mempool or estimate fees.
 *   explorer — `BDX_EXPLORER_API_URL` (defaults to Beldex's official testnet
 *              explorer when the network is testnet). Used because Beldex
 *              publishes no public testnet daemon. Every answer is marked
 *              untrusted and names the explorer it came from.
 *
 * Funds can never move through this module: it reads heights, blocks and
 * whether a transaction hash is mined, and nothing else.
 */

export type ChainSource = "daemon" | "explorer";

export type ChainReader = {
  getInfo(): Promise<DaemonInfo>;
  getHeight(): Promise<number>;
  getBlockHeaderByHeight(height: number): Promise<{
    height: number;
    hash: string | null;
    timestamp: number | null;
    difficulty: number;
    reward: string | null;
  }>;
  getTransaction(txHash: string): Promise<TransactionEvidence>;
  getFeeEstimate(): Promise<{ feePerByte: number | null; quantizationMask: number | null } | null>;
  verifySettlement(
    txHash: string,
    minConfirmations: number
  ): Promise<TransactionEvidence & { settled: boolean; required: number }>;
};

/** Which backend would answer, or null when neither is configured. */
export function chainSource(): ChainSource | null {
  const config = beldexConfig();
  if (config.daemonUrl) return "daemon";
  if (config.explorerApiUrl) return "explorer";
  return null;
}

export function chainReader(): ChainReader | null {
  const source = chainSource();
  if (source === "daemon") return BdxDaemon.fromEnv();
  if (source === "explorer") return BdxExplorerApi.fromEnv();
  return null;
}
