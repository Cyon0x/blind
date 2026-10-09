# Payment flows

Two products, one state machine. Every transition below happens in
`src/lib/payments.ts` and is either a conditional `UPDATE … WHERE … RETURNING` or
an `INSERT … ON CONFLICT`.

```
Blind Pay      created → awaiting_deposit → funded → claim_pending → payout_submitted → settled
Blind Request  awaiting_payment → funded → payout_submitted → settled
(username pay) created → awaiting_deposit → funded → claim_pending → payout_submitted → settled
either                                          → expired | failed
Blind Pay (payer)                               → refunding → refunded
```

`created` is Blind Pay before the escrow has handed out a deposit address; if the
escrow is unavailable the payment is never created at all.

## Blind Pay

### 1. Create

`POST /api/payments` with `kind: "pay"` (or `toUsername` for a username payment).

1. Validate the amount (≤ `BDX_MAX_PAYMENT_ATOMIC`, > 0). A bad amount never
   creates a row.
2. Mint a reference `bp_<16 random bytes, base64url>` and a 32-byte claim secret.
   Store `sha256(secret)` in `claim_secret_hash`, and — if `BDX_CLAIM_KEY` is set —
   an AES-256-GCM sealed copy in `claim_secret_sealed`.
3. **Allocate a real deposit destination**: `create_address` on the escrow wallet,
   then `make_integrated_address`. If the escrow is down, this throws
   `EscrowUnavailable` and the whole request fails with 503. Blind will not hand
   out a link that cannot hold money.
4. Return the claim URL `${APP_URL}/claim/<reference>#<secret>`. The secret is in
   the fragment deliberately.

For a **username payment** (`toUsername`): Blind resolves the handle to an
internal user id, requires that profile to be public, sets
`counterparty_user_id`, and returns **no claim URL to the payer**. The link is
delivered to the recipient instead, from the sealed copy, on their own dashboard.
A username payment cannot be created at all without `BDX_CLAIM_KEY` — otherwise
Blind would be unable to deliver the link it created.

### 2. Fund

The payer sends BDX to the integrated address, either from the extension
(`sendTransactionSafe` with the payment reference as the idempotency key) or from
any external wallet.

`POST /api/payments/<ref>/funding` re-reads the escrow wallet
(`get_bulk_payments` on the payment id) and, when it finds the deposit, deepens the
confirmation count from the daemon. Then:

- below `BDX_CONFIRMATIONS` → state unchanged, UI shows "seen, 2 of 10";
- at threshold → `markFunded` (`UPDATE … WHERE kind='pay' AND status IN
  ('created','awaiting_deposit')`) → `funded`, notify both sides.

Two tabs, a retry and a replayed observation all converge on one transition: the
loser's `UPDATE` matches nothing and returns null, and the caller reports "another
writer advanced this payment first".

### 3. Share

`GET /api/payments/<ref>/claim-link` (payer only, rate-limited, audited) unseals
the stored secret and rebuilds the URL. The QR code is rendered server-side from
that exact URL. Expiry is set per payment (`expiresInHours`, default 72 hours, or
none at all).

### 4. Claim

`POST /api/claims/<ref>` with `{ secret, payoutAddress }`. No Blind account is
required, so the same-origin check and a rate limit are the only other gates.
A wrong secret is indistinguishable from an unknown one.

1. Decode and validate the destination address **for the configured network**, so
   a mainnet-only deployment cannot be tricked into paying a testnet address.
2. Verify the secret hash in constant time — and then again *inside* the
   transition. `beginClaim` is one statement:

   ```sql
   update payments set status='claim_pending', claimed_at=now(), payout_address=$3
    where id=$1 and kind='pay' and status='funded'
      and claim_secret_hash is not null and claim_secret_hash = $2
      and (expires_at is null or expires_at > now())
   returning *
   ```

   The check and the transition are the same operation, so two simultaneous
   claims cannot both win, and an expired payment cannot be claimed at all.
3. `executePayout` sends once (see below).
4. If the claim loses, the API reports the current state — `already_claimed`,
   `expired`, or `not_claimable` — with the words to match. **A second claim is
   never paid**, and nothing marks the payment settled by changing a column.

### 5. Settle

`POST /api/payments/<ref>/settlement` asks the escrow wallet and the daemon
independently. `settled` requires the daemon to have seen the transaction (or, if
no daemon is configured, the wallet's own count) at `≥ BDX_CONFIRMATIONS`. Then
`ensureReceipts` writes both receipts. A bootstrap node answering is recorded and
surfaced.

### 6. Refund

`POST /api/payments/<ref>/refund` — payer only, `funded` only, and refused within
one hour of funding so a recipient mid-claim is not robbed by it. Same
once-only payout path, with `kind='refund'`.

## Blind Request

### Create

`POST /api/payments` with `kind: "request"`, a payout address, and
`payoutMode`.

- **escrow** (default): Blind validates the address structurally and allocates a
  fresh escrow deposit destination. The payer's wallet never sees the recipient's
  address.
- **direct**: the link carries the recipient's own address. The UI says so in as
  many words: direct mode means the recipient's address is visible to the payer and
  the only witness of payment is their own wallet.

### Pay

`GET /api/requests/<ref>` returns the public view plus `requestPayerTarget()` —
which is only ever "a one-time escrow address" or "the recipient's own address",
never anything about the recipient.

`POST /api/requests/<ref>/fund` (same-origin, rate-limited, no account needed) is
the "I sent it — check now" action. It is safe to expose because it only *reads*
the escrow wallet: the state advances solely on evidence, and the transition is a
single conditional `UPDATE`. Funding a request then **forwards immediately**:
`executePayout(payment, payout_address, 'payout')`, because a request is money
going out.

`POST /api/requests/<ref>/direct` records the two parties' reports for a direct
request. It is deliberately weak and says so: `markDirectRequestPaid` records
"the payer says they sent it", and only the recipient can
`recipientConfirmsDirect` — after which Blind states plainly that it has **no chain
evidence** for the payment.

### Duplicate and mis-amount payments

- A second deposit to an already-funded escrow request does not advance anything:
  the transition only matches `awaiting_payment`. The extra money is visible in the
  escrow wallet for an operator to refund manually, and Blind never claims it was
  paid.
- Over/underpayment in escrow mode: the funded amount recorded is what the wallet
  actually saw (`deposit_amount_atomic`), and receipts use that figure. Blind does
  not top up or claw back.
- Blind promises no automatic refund anywhere. Refunds are a payer action with a
  destination the payer names.

## Payouts, once

```
beginPayoutOperation  INSERT … ON CONFLICT (payment_id, kind) DO NOTHING
   ├─ created → markPayoutSubmitting → transfer()
   │                ├─ ok      → finishPayoutOperation(submitted, txHash)
   │                └─ error   → finishPayoutOperation(failed, message)
   └─ exists  → tx_hash?      → report it, do not send
                failed?        → report the failure, do not send
                else (unknown) → reconcileOutgoing(): search get_transfers for a
                                 matching amount+destination. Found → adopt it.
                                 Not found → park as `unknown`. Never re-send.
```

An `unknown` operation is the one case Blind refuses to resolve on its own: the
payment stays in `funded`/`refunding` with the operation recorded for an operator,
because guessing here means paying twice.

## Claim links and secrets

- The secret is 32 random bytes, base64url, and travels in the URL **fragment**.
- The database holds `sha256(secret)` and, when `BDX_CLAIM_KEY` is set, an
  AES-256-GCM sealed copy. Losing the key makes existing sealed links
  unrecoverable, and the UI says that instead of silently producing a dead link.
- `claimLinkFor()` hands a link only to someone entitled to it: the payer who
  created it — **unless** the payment was addressed to somebody else, in which case
  the payer may never hold it — or the addressed recipient while the payment is
  still unclaimed. Each disclosure is audited.
- Anyone who obtains a claim link can claim the money to an address of their
  choosing. That is what a bearer link is, it is stated in the UI where the link is
  handed over, and it is the reason escrow exists at all.

## Expiry

Expiry is only ever applied to states that hold no money: `sweepExpired()`
(`expireStalePayments`) touches `created`, `awaiting_deposit` and
`awaiting_payment` rows past `expires_at`, and can never retire a funded payment
whose owner has not been paid. A funded payment stays claimable until claimed or
refunded.

## Receipts

Written by `ensureReceipts` when a payout is chain-verified:

- one row per side, enforced by the unique index, so asking twice changes nothing;
- the **side is attached by kind** — a Blind Pay's creator holds the payer receipt;
  a Blind Request's creator holds the recipient receipt;
- each carries `receiptIntegrity()` (SHA-256 over the sorted fields), a
  deterministic engraving seed, and a disclosure naming the half of the story its
  holder may see;
- `settlement_verified` is true only when chain evidence exists. A direct request
  produces receipts that say `verified: false`.
