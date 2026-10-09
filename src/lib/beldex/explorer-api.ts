import { beldexConfig } from "./config";
import { isBdxNettype } from "./nettype";
import type { DaemonInfo, TransactionEvidence } from "./daemon";

/**
 * Read-only chain evidence from a Beldex block explorer's JSON API.
 *
 * Why this exists: Beldex publishes a live testnet (the official explorer is
 * synced to it) but **no public testnet daemon**, so `BDX_DAEMON_URL` has
 * nothing to point at on testnet. Without a daemon Blind cannot answer the one
 * question settlement depends on — "is this transaction mined, and how deep?"
 * — so this adapter reads the same answer from the explorer that reads it from
 * a daemon.
 *
 * What it is not: a node we chose. Every piece of evidence it returns is marked
 * `untrusted: true` and carries `source: "explorer <url>"`, so receipts and the
 * UI can say a third party answered. A daemon, when `BDX_DAEMON_URL` is set,
 * always wins over this — see `chain.ts`.
 *
 * Two honest gaps against a daemon:
 *   - the explorer does not publish a fee estimate (`getFeeEstimate` is null);
 *   - it indexes mined blocks, so a mempool transaction reads as not-yet-found
 *     rather than "in the pool". Both only ever make Blind *more* conservative.
 */

export class ExplorerError extends Error {
  readonly code: number | string;
  constructor(code: number | string, message: string) {
    super(message);
    this.name = "ExplorerError";
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;

type Envelope<T> = { data?: T; status?: string };

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class BdxExplorerApi {
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(base: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.base = base.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }

  static fromEnv(): BdxExplorerApi | null {
    const url = beldexConfig().explorerApiUrl;
    return url ? new BdxExplorerApi(url) : null;
  }

  private async get<T>(path: string): Promise<Envelope<T> | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.base}${path}`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new ExplorerError(response.status, `the explorer answered ${response.status}`);
      }
      return (await response.json()) as Envelope<T>;
    } catch (error) {
      if (error instanceof ExplorerError) throw error;
      throw new ExplorerError(
        "unreachable",
        error instanceof Error ? error.message : "the explorer could not be reached"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async getInfo(): Promise<DaemonInfo> {
    const payload = await this.get<Record<string, unknown>>("/api/networkinfo");
    const data = payload?.data ?? {};
    return {
      height: num(data.height) ?? 0,
      nettype: isBdxNettype(data.nettype) ? data.nettype : "unknown",
      status: typeof data.status === "string" ? data.status : "unknown",
      // An explorer is a third party, never a node Blind selected.
      untrusted: true,
      databaseSizeBytes: num(data.database_size),
      immutableHeight: num(data.immutable_height),
      bnsNames: num(data.bns_counts),
    };
  }

  async getHeight(): Promise<number> {
    return (await this.getInfo()).height;
  }

  async getBlockHeaderByHeight(height: number) {
    const payload = await this.get<Record<string, unknown>>(`/api/block/${height}`);
    const data = payload?.data ?? {};
    return {
      height: num(data.height) ?? height,
      hash: typeof data.hash === "string" ? data.hash : null,
      timestamp: num(data.timestamp),
      // The explorer's block view does not expose either of these.
      difficulty: num(data.difficulty) ?? 0,
      reward: data.reward === undefined || data.reward === null ? null : String(data.reward),
    };
  }

  async getTransaction(txHash: string): Promise<TransactionEvidence> {
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
      untrusted: true,
      source: `explorer ${this.base}`,
      checkedAt: Date.now(),
    };

    let payload: Envelope<Record<string, unknown> | null> | null;
    try {
      payload = await this.get<Record<string, unknown> | null>(`/api/transaction/${txHash}`);
    } catch (error) {
      return { ...base, reason: error instanceof Error ? error.message : "the explorer could not be reached" };
    }

    const tx = payload?.data ?? null;
    if (!tx) {
      return { ...base, reason: "the explorer does not know this transaction hash" };
    }

    const blockHeight = num(tx.block_height);
    const inPool = !blockHeight;
    let confirmations = 0;
    let blockHash: string | null = null;
    if (!inPool && blockHeight !== null) {
      try {
        const info = await this.getInfo();
        confirmations = Math.max(0, info.height - blockHeight + 1);
        const header = await this.getBlockHeaderByHeight(blockHeight);
        blockHash = header.hash;
      } catch {
        // Corroborating evidence only: the transaction existing is what matters.
        confirmations = 0;
      }
    }

    return {
      ...base,
      found: true,
      inPool,
      blockHeight: blockHeight && blockHeight > 0 ? blockHeight : null,
      blockTimestamp: num(tx.block_timestamp),
      confirmations,
      fee: tx.fee === undefined || tx.fee === null ? null : String(tx.fee),
      size: num(tx.size),
      unlockTime: num(tx.unlock_time),
      blockHash,
    };
  }

  /** The explorer publishes no fee estimate. Absent means "unavailable". */
  async getFeeEstimate(): Promise<{ feePerByte: number | null; quantizationMask: number | null } | null> {
    return null;
  }

  async verifySettlement(
    txHash: string,
    minConfirmations: number
  ): Promise<TransactionEvidence & { settled: boolean; required: number }> {
    const evidence = await this.getTransaction(txHash);
    const settled = evidence.found && evidence.confirmations >= minConfirmations;
    return { ...evidence, settled, required: minConfirmations };
  }
}
