# Escrow signer

Blind Pay holds a funded payment until the recipient claims it. Beldex has no
on-chain scripting, so somebody must hold a signing key while the payment is in
flight — that is what this directory is: the process that holds it, run by you,
on a host you own.

The web app never holds escrow key material. It talks to `beldex-wallet-rpc`
over HTTP with credentials, and only ever asks it to pay the destination recorded
on the claim that owns the deposit. See `docs/PAYMENT_FLOWS.md` and
`docs/PRIVACY_THREAT_MODEL.md` for the custody this implies.

## Why it is not part of the deployment

A Vercel function cannot be the signer: it has no persistent disk, so it cannot
keep a synced wallet, and it would mean shipping the escrow spend key into the
app's own environment. The signer is deliberately a separate process.

## Status: prepared, not yet run

**Nothing in this directory has been executed.** The machine this was written on
is an Intel Mac with no Docker, and Beldex publishes `beldex-linux-x86_64` and
`beldex-mac-silicon` builds only — there is no Intel-mac build — so there was no
host here to run it on. It is written from Beldex's published release layout and
its wallet-RPC guide, which is Monero-CLI compatible (`--wallet-dir`,
`--rpc-login`, `restore_deterministic_wallet`). Treat the first run as a first
run, and let `npm run bdx:doctor` be the judge.

It also needs a **reachable testnet daemon**, which is included here because
Beldex publishes no public one: the `daemon` service syncs its own copy of the
testnet chain (~8 GB and counting — check
`https://testnet.beldex.dev/api/networkinfo` for the current size).

## Run it

Requires Docker on the host (any Linux box, or Docker Desktop / Colima on a Mac).

```bash
cd infra/escrow
cp env.example .env                      # then edit the credentials
mkdir -p secrets
openssl rand -base64 32 > secrets/escrow-wallet-password   # KEEP THIS FILE

docker compose up -d --build             # daemon syncs, then the signer starts
docker compose logs -f daemon            # watch the sync
```

Restore the escrow wallet from its seed phrase once — the seed is read on stdin,
hidden, and never written to a file or a command line:

```bash
docker compose run --rm -i --entrypoint /usr/local/bin/restore-wallet.sh signer
```

Set `BDX_RESTORE_HEIGHT` to the height the wallet was created at (or just before
the faucet payment) to scan minutes instead of the whole chain. The default `0`
scans everything and can take hours.

Then point the app at it. Locally, in `.env.local`; on Vercel, as project
environment variables:

```
BDX_NETWORK=testnet
BDX_WALLET_RPC_URL=http://<signer host>:29092/json_rpc
BDX_WALLET_RPC_USER=<same as BDX_WALLET_RPC_USER in .env>
BDX_WALLET_RPC_PASSWORD=<same as BDX_WALLET_RPC_PASSWORD in .env>
BDX_ESCROW_WALLET=blind-escrow
BDX_DAEMON_URL=http://<signer host>:28081/json_rpc
BDX_ESCROW_HOT_CAP_ATOMIC=<cap the escrow may hold at once; optional>
```

Prove it before using the UI:

```bash
npm run bdx:doctor        # every wallet line must print ok, not skip
```

`BDX_ESCROW_HOT_CAP_ATOMIC` is not decoration: `escrowHealth()` checks it before
every payout, and a payout that would push the escrow past it is refused.

## Reaching it from Vercel

The signer port is bound to loopback on purpose. To let the deployed app reach
it, put something authenticated in front — a private network (Tailscale, WireGuard,
a VPC), or an authenticated tunnel — and set `BDX_WALLET_RPC_URL` to that. Do not
publish the port as-is: it is a wallet that can spend escrowed funds, and its
credentials travel in the request body, so terminate TLS in front of it.

## If you would rather not run this

Blind Request's **direct** payout mode does not need the signer at all: the payer
pays the recipient's own address from their own wallet. The UI says so in as many
words. Only Blind Pay — and requests in escrow mode — need this process.
