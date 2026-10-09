import { beldexConfig } from "./beldex/config";
import { BdxDaemon, type TransactionEvidence } from "./beldex/daemon";
import { decodeAddress } from "./beldex/address";
import {
  EscrowUnavailable,
  allocateDepositTarget,
  findDeposit,
  payoutEvidence,
  reconcileOutgoing,
  sendPayout,
} from "./beldex/escrow";
import { formatBdx } from "./beldex/units";
import { claimSecretMatches, hashClaimSecret, newClaimReference, newClaimSecret } from "./claim-secret";
import { seal, unseal, engravingSeed, receiptIntegrity, claimSealingConfigured } from "./seal";
import * as store from "./store";
import type { PaymentRow } from "./store";

/**
 * Blind Pay and Blind Request, as one state machine.
 *
 *   pay:      created → awaiting_deposit → funded → claim_pending → payout_submitted → settled
 *   request:  awaiting_payment → funded → payout_submitted → settled
 *   (either)  → expired | failed | refunding → refunded
 *
 * Two rules hold everywhere below:
 *   1. a status only advances on evidence, from the escrow wallet for deposits
 *      and payouts, and from the daemon for confirmations. Nothing advances
 *      because a client said so;
 *   2. every transition that must not happen twice is a conditional UPDATE
 *      wrapped in `beginPayoutOperation`, which is where the unique constraints
 *      do the work.
 */

export const DEFAULT_EXPIRY_HOURS = 72;

export type CreatePayInput = {
  userId: string;
  amountAtomic: bigint;
  description?: string | null;
  invoiceRef?: string | null;
  expiresInHours?: number;
  /**
   * A username payment: the claim link is delivered to this Blind account
   * instead of being handed back to the payer, so the payer never holds the
   * credential that releases the money.
   */
  addressedToUserId?: string | null;
};

export type CreateRequestInput = CreatePayInput & {
  payoutAddress: string;
  payoutMode?: "escrow" | "direct";
};

function referenceFor(kind: "pay" | "request"): string {
  return `${kind === "pay" ? "bp" : "br"}_${newClaimReference()}`;
}

function expiryIso(hours: number | undefined): string | null {
  if (hours === undefined || hours === null || hours <= 0) return null;
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

/* ------------------------------------------------------------------ creation */

export type CreatedPay = {
  payment: PaymentRow;
  claim: { url: string; secret: string; resealable: boolean } | null;
};

export async function createPay(input: CreatePayInput & { appUrl: string }): Promise<CreatedPay> {
  const addressedTo = input.addressedToUserId ?? null;
  // An addressed payment is never handed to the payer, so the only way its
  // recipient can be given the link later is the sealed copy. Refuse to create
  // one we could not deliver rather than stranding the money.
  if (addressedTo && !claimSealingConfigured()) {
    throw new PaymentError(
      "This deployment cannot address a payment to a username: BDX_CLAIM_KEY is not set, so Blind could not hand the claim link to its recipient.",
      503
    );
  }
  const reference = referenceFor("pay");
  const secret = newClaimSecret();
  const secretHash = hashClaimSecret(secret);
  let sealed: string | null = null;
  try {
    sealed = seal(secret);
  } catch {
    sealed = null; // no BDX_CLAIM_KEY: the link is shown once and never re-displayed
  }

  const payment = await store.createPaymentRow({
    kind: "pay",
    reference,
    creatorUserId: input.userId,
    amountAtomic: input.amountAtomic.toString(),
    description: input.description ?? null,
    invoiceRef: input.invoiceRef ?? null,
    expiresAt: expiryIso(input.expiresInHours ?? DEFAULT_EXPIRY_HOURS),
    claimSecretHash: secretHash,
    counterpartyUserId: addressedTo,
  });

  // The deposit destination is real wallet work; if the escrow is down we fail
  // loudly instead of handing out a link that cannot hold money.
  const target = await allocateDepositTarget(`blind:pay:${reference}`);
  const updated = await store.attachDepositTarget(payment.id, target);
  await store.recordPaymentEvent({
    paymentId: payment.id,
    userId: input.userId,
    event: "pay.created",
    detail: { escrowConfigured: true, addressed: Boolean(addressedTo) },
  });
  await store.notify({
    userId: input.userId,
    kind: "payment_created",
    title: addressedTo ? "Payment addressed" : "Payment created",
    body: addressedTo
      ? `Send ${formatBdx(input.amountAtomic)} BDX to fund it. Only the address you named can claim it.`
      : `Send ${formatBdx(input.amountAtomic)} BDX to the deposit address to fund it.`,
    paymentId: payment.id,
  });
  if (addressedTo) {
    await store.notify({
      userId: addressedTo,
      kind: "payment_addressed",
      title: "A payment is being addressed to you",
      body: `Someone has set up ${formatBdx(input.amountAtomic)} BDX for you. It becomes claimable once it is funded, the link stays sealed with Blind until then.`,
      paymentId: payment.id,
    });
  }

  // The sealed copy is persisted through a dedicated statement so the plaintext
  // secret never lands in application logs.
  if (sealed) await persistSealedClaim(payment.id, sealed);

  return {
    payment: updated ?? payment,
    // An addressed payment hands its link to its recipient through the sealed
    // copy, never to the payer who created it.
    claim: addressedTo
      ? null
      : {
          url: `${input.appUrl}/claim/${reference}#${secret}`,
          secret,
          resealable: sealed !== null && claimSealingConfigured(),
        },
  };
}

async function persistSealedClaim(paymentId: string, sealed: string): Promise<void> {
  const { query } = await import("./db");
  await query("update payments set claim_secret_sealed = $2, updated_at = now() where id = $1", [paymentId, sealed]);
}

export type CreatedRequest = {
  payment: PaymentRow;
  url: string;
  payoutAddress: string;
  checksumVerified: boolean;
};

export async function createRequest(input: CreateRequestInput & { appUrl: string }): Promise<CreatedRequest> {
  const config = beldexConfig();
  const decoded = decodeAddress(input.payoutAddress.trim(), config.nettype);
  const payoutMode = input.payoutMode ?? "escrow";

  // Escrow mode hides the recipient's address from the payer entirely, so we
  // verify the address here rather than later. Direct mode hands the address to
  // the payer's wallet, where it is re-validated anyway.
  if (!decoded.ok && payoutMode === "escrow") {
    throw new PaymentError(`Blind cannot pay out to that address: ${decoded.reason}`);
  }

  const reference = referenceFor("request");
  const payment = await store.createPaymentRow({
    kind: "request",
    reference,
    creatorUserId: input.userId,
    amountAtomic: input.amountAtomic.toString(),
    description: input.description ?? null,
    invoiceRef: input.invoiceRef ?? null,
    expiresAt: expiryIso(input.expiresInHours ?? DEFAULT_EXPIRY_HOURS),
    payoutAddress: input.payoutAddress.trim(),
    payoutMode,
    recipientVisibility: "private",
  });

  let row = payment;
  if (payoutMode === "escrow") {
    const target = await allocateDepositTarget(`blind:req:${reference}`);
    row = (await store.attachDepositTarget(payment.id, target)) ?? payment;
  }
  await store.recordPaymentEvent({
    paymentId: payment.id,
    userId: input.userId,
    event: "request.created",
    detail: { payoutMode, checksumVerified: decoded.ok },
  });

  return {
    payment: row,
    url: `${input.appUrl}/r/${reference}`,
    payoutAddress: input.payoutAddress.trim(),
    checksumVerified: decoded.ok,
  };
}

export class PaymentError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PaymentError";
    this.status = status;
  }
}

/* ------------------------------------------------------------------ funding */

export type FundingRefresh = {
  payment: PaymentRow;
  changed: boolean;
  depositConfirmations: number;
  required: number;
  detail: string;
};

/**
 * Asks the escrow wallet what it can see for this payment, then advances the
 * state only if the evidence supports it. The daemon is consulted for how deep
 * the deposit is; the wallet is the one that knows it received the money.
 */
export async function refreshFunding(payment: PaymentRow): Promise<FundingRefresh> {
  const required = beldexConfig().confirmationsForSettlement;
  if (payment.status !== "awaiting_deposit" && payment.status !== "awaiting_payment" && payment.status !== "created") {
    return {
      payment,
      changed: false,
      depositConfirmations: payment.deposit_confirmations,
      required,
      detail: `no funding refresh applies while a payment is ${payment.status}`,
    };
  }
  if (!payment.deposit_payment_id && !payment.deposit_subaddress_index) {
    return { payment, changed: false, depositConfirmations: 0, required, detail: "this payment has no deposit destination yet" };
  }

  let deposit;
  try {
    deposit = await findDeposit({
      paymentId: payment.deposit_payment_id ?? "",
      subaddressIndex: payment.deposit_subaddress_index,
      minBlockHeight: 0,
    });
  } catch (error) {
    const detail =
      error instanceof EscrowUnavailable || error instanceof Error ? error.message : "escrow unavailable";
    return { payment, changed: false, depositConfirmations: payment.deposit_confirmations, required, detail };
  }
  if (!deposit) {
    return { payment, changed: false, depositConfirmations: payment.deposit_confirmations, required, detail: "no deposit seen yet" };
  }

  // Deepen the record even before the threshold is met, so the UI can show the
  // honest "seen, 2 of 10 confirmations" state.
  let confirmations = deposit.confirmations;
  const daemon = BdxDaemon.fromEnv();
  if (daemon) {
    try {
      const chain = await daemon.getTransaction(deposit.txHash);
      if (chain.found) confirmations = chain.confirmations;
    } catch {
      /* keep the wallet's count */
    }
  }
  await store.updateDepositConfirmations(payment.id, confirmations);

  if (confirmations < required) {
    return {
      payment: await store.getPaymentById(payment.id) ?? payment,
      changed: false,
      depositConfirmations: confirmations,
      required,
      detail: `deposit seen, ${confirmations} of ${required} confirmations`,
    };
  }

  // One transition per kind: a deposit observed against a payment link can
  // never advance a request, or the other way round.
  const funded =
    payment.kind === "pay"
      ? await store.markFunded({
          paymentId: payment.id,
          txHash: deposit.txHash,
          amountAtomic: deposit.amountAtomic,
          confirmations,
        })
      : await store.markRequestFunded({
          paymentId: payment.id,
          txHash: deposit.txHash,
          amountAtomic: deposit.amountAtomic,
          confirmations,
        });
  if (!funded) {
    return {
      payment: await store.getPaymentById(payment.id) ?? payment,
      changed: false,
      depositConfirmations: confirmations,
      required,
      detail: "another writer advanced this payment first",
    };
  }

  await store.recordPaymentEvent({
    paymentId: funded.id,
    event: funded.kind === "pay" ? "funding.confirmed" : "request.funded",
    detail: { txHash: deposit.txHash, confirmations },
  });
  await store.notify({
    userId: funded.creator_user_id,
    kind: funded.kind === "pay" ? "funding_confirmed" : "payment_received",
    title: funded.kind === "pay" ? "Payment funded" : "Your request was paid",
    body:
      funded.kind === "pay"
        ? `${formatBdx(funded.deposit_amount_atomic ?? funded.amount_atomic)} BDX confirmed in the escrow.`
        : `${formatBdx(funded.deposit_amount_atomic ?? funded.amount_atomic)} BDX arrived for your request. Blind is forwarding it to the address you named.`,
    paymentId: funded.id,
  });

  // A request is a payment *out*, so funding it starts the payout to the
  // address its creator named. Escrow mode only: a direct request never had a
  // deposit to forward.
  if (funded.kind === "request" && funded.payout_mode === "escrow" && funded.payout_address) {
    const payout = await executePayout(funded, funded.payout_address, "payout");
    return {
      payment: (await store.getPaymentById(funded.id)) ?? funded,
      changed: true,
      depositConfirmations: confirmations,
      required,
      detail: payout.txHash ? `funded and forwarded: ${payout.detail}` : `funded, but the forward failed: ${payout.detail}`,
    };
  }

  return { payment: funded, changed: true, depositConfirmations: confirmations, required, detail: "funded" };
}

/* --------------------------------------------------------------------- claim */

export type ClaimOutcome = {
  payment: PaymentRow;
  payoutTxHash: string | null;
  status: "payout_submitted" | "already_claimed" | "expired" | "not_claimable" | "settled";
  detail: string;
  confirmations: number;
  required: number;
};

/**
 * The recipient's side of Blind Pay.
 *
 * Authorization is proof of the claim secret (sha256 compared in the UPDATE's
 * WHERE clause, so the check and the transition are one atomic operation).
 * The payout is then attempted exactly once per payment: `beginPayoutOperation`
 * is the lock, and a crash mid-send is recovered by `reconcileOutgoing` rather
 * than by sending again.
 */
export async function claimPayment(input: {
  reference: string;
  secret: string;
  payoutAddress: string;
  claimerUserId?: string | null;
}): Promise<ClaimOutcome> {
  const config = beldexConfig();
  const payment = await store.getPaymentByReference(input.reference);
  if (!payment || payment.kind !== "pay") throw new PaymentError("no such payment", 404);

  const addressCheck = decodeAddress(input.payoutAddress.trim(), config.nettype);
  if (!addressCheck.ok) throw new PaymentError(`Blind cannot pay out to that address: ${addressCheck.reason}`);

  const required = config.confirmationsForSettlement;
  const secretHash = hashClaimSecret(input.secret);
  if (!payment.claim_secret_hash) throw new PaymentError("this payment has no claim secret", 409);
  if (!claimSecretMatches(input.secret, payment.claim_secret_hash)) {
    throw new PaymentError("this claim link does not match the payment", 403);
  }

  const claimed = await store.beginClaim({
    paymentId: payment.id,
    secretHash,
    payoutAddress: input.payoutAddress.trim(),
  });
  if (!claimed) {
    const current = (await store.getPaymentById(payment.id)) ?? payment;
    if (current.status === "expired") {
      return { payment: current, payoutTxHash: null, status: "expired", detail: "this payment link has expired", confirmations: 0, required };
    }
    if (["claim_pending", "payout_submitted", "settled", "refunded", "refunding"].includes(current.status)) {
      return {
        payment: current,
        payoutTxHash: current.payout_tx_hash,
        status: current.status === "settled" ? "settled" : "already_claimed",
        detail: "this payment has already been claimed",
        confirmations: current.payout_confirmations,
        required,
      };
    }
    return { payment: current, payoutTxHash: null, status: "not_claimable", detail: `a payment in state ${current.status} cannot be claimed`, confirmations: 0, required };
  }

  if (input.claimerUserId) await store.setCounterparty(claimed.id, input.claimerUserId);
  await store.recordPaymentEvent({
    paymentId: claimed.id,
    userId: input.claimerUserId ?? null,
    event: "claim.authorized",
    detail: {},
  });

  const payout = await executePayout(claimed, claimed.payout_address as string, "payout");
  const after = (await store.getPaymentById(claimed.id)) ?? claimed;
  return {
    payment: after,
    payoutTxHash: payout.txHash,
    status: payout.txHash ? "payout_submitted" : "not_claimable",
    detail: payout.detail,
    confirmations: after.payout_confirmations,
    required,
  };
}

/**
 * One payout attempt per (payment, kind). Returns the transaction hash when the
 * escrow wallet accepted the send, or a plain explanation when it did not.
 */
async function executePayout(
  payment: PaymentRow,
  toAddress: string,
  kind: "payout" | "refund"
): Promise<{ txHash: string | null; detail: string }> {
  const amount = payment.deposit_amount_atomic ?? payment.amount_atomic;
  const { operation, created } = await store.beginPayoutOperation({
    paymentId: payment.id,
    kind,
    idempotencyKey: `${payment.reference}:${kind}`,
    toAddress,
    amountAtomic: amount,
  });

  if (!created) {
    if (operation.tx_hash) {
      await store.setPaymentStatus(payment.id, "payout_submitted", { payoutTxHash: operation.tx_hash });
      return { txHash: operation.tx_hash, detail: "payout was already submitted" };
    }
    if (operation.status === "failed") {
      return { txHash: null, detail: operation.error ?? "a previous payout attempt failed" };
    }
    // The dangerous case: we asked the wallet and never learned the outcome.
    // Look for the transfer instead of sending a second one.
    try {
      const matches = await reconcileOutgoing({ toAddress, amountAtomic: amount });
      const recovered = matches[0];
      if (recovered) {
        await store.finishPayoutOperation(operation.id, { status: "submitted", txHash: recovered.tx_hash });
        await store.setPaymentStatus(payment.id, "payout_submitted", { payoutTxHash: recovered.tx_hash });
        await store.recordPaymentEvent({ paymentId: payment.id, event: "payout.recovered", detail: { txHash: recovered.tx_hash } });
        return { txHash: recovered.tx_hash, detail: "recovered a payout that had already reached the wallet" };
      }
    } catch {
      /* fall through to the unknown state below */
    }
    await store.finishPayoutOperation(operation.id, {
      status: "unknown",
      error: "the wallet never reported an outcome; not resending to avoid a double payment",
    });
    return {
      txHash: null,
      detail: "the escrow wallet did not report an outcome; Blind will not risk a second payout and needs an operator look",
    };
  }

  const reserved = await store.markPayoutSubmitting(operation.id);
  if (!reserved) return { txHash: null, detail: "another worker is already sending this payout" };

  try {
    const result = await sendPayout({ toAddress, amountAtomic: amount, priority: 2 });
    await store.finishPayoutOperation(operation.id, { status: "submitted", txHash: result.txHash, feeAtomic: result.fee });
    await store.setPaymentStatus(payment.id, "payout_submitted", { payoutTxHash: result.txHash });
    await store.recordPaymentEvent({
      paymentId: payment.id,
      event: kind === "payout" ? "payout.submitted" : "refund.submitted",
      detail: { txHash: result.txHash, fee: result.fee },
    });
    await store.notify({
      userId: payment.creator_user_id,
      kind: "payout_submitted",
      title: kind === "payout" ? "Payment on its way" : "Refund on its way",
      body: `The escrow sent ${formatBdx(amount)} BDX.`,
      paymentId: payment.id,
    });
    return { txHash: result.txHash, detail: "payout submitted to the network" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown wallet error";
    await store.finishPayoutOperation(operation.id, { status: "failed", error: message });
    await store.setPaymentStatus(payment.id, kind === "payout" ? "funded" : "funded", { reason: message });
    await store.recordPaymentEvent({ paymentId: payment.id, event: "payout.failed", detail: { message } });
    return { txHash: null, detail: `the escrow wallet rejected the payout: ${message}` };
  }
}

/* --------------------------------------------------------------- settlement */

export type SettlementOutcome = {
  payment: PaymentRow;
  settled: boolean;
  confirmations: number;
  required: number;
  evidence: TransactionEvidence | null;
  detail: string;
};

/**
 * Confirms a payout with two independent sources: the escrow wallet (which
 * knows it sent the transaction) and the daemon (which knows the chain mined
 * it and how deep). Both are reported; neither is inferred from a request body.
 */
export async function refreshSettlement(payment: PaymentRow): Promise<SettlementOutcome> {
  const required = beldexConfig().confirmationsForSettlement;
  if (!payment.payout_tx_hash) {
    return { payment, settled: false, confirmations: 0, required, evidence: null, detail: "no payout transaction to verify yet" };
  }

  let walletConfirmations = payment.payout_confirmations;
  try {
    const evidence = await payoutEvidence(payment.payout_tx_hash);
    if (evidence.found) walletConfirmations = evidence.confirmations;
  } catch {
    /* the daemon below may still be able to answer */
  }

  let evidence: TransactionEvidence | null = null;
  const daemon = BdxDaemon.fromEnv();
  if (daemon) {
    try {
      evidence = await daemon.getTransaction(payment.payout_tx_hash);
    } catch {
      evidence = null;
    }
  }
  const confirmations = Math.max(walletConfirmations, evidence?.confirmations ?? 0);
  const settled = confirmations >= required && (evidence ? evidence.found : walletConfirmations >= required);

  if (settled && payment.status !== "settled") {
    await store.setPaymentStatus(payment.id, "settled", { confirmations });
    await store.finishPayoutOperationFor(payment.id, "payout", { status: "confirmed" });
    await store.recordPaymentEvent({
      paymentId: payment.id,
      event: "settlement.confirmed",
      detail: { confirmations, blockHeight: evidence?.blockHeight ?? null },
    });
    await store.notify({
      userId: payment.creator_user_id,
      kind: "payment_settled",
      title: "Payment settled",
      body: `${formatBdx(payment.deposit_amount_atomic ?? payment.amount_atomic)} BDX settled with ${confirmations} confirmations.`,
      paymentId: payment.id,
    });
  } else if (!settled) {
    await store.setPaymentStatus(payment.id, payment.status, { confirmations });
  }

  const updated = (await store.getPaymentById(payment.id)) ?? payment;
  return {
    payment: updated,
    settled,
    confirmations,
    required,
    evidence,
    detail: settled ? "settled" : `${confirmations} of ${required} confirmations`,
  };
}

/* ------------------------------------------------------------- direct pay */

export type RequestPayerTarget = {
  reference: string;
  mode: "escrow" | "direct";
  amountAtomic: string;
  /** Escrow mode: the one-time address a payer's wallet sends to. */
  depositIntegratedAddress: string | null;
  /** Direct mode: the recipient's own address, which this mode necessarily exposes. */
  payoutAddress: string | null;
  open: boolean;
  reason: string | null;
};

/**
 * What a payer needs in order to pay a request, and nothing about the person
 * who created it. In escrow mode that is a one-time escrow address that says
 * nothing about the recipient; in direct mode it is the recipient's address,
 * which is the trade-off direct mode documents.
 */
export function requestPayerTarget(payment: PaymentRow): RequestPayerTarget {
  const base = {
    reference: payment.reference,
    mode: payment.payout_mode,
    amountAtomic: payment.amount_atomic,
  };
  if (payment.kind !== "request") {
    return { ...base, mode: "escrow", depositIntegratedAddress: null, payoutAddress: null, open: false, reason: "This link is not a payment request." };
  }
  if (payment.status !== "awaiting_payment") {
    const reason =
      payment.status === "expired"
        ? "This request has expired and no longer accepts a payment."
        : payment.status === "failed"
          ? "This request failed and no longer accepts a payment."
          : `This request is already ${payment.status}, the money has moved.`;
    return { ...base, depositIntegratedAddress: null, payoutAddress: null, open: false, reason };
  }
  if (payment.payout_mode === "direct") {
    return {
      ...base,
      depositIntegratedAddress: null,
      payoutAddress: payment.payout_address,
      open: Boolean(payment.payout_address),
      reason: payment.payout_address ? null : "This request has no payout address on record.",
    };
  }
  return {
    ...base,
    depositIntegratedAddress: payment.deposit_integrated_address,
    payoutAddress: null,
    open: Boolean(payment.deposit_integrated_address),
    reason: payment.deposit_integrated_address
      ? null
      : "The escrow has not produced a deposit address for this request yet.",
  };
}

/**
 * Opportunistic sweep for links past their expiry that never took money. It is
 * evidence-free by construction: only states with no deposit are touched, so a
 * funded payment can never be retired out from under its owner.
 */
export async function sweepExpired(): Promise<number> {
  const rows = await store.expireStalePayments(25);
  return rows.length;
}

/**
 * Blind Request with `payoutMode: 'direct'`: the payer's wallet pays the
 * recipient's address itself, so there is no escrow and Blind never holds the
 * money. The trade-off is honest and surfaced in the UI: nobody but the
 * recipient's own wallet can confirm the money arrived, so a direct request is
 * marked recipient-confirmed rather than chain-verified.
 */
export async function markDirectRequestPaid(input: {
  reference: string;
  payerUserId?: string | null;
  payerWalletAddress?: string | null;
}): Promise<PaymentRow> {
  const payment = await store.getPaymentByReference(input.reference);
  if (!payment || payment.kind !== "request") throw new PaymentError("no such request", 404);
  if (payment.payout_mode !== "direct") throw new PaymentError("this request is settled through the escrow", 409);
  if (input.payerUserId) await store.setCounterparty(payment.id, input.payerUserId);
  await store.recordPaymentEvent({
    paymentId: payment.id,
    userId: input.payerUserId ?? null,
    event: "direct.payer_submitted",
    detail: { payerWalletKnown: Boolean(input.payerWalletAddress) },
  });
  await store.notify({
    userId: payment.creator_user_id,
    kind: "request_paid_direct",
    title: "Someone says they paid your request",
    body: `${formatBdx(payment.amount_atomic)} BDX was sent directly to your address. Confirm it in your wallet.`,
    paymentId: payment.id,
  });
  return (await store.getPaymentById(payment.id)) ?? payment;
}

/** The recipient confirms money landed; the only witness is their own wallet. */
export async function recipientConfirmsDirect(input: { reference: string; userId: string }): Promise<PaymentRow> {
  const payment = await store.getPaymentByReference(input.reference);
  if (!payment || payment.kind !== "request") throw new PaymentError("no such request", 404);
  if (payment.creator_user_id !== input.userId) throw new PaymentError("only the recipient can confirm this request", 403);
  if (payment.payout_mode !== "direct") throw new PaymentError("this request is settled through the escrow", 409);
  const row = await store.setPaymentStatus(payment.id, "settled");
  await store.recordPaymentEvent({ paymentId: payment.id, userId: input.userId, event: "direct.recipient_confirmed" });
  return row ?? payment;
}

/* ------------------------------------------------------------------ receipts */

/**
 * Writes both sides' receipts, idempotently (one per side, enforced by a unique
 * index). `settlement_verified` is true only when chain evidence of the payout
 * exists, a receipt never claims more than was observed.
 */
export async function ensureReceipts(payment: PaymentRow): Promise<void> {
  const evidence = payment.payout_tx_hash ? await safeEvidence(payment.payout_tx_hash) : null;
  const verified = Boolean(evidence?.found && evidence.confirmations >= beldexConfig().confirmationsForSettlement);
  const required = beldexConfig().confirmationsForSettlement;

  const base = {
    asset: payment.asset,
    amountAtomic: payment.amount_atomic,
    reference: payment.reference,
    depositTxHash: payment.deposit_tx_hash,
    payoutTxHash: payment.payout_tx_hash,
    blockHeight: evidence?.blockHeight ?? null,
  };

  // Which side of the money each participant holds depends on the kind: the
  // creator of a Blind Pay is the payer; the creator of a Blind Request is the
  // one being paid. Getting this wrong would put a receipt in the wrong hands.
  const amount = payment.deposit_amount_atomic ?? payment.amount_atomic;
  const payerUserId = payment.kind === "pay" ? payment.creator_user_id : payment.counterparty_user_id;
  const recipientUserId = payment.kind === "pay" ? payment.counterparty_user_id : payment.creator_user_id;
  const sides: Array<{ side: "payer" | "recipient"; ownerUserId: string | null; amountAtomic: string }> = [
    { side: "payer", ownerUserId: payerUserId, amountAtomic: amount },
    { side: "recipient", ownerUserId: recipientUserId, amountAtomic: amount },
  ];

  for (const entry of sides) {
    const reference = `rc_${newClaimReference()}`;
    const payload = {
      kind: payment.kind,
      ...base,
      side: entry.side,
      amountAtomic: entry.amountAtomic,
      confirmations: evidence?.confirmations ?? payment.payout_confirmations,
      requiredConfirmations: required,
      verified,
      issuedAt: new Date().toISOString(),
      // The receipt states which half of the story this holder is entitled to.
      disclosure:
        entry.side === "payer"
          ? "The recipient's address and identity are not part of this receipt."
          : "The payer's address and identity are not part of this receipt.",
    };
    await store.insertReceipt({
      reference,
      paymentId: payment.id,
      ownerUserId: entry.ownerUserId,
      side: entry.side,
      amountAtomic: entry.amountAtomic,
      settlementTxHash: payment.payout_tx_hash,
      settlementConfirmations: evidence?.confirmations ?? payment.payout_confirmations,
      settlementBlockHeight: evidence?.blockHeight !== null && evidence?.blockHeight !== undefined ? String(evidence.blockHeight) : null,
      settlementBlockHash: evidence?.blockHash ?? null,
      settlementVerified: verified,
      integrityHash: receiptIntegrity({ ...base, side: entry.side, amountAtomic: entry.amountAtomic, verified }),
      engravingSeed: engravingSeed(`${payment.reference}:${entry.side}`),
      payload,
    });
  }
}

async function safeEvidence(txHash: string): Promise<TransactionEvidence | null> {
  const daemon = BdxDaemon.fromEnv();
  if (!daemon) return null;
  try {
    return await daemon.getTransaction(txHash);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- refunds */

export async function refundClaim(input: { reference: string; userId: string; toAddress: string }): Promise<ClaimOutcome> {
  const payment = await store.getPaymentByReference(input.reference);
  if (!payment || payment.kind !== "pay") throw new PaymentError("no such payment", 404);
  if (payment.creator_user_id !== input.userId) throw new PaymentError("only the payer can take back an unclaimed payment", 403);
  if (payment.status !== "funded") throw new PaymentError("only a funded, unclaimed payment can be refunded", 409);
  if (!payment.funded_at || Date.now() - new Date(payment.funded_at).getTime() < 3_600_000) {
    throw new PaymentError("Blind holds a claim open for at least an hour after funding before a refund", 409);
  }
  const check = decodeAddress(input.toAddress.trim(), beldexConfig().nettype);
  if (!check.ok) throw new PaymentError(`Blind cannot refund to that address: ${check.reason}`);

  const updated = await store.setPaymentStatus(payment.id, "refunding");
  const current = updated ?? payment;
  const payout = await executePayout(current, input.toAddress.trim(), "refund");
  const after = (await store.getPaymentById(payment.id)) ?? current;
  return {
    payment: after,
    payoutTxHash: payout.txHash,
    status: payout.txHash ? "payout_submitted" : "not_claimable",
    detail: payout.detail,
    confirmations: after.payout_confirmations,
    required: beldexConfig().confirmationsForSettlement,
  };
}

/* --------------------------------------------------------------- claim links */

export type ClaimLinkView = {
  url: string | null;
  resealable: boolean;
  sealedOnly: boolean;
  /** Why the link is not being handed over, when it is not. */
  reason: string | null;
};

/**
 * Only ever returns a URL to someone entitled to hold it: the payer who created
 * the link, or the Blind account a username payment was addressed to while it
 * is still unclaimed. Nobody else, ever.
 */
export async function claimLinkFor(payment: PaymentRow, viewerUserId: string): Promise<ClaimLinkView> {
  // A payment addressed to somebody else is one the payer must never hold the
  // credential for: that is the whole point of addressing it. We can tell the
  // difference from a *claimed* link because a claimed one has already reached
  // its later states.
  const claimed = ["claim_pending", "payout_submitted", "settled", "refunding", "refunded"].includes(payment.status);
  const addressedElsewhere = payment.counterparty_user_id !== null && !claimed;
  const isCreator = payment.creator_user_id === viewerUserId && !addressedElsewhere;
  const isAddressee =
    payment.kind === "pay" &&
    payment.counterparty_user_id === viewerUserId &&
    ["created", "awaiting_deposit", "funded"].includes(payment.status);
  if (payment.kind !== "pay" || (!isCreator && !isAddressee)) {
    return {
      url: null,
      resealable: false,
      sealedOnly: true,
      reason: addressedElsewhere
        ? "This payment is addressed to someone else. Blind will not hand its claim link to the payer."
        : "This claim link is not yours to display.",
    };
  }
  const { one } = await import("./db");
  const row = await one<{ claim_secret_sealed: string | null }>(
    "select claim_secret_sealed from payments where id = $1",
    [payment.id]
  );
  const secret = unseal(row?.claim_secret_sealed ?? null);
  if (!secret) {
    return {
      url: null,
      resealable: false,
      sealedOnly: true,
      reason: "This link was shown once and its secret is no longer recoverable on this deployment.",
    };
  }
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  return {
    url: `${appUrl.replace(/\/$/, "")}/claim/${payment.reference}#${secret}`,
    resealable: true,
    sealedOnly: false,
    reason: null,
  };
}
