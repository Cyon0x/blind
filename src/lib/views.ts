import { beldexConfig } from "./beldex/config";
import { formatBdx } from "./beldex/units";
import { ESCROW_CUSTODY_DISCLOSURE } from "./beldex/escrow";
import { receiptIntegrity } from "./seal";
import type { PaymentRow, ReceiptRow } from "./store";

/**
 * What each viewer is allowed to see.
 *
 * The rule the wording everywhere depends on: Blind shows a participant the half
 * of the payment they own, and nothing about the other half. A payer never
 * learns a recipient's address or identity from Blind; a recipient never learns
 * the payer's. The public link (the claim page, and the request page before
 * anyone signs in) knows the amount, the description and the state, not the
 * people.
 */
export type ViewerRole = "creator" | "counterparty" | "public";

export type PaymentView = {
  reference: string;
  kind: "pay" | "request";
  status: string;
  statusLabel: string;
  statusTone: "latent" | "developing" | "fixed" | "dead";
  amountAtomic: string;
  amountDisplay: string;
  asset: string;
  description: string | null;
  invoiceRef: string | null;
  role: ViewerRole;
  payoutMode: "escrow" | "direct";
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  fundedAt: string | null;
  settledAt: string | null;
  claimedAt: string | null;
  failedReason: string | null;
  deposit: null | {
    address: string | null;
    integratedAddress: string | null;
    paymentId: string | null;
    txHash: string | null;
    confirmations: number;
    amountAtomic: string | null;
  };
  /**
   * Payout progress. The transaction id is withheld from the public link: a
   * payout is mined to the recipient's own address, so publishing the id on a
   * page anyone holding the link can read would hand an observer the one thing
   * Blind exists to keep out of the link. Participants still see it.
   */
  payout: {
    txHash: string | null;
    confirmations: number;
    verified: boolean;
  };
  /** Only the request's creator sees the address they asked to be paid at. */
  payoutAddress: string | null;
  /** Never the other participant's data. */
  you: { role: ViewerRole };
  counterpartyRole: "none" | "present";
  confirmationsRequired: number;
  explorerUrl: string | null;
  custody: typeof ESCROW_CUSTODY_DISCLOSURE;
  chainHref: string | null;
};

const LABELS: Record<string, { label: string; tone: PaymentView["statusTone"] }> = {
  created: { label: "Latent, not funded yet", tone: "latent" },
  awaiting_deposit: { label: "Waiting for the deposit", tone: "latent" },
  awaiting_payment: { label: "Waiting to be paid", tone: "latent" },
  funded: { label: "Funded in escrow", tone: "developing" },
  claim_pending: { label: "Claim in progress", tone: "developing" },
  payout_submitted: { label: "Payout sent, confirming", tone: "developing" },
  settled: { label: "Settled", tone: "fixed" },
  expired: { label: "Expired", tone: "dead" },
  cancelled: { label: "Cancelled", tone: "dead" },
  refunding: { label: "Refund in progress", tone: "developing" },
  refunded: { label: "Refunded", tone: "dead" },
  failed: { label: "Failed", tone: "dead" },
};

export function paymentView(payment: PaymentRow, viewerUserId: string | null): PaymentView {
  const config = beldexConfig();
  const role: ViewerRole =
    viewerUserId && payment.creator_user_id === viewerUserId
      ? "creator"
      : viewerUserId && payment.counterparty_user_id === viewerUserId
        ? "counterparty"
        : "public";

  const meta = LABELS[payment.status] ?? { label: payment.status, tone: "latent" as const };
  const amount = payment.deposit_amount_atomic ?? payment.amount_atomic;
  const showPayoutAddress = role === "creator" && payment.kind === "request";

  return {
    reference: payment.reference,
    kind: payment.kind,
    status: payment.status,
    statusLabel: meta.label,
    statusTone: meta.tone,
    amountAtomic: payment.amount_atomic,
    amountDisplay: formatBdx(payment.amount_atomic),
    asset: payment.asset,
    description: payment.description,
    invoiceRef: payment.invoice_ref,
    role,
    payoutMode: payment.payout_mode,
    createdAt: payment.created_at,
    expiresAt: payment.expires_at,
    expired: Boolean(payment.expires_at && new Date(payment.expires_at).getTime() < Date.now()),
    fundedAt: payment.funded_at,
    settledAt: payment.settled_at,
    claimedAt: payment.claimed_at,
    failedReason: payment.failed_reason,
    deposit:
      role === "creator" && payment.deposit_address
        ? {
            address: payment.deposit_address,
            integratedAddress: payment.deposit_integrated_address,
            paymentId: payment.deposit_payment_id,
            txHash: payment.deposit_tx_hash,
            confirmations: payment.deposit_confirmations,
            amountAtomic: payment.deposit_amount_atomic,
          }
        : null,
    payout: {
      txHash: role === "public" ? null : payment.payout_tx_hash,
      confirmations: payment.payout_confirmations,
      verified: Boolean(payment.settled_at),
    },
    payoutAddress: showPayoutAddress ? payment.payout_address : null,
    you: { role },
    counterpartyRole: payment.counterparty_user_id ? "present" : "none",
    confirmationsRequired: config.confirmationsForSettlement,
    explorerUrl: config.explorerUrl,
    custody: ESCROW_CUSTODY_DISCLOSURE,
    chainHref:
      role !== "public" && config.explorerUrl && payment.payout_tx_hash
        ? `${config.explorerUrl}/tx/${payment.payout_tx_hash}`
        : null,
  };
}

export type ReceiptView = {
  reference: string;
  side: "payer" | "recipient";
  amountDisplay: string;
  asset: string;
  issuedAt: string;
  settlementTxHash: string | null;
  settlementConfirmations: number;
  settlementVerified: boolean;
  blockHeight: string | null;
  integrityHash: string;
  engravingSeed: string;
  payload: Record<string, unknown>;
  explorerHref: string | null;
};

export function receiptView(receipt: ReceiptRow): ReceiptView {
  const config = beldexConfig();
  return {
    reference: receipt.reference,
    side: receipt.side,
    amountDisplay: formatBdx(receipt.amount_atomic),
    asset: receipt.asset,
    issuedAt: receipt.issued_at,
    settlementTxHash: receipt.settlement_tx_hash,
    settlementConfirmations: receipt.settlement_confirmations,
    settlementVerified: receipt.settlement_verified,
    blockHeight:
      receipt.settlement_block_height === null || receipt.settlement_block_height === undefined
        ? null
        : String(receipt.settlement_block_height),
    integrityHash: receipt.integrity_hash,
    engravingSeed: receipt.engraving_seed,
    payload: receipt.payload,
    explorerHref:
      config.explorerUrl && receipt.settlement_tx_hash
        ? `${config.explorerUrl}/tx/${receipt.settlement_tx_hash}`
        : null,
  };
}

/**
 * Recomputes a receipt's integrity hash from its own stored fields. Shared by
 * the API and the verification page so both report the same answer.
 */
export function receiptIntegrityCheck(receipt: ReceiptRow): { recomputed: string; matches: boolean } {
  const recomputed = receiptIntegrity({
    asset: receipt.asset,
    amountAtomic: receipt.amount_atomic,
    reference: receipt.payload?.reference ?? null,
    depositTxHash: receipt.payload?.depositTxHash ?? null,
    payoutTxHash: receipt.settlement_tx_hash,
    blockHeight: receipt.settlement_block_height === null ? null : Number(receipt.settlement_block_height),
    side: receipt.side,
    verified: receipt.settlement_verified,
  });
  return { recomputed, matches: recomputed === receipt.integrity_hash };
}

/** Copy that must never overstate what Blind verified. */
export function settlementWording(view: PaymentView): string {
  // A direct request is settled by the recipient's own wallet, so Blind has no
  // chain evidence for it whatever its status says.
  if (view.kind === "request" && view.payoutMode === "direct" && view.status === "settled") {
    return "The recipient confirmed this in their own wallet. Blind has no chain evidence for a direct payment.";
  }
  if (view.status === "settled") {
    return `Blind verified this against the Beldex chain with ${view.payout.confirmations} confirmations.`;
  }
  if (view.status === "payout_submitted") {
    return `The payout is on the network with ${view.payout.confirmations} of ${view.confirmationsRequired} confirmations. It is not final yet.`;
  }
  if (view.status === "funded") {
    return `The money is in Blind's escrow with ${view.deposit?.confirmations ?? 0} confirmations, waiting for a claim.`;
  }
  return "Nothing has settled yet.";
}
