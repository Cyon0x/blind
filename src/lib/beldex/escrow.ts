import { beldexConfig, ESCROW_WALLET_NAME } from "./config";
import { chainReader } from "./chain";
import { BdxWalletRpc, type PayoutPriority, type SubaddressTransfer } from "./wallet-rpc";

/**
 * The Blind claim escrow, expressed as real wallet operations.
 *
 * Beldex has no on-chain scripting, so a payment link that can be claimed by
 * whoever holds it cannot be trustless: somebody must hold a signing key while
 * the payment is in flight. Blind's answer is to make that window explicit,
 * short and auditable —
 *
 *   1. payer → a *fresh subaddress* of the escrow wallet, labelled with an
 *      integrated-address payment id unique to this payment (no address reuse,
 *      no deposit that can be attributed to another payment);
 *   2. Blind holds the escrow spend key in `beldex-wallet-rpc` outside the web
 *      app, and will only ever spend a deposit to the payout address attached to
 *      the claim that owns it;
 *   3. recipient → payout, with the claim secret proving ownership.
 *
 * docs/PRIVACY_THREAT_MODEL.md and docs/PAYMENT_FLOWS.md state the custody this
 * implies, what the escrow operator can learn, and what it cannot.
 */

export const ESCROW_CUSTODY_DISCLOSURE = {
  custodian: "Blind escrow service (beldex-wallet-rpc)",
  fundsAtRest: "Deposits sit in a Blind-controlled escrow wallet until claimed, refunded or expired.",
  serverCanLearn: [
    "the amount and time of each deposit",
    "the payout address chosen by the recipient",
    "which claim link was opened (unless the fragment is never loaded)",
  ],
  serverCannotLearn: [
    "the payer's wallet address or balance",
    "the recipient's balance or transaction history",
    "the identity behind either wallet beyond the address itself",
  ],
  mitigations: [
    "one fresh escrow subaddress per payment",
    "a unique payment id per payment, so deposits cannot be confused or merged",
    "payout only to the destination recorded by the claim, never to an address supplied later by a payer",
    "escrow hot balance cap, checked before every payout",
  ],
} as const;

export type DepositTarget = {
  address: string;
  integratedAddress: string;
  paymentId: string;
  subaddressIndex: number;
};

export type DepositEvidence = {
  txHash: string;
  amountAtomic: string;
  blockHeight: number | null;
  confirmations: number;
  paymentId: string;
  subaddressIndex: number | null;
  claimable: boolean;
  reason?: string;
};

export function escrowWallet(wallet: BdxWalletRpc = requireWallet()): BdxWalletRpc {
  return wallet;
}

function requireWallet(wallet?: BdxWalletRpc): BdxWalletRpc {
  const client = wallet ?? BdxWalletRpc.fromEnv();
  if (!client) {
    throw new EscrowUnavailable("Blind's escrow wallet is not configured (BDX_WALLET_RPC_URL is unset).");
  }
  return client;
}

export class EscrowUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EscrowUnavailable";
  }
}

/** Step 1 — a fresh, single-use destination for one payment. */
export async function allocateDepositTarget(label: string, wallet?: BdxWalletRpc): Promise<DepositTarget> {
  const client = requireWallet(wallet);
  const created = await client.createAddress(label);
  const integrated = await client.makeIntegratedAddress(created.address);
  return {
    address: created.address,
    integratedAddress: integrated.integrated_address,
    paymentId: integrated.payment_id,
    subaddressIndex: created.address_index,
  };
}

/**
 * Step 2 — evidence that a deposit actually arrived. Only incoming transfers
 * carrying this payment's id (or this payment's subaddress index) count, and
 * `claimable` additionally requires the wallet to have unlocked the output.
 */
export async function findDeposit(
  opts: { paymentId: string; subaddressIndex: number | null; minBlockHeight?: number; mergedPaymentId?: string },
  wallet?: BdxWalletRpc
): Promise<DepositEvidence | null> {
  const client = requireWallet(wallet);
  const ids = [opts.paymentId];
  if (opts.mergedPaymentId) ids.push(opts.mergedPaymentId);
  const bulk = await client.getBulkPayments(ids, opts.minBlockHeight ?? 0);
  const match = (bulk.payments ?? [])
    .filter((payment) => ids.includes(payment.payment_id))
    .sort((a, b) => (a.block_height ?? 0) - (b.block_height ?? 0));
  if (match.length === 0) return null;

  const total = match.reduce((sum, payment) => sum + BigInt(payment.amount), 0n);
  const first = match[0];
  const height = await client.getHeight().catch(() => null);

  const incoming = await client
    .getTransfers({ incoming: true, accountIndex: undefined, filterByHeight: false })
    .catch(() => ({ in: [] as SubaddressTransfer[] }));
  const detail = (incoming.in ?? []).find((transfer) =>
    match.some((payment) => payment.tx_hash === transfer.tx_hash)
  );
  const confirmations =
    height !== null && detail?.height ? Math.max(0, height.height - detail.height + 1) : 0;
  const locked = Boolean(detail && detail.unlock_time && detail.unlock_time > 0);

  return {
    txHash: first.tx_hash,
    amountAtomic: total.toString(),
    blockHeight: first.block_height ?? null,
    confirmations,
    paymentId: opts.paymentId,
    subaddressIndex: detail?.subaddr_index?.minor ?? opts.subaddressIndex,
    claimable: confirmations > 0 && !locked,
    reason: locked ? "the deposit is not unlocked yet" : undefined,
  };
}

/** Step 3 — pay a claim out. The caller owns idempotency and state transitions. */
export async function sendPayout(
  opts: { toAddress: string; amountAtomic: string; priority?: PayoutPriority; accountIndex?: number; unlockTime?: number },
  wallet?: BdxWalletRpc
): Promise<{ txHash: string; txKey: string | null; fee: string }> {
  const client = requireWallet(wallet);
  const result = await client.transfer({
    address: opts.toAddress,
    amountAtomic: opts.amountAtomic,
    priority: opts.priority ?? 2,
    accountIndex: opts.accountIndex,
    unlockTime: opts.unlockTime,
    getTxKey: true,
  });
  return { txHash: result.tx_hash, txKey: result.tx_key ?? null, fee: String(result.fee) };
}

/** Step 4 — what the escrow wallet itself knows about a payout it sent. */
export async function payoutEvidence(txHash: string, wallet?: BdxWalletRpc) {
  const client = requireWallet(wallet);
  const result = await client.getTransferByTxid(txHash);
  const transfer = result.transfer;
  return {
    txHash,
    found: Boolean(transfer),
    amountAtomic: transfer?.amount ? String(transfer.amount) : null,
    fee: transfer?.fee ? String(transfer.fee) : null,
    height: transfer?.height ?? null,
    confirmations: transfer?.confirmations ?? 0,
    address: transfer?.address ?? null,
    paymentId: transfer?.payment_id ?? null,
  };
}

/**
 * Recovery for the one genuinely dangerous window: the app asked the wallet to
 * send and never learned the outcome (process restart, timeout). Rather than
 * resend — which would pay twice — we look for an outgoing transfer that
 * matches the destination and amount we recorded.
 */
export async function reconcileOutgoing(
  opts: { toAddress: string; amountAtomic: string; sinceHeight?: number },
  wallet?: BdxWalletRpc
): Promise<SubaddressTransfer[]> {
  const client = requireWallet(wallet);
  const transfers = await client.getTransfers({
    outgoing: true,
    pending: true,
    failed: true,
    filterByHeight: false,
    minHeight: opts.sinceHeight,
  });
  const all = [...(transfers.out ?? []), ...(transfers.pending ?? []), ...(transfers.failed ?? [])];
  return all.filter((transfer) => {
    if (!transfer.address || transfer.address !== opts.toAddress) return false;
    try {
      return BigInt(transfer.amount) === BigInt(opts.amountAtomic);
    } catch {
      return false;
    }
  });
}

export type EscrowHealth = {
  configured: boolean;
  reachable: boolean;
  walletOpen: boolean;
  version: number | null;
  height: number | null;
  unlockedBalanceAtomic: string | null;
  totalBalanceAtomic: string | null;
  hotCapAtomic: string | null;
  withinHotCap: boolean | null;
  daemonReachable: boolean;
  nettype: string | null;
  detail: string;
};

/** Everything /api/health and the wallet page need to say the truth about escrow. */
export async function escrowHealth(): Promise<EscrowHealth> {
  const config = beldexConfig();
  const wallet = BdxWalletRpc.fromEnv();
  const health: EscrowHealth = {
    configured: Boolean(wallet),
    reachable: false,
    walletOpen: false,
    version: null,
    height: null,
    unlockedBalanceAtomic: null,
    totalBalanceAtomic: null,
    hotCapAtomic: process.env.BDX_ESCROW_HOT_CAP_ATOMIC ?? null,
    withinHotCap: null,
    daemonReachable: false,
    nettype: config.nettype,
    detail: "",
  };
  if (!wallet) {
    health.detail = "BDX_WALLET_RPC_URL is not set, so Blind cannot hold or release escrowed funds.";
    return health;
  }
  try {
    const version = await wallet.getVersion();
    health.reachable = true;
    health.version = version.version ?? null;
  } catch (error) {
    health.detail = error instanceof Error ? error.message : "wallet RPC unreachable";
    return health;
  }
  try {
    const balance = await wallet.getBalance();
    health.walletOpen = true;
    health.unlockedBalanceAtomic = String(balance.unlocked_balance);
    health.totalBalanceAtomic = String(balance.balance);
    if (health.hotCapAtomic) {
      health.withinHotCap = BigInt(balance.balance) <= BigInt(health.hotCapAtomic);
    }
    const height = await wallet.getHeight().catch(() => null);
    health.height = height?.height ?? null;
  } catch (error) {
    health.detail = `wallet RPC answered but no wallet is open: ${error instanceof Error ? error.message : "unknown"}`;
    return health;
  }
  const chain = chainReader();
  if (chain) {
    try {
      await chain.getInfo();
      health.daemonReachable = true;
    } catch {
      health.daemonReachable = false;
    }
  }
  health.detail = health.walletOpen
    ? `escrow wallet ${ESCROW_WALLET_NAME()} is open and answering`
    : "escrow wallet is not open";
  return health;
}
