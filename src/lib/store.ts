import { query, one, isoPlusMs } from "./db";

/* --------------------------------------------------------------------- rows */

export type UserRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  status: "active" | "suspended" | "closed";
  public_profile: boolean;
  show_x_handle: boolean;
  notify_on_payment: boolean;
  onboarded_at: string | null;
  created_at: string;
};

export type LinkedAccountRow = {
  id: string;
  user_id: string;
  provider: "google" | "x" | "wallet";
  provider_account_id: string;
  handle: string | null;
  email: string | null;
  profile: Record<string, unknown>;
  created_at: string;
};

export type WalletRow = {
  id: string;
  user_id: string;
  nettype: string;
  address: string;
  label: string | null;
  source: "extension" | "pasted";
  ownership_proven_at: string | null;
  last_seen_at: string;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  kind: "pay" | "request";
  reference: string;
  creator_user_id: string;
  counterparty_user_id: string | null;
  amount_atomic: string;
  asset: string;
  description: string | null;
  invoice_ref: string | null;
  status: string;
  expires_at: string | null;
  deposit_address: string | null;
  deposit_integrated_address: string | null;
  deposit_payment_id: string | null;
  deposit_subaddress_index: number | null;
  deposit_tx_hash: string | null;
  deposit_confirmations: number;
  deposit_amount_atomic: string | null;
  funded_at: string | null;
  payout_address: string | null;
  payout_tx_hash: string | null;
  payout_confirmations: number;
  settled_at: string | null;
  claimed_at: string | null;
  claim_secret_hash: string | null;
  recipient_visibility: "private" | "public";
  payout_mode: "escrow" | "direct";
  failed_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type PayoutOperationRow = {
  id: string;
  payment_id: string;
  kind: "payout" | "refund";
  idempotency_key: string;
  status: "preparing" | "submitting" | "submitted" | "unknown" | "confirmed" | "failed";
  to_address: string;
  amount_atomic: string;
  tx_hash: string | null;
  fee_atomic: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptRow = {
  id: string;
  reference: string;
  payment_id: string;
  owner_user_id: string | null;
  side: "payer" | "recipient";
  amount_atomic: string;
  asset: string;
  settlement_tx_hash: string | null;
  settlement_confirmations: number;
  settlement_block_height: string | number | null;
  settlement_block_hash: string | null;
  settlement_verified: boolean;
  integrity_hash: string;
  engraving_seed: string;
  issued_at: string;
  payload: Record<string, unknown>;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  payment_id: string | null;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

/* -------------------------------------------------------------------- users */

export async function getUserById(id: string): Promise<UserRow | null> {
  return one<UserRow>("select * from users where id = $1", [id]);
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  return one<UserRow>("select * from users where username = $1", [username.toLowerCase()]);
}

export async function usernameAvailable(username: string, exceptUserId?: string): Promise<boolean> {
  const row = await one<{ id: string }>("select id from users where username = $1", [username.toLowerCase()]);
  if (!row) return true;
  return exceptUserId !== undefined && row.id === exceptUserId;
}

/** Reserved so no account can look like app infrastructure or a route. */
export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "api", "app", "blind", "beldex", "bdx", "claim", "dashboard", "help",
  "login", "logout", "me", "new", "official", "pay", "receipt", "receipts", "request", "root",
  "security", "settings", "signin", "signup", "staff", "support", "system", "team", "wallet", "www",
]);

export async function createUser(input: {
  displayName?: string | null;
  avatarUrl?: string | null;
  username?: string | null;
}): Promise<UserRow> {
  const row = await one<UserRow>(
    `insert into users (display_name, avatar_url, username)
     values ($1, $2, $3)
     returning *`,
    [input.displayName ?? null, input.avatarUrl ?? null, input.username?.toLowerCase() ?? null]
  );
  if (!row) throw new Error("could not create user");
  return row;
}

export async function setUsername(userId: string, username: string): Promise<UserRow | null> {
  return one<UserRow>(
    `update users
        set username = $2, updated_at = now()
      where id = $1
        and (username is null or username = $2 or created_at < now() - interval '1 day')
     returning *`,
    [userId, username.toLowerCase()]
  );
}

export async function updateUserSettings(
  userId: string,
  input: { displayName?: string | null; publicProfile?: boolean; showXHandle?: boolean; notifyOnPayment?: boolean; onboarded?: boolean }
): Promise<UserRow | null> {
  return one<UserRow>(
    `update users
        set display_name      = coalesce($2, display_name),
            public_profile    = coalesce($3, public_profile),
            show_x_handle     = coalesce($4, show_x_handle),
            notify_on_payment = coalesce($5, notify_on_payment),
            onboarded_at      = case when $6 then coalesce(onboarded_at, now()) else onboarded_at end,
            updated_at        = now()
      where id = $1
     returning *`,
    [
      userId,
      input.displayName ?? null,
      input.publicProfile ?? null,
      input.showXHandle ?? null,
      input.notifyOnPayment ?? null,
      input.onboarded ?? false,
    ]
  );
}

/* ---------------------------------------------------------- linked accounts */

export async function findLinkedAccount(
  provider: "google" | "x" | "wallet",
  providerAccountId: string
): Promise<LinkedAccountRow | null> {
  return one<LinkedAccountRow>(
    "select * from linked_accounts where provider = $1 and provider_account_id = $2",
    [provider, providerAccountId]
  );
}

export async function listLinkedAccounts(userId: string): Promise<LinkedAccountRow[]> {
  return query<LinkedAccountRow>("select * from linked_accounts where user_id = $1 order by created_at", [userId]);
}

export async function attachLinkedAccount(input: {
  userId: string;
  provider: "google" | "x" | "wallet";
  providerAccountId: string;
  handle?: string | null;
  email?: string | null;
  profile?: Record<string, unknown>;
}): Promise<LinkedAccountRow | null> {
  return one<LinkedAccountRow>(
    `insert into linked_accounts (user_id, provider, provider_account_id, handle, email, profile)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (provider, provider_account_id)
       do update set handle = excluded.handle,
                     email = excluded.email,
                     profile = excluded.profile,
                     updated_at = now()
     returning *`,
    [
      input.userId,
      input.provider,
      input.providerAccountId,
      input.handle ?? null,
      input.email ?? null,
      JSON.stringify(input.profile ?? {}),
    ]
  );
}

export async function detachLinkedAccount(userId: string, provider: string): Promise<number> {
  const rows = await query<{ id: string }>(
    "delete from linked_accounts where user_id = $1 and provider = $2 returning id",
    [userId, provider]
  );
  return rows.length;
}

/* ----------------------------------------------------------------- sessions */

export async function createSessionRow(input: {
  userId: string;
  tokenHash: string;
  userAgent?: string | null;
  ipHash?: string | null;
  ttlMs: number;
}): Promise<void> {
  await query(
    `insert into sessions (user_id, token_hash, user_agent, ip_hash, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [input.userId, input.tokenHash, input.userAgent ?? null, input.ipHash ?? null, isoPlusMs(input.ttlMs)]
  );
}

export async function sessionByTokenHash(tokenHash: string): Promise<
  (UserRow & { session_id: string; session_expires_at: string }) | null
> {
  return one(
    `select u.*, s.id as session_id, s.expires_at as session_expires_at
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()`,
    [tokenHash]
  );
}

export async function touchSession(sessionId: string): Promise<void> {
  await query("update sessions set last_seen_at = now() where id = $1", [sessionId]);
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query("update sessions set revoked_at = now() where id = $1", [sessionId]);
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    "update sessions set revoked_at = now() where user_id = $1 and revoked_at is null returning id",
    [userId]
  );
  return rows.length;
}

export async function listSessions(userId: string) {
  return query<{ id: string; user_agent: string | null; created_at: string; last_seen_at: string }>(
    `select id, user_agent, created_at, last_seen_at
       from sessions
      where user_id = $1 and revoked_at is null and expires_at > now()
      order by last_seen_at desc`,
    [userId]
  );
}

/* ------------------------------------------------------------------ wallets */

export async function upsertWallet(input: {
  userId: string;
  nettype: string;
  address: string;
  label?: string | null;
  source?: "extension" | "pasted";
  ownershipProven?: boolean;
}): Promise<WalletRow | null> {
  return one<WalletRow>(
    `insert into wallets (user_id, nettype, address, label, source, ownership_proven_at)
     values ($1, $2, $3, $4, $5, case when $6 then now() else null end)
     on conflict (nettype, address)
       do update set user_id = excluded.user_id,
                     label = coalesce(excluded.label, wallets.label),
                     source = excluded.source,
                     ownership_proven_at = coalesce(excluded.ownership_proven_at, wallets.ownership_proven_at),
                     last_seen_at = now()
     returning *`,
    [
      input.userId,
      input.nettype,
      input.address,
      input.label ?? null,
      input.source ?? "extension",
      input.ownershipProven ?? false,
    ]
  );
}

export async function listWallets(userId: string): Promise<WalletRow[]> {
  return query<WalletRow>("select * from wallets where user_id = $1 order by last_seen_at desc", [userId]);
}

export async function getWalletForUser(userId: string, address: string): Promise<WalletRow | null> {
  return one<WalletRow>("select * from wallets where user_id = $1 and address = $2", [userId, address]);
}

export async function deleteWallet(userId: string, address: string): Promise<number> {
  const rows = await query<{ id: string }>(
    "delete from wallets where user_id = $1 and address = $2 returning id",
    [userId, address]
  );
  return rows.length;
}

/* ----------------------------------------------------------------- payments */

export async function createPaymentRow(input: {
  kind: "pay" | "request";
  reference: string;
  creatorUserId: string;
  amountAtomic: string;
  description?: string | null;
  invoiceRef?: string | null;
  expiresAt?: string | null;
  payoutAddress?: string | null;
  payoutMode?: "escrow" | "direct";
  claimSecretHash?: string | null;
  recipientVisibility?: "private" | "public";
  /** Set when the payment is addressed to a Blind account (a username payment). */
  counterpartyUserId?: string | null;
}): Promise<PaymentRow> {
  const status = input.kind === "pay" ? "created" : "awaiting_payment";
  const row = await one<PaymentRow>(
    `insert into payments
       (kind, reference, creator_user_id, amount_atomic, description, invoice_ref, expires_at,
        status, payout_address, payout_mode, claim_secret_hash, recipient_visibility, counterparty_user_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning *`,
    [
      input.kind,
      input.reference,
      input.creatorUserId,
      input.amountAtomic,
      input.description ?? null,
      input.invoiceRef ?? null,
      input.expiresAt ?? null,
      status,
      input.payoutAddress ?? null,
      input.payoutMode ?? "escrow",
      input.claimSecretHash ?? null,
      input.recipientVisibility ?? "private",
      input.counterpartyUserId ?? null,
    ]
  );
  if (!row) throw new Error("could not create payment");
  return row;
}

export async function getPaymentByReference(reference: string): Promise<PaymentRow | null> {
  return one<PaymentRow>("select * from payments where reference = $1", [reference]);
}

export async function getPaymentById(id: string): Promise<PaymentRow | null> {
  return one<PaymentRow>("select * from payments where id = $1", [id]);
}

export async function listPaymentsForUser(userId: string, limit = 100): Promise<PaymentRow[]> {
  return query<PaymentRow>(
    `select * from payments
      where creator_user_id = $1 or counterparty_user_id = $1
      order by created_at desc
      limit $2`,
    [userId, limit]
  );
}

export async function attachDepositTarget(
  paymentId: string,
  target: { address: string; integratedAddress: string; paymentId: string; subaddressIndex: number }
): Promise<PaymentRow | null> {
  return one<PaymentRow>(
    `update payments
        set deposit_address = $2,
            deposit_integrated_address = $3,
            deposit_payment_id = $4,
            deposit_subaddress_index = $5,
            status = case when kind = 'pay' and status = 'created' then 'awaiting_deposit' else status end,
            updated_at = now()
      where id = $1
     returning *`,
    [paymentId, target.address, target.integratedAddress, target.paymentId, target.subaddressIndex]
  );
}

/**
 * Records funding. The guard on the previous status is what stops a replayed or
 * out-of-order observation from double-funding a payment: only the transition
 * out of 'created'/'awaiting_deposit' can win.
 */
export async function markFunded(input: {
  paymentId: string;
  txHash: string;
  amountAtomic: string;
  confirmations: number;
}): Promise<PaymentRow | null> {
  return one<PaymentRow>(
    `update payments
        set status = 'funded',
            deposit_tx_hash = $2,
            deposit_amount_atomic = $3,
            deposit_confirmations = $4,
            funded_at = coalesce(funded_at, now()),
            updated_at = now()
      where id = $1
        and kind = 'pay'
        and status in ('created', 'awaiting_deposit')
     returning *`,
    [input.paymentId, input.txHash, input.amountAtomic, input.confirmations]
  );
}

/**
 * The same transition for Blind Request, where the money moving is the payer's
 * deposit rather than the link creator's. Kept separate so a deposit observed
 * against one kind can never advance the other.
 */
export async function markRequestFunded(input: {
  paymentId: string;
  txHash: string;
  amountAtomic: string;
  confirmations: number;
}): Promise<PaymentRow | null> {
  return one<PaymentRow>(
    `update payments
        set status = 'funded',
            deposit_tx_hash = $2,
            deposit_amount_atomic = $3,
            deposit_confirmations = $4,
            funded_at = coalesce(funded_at, now()),
            updated_at = now()
      where id = $1
        and kind = 'request'
        and status = 'awaiting_payment'
     returning *`,
    [input.paymentId, input.txHash, input.amountAtomic, input.confirmations]
  );
}

/** Payments addressed to a Blind account by username (kind 'pay'). */
export async function listPaymentsAddressedTo(userId: string, limit = 50): Promise<PaymentRow[]> {
  return query<PaymentRow>(
    `select * from payments
      where counterparty_user_id = $1 and kind = 'pay'
      order by created_at desc
      limit $2`,
    [userId, limit]
  );
}

/**
 * Claims are won by exactly one caller: the UPDATE only matches while the
 * payment is still funded and unclaimed, so the loser gets null instead of a
 * second payout.
 */
export async function beginClaim(input: {
  paymentId: string;
  secretHash: string;
  payoutAddress: string;
}): Promise<PaymentRow | null> {
  return one<PaymentRow>(
    `update payments
        set status = 'claim_pending',
            claimed_at = now(),
            payout_address = $3,
            updated_at = now()
      where id = $1
        and kind = 'pay'
        and status = 'funded'
        and claim_secret_hash is not null
        and claim_secret_hash = $2
        and (expires_at is null or expires_at > now())
     returning *`,
    [input.paymentId, input.secretHash, input.payoutAddress]
  );
}

export async function setPaymentStatus(
  paymentId: string,
  status: string,
  extra: { payoutTxHash?: string | null; confirmations?: number; reason?: string | null } = {}
): Promise<PaymentRow | null> {
  return one<PaymentRow>(
    `update payments
        set status = $2,
            payout_tx_hash = coalesce($3, payout_tx_hash),
            payout_confirmations = coalesce($4, payout_confirmations),
            failed_reason = case when $2 = 'failed' then $5 else failed_reason end,
            settled_at = case when $2 = 'settled' then coalesce(settled_at, now()) else settled_at end,
            updated_at = now()
      where id = $1
     returning *`,
    [paymentId, status, extra.payoutTxHash ?? null, extra.confirmations ?? null, extra.reason ?? null]
  );
}

export async function updateDepositConfirmations(paymentId: string, confirmations: number): Promise<void> {
  await query(
    "update payments set deposit_confirmations = $2, updated_at = now() where id = $1 and status in ('awaiting_deposit','funded')",
    [paymentId, confirmations]
  );
}

export async function setCounterparty(paymentId: string, userId: string): Promise<void> {
  await query(
    "update payments set counterparty_user_id = coalesce(counterparty_user_id, $2), updated_at = now() where id = $1",
    [paymentId, userId]
  );
}

export async function expireStalePayments(limit = 50): Promise<PaymentRow[]> {
  return query<PaymentRow>(
    `update payments
        set status = case when kind = 'pay' then 'expired' else 'expired' end,
            updated_at = now()
      where id in (
        select id from payments
         where expires_at is not null
           and expires_at < now()
           and status in ('created', 'awaiting_deposit', 'awaiting_payment')
         order by expires_at
         limit $1
      )
     returning *`,
    [limit]
  );
}

/* ------------------------------------------------------- payout operations */

/**
 * Reserves the single payout slot for a payment. The unique constraint on
 * (payment_id, kind) is the real guard: two concurrent claimers can both reach
 * this call, and exactly one insert survives.
 */
export async function beginPayoutOperation(input: {
  paymentId: string;
  kind: "payout" | "refund";
  idempotencyKey: string;
  toAddress: string;
  amountAtomic: string;
}): Promise<{ operation: PayoutOperationRow; created: boolean }> {
  const inserted = await one<PayoutOperationRow>(
    `insert into payout_operations (payment_id, kind, idempotency_key, status, to_address, amount_atomic)
     values ($1, $2, $3, 'preparing', $4, $5)
     on conflict (payment_id, kind) do nothing
     returning *`,
    [input.paymentId, input.kind, input.idempotencyKey, input.toAddress, input.amountAtomic]
  );
  if (inserted) return { operation: inserted, created: true };
  const existing = await one<PayoutOperationRow>(
    "select * from payout_operations where payment_id = $1 and kind = $2",
    [input.paymentId, input.kind]
  );
  if (!existing) throw new Error("payout operation vanished after a conflict");
  return { operation: existing, created: false };
}

export async function markPayoutSubmitting(operationId: string): Promise<PayoutOperationRow | null> {
  return one<PayoutOperationRow>(
    `update payout_operations
        set status = 'submitting', attempts = attempts + 1, updated_at = now()
      where id = $1 and status in ('preparing', 'unknown')
     returning *`,
    [operationId]
  );
}

export async function finishPayoutOperation(
  operationId: string,
  input: { status: "submitted" | "confirmed" | "failed" | "unknown"; txHash?: string | null; feeAtomic?: string | null; error?: string | null }
): Promise<PayoutOperationRow | null> {
  return one<PayoutOperationRow>(
    `update payout_operations
        set status = $2,
            tx_hash = coalesce($3, tx_hash),
            fee_atomic = coalesce($4, fee_atomic),
            error = $5,
            updated_at = now()
      where id = $1
     returning *`,
    [operationId, input.status, input.txHash ?? null, input.feeAtomic ?? null, input.error ?? null]
  );
}

export async function getPayoutOperation(paymentId: string, kind: "payout" | "refund"): Promise<PayoutOperationRow | null> {
  return one<PayoutOperationRow>("select * from payout_operations where payment_id = $1 and kind = $2", [paymentId, kind]);
}

/** Confirmation bookkeeping for a payout operation (used by settlement). */
export async function finishPayoutOperationFor(
  paymentId: string,
  kind: "payout" | "refund",
  input: { status: "confirmed" | "failed" }
): Promise<void> {
  await query("update payout_operations set status = $3, updated_at = now() where payment_id = $1 and kind = $2 and status <> 'confirmed'", [
    paymentId,
    kind,
    input.status,
  ]);
}

export async function listUnsettledPayouts(limit = 25): Promise<PayoutOperationRow[]> {
  return query<PayoutOperationRow>(
    `select * from payout_operations
      where status in ('submitting', 'unknown', 'submitted')
      order by updated_at
      limit $1`,
    [limit]
  );
}

/* ----------------------------------------------------------------- receipts */

export async function insertReceipt(input: {
  reference: string;
  paymentId: string;
  ownerUserId: string | null;
  side: "payer" | "recipient";
  amountAtomic: string;
  settlementTxHash: string | null;
  settlementConfirmations: number;
  settlementBlockHeight: string | null;
  settlementBlockHash: string | null;
  settlementVerified: boolean;
  integrityHash: string;
  engravingSeed: string;
  payload: Record<string, unknown>;
}): Promise<ReceiptRow | null> {
  return one<ReceiptRow>(
    `insert into receipts
       (reference, payment_id, owner_user_id, side, amount_atomic, settlement_tx_hash,
        settlement_confirmations, settlement_block_height, settlement_block_hash, settlement_verified,
        integrity_hash, engraving_seed, payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (payment_id, side) do nothing
     returning *`,
    [
      input.reference,
      input.paymentId,
      input.ownerUserId,
      input.side,
      input.amountAtomic,
      input.settlementTxHash,
      input.settlementConfirmations,
      input.settlementBlockHeight,
      input.settlementBlockHash,
      input.settlementVerified,
      input.integrityHash,
      input.engravingSeed,
      JSON.stringify(input.payload),
    ]
  );
}

export async function getReceiptByReference(reference: string): Promise<ReceiptRow | null> {
  return one<ReceiptRow>("select * from receipts where reference = $1", [reference]);
}

export async function getReceiptForPayment(paymentId: string, side: "payer" | "recipient"): Promise<ReceiptRow | null> {
  return one<ReceiptRow>("select * from receipts where payment_id = $1 and side = $2", [paymentId, side]);
}

export async function listReceiptsForUser(userId: string, limit = 100): Promise<ReceiptRow[]> {
  return query<ReceiptRow>(
    `select r.* from receipts r
       join payments p on p.id = r.payment_id
      where r.owner_user_id = $1 or p.creator_user_id = $1 or p.counterparty_user_id = $1
      order by r.issued_at desc
      limit $2`,
    [userId, limit]
  );
}

export async function refreshReceiptSettlement(
  receiptId: string,
  evidence: { confirmations: number; verified: boolean; blockHash?: string | null }
): Promise<void> {
  await query(
    `update receipts
        set settlement_confirmations = $2,
            settlement_verified = $3,
            settlement_block_hash = coalesce($4, settlement_block_hash)
      where id = $1`,
    [receiptId, evidence.confirmations, evidence.verified, evidence.blockHash ?? null]
  );
}

/* ------------------------------------------------------ events, audit, misc */

export async function recordPaymentEvent(input: {
  paymentId: string;
  userId?: string | null;
  event: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await query("insert into payment_events (payment_id, user_id, event, detail) values ($1, $2, $3, $4)", [
    input.paymentId,
    input.userId ?? null,
    input.event,
    JSON.stringify(input.detail ?? {}),
  ]);
}

export async function listPaymentEvents(paymentId: string) {
  return query<{ event: string; detail: Record<string, unknown>; at: string }>(
    "select event, detail, at from payment_events where payment_id = $1 order by at",
    [paymentId]
  );
}

export async function audit(input: {
  actorUserId?: string | null;
  action: string;
  subject?: string | null;
  ipHash?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await query("insert into audit_log (actor_user_id, action, subject, ip_hash, detail) values ($1, $2, $3, $4, $5)", [
    input.actorUserId ?? null,
    input.action,
    input.subject ?? null,
    input.ipHash ?? null,
    JSON.stringify(input.detail ?? {}),
  ]);
}

export async function notify(input: {
  userId: string;
  kind: string;
  title: string;
  body?: string | null;
  paymentId?: string | null;
}): Promise<void> {
  await query("insert into notifications (user_id, kind, payment_id, title, body) values ($1, $2, $3, $4, $5)", [
    input.userId,
    input.kind,
    input.paymentId ?? null,
    input.title,
    input.body ?? null,
  ]);
}

export async function listNotifications(userId: string, limit = 30): Promise<NotificationRow[]> {
  return query<NotificationRow>(
    "select * from notifications where user_id = $1 order by created_at desc limit $2",
    [userId, limit]
  );
}

export async function markNotificationsRead(userId: string): Promise<void> {
  await query("update notifications set read_at = now() where user_id = $1 and read_at is null", [userId]);
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const row = await one<{ count: string }>(
    "select count(*)::text as count from notifications where user_id = $1 and read_at is null",
    [userId]
  );
  return row ? Number(row.count) : 0;
}

/* ------------------------------------------------------- auth challenges --- */

export async function createAuthChallenge(input: {
  nonce: string;
  kind: "signin" | "link" | "refund";
  userId?: string | null;
  address?: string | null;
  ttlMs: number;
}): Promise<void> {
  await query(
    `insert into auth_challenges (nonce, kind, user_id, address, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [input.nonce, input.kind, input.userId ?? null, input.address ?? null, isoPlusMs(input.ttlMs)]
  );
}

/** Single-use: the challenge is consumed by the same statement that reads it. */
export async function consumeAuthChallenge(nonce: string, kind: "signin" | "link" | "refund") {
  return one<{ id: string; user_id: string | null; address: string | null }>(
    `update auth_challenges
        set consumed_at = now()
      where nonce = $1 and kind = $2 and consumed_at is null and expires_at > now()
     returning id, user_id, address`,
    [nonce, kind]
  );
}

export async function createOauthState(input: {
  state: string;
  provider: "google" | "x";
  codeVerifier: string;
  redirectTo?: string | null;
  linkUserId?: string | null;
  ttlMs: number;
}): Promise<void> {
  await query(
    `insert into oauth_states (state, provider, code_verifier, redirect_to, link_user_id, expires_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.state,
      input.provider,
      input.codeVerifier,
      input.redirectTo ?? null,
      input.linkUserId ?? null,
      isoPlusMs(input.ttlMs),
    ]
  );
}

export async function consumeOauthState(state: string, provider: "google" | "x") {
  return one<{ code_verifier: string; redirect_to: string | null; link_user_id: string | null }>(
    `update oauth_states
        set consumed_at = now()
      where state = $1 and provider = $2 and consumed_at is null and expires_at > now()
     returning code_verifier, redirect_to, link_user_id`,
    [state, provider]
  );
}

/* ------------------------------------------------------------- rate limits */

/**
 * Fixed-window counter in one statement, so two serverless invocations cannot
 * both think they are the first request in the window.
 */
export async function consumeRateLimit(
  bucket: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number }> {
  const row = await one<{ count: number }>(
    `insert into rate_limits (bucket, count, window_started_at)
     values ($1, 1, now())
     on conflict (bucket) do update
       set count = case when rate_limits.window_started_at < now() - ($2::text)::interval then 1 else rate_limits.count + 1 end,
           window_started_at = case when rate_limits.window_started_at < now() - ($2::text)::interval then now() else rate_limits.window_started_at end
     returning count`,
    [bucket, `${windowMs} milliseconds`]
  );
  const count = row?.count ?? limit + 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export async function countUsers(): Promise<number> {
  const row = await one<{ count: string }>("select count(*)::text as count from users");
  return row ? Number(row.count) : 0;
}
