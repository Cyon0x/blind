# Testing

## Running the suite

```bash
npm test              # vitest, 91 tests, no external services needed
npm run test:watch
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run build         # production build (needs network for next/font on first run)
```

The database tests run a **real embedded Postgres** (PGlite) with the real
migrations applied, so table constraints, conditional `UPDATE`s and unique indexes
are exercised rather than mocked. Each test file gets its own data directory.

Tests never touch a deployed database. `db.ts` refuses a non-loopback
`DATABASE_URL` outside production (`ALLOW_REMOTE_DB_IN_DEV=1` overrides), which is
pinned by `tests/database-guard.test.ts` — `vercel env pull` putting a production
URL into `.env.local` is otherwise a silent way for a dev run to write to real
data.

## What is covered

| Area | File | Notes |
| --- | --- | --- |
| Address codec | `tests/beldex-address.test.ts` | 10 tests. Byte-for-byte against fixtures produced by Beldex's own WASM wallet core: varint prefixes (209 → 2 bytes → 97 chars mainnet, 53 → 95 chars testnet), Monero base58 block boundaries, keccak checksums, wrong-network rejection |
| `SigV1` signatures | `tests/beldex-signature.test.ts` | 21 tests. Real ed25519 arithmetic: valid signatures verify, tampering fails, wrong key fails, replay across messages fails, domain binding enforced in both the origin and bare-host shapes, lookalike hosts refused, a foreign web `uri` refused, expiry enforced |
| Payment state machine | `tests/payment-state.test.ts` | 13 tests against embedded Postgres: no double funding, single claim winner, wrong secret refused, unfunded claim refused, expired claim refused, request/pay transitions cannot cross, one payout slot per payment, one receipt per side, rate window closes, expiry never retires a funded payment |
| Claim-link disclosure | `tests/payment-state.test.ts` | The payer gets their own link; a payment addressed to somebody else is **never** disclosed to the payer; the addressed recipient gets it; a stranger gets nothing; a request row returns nothing |
| Redaction | `tests/redaction.test.ts` | 5 tests over a fully-populated row, asserting on the serialised JSON: the payer never sees the recipient's address or identity (or vice versa), the recipient never sees the payer's deposit address, the public link carries no address or payout txid, and settlement wording never overstates what was verified |
| Claim-secret sealing | `tests/seal-integrity.test.ts` | 8 tests: round-trip, fresh nonce per seal, tampered ciphertext rejected, junk rejected, no key means a clear refusal, receipt integrity stable under key reordering and sensitive to any field change, engraving seed deterministic |
| Sessions and CSRF | `tests/session-tokens.test.ts` | 10 tests: only hashes stored, CSRF bound to the session, secret rotation invalidates tokens, short secret refused, origin allow-list, app URL and auth-domain derivation, and the wallet binding set (configured host plus the request host, never a spoofed one) |

## What is *not* covered, and why

Being explicit about this matters more than a green check mark.

- **No escrow test against a live wallet.** `beldex-wallet-rpc` has no
  `darwin-x86_64` build and Docker is not installed on the development machine, so
  funding, payout and reconciliation have not been run end to end. The state
  machine around them is tested with the database as the witness; the wallet calls
  themselves are not.
- **No end-to-end browser test.** The route handlers and domain logic are tested;
  the components are not driven by Playwright. The design QA pass (below) renders
  and scans them visually, which catches layout and accessibility defects but not
  JavaScript regressions.
- **OAuth exchange is not tested against Google or X** — no credentials exist yet.
  State/CSRF handling, redirect validation and the callback's control flow are.
- **No testnet run.** Beldex publishes no public testnet endpoints.

## Manual verification that *has* been performed

- **Live testnet chain evidence** (`npm run bdx:doctor`, `BDX_NETWORK=testnet`,
  2026-10-09): `chain (explorer): get_info` → height 4259754, `nettype: testnet`;
  `get_height`; `get_block_header_by_height(0)` → hash `919ef94bcb799632…`;
  `get_fee_estimate` → `skip`, because the explorer publishes none. The same
  adapter was checked against one real transaction
  (`ebbb80ddcd020a8ec1255054d13f8e1cea9bed5d535b18bb782f2e8e1f1a4f88`, block
  4259725) and returned 23 confirmations plus the block hash for reorg checks.
  This is what `/api/health` reports as `"source": "explorer"`.
- **Live Google OAuth**: following `/api/auth/google/start` reaches Google's real
  sign-in page ("Sign in to continue to blind-pi-six.vercel.app") with no
  `redirect_uri_mismatch`, so the client id and callback are accepted. X's
  authorize endpoint builds the right URL (client id, callback, PKCE S256,
  `users.read`) but returns HTTP 403 to an automated browser, so **the X flow has
  not been completed end to end** — X blocks headless clients and only a human
  click-through can confirm its callback registration.
- **Live mainnet daemon** (`npm run bdx:doctor` with
  `BDX_DAEMON_URL=http://publicnode1.rpcnode.stream:29095/json_rpc`, 2026-10-09):
  `get_info` → height 5822269; `get_height`; `get_block_header_by_height(0)` →
  hash `6ea477622339f61c…`; `get_fee_estimate` → 6666 atomic/byte. The wallet checks
  report `skip`, because no escrow signer is configured — the doctor prints `skip`,
  never `ok`.
- **Address codec against Beldex's own WASM core**: reproduced exactly (see the
  address test above).
- **Health endpoint** (`GET /api/health`) reports database, chain, escrow, auth
  providers and claim-sealing status without leaking configuration values.
- **Migrations** applied cleanly to both embedded Postgres
  (`npm run db:pglite`) and a Neon database (`npm run db:migrate`).

## Setting up a real testnet workflow

Two halves. The **read** half works today with no setup: Blind is already on
testnet and reads settlement evidence from the official testnet explorer, which
the doctor verifies in one command (`BDX_NETWORK=testnet npm run bdx:doctor`).

The **escrow** half is the workflow below. It needs a Linux (or macOS-arm) host,
because that is what `beldex-wallet-rpc` ships for, and a testnet daemon, because
Beldex publishes none publicly. That is what preserves Blind's custody design:
the signer must be a process you run and can watch, never something a Vercel
function holds. `infra/escrow/` packages both processes as a compose file and
runs on Colima (a Linux VM — Beldex ships no Intel-mac build): the daemon starts
and answers JSON-RPC. **It cannot sync**: Beldex's two testnet seed hosts refuse
their P2P port (verified from here, from the VM, and from four independent
external nodes on 2026-10-10, while mainnet seeds connect), so a new node cannot
get peers. Nothing has been verified against a live wallet yet, and no local
setup fixes that.

1. **Get a node and a wallet.**
   ```bash
   # A testnet daemon must be reachable too — Beldex publishes no public one.
   beldexd --testnet --rpc-bind-ip 127.0.0.1 --rpc-bind-port <daemon rpc port>

   beldex-wallet-rpc --testnet --rpc-bind-port 29092 \
     --wallet-dir /var/lib/blind/escrow --rpc-login user:pass \
     --disable-rpc-login=false --prompt-for-password
   ```
   Open or create a wallet named `blind-escrow` and let it sync.
2. **Point Blind at it.**
   ```
   BDX_NETWORK=testnet
   BDX_WALLET_RPC_URL=http://127.0.0.1:29092/json_rpc
   BDX_WALLET_RPC_USER=user
   BDX_WALLET_RPC_PASSWORD=pass
   # Setting this replaces the explorer with your own node.
   BDX_DAEMON_URL=http://127.0.0.1:<daemon rpc port>/json_rpc
   BDX_CONFIRMATIONS=10
   BDX_CLAIM_KEY=$(openssl rand -hex 32)
   APP_URL=http://localhost:3000
   ```
3. **Prove the endpoints before using the UI.**
   ```bash
   npm run bdx:doctor        # every wallet check must print ok, not skip
   curl -s localhost:3000/api/health | python3 -m json.tool
   ```
4. **Blind Pay, end to end.**
   - Create a payment for a small amount. Confirm the payment page shows a
     subaddress **and** an integrated address, and that the two differ per payment.
   - Fund it from a wallet extension. Watch the status move `awaiting_deposit` →
     `funded` only after 10 confirmations.
   - Open the claim link in a private window and claim to a second wallet's address.
   - Confirm the payout appears on the explorer, the payment reaches `settled`, and
     two receipts exist — one per side, each marked `verified`.
5. **Adversarial checks.** Re-open the same claim link and confirm it reports
   "already claimed" and pays nothing. Try `POST /api/claims/<ref>` with a
   one-character-off secret and confirm a 403 with no state change. Try
   `GET /api/payments/<ref>/claim-link` as a different signed-in user and confirm a
   403.
6. **Blind Request, escrow mode.** Create a request, open it signed out, pay it from
   the extension, and confirm the requester's address is never in the payer's page
   source.
7. **Username payment.** Publish a profile, then pay `@that-user` from a second
   account. Confirm the payer is **not** shown a claim link, and that the recipient
   can claim it from their dashboard.

Record the txids in this file when you do it. Until then, the escrow path is
implemented and reviewed, not proven.

## Design verification

Rendered and scanned at phone (390), tablet (768), laptop (1280) and desktop (1600)
widths, dark and print themes, plus reduced-motion — checking for clipped or
overlapping text, sideways scrolling, contrast on the rendered pixels, visible
keyboard focus and tap-target size. Results are in `design/DIRECTION.md`.
