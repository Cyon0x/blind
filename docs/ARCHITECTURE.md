# Architecture

## Shape

```
browser ── extension (beldex wallet)          [user's keys, never sent anywhere]
   │
   ├── Next.js app  (Vercel)
   │      App Router · React 19 · RSC · Tailwind v4
   │      ├── /api/*        route handlers — the only writers
   │      ├── lib/*         domain, redaction, views
   │      └── lib/beldex/*  address codec, daemon client, wallet-rpc client
   │
   ├── Postgres (Neon over HTTP in prod, embedded Postgres in dev/tests)
   │
   ├── beldex daemon  ── read-only chain evidence (confirmations, reorgs)
   │
   └── beldex-wallet-rpc  ── the escrow signer (separate host, separate keys)
```

Four rules hold across the whole codebase:

1. **The database is never the authority on settlement.** Chain and wallet
   evidence is stored *beside* a payment row, never inferred from it.
2. **Every state transition is one SQL statement** — a conditional
   `UPDATE … WHERE … RETURNING`, or an `INSERT … ON CONFLICT`. No interactive
   transactions, so the same invariants hold on Neon and on embedded Postgres.
3. **No screen formats its own payment data.** All of it goes through
   `src/lib/views.ts`, which decides what a viewer may see.
4. **A missing capability is reported as missing.** `handle()` in
   `src/lib/api.ts` maps `EscrowUnavailable`, `DatabaseNotConfigured`,
   `DaemonError` and friends onto 503/502 responses with honest copy.

## Frontend

| Piece | Where |
| --- | --- |
| Design tokens, shapes, motion | `src/app/globals.css` (the only file with raw hex) |
| The aperture (the one big custom graphic) | `src/components/Iris.tsx` |
| Status | `src/components/StatePill.tsx` — words come from the domain, never from the component |
| Authenticated shell | `src/app/dashboard/*` + `src/components/DashNav.tsx` |
| Composers | `PayComposer`, `RequestComposer`, `PayUserPanel` |
| Money movement | `FundingPanel` (payer), `ClaimFlow` (recipient), `RequestPayPanel` (request payer) |
| Wallet | `src/lib/useBeldex.ts` — one lazy wrapper over `@bdxi/web3js` |

Fonts are loaded with `next/font` (Anybody, Rubik Mono One, Martian Mono, Hanken
Grotesk). Every interactive state has a designed empty, loading, error, success
and disabled form; `prefers-reduced-motion` collapses all animation.

## Routes

Pages: `/` · `/signin` · `/onboarding` · `/claim/[reference]` · `/r/[reference]` ·
`/u/[username]` · `/verify/[reference]` · `/dashboard` (+ `pay`, `request`,
`payments`, `payments/[reference]`, `receipts`, `wallet`, `settings`) ·
`not-found`, `error`, `global-error`.

API: `/api/health` · `/api/auth/{session,signout,[provider]/start,[provider]/callback,wallet/challenge,wallet/verify}` ·
`/api/payments` (+ `[reference]`, `…/funding`, `…/settlement`, `…/claim-link`, `…/refund`) ·
`/api/claims/[reference]` · `/api/requests/[reference]` (+ `…/fund`, `…/direct`) ·
`/api/receipts` (+ `[reference]`, `…/pdf`) · `/api/username` · `/api/profile` · `/api/wallets` · `/api/notifications`.

## Authentication

Hand-rolled OAuth 2.0 with PKCE for **Google** and **X** — no third-party auth
service, so no identity provider receives payment data. The flow:

1. `GET /api/auth/<provider>/start` mints a state, a PKCE verifier and a
   challenge, stores them in `oauth_states` with a 10-minute TTL, and redirects.
2. `GET /api/auth/<provider>/callback` **consumes** the state in the same
   statement that reads it (a replayed URL cannot start a second session),
   exchanges the code, and resolves the identity.
3. `resolveIdentity()` finds or creates the internal user, then
   `startSession()` writes a session row and sets an httpOnly cookie.

Sessions are opaque 32-byte tokens; only their SHA-256 is stored. The CSRF token
is an HMAC of the session token, so another session's token is useless. Wallet
sign-in replaces the OAuth code exchange with a signature over a
domain-bound challenge.

`next=` destinations are validated to be relative paths, so the callback cannot
be used as an open redirect.

## Database

Migrations in `db/migrations/`, applied by `scripts/migrate.mjs` (or
`npm run db:pglite` for the embedded instance). Tables: `users`,
`linked_accounts`, `sessions`, `wallets`, `payments`, `payout_operations`,
`receipts`, `payment_events`, `notifications`, `auth_challenges`, `oauth_states`,
`rate_limits`, `audit_log`, `schema_migrations`.

The constraints are load-bearing, not decorative:

- `receipts (payment_id, side)` unique → one receipt per side, however often it
  is asked for.
- `payout_operations (payment_id, kind)` unique → exactly one payout slot; the
  losing claimant gets the winner's row and does not send.
- `payments.reference` unique, `users.username` unique.
- `rate_limits (bucket)` with a fixed-window counter in a single statement.

`src/lib/db.ts` picks Neon when `DATABASE_URL(_POOLED)` is set and embedded
Postgres otherwise, and refuses the embedded path in a production build unless
`ALLOW_EMBEDDED_DB_IN_PROD=1`. The test suite runs the real migrations against
embedded Postgres, so the constraints are exercised rather than assumed.

## Redaction

`src/lib/views.ts` is the only place that turns rows into what a viewer sees.

`paymentView(payment, viewerUserId)` resolves a role — `creator`,
`counterparty` or `public` — and then:

- the **escrow deposit address** is shown to the payer only (the recipient has no
  use for the payer's destination);
- the **payout destination** is shown to a request's creator (their own address);
  never to the other side;
- the **payout transaction id** is withheld from the public link, because a payout
  is mined to the recipient's own address and publishing the id on a page anyone
  holding the link can read would undo the point of the link;
- neither participant's identity (Google email, X handle, internal user id) is in
  the view for the other.

`tests/redaction.test.ts` asserts this over a fully-populated row, including on
the serialised JSON — so a leak in any field fails the suite.

## Beldex integration

`src/lib/beldex/`:

| Module | Responsibility |
| --- | --- |
| `nettype.ts`, `base58.ts`, `address.ts` | Address codec: varint prefix, Monero base58, keccak checksum. Verified byte-for-byte against Beldex's own WASM core. |
| `units.ts` | Atomic ↔ display BDX (9 decimals). |
| `sig.ts` | `SigV1` signature verification (Schnorr over keccak-256, Monero's `sc_mulsub`). |
| `daemon.ts` | Read-only JSON-RPC: `get_info`, `get_transactions`, `get_block_header_by_height`, `get_fee_estimate`. |
| `wallet-rpc.ts` | `beldex-wallet-rpc` client: addresses, balances, transfers, bulk payments. |
| `escrow.ts` | The escrow as domain operations: allocate a deposit target, find a deposit, send a payout, reconcile an ambiguous send, report health. |
| `config.ts` | Every endpoint and threshold, from the environment. |

See [BELDEX_INTEGRATION.md](BELDEX_INTEGRATION.md).

## Payment flow

`src/lib/payments.ts` is the domain: `createPay`, `createRequest`, `refreshFunding`,
`claimPayment`, `executePayout`, `refreshSettlement`, `refundClaim`,
`ensureReceipts`, `claimLinkFor`, `requestPayerTarget`, `sweepExpired`.

Two properties are enforced there and nowhere else:

- **A status only advances on evidence.** Funding comes from the escrow wallet
  (deepened by the daemon); settlement comes from the daemon and/or the escrow
  wallet; a claim is authorised by the claim secret compared *inside* the state
  transition.
- **A payout is attempted once.** `beginPayoutOperation` is the lock; a crash
  mid-send is resolved by `reconcileOutgoing` (find the transfer that may already
  exist) and never by sending again. An unresolved operation is parked as
  `unknown` for an operator rather than re-sent.

See [PAYMENT_FLOWS.md](PAYMENT_FLOWS.md).

## Receipts

`ensureReceipts` writes one receipt per side when a payout is chain-verified, with
the correct side attached for each kind (a Blind Pay's creator is the payer; a
Blind Request's creator is the one being paid). Each carries a SHA-256 integrity
hash over its sorted fields, a deterministic engraving seed, and a disclosure line
naming the half of the story its holder is entitled to. `/verify/[reference]`
recomputes the hash from the stored fields and says whether it still matches.
Integrity detects edits; it is not a signature and not a proof of settlement.

## Privacy layer

The privacy layer is not a screen. It is:

- **fragment-borne claim secrets** — the secret after the `#` is never sent to a
  server until the holder presses claim;
- **hash-only storage** of the secret (`sha256`), with an AES-256-GCM sealed copy
  under `BDX_CLAIM_KEY` as the *only* way a link can be re-displayed;
- **one-time escrow destinations** — a fresh subaddress and a unique payment id per
  payment, so deposits cannot be merged or re-attributed;
- **payout only to the claim's recorded destination**, never to an address supplied
  later by a payer;
- **a view layer that withholds counterparty addresses and the payout txid**;
- **no analytics and no third-party scripts** — the only outbound requests are to
  Google's and X's own OAuth endpoints, and `next/font` self-hosts the fonts at
  build time so no browser request leaves for a CDN;
- **hashed IP addresses** in `audit_log` and `sessions`, never raw.

What this does *not* buy is on-chain unlinkability, and the app never claims it.
See [PRIVACY_THREAT_MODEL.md](PRIVACY_THREAT_MODEL.md).
