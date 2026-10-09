-- Blind — initial schema.
--
-- Two rules shape this file:
--   * every identity is an internal UUID. A mutable social username or a wallet
--     address is never the primary identifier of a person.
--   * the database records what Blind *did* and what independent evidence it
--     holds. It never becomes the authority on whether a payment settled.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique,
  display_name text,
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  public_profile boolean not null default true,
  show_x_handle boolean not null default true,
  notify_on_payment boolean not null default true,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_shape check (username is null or username ~ '^[a-z0-9_]{3,20}$')
);

create table if not exists linked_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('google', 'x', 'wallet')),
  provider_account_id text not null,
  handle text,
  email text,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);

create index if not exists linked_accounts_user on linked_accounts (user_id);
create index if not exists linked_accounts_email on linked_accounts (lower(email));

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists sessions_user on sessions (user_id) where revoked_at is null;

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  nettype text not null check (nettype in ('mainnet', 'testnet', 'devnet')),
  address text not null,
  label text,
  source text not null default 'extension' check (source in ('extension', 'pasted')),
  ownership_proven_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (nettype, address)
);

create index if not exists wallets_user on wallets (user_id);

-- One table for both payment directions. `kind` decides which state machine the
-- status belongs to, enforced by the two check constraints below.
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pay', 'request')),
  reference text not null unique,
  creator_user_id uuid not null references users(id) on delete cascade,
  counterparty_user_id uuid references users(id) on delete set null,
  amount_atomic text not null check (amount_atomic ~ '^[0-9]{1,24}$'),
  asset text not null default 'BDX' check (asset = 'BDX'),
  description text,
  invoice_ref text,
  status text not null,
  expires_at timestamptz,
  -- deposit side (money coming in to the escrow for this payment)
  deposit_address text,
  deposit_integrated_address text,
  deposit_payment_id text,
  deposit_subaddress_index integer,
  deposit_tx_hash text,
  deposit_confirmations integer not null default 0,
  deposit_amount_atomic text,
  funded_at timestamptz,
  -- payout side (money going out to the recipient)
  payout_address text,
  payout_tx_hash text,
  payout_confirmations integer not null default 0,
  settled_at timestamptz,
  claimed_at timestamptz,
  claim_secret_hash text,
  -- the claim secret, sealed with AES-256-GCM under BDX_CLAIM_KEY so the payer
  -- can re-display their own link without the database holding a usable secret
  claim_secret_sealed text,
  -- who is allowed to see which half of the story
  recipient_visibility text not null default 'private' check (recipient_visibility in ('private', 'public')),
  payout_mode text not null default 'escrow' check (payout_mode in ('escrow', 'direct')),
  failed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Both directions share the settlement half of the machine, because a payment
  -- request is also settled through the escrow. Only the beginning differs:
  -- pay starts 'created' (claim link), a request starts 'awaiting_payment'.
  constraint pay_states check (kind <> 'pay' or status in
    ('created', 'awaiting_deposit', 'funded', 'claim_pending', 'payout_submitted', 'settled',
     'expired', 'refunding', 'refunded', 'failed')),
  constraint request_states check (kind <> 'request' or status in
    ('created', 'awaiting_payment', 'funded', 'payout_submitted', 'settled',
     'expired', 'cancelled', 'refunding', 'refunded', 'failed'))
);

create index if not exists payments_creator on payments (creator_user_id, created_at desc);
create index if not exists payments_counterparty on payments (counterparty_user_id, created_at desc);
create index if not exists payments_status on payments (status);
create index if not exists payments_deposit_payment_id on payments (deposit_payment_id);

create table if not exists payout_operations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  kind text not null check (kind in ('payout', 'refund')),
  idempotency_key text not null,
  status text not null check (status in ('preparing', 'submitting', 'submitted', 'unknown', 'confirmed', 'failed')),
  to_address text not null,
  amount_atomic text not null check (amount_atomic ~ '^[0-9]{1,24}$'),
  tx_hash text,
  fee_atomic text,
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, kind),
  unique (idempotency_key)
);

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  payment_id uuid not null references payments(id) on delete cascade,
  owner_user_id uuid references users(id) on delete set null,
  side text not null check (side in ('payer', 'recipient')),
  amount_atomic text not null,
  asset text not null default 'BDX',
  settlement_tx_hash text,
  settlement_confirmations integer not null default 0,
  settlement_block_height bigint,
  settlement_block_hash text,
  settlement_verified boolean not null default false,
  integrity_hash text not null,
  engraving_seed text not null,
  issued_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists receipts_payment on receipts (payment_id);
-- One receipt per side per payment: a retried settlement cannot mint duplicates.
create unique index if not exists receipts_payment_side on receipts (payment_id, side);
create index if not exists receipts_owner on receipts (owner_user_id, issued_at desc);

create table if not exists payment_events (
  id bigserial primary key,
  payment_id uuid references payments(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists payment_events_payment on payment_events (payment_id, at);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  payment_id uuid references payments(id) on delete set null,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user on notifications (user_id, created_at desc);

-- Wallet sign-in / link / refund challenges. Single use, short lived.
create table if not exists auth_challenges (
  id uuid primary key default gen_random_uuid(),
  nonce text not null unique,
  kind text not null check (kind in ('signin', 'link', 'refund')),
  user_id uuid references users(id) on delete cascade,
  address text,
  statement text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  provider text not null check (provider in ('google', 'x')),
  code_verifier text,
  redirect_to text,
  link_user_id uuid references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

-- Fixed-window counters. Shared state, so it survives serverless invocations.
create table if not exists rate_limits (
  bucket text primary key,
  count integer not null default 0,
  window_started_at timestamptz not null default now()
);

-- Security-relevant trail. Never receives secrets, keys or full addresses.
create table if not exists audit_log (
  id bigserial primary key,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  subject text,
  ip_hash text,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists audit_log_action on audit_log (action, at desc);
