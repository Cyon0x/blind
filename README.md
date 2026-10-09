# Blind

**Privacy-first payments and payment requests on Beldex.**

Blind lets someone send money as a link and someone else claim it, without either
side handing over a wallet address. Or it lets someone ask to be paid — through a
normal escrow address, a direct address, or a Blind username — without publishing
the address first.

The name is the idea: a payment stays *latent* until it is claimed. The amount is
the only thing that has to be public, and even that is a plaintext-free amount on
the chain once Beldex's own privacy features do their work.

## What it does

- **Blind Pay** — fund a payment, hand over a claim link or QR code. Whoever holds
  the link names a Beldex address and the escrow pays it out, once.
- **Blind Request** — ask for money. Escrow mode hides the recipient's address from
  the payer; direct mode pays the recipient's own address and says so plainly.
- **Blind username payments** — pay `@someone` from `/u/someone`. Blind resolves
  the handle to an account and delivers the claim link to *them*, never to the payer.
- **Google and X sign-in**, plus real Beldex wallet-signature sign-in that proves
  address ownership without an account anywhere else.
- **Receipts** for both sides that state whether Blind verified settlement against
  the chain, with a tamper-evident integrity hash and a PDF.
- **A dashboard** that counts real payments: funded, awaiting claim, settled,
  failed, expired. No placeholder numbers.
- **Honest failure.** Every capability Blind does not have configured reports
  itself as unavailable — `503 escrow_unavailable`, a "not configured" pill, an
  empty state that explains why it is empty. There are no simulated confirmations
  and no fabricated balances anywhere in the codebase.

## Architecture in one paragraph

Next.js (App Router, React Server Components) on Vercel; Postgres (Neon over HTTP
in production, embedded Postgres for development and tests); hand-rolled OAuth with
PKCE for Google and X; the official `@bdxi/web3js` browser wallet SDK for
user-authorised sends; `beldex-wallet-rpc` as a separate escrow signer that the web
app can ask to allocate deposit destinations and to pay out to a claim's
destination; and a Beldex daemon for chain evidence. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The privacy model, in one paragraph

Blind never asks for a seed phrase and has no field for one. The backend never
holds a user's spend key; the escrow service holds *its own* key and pays out only
to the destination recorded by a claim. Claim secrets travel in the URL fragment,
so a browser never sends them to a server until the holder presses claim, and the
database stores only a SHA-256 of the secret plus an AES-256-GCM sealed copy. The
payer never learns the recipient's address or identity from Blind, and the
recipient never learns the payer's. Read
[docs/PRIVACY_THREAT_MODEL.md](docs/PRIVACY_THREAT_MODEL.md) — including the part
that says what Blind *cannot* do.

## Prerequisites

- Node.js 20+ (developed against Node 24).
- A Postgres database for production (Blind runs an embedded Postgres locally, so
  you need nothing for local development).
- A Beldex daemon reachable over HTTP for settlement evidence.
- `beldex-wallet-rpc` with a wallet for anything that holds or releases funds.

## Install and run

```bash
npm install
cp .env.example .env.local        # fill in what you have; leave the rest blank
npm run db:pglite                 # create the local embedded database
npm run dev                       # http://localhost:3000
```

`npm run dev` uses webpack (`next dev --webpack`), as does `npm run build`.

## Commands

```bash
npm run dev            # local development server
npm run build          # production build
npm start              # serve the production build
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm test               # vitest (58 tests)
npm run db:migrate     # apply db/migrations to DATABASE_URL, or -- --embedded
npm run db:pglite      # prepare the embedded development database
npm run bdx:doctor     # check every Beldex operation against the live endpoints
```

## Configuration

Everything is environment configuration; nothing is a constant. `.env.example`
lists every variable with what it buys you. The four that matter most:

- `APP_URL` — the origin links and OAuth callbacks are built from.
- `AUTH_SECRET` — signs sessions and CSRF tokens.
- `BDX_WALLET_RPC_URL` — presence of this is what enables Blind Pay and escrow
  requests. Without it those features report themselves unavailable.
- `BDX_CLAIM_KEY` — seals claim secrets so a payer can re-display their own link.
  Required for username payments (Blind must hold the link for someone else).

## Deployment

### Live

- **App:** https://blind-pi-six.vercel.app
- **Repository:** https://github.com/Cyon0x/blind
- **Database:** Neon Postgres, provisioned through the Vercel integration and
  migrated with `npm run db:migrate`.
- **Chain read:** Beldex mainnet daemon. `GET /api/health` reports the live height.
- **Configured:** `APP_URL`, `AUTH_SECRET`, `DATABASE_URL`, `BDX_CLAIM_KEY`,
  `BDX_NETWORK`, `BDX_DAEMON_URL`, `BDX_EXPLORER_URL`, `BDX_CONFIRMATIONS`.
- **Still missing on the deployment:** Google and X client ids/secrets, and the
  escrow signer (see below). Until these exist the sign-in page and the pay flow
  say so rather than pretending.

### From scratch

1. Push the repository and import it into Vercel (or run `vercel`).
2. Set the environment variables from `.env.example`. At minimum: `APP_URL`,
   `AUTH_SECRET`, `DATABASE_URL_POOLED`, `BDX_DAEMON_URL`, `BDX_CLAIM_KEY`.
3. Run `npm run db:migrate` against the production database.
4. Add OAuth credentials, with callbacks `${APP_URL}/api/auth/google/callback` and
   `${APP_URL}/api/auth/x/callback`.
5. Host `beldex-wallet-rpc` on a machine with the escrow wallet and set
   `BDX_WALLET_RPC_URL` to it. **This is the one piece with no viable home on
   Vercel**: `beldex-wallet-rpc` has no `darwin-x86_64` build, and Vercel runs no
   long-lived process. Until you host it, Blind deploys and works, and honest
   "escrow unavailable" states stand in for the features that need it.
6. Check the deployment: `curl $APP_URL/api/health` and `npm run bdx:doctor`.

## Known limitations

- **Escrow custody is real.** Beldex has no on-chain scripting, so a link anyone
  can claim requires somebody to hold a key while the payment is in flight. Blind
  makes that window explicit: one fresh subaddress per payment, a payout only ever
  to the destination the claim recorded, at least an hour's grace before a refund,
  and a hot-balance cap. It is custody, and it is documented rather than hidden.
- **Escrow is not running here.** No Beldex wallet-rpc binary exists for this
  development machine's architecture and Docker is not installed, so the signer
  must run on a Linux host. Blind Pay therefore reports `escrow_unavailable` on
  this deployment, and the payment lifecycle beyond deposit detection is
  **untested against a real wallet** until that host exists.
- **Testnet is unpublished.** Beldex publishes no public testnet endpoints, so the
  documented testnet workflow in [docs/TESTING.md](docs/TESTING.md) needs a
  self-hosted testnet node.
- **Google and X credentials are pending.** The flows are implemented and the
  callback handling is tested, but sign-in cannot complete until client ids and
  secrets are supplied.
- **Settlement is only as good as the node.** Blind reads the daemon you point it
  at and reports whether that node is a bootstrap (untrusted) node.
- Not yet implemented: email/push notifications (in-app only), multi-asset support
  (BDX only, because that is what the integration can actually move), and any
  claim-pool or zero-knowledge construction — Blind deliberately does **not**
  improvise cryptography.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit.
- [docs/BELDEX_INTEGRATION.md](docs/BELDEX_INTEGRATION.md) — what Beldex can and
  cannot do, and how each call is made.
- [docs/PAYMENT_FLOWS.md](docs/PAYMENT_FLOWS.md) — the state machines.
- [docs/PRIVACY_THREAT_MODEL.md](docs/PRIVACY_THREAT_MODEL.md) — goals, attackers,
  what each party learns, and residual risk.
- [docs/SECURITY.md](docs/SECURITY.md) — authentication, authorization, secrets.
- [docs/TESTING.md](docs/TESTING.md) — how to run everything, and what is verified.
- [design/DIRECTION.md](design/DIRECTION.md) — the design direction.
