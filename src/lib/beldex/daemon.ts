import { beldexConfig } from "./config";
import type { BdxNettype } from "./nettype";

/**
 * Beldex daemon JSON-RPC client. Used only to *verify* what the chain says:
 * heights, block headers, and whether a transaction hash is mined and how
 * deeply. The daemon can never move funds, and no code path here trusts a
 * client-supplied status.
 */

export type DaemonInfo = {
  height: number;
  nettype: BdxNettype | "unknown";
  status: string;
  untrusted: boolean;
  databaseSizeBytes: number | null;
  immutableHeight: number | null;
  bnsNames: number | null;
};

export type TransactionEvidence = {
  txHash: string;
  found: boolean;
  inPool: boolean;
  blockHeight: number | null;
  blockTimestamp: number | null;
  confirmations: number;
  fee: string | null;
  size: number | null;
  unlockTime: number | null;
  /** Hash of the block the transaction was mined in, for reorg detection. */
  blockHash: string | null;
  untrusted: boolean;
  source: string;
  checkedAt: number;
  reason?: string;
};

export class DaemonError extends Error {
  readonly code: number | string;
  constructor(code: number | string, message: string) {
    super(message);
    this.name = "DaemonError";
    this.code = code;
  }
}

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code: number; message: string };
};

const DEFAULT_TIMEOUT_MS = 12_000;

export class BdxDaemon {
  private readonly url: string;
  private readonly timeoutMs: number;
  private id = 0;

  constructor(url: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  static fromEnv(): BdxDaemon | null {
    const config = beldexConfig();
    return config.daemonUrl ? new BdxDaemon(config.daemonUrl) : null;
  }

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.id += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: String(this.id), method, params: params ?? {} }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new DaemonError(response.status, `daemon returned HTTP ${response.status}`);
      }
      const payload = (await response.json()) as JsonRpcResponse<T>;
      if (payload.error) throw new DaemonError(payload.error.code, payload.error.message);
      if (payload.result === undefined) throw new DaemonError("empty", "daemon returned no result");
      return payload.result;
    } catch (error) {
      if (error instanceof DaemonError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new DaemonError("timeout", `daemon did not answer within ${this.timeoutMs}ms`);
      }
      throw new DaemonError("unreachable", error instanceof Error ? error.message : "daemon unreachable");
    } finally {
      clearTimeout(timer);
    }
  }

  async getInfo(): Promise<DaemonInfo> {
    const result = await this.call<Record<string, unknown>>("get_info");
    const height = Number(result.height ?? 0);
    return {
      height,
      nettype: typeof result.nettype === "string" ? (result.nettype.toLowerCase() as BdxNettype) : "unknown",
      status: String(result.status ?? "unknown"),
      untrusted: Boolean(result.untrusted),
      databaseSizeBytes: Number.isFinite(Number(result.database_size)) ? Number(result.database_size) : null,
      immutableHeight: Number.isFinite(Number(result.immutable_height)) ? Number(result.immutable_height) : null,
      bnsNames: Number.isFinite(Number(result.bns_counts)) ? Number(result.bns_counts) : null,
    };
  }

  async getBlockHeaderByHeight(height: number) {
    const result = await this.call<{ block_header: Record<string, unknown> }>("get_block_header_by_height", { height });
    const header = result.block_header ?? {};
    return {
      height: Number(header.height ?? height),
      hash: typeof header.hash === "string" ? header.hash : null,
      timestamp: Number.isFinite(Number(header.timestamp)) ? Number(header.timestamp) : null,
      difficulty: Number(header.difficulty ?? 0),
      reward: typeof header.reward === "string" ? header.reward : null,
    };
  }

  async getTransaction(txHash: string): Promise<TransactionEvidence> {
    const now = Date.now();
    const base: TransactionEvidence = {
      txHash,
      found: false,
      inPool: false,
      blockHeight: null,
      blockTimestamp: null,
      confirmations: 0,
      fee: null,
      size: null,
      unlockTime: null,
      blockHash: null,
      untrusted: false,
      source: this.url,
      checkedAt: now,
    };

    const result = await this.call<{
      txs?: Array<Record<string, unknown>>;
      missed_tx?: string[];
      untrusted?: boolean;
    }>("get_transactions", { txs_hashes: [txHash] });

    const untrusted = Boolean(result.untrusted);
    const tx = (result.txs ?? []).find((candidate) => candidate.tx_hash === txHash);
    if (!tx) {
      const missed = (result.missed_tx ?? []).includes(txHash);
      return {
        ...base,
        untrusted,
        reason: missed ? "the daemon does not know this transaction hash" : "transaction not found",
      };
    }

    const blockHeight = Number.isFinite(Number(tx.block_height)) ? Number(tx.block_height) : null;
    const inPool = blockHeight === null || blockHeight === 0;
    let confirmations = 0;
    let blockHash: string | null = null;

    if (!inPool && blockHeight !== null) {
      try {
        const info = await this.getInfo();
        confirmations = Math.max(0, info.height - blockHeight + 1);
        const header = await this.getBlockHeaderByHeight(blockHeight);
        blockHash = header.hash;
      } catch {
        // Height lookup is corroborating evidence only; the transaction itself
        // is what matters. Leave confirmations at 0 rather than guessing.
        confirmations = 0;
      }
    }

    return {
      ...base,
      found: true,
      inPool,
      blockHeight,
      blockTimestamp: Number.isFinite(Number(tx.block_timestamp)) ? Number(tx.block_timestamp) : null,
      confirmations,
      fee: tx.fee === undefined ? null : String(tx.fee),
      size: Number.isFinite(Number(tx.size)) ? Number(tx.size) : null,
      unlockTime: Number.isFinite(Number(tx.unlock_time)) ? Number(tx.unlock_time) : null,
      blockHash,
      untrusted,
    };
  }

  /** Some nodes expose fee estimation, some do not. Absent means "unavailable". */
  async getFeeEstimate(): Promise<{ feePerByte: number | null; quantizationMask: number | null } | null> {
    try {
      const result = await this.call<Record<string, unknown>>("get_fee_estimate", {});
      return {
        feePerByte: Number.isFinite(Number(result.fee_per_byte)) ? Number(result.fee_per_byte) : null,
        quantizationMask: Number.isFinite(Number(result.quantization_mask)) ? Number(result.quantization_mask) : null,
      };
    } catch {
      return null;
    }
  }

  async getHeight(): Promise<number> {
    const info = await this.getInfo();
    return info.height;
  }

  /**
   * Settlement verdict from chain evidence only. `untrusted` nodes are reported
   * as such so a receipt can say a bootstrap node answered.
   */
  async verifySettlement(
    txHash: string,
    minConfirmations: number
  ): Promise<TransactionEvidence & { settled: boolean; required: number }> {
    const evidence = await this.getTransaction(txHash);
    const settled = evidence.found && evidence.confirmations >= minConfirmations;
    return { ...evidence, settled, required: minConfirmations };
  }
}
