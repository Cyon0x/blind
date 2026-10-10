#!/bin/sh
# Restore the escrow wallet from its seed phrase, read on standard input.
#
# The seed is never echoed, never written to a file, and never placed on a
# command line (where `ps` would show it): it is read without echo and piped
# straight into the JSON-RPC request body. The only copy that persists is the
# wallet file beldex-wallet-rpc writes, which is what a wallet is.
set -eu

: "${BDX_WALLET_RPC_USER:?set BDX_WALLET_RPC_USER}"
: "${BDX_WALLET_RPC_PASSWORD:?set BDX_WALLET_RPC_PASSWORD}"
: "${BDX_ESCROW_WALLET:=blind-escrow}"
: "${BDX_ESCROW_WALLET_PASSWORD_FILE:=/secrets/escrow-wallet-password}"
: "${BDX_WALLET_RPC_PORT:=29092}"
: "${BDX_RESTORE_HEIGHT:=0}"

if [ ! -f "$BDX_ESCROW_WALLET_PASSWORD_FILE" ]; then
  echo "No wallet password at $BDX_ESCROW_WALLET_PASSWORD_FILE." >&2
  echo "Create one first, and keep it: it is the only thing that unlocks the wallet file." >&2
  echo "  mkdir -p infra/escrow/secrets && openssl rand -base64 32 > infra/escrow/secrets/escrow-wallet-password" >&2
  exit 1
fi
WALLET_PASSWORD="$(cat "$BDX_ESCROW_WALLET_PASSWORD_FILE")"

if [ "$BDX_RESTORE_HEIGHT" = "0" ]; then
  echo "BDX_RESTORE_HEIGHT is 0, so the wallet will scan the whole chain (~8 GB on" >&2
  echo "testnet) and can take hours. Set it to the height the wallet was created at," >&2
  echo "or shortly before the faucet payment, to scan minutes instead." >&2
fi

printf 'Paste the escrow wallet seed phrase, then press enter (input is hidden): ' >&2
if [ -t 0 ]; then stty -echo; fi
read -r SEED
if [ -t 0 ]; then stty echo; fi
printf '\n' >&2

if [ -z "${SEED:-}" ]; then
  echo "Nothing read; nothing restored." >&2
  exit 1
fi

BODY="$(SEED="$SEED" WALLET_PASSWORD="$WALLET_PASSWORD" WALLET="$BDX_ESCROW_WALLET" HEIGHT="$BDX_RESTORE_HEIGHT" python3 -c '
import json, os
print(json.dumps({
    "jsonrpc": "2.0", "id": "0", "method": "restore_deterministic_wallet",
    "params": {
        "filename": os.environ["WALLET"],
        "password": os.environ["WALLET_PASSWORD"],
        "seed": os.environ["SEED"],
        "restore_height": int(os.environ["HEIGHT"]),
        "language": "English",
    },
}))
')"
unset SEED

RESULT="$(printf '%s' "$BODY" | curl -fsS \
  -u "${BDX_WALLET_RPC_USER}:${BDX_WALLET_RPC_PASSWORD}" \
  -X POST "http://127.0.0.1:${BDX_WALLET_RPC_PORT}/json_rpc" \
  -H 'content-type: application/json' --data-binary @-)"
unset BODY

printf '%s' "$RESULT" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
if "error" in payload:
    raise SystemExit("restore failed: " + json.dumps(payload["error"]))
result = payload.get("result", {})
print("restored")
print("address:", result.get("address", "(not reported)"))
print("seed was accepted:", result.get("seed_language") or "English")
print("next: wait for the wallet to sync, then run: npm run bdx:doctor")
'
