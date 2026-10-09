# Privacy threat model

Blind's claim is narrow and specific: **a payment can complete without either side
learning the other's wallet address from Blind, and without either side's identity
becoming part of the payment record.** This document states what that does and does
not mean, who can learn what, and what remains possible.

It deliberately does not claim anonymity or untraceability. Anything Blind cannot
back with a mechanism is listed as residual risk.

## Goals

| Goal | How it is pursued | Status |
| --- | --- | --- |
| The payer never learns the recipient's address or identity from Blind | The escrow pays out to the destination the *claim* recorded; the view layer withholds every counterparty field | Implemented, tested (`tests/redaction.test.ts`) |
| The recipient never learns the payer's address or identity from Blind | The payer's deposit is one of the escrow's subaddresses; the view layer withholds it from the recipient | Implemented, tested |
| The application server never holds a user's spending key | Users bring a wallet; the escrow holds only its own key, in a separate service | By design — there is no seed-phrase field |
| A public link reveals no wallet information about either party | `paymentView()` for role `public` carries amount, description, state — and no address or txid | Implemented, tested |
| A claim credential never travels to a server unless it must | The secret lives in the URL fragment; the database keeps `sha256` plus a sealed copy | Implemented |
| No payment is attributed by amount alone across payments | The hosted amount on-chain is Beldex's own concern; Blind's contribution is one-time destinations and unique payment ids | Partial — see below |

## Threat actors

1. **The other participant.** A payer wanting to know who they paid, or a recipient
   wanting to know who paid them.
2. **An observer holding a payment link.** Anyone the link was forwarded to, or who
   finds it in a log, screenshot or chat history.
3. **The escrow operator** (whoever runs `beldex-wallet-rpc` and can read the
   database and the app's logs).
4. **A database thief.** Someone with a dump of `payments`, `receipts`, `users`.
5. **A network observer** between the user and Blind, or between Blind and the node.
6. **A malicious link author.** Someone who mints a link to phish, or who tampers
   with one.
7. **An unauthorised stranger.** Someone who tries to read or move money that is not
   theirs by guessing identifiers or changing a URL.
8. **A compromised user account.** Someone who gets into a user's Blind session.
9. **The chain itself.** Anyone reading the public ledger.
10. **The chain evidence source.** On testnet this is the Beldex testnet
    explorer (`https://testnet.beldex.dev`), because Beldex publishes no public
    testnet daemon; on mainnet it is whatever `BDX_DAEMON_URL` points at. It sees
    every transaction hash Blind checks and the originating IP of the check.

## What each party can learn

| | Amount | Description | Payer identity | Recipient identity | Payer wallet | Recipient wallet |
| --- | --- | --- | --- | --- | --- | --- |
| Payer | ✓ | ✓ | ✓ (self) | ✗ | ✓ (self) | ✗ |
| Recipient | ✓ | ✓ | ✗ | ✓ (self) | ✗ | ✓ (the address they named at claim) |
| Holder of the link | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Blind server | ✓ | ✓ | via OAuth for signed-in users | via OAuth for signed-in users | ✗ | ✗ (until a claim records a payout destination) |
| Escrow operator | ✓ | ✓ | ✗ | ✗ | ✗ | the payout destination |
| Chain observer | ✓ (Beldex-style) | ✗ | ✗ (see below) | ✗ | ✗ | the payout destination |
| Chain evidence source (explorer or daemon) | ✓ (Beldex-style) | ✗ | ✗ | ✗ | ✗ | the payout destination; plus *which* transactions Blind asked about, correlated with Blind's requests |

### The evidence source, specifically

Blind has to ask *someone* whether a transaction is mined. That someone learns
the transaction hashes Blind cares about, when it asked, and — unless Blind is
proxied — roughly who asked. Mitigations that are actually in force:

- Blind asks **only** about hashes it has a payment for, and never about an
  address. Address lookups would leak the social graph; there are none.
- Evidence from an explorer is stored and displayed as `untrusted` with its
  source named, so a receipt never implies a node vouched for it.
- A daemon, self-hosted, removes the third party entirely: set `BDX_DAEMON_URL`
  and the explorer is not used at all (see `chainSource()`).

Residual risk: whoever answers the question knows a payment exists and when it
was checked, and could in principle lie about confirmations. Blind cannot detect
a lying source; it can only refuse to describe one as authoritative, which is why
the field is on the receipt.

"Amount" on chain is Beldex's business, not Blind's: Blind posts no amount,
description or reference to the chain and stores nothing on it. A Beldex
transaction is recorded with the amounts hidden by the protocol's own construction,
which Blind relies on and does not weaken.

## Threats and mitigations

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| **Direct address exposure** | One fresh escrow subaddress per payment; the recipient's address is never in the payer's view; the payout destination is recorded only at claim time | The escrow operator sees every payout destination. A direct-mode request hands the recipient's address to the payer by definition, and the UI says so |
| **Deposit → withdrawal correlation** | Deposits go to per-payment subaddresses with unique payment ids; payouts go to the claim's destination | The escrow wallet's own transaction graph is one wallet with an operator who can correlate entry and exit by timing and amount. Blind does not mix, and does not claim to |
| **Timing correlation** | Nothing; Blind does not delay or batch payouts | Deposit time and payout time are visible to the operator and to the chain observer. Claiming later reduces this |
| **Amount correlation** | Blind posts no amounts; Beldex hides them on chain | Round numbers are still memorable, and a *unique* amount is a fingerprint. Nothing in the protocol fixes that |
| **Reused addresses** | `create_address` per payment; the user's own address is used only as a payout destination | A user who pastes the same payout address every time has a stable on-chain identity for every payout they receive |
| **Link leakage** | The secret is in the fragment (never in a `Referer`, never in a server log); `/claim/*` is `Cache-Control: no-store`; `Referrer-Policy: strict-origin-when-cross-origin` | A link in a screenshot, a chat message or a browser history entry is still a claimable bearer credential. Whoever holds it can take the money |
| **QR-code leakage** | The QR encodes only the claim URL; rendered server-side from the exact string | Anyone who photographs the QR holds the same credential as the link |
| **Application server logs** | Secrets are never logged; `handle()` logs one line per unhandled error, with no payload | Route-level logging discipline is code review, not enforcement. An operator can add a bad log line |
| **Database access** | Claim secrets are stored as SHA-256; the only reversible copy is AES-256-GCM sealed under `BDX_CLAIM_KEY`; IPs are hashed | A dump plus `BDX_CLAIM_KEY` (i.e. both a database and a config compromise) yields live claim links |
| **Analytics / third-party scripts** | None. The only outbound calls are to Google's and X's OAuth endpoints | Google and X learn that the user signed in to Blind, which is inherent to using them |
| **Social identity linkage** | The internal user id is the only identifier; emails and handles are stored on `linked_accounts`, never shown to a counterparty, and `show_x_handle` controls even the public profile | A user who links the same X handle publicly elsewhere is correlatable by a human. The X handle is never an identity key |
| **Browser / network metadata** | Blind sets `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and no third-party requests; IPs are hashed before storage | The hosting provider and any TLS terminator see IPs. Request timing is visible to whoever watches the wire |
| **Compromised user account** | Sessions are opaque, httpOnly, 30-day, revocable by signing out; CSRF tokens are bound to the session; sign-in is rate-limited | An attacker in a session can claim any unclaimed link addressed to that user, and can see their payment history. Wallet sends still require the wallet's own approval |
| **Malicious payment links** | A claim is authorised by a secret compared inside the state transition; a wrong secret is indistinguishable from an unknown one; the payout address is validated for the configured network before anything is spent; the claim page names the amount before the user confirms | A link forwarded to the wrong person is claimable by them. Blind's claim UI says so where the link is handed over |
| **Unauthorised claims** | `beginClaim` matches only `funded` + the exact secret hash + unexpired; the unique `payout_operations` slot makes a second payout impossible; the losing claimer gets the winner's state | None known against a funded payment. Pre-funding, nothing is at stake |
| **Replay and double spend** | The claim secret is compared *inside* the transition; the state leaves `funded` on the first success; the payout slot is unique; a replayed OAuth callback cannot start a session because the state row is consumed by the statement that reads it | None against the recorded state. The on-chain double-spend question is Beldex's |
| **Receipt tampering** | SHA-256 over the sorted fields, recomputed on `/verify/[reference]` and reported as matched or not | Integrity is not a signature: someone who can rewrite both the fields and the hash in the database defeats it. The anchored settlement evidence (txid, block height, confirmations) is what makes that detectable in practice |
| **Unauthorised changes to payment status** | Every status change is a conditional statement in the domain layer; no route accepts a status from a client body | Requires database write access, in which case everything is lost anyway |
| **IDOR (reading another user's records)** | Payment, receipt and request routes look the payment up and compare `creator_user_id`/`counterparty_user_id` against the session; `paymentView` shapes what comes back | A receipt **is** a bearer document — its reference is the credential — and that is stated on the verification page |

## Custody: the honest part

Beldex has no on-chain scripting. A link that *anyone* can claim therefore cannot
be trustless: while the payment is in flight, somebody holds a spending key for the
money. Blind chooses to make that window explicit rather than to pretend
otherwise:

- **Who holds the funds, when**

  | Stage | Who controls the money |
  | --- | --- |
  | Before funding | The payer, in their own wallet |
  | After funding, awaiting a claim | The escrow wallet (`beldex-wallet-rpc`), key held by the operator |
  | During a payout | The escrow wallet, to the destination the claim recorded |
  | After settlement | The recipient, in their own wallet |
  | If the payment expires unfunded | The payer — nothing was ever deposited |
  | If a funded payment is never claimed | The escrow, until the payer refunds it to a destination they name |

- **What the escrow operator can and cannot do.** They can pay a claim's recorded
  destination, and refund a payer. They cannot redirect a deposit to an address
  they invent later, cannot see either party's balance, and cannot learn the payer's
  address from Blind. They *can* refuse to release funds — the honest description is
  that Blind is a trusted escrow during the claim window, not a trustless bridge.
- **Why there is no better option available today.** A trustless claim link needs
  either scripting (absent) or a custom cryptographic claim pool with commitments,
  nullifiers and zero-knowledge proofs. Blind will not ship improvised cryptography
  against real money, so it ships the custody it can describe instead.
- **Safeguards.** One fresh subaddress per payment; payout only ever to the
  destination recorded by the claim; at least one hour between funding and a refund
  so a mid-claim recipient cannot be robbed by one; a hot-balance cap
  (`BDX_ESCROW_HOT_CAP_ATOMIC`) checked before every send; every disclosure and
  status change audited in `audit_log` and `payment_events`.

## Unclaimed funds and failure

- An unfunded, expired link is retired by `sweepExpired()` and holds nothing.
- A funded link stays claimable indefinitely unless the payer refunds it. Refunds
  require the payer's session, an address, and the one-hour grace.
- If the escrow is unreachable, funding and payouts fail loudly (503) and no state
  advances. Money already in escrow stays there; the app says so rather than
  inventing a success.
- If a payout's outcome is unknown, the operation is parked as `unknown` for an
  operator and never re-sent. Blind would rather stop than pay twice.

## Data retention

`payments`, `payment_events`, `receipts`, `audit_log` and `notifications` are
retained indefinitely: they are the financial record, and a receipt that expires is
not a receipt. `sessions` expire after 30 days. `oauth_states` and
`auth_challenges` are consumed or expire within 10 minutes. `rate_limits` rows are
overwritten by their own bucket. IP addresses are stored only as an HMAC with
`AUTH_SECRET`, so the table cannot be turned into a list of visitors.

A production operator should add a documented retention policy for `audit_log`
before running at scale; Blind does not delete payment records on its own, and it
would be dishonest for it to do so silently.

## What Blind does not claim

- **Testnet is not a privacy rehearsal.** Blind is deployed against Beldex
  testnet, where the coins are worthless and the user set is tiny — a handful of
  addresses in an anonymity set of a few hundred tells you far less about the
  mechanism than mainnet does. Testnet says the plumbing works; it does not
  evidence the privacy properties at mainnet scale, and nothing here should be
  read as a mainnet privacy result.
- It does not make payments **untraceable**. Beldex's protocol does its part; Blind
  adds no mixing, no batching, no decoys and no anonymity set, and the escrow
  operator can correlate deposits with payouts by time and amount.
- It does not protect against a compromised device, a keylogged wallet, or a user
  who claims to an address they do not control.
- It does not make a bearer link safe to publish: a claim link is money, and anyone
  holding it can spend it.
- It is not trustless: see *Custody* above.
- It is not audited. `SigV1` verification, the address codec and the state machine
  are tested against real fixtures and real arithmetic, but no third party has
  reviewed this code, and a payment app holding other people's money should have
  that before it holds real value.
