import { beldexConfig, ESCROW_ACCOUNT_INDEX, WALLET_RPC_PASSWORD, WALLET_RPC_USER } from "./config";

/**
 * Client for `beldex-wallet-rpc`, the wallet daemon that ships with Beldex.
 * This is the *only* thing in Blind that can move escrowed funds, and it runs
 * outside the web app (a Linux host, or a Mac running the arm64 build) — the
 * app talks to it over HTTP with Basic auth and never holds a seed or a spend
 * key of its own.
 *
 * Method names and payload shapes follow Beldex's Wallet RPC guide, which
 * mirrors Monero's wallet RPC. scripts/bdx/doctor.mjs checks every method this
 * file uses against the live wallet before Blind will offer escrow services.
 */

/**
 * An 8-byte payment id, in the 16-hex-character form the wallet wants.
 *
 * Monero's `make_integrated_address` invents one when the caller omits it;
 * Beldex refuses the call outright ("Payment ID shouldn't be left unspecified"),
 * so Blind mints the id itself and keeps it with the payment. It is the deposit's
 * label: the integrated address the payer is given encodes it, and
 * `get_bulk_payments` is asked for it when looking for the deposit.
 */
export function newPaymentId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type WalletRpcOptions = {
  url: string;
  user?: string | null;
  password?: string | null;
  timeoutMs?: number;
};

export class WalletRpcError extends Error {
  readonly code: number | string;
  readonly method: string;
  constructor(method: string, code: number | string, message: string) {
    super(`${method}: ${message}`);
    this.name = "WalletRpcError";
    this.code = code;
    this.method = method;
  }
}

export type SubaddressTransfer = {
  txid: string;
  tx_hash: string;
  amount: string;
  fee?: string;
  height: number | null;
  confirmations: number;
  timestamp?: number;
  payment_id?: string;
  subaddr_index?: { major: number; minor: number };
  address?: string;
  type?: string;
  unlock_time?: number;
};

export type PayoutPriority = 1 | 2 | 3 | 4 | 5;

/**
 * The extension SDK sends priorities 1 (default) … 5 (flash). Monero's wallet
 * RPC uses 0 … 4. BDX_WALLET_RPC_PRIORITY_STYLE picks which convention the
 * connected wallet expects; the default matches Beldex tooling.
 */
function mapPriority(priority: PayoutPriority): number {
  const style = (process.env.BDX_WALLET_RPC_PRIORITY_STYLE ?? "beldex").toLowerCase();
  if (style === "monero") return Math.max(0, Math.min(4, priority - 1));
  return Math.max(1, Math.min(5, priority));
}

export class BdxWalletRpc {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly authHeader: string | null;
  private id = 0;

  constructor(options: WalletRpcOptions) {
    this.url = options.url;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const user = options.user ?? null;
    const password = options.password ?? null;
    this.authHeader =
      user && password
        ? `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
        : user
          ? `Basic ${Buffer.from(`${user}:`).toString("base64")}`
          : null;
  }

  static fromEnv(): BdxWalletRpc | null {
    const config = beldexConfig();
    if (!config.walletRpcUrl) return null;
    return new BdxWalletRpc({
      url: config.walletRpcUrl,
      user: WALLET_RPC_USER(),
      password: WALLET_RPC_PASSWORD(),
    });
  }

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.id += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.authHeader ? { authorization: this.authHeader } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: String(this.id), method, params }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.status === 401) throw new WalletRpcError(method, 401, "wallet RPC rejected the credentials");
      if (!response.ok) throw new WalletRpcError(method, response.status, `wallet RPC returned HTTP ${response.status}`);
      const payload = (await response.json()) as { result?: T; error?: { code: number; message: string } };
      if (payload.error) throw new WalletRpcError(method, payload.error.code, payload.error.message);
      if (payload.result === undefined) throw new WalletRpcError(method, "empty", "wallet RPC returned no result");
      return payload.result;
    } catch (error) {
      if (error instanceof WalletRpcError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new WalletRpcError(method, "timeout", `wallet RPC did not answer within ${this.timeoutMs}ms`);
      }
      throw new WalletRpcError(method, "unreachable", error instanceof Error ? error.message : "wallet RPC unreachable");
    } finally {
      clearTimeout(timer);
    }
  }

  getVersion() {
    return this.call<{ version: number }>("get_version");
  }

  getHeight() {
    return this.call<{ height: number }>("get_height");
  }

  async openWallet(filename: string, password: string) {
    return this.call<Record<string, unknown>>("open_wallet", { filename, password });
  }

  async createWallet(filename: string, password: string, language = "English") {
    return this.call<Record<string, unknown>>("create_wallet", { filename, password, language });
  }

  getAddress(accountIndex = ESCROW_ACCOUNT_INDEX(), addressIndex = 0) {
    return this.call<{ address: string }>("get_address", { account_index: accountIndex, address_index: addressIndex });
  }

  getBalance(accountIndex = ESCROW_ACCOUNT_INDEX(), addressIndices?: number[]) {
    return this.call<{
      balance: number;
      unlocked_balance: number;
      per_subaddress?: Array<{ address: string; address_index: number; balance: number; unlocked_balance: number }>;
    }>("get_balance", {
      account_index: accountIndex,
      ...(addressIndices ? { address_indices: addressIndices } : {}),
    });
  }

  /** A fresh receiving destination for one payment (no address reuse). */
  createAddress(label: string, accountIndex = ESCROW_ACCOUNT_INDEX()) {
    return this.call<{ address: string; address_index: number }>("create_address", {
      account_index: accountIndex,
      label,
    });
  }

  makeIntegratedAddress(standardAddress: string, paymentId: string) {
    return this.call<{ integrated_address: string; payment_id: string }>("make_integrated_address", {
      standard_address: standardAddress,
      payment_id: paymentId,
    });
  }

  refresh() {
    return this.call<Record<string, unknown>>("refresh", {});
  }

  store() {
    return this.call<Record<string, unknown>>("store", {});
  }

  transfer(opts: {
    address: string;
    amountAtomic: string;
    priority?: PayoutPriority;
    accountIndex?: number;
    unlockTime?: number;
    getTxKey?: boolean;
    paymentId?: string;
  }) {
    return this.call<{ tx_hash: string; tx_key?: string; amount: number; fee: number }>("transfer", {
      destinations: [{ amount: Number(BigInt(opts.amountAtomic)), address: opts.address }],
      account_index: opts.accountIndex ?? ESCROW_ACCOUNT_INDEX(),
      priority: mapPriority(opts.priority ?? 2),
      get_tx_key: opts.getTxKey ?? true,
      ...(opts.unlockTime ? { unlock_time: opts.unlockTime } : {}),
      ...(opts.paymentId ? { payment_id: opts.paymentId } : {}),
    });
  }

  getTransfers(opts: {
    incoming?: boolean;
    outgoing?: boolean;
    pending?: boolean;
    failed?: boolean;
    pool?: boolean;
    accountIndex?: number;
    minHeight?: number;
    filterByHeight?: boolean;
  } = {}) {
    return this.call<{ in?: SubaddressTransfer[]; out?: SubaddressTransfer[]; pending?: SubaddressTransfer[]; failed?: SubaddressTransfer[]; pool?: SubaddressTransfer[] }>(
      "get_transfers",
      {
        in: opts.incoming ?? false,
        out: opts.outgoing ?? false,
        pending: opts.pending ?? false,
        failed: opts.failed ?? false,
        pool: opts.pool ?? false,
        account_index: opts.accountIndex ?? ESCROW_ACCOUNT_INDEX(),
        ...(opts.minHeight ? { min_height: opts.minHeight } : {}),
        ...(opts.filterByHeight === false ? { filter_by_height: false } : {}),
      }
    );
  }

  getTransferByTxid(txid: string, accountIndex = ESCROW_ACCOUNT_INDEX()) {
    return this.call<{ transfer: SubaddressTransfer }>("get_transfer_by_txid", {
      txid,
      account_index: accountIndex,
    });
  }

  getBulkPayments(paymentIds: string[], minBlockHeight = 0) {
    return this.call<{
      payments: Array<{ payment_id: string; tx_hash: string; amount: string; block_height: number; unlock_time: number }>;
    }>("get_bulk_payments", { payment_ids: paymentIds, min_block_height: minBlockHeight });
  }

  getPayments(paymentIds: string[]) {
    return this.call<{ payments: Array<{ payment_id: string; tx_hash: string; amount: string; block_height: number }> }>(
      "get_payments",
      { payment_ids: paymentIds }
    );
  }
}
