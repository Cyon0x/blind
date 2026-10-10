#!/bin/sh
# Start beldex-wallet-rpc and open the escrow wallet, so a restart does not leave
# the app posting into a wallet-rpc that has nothing open.
set -eu

# The image carries both binaries; an explicit command runs instead of the
# signer's default startup, so beldexd can use the same image.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

: "${BDX_NETWORK:?set BDX_NETWORK (testnet)}"
: "${BDX_WALLET_RPC_USER:?set BDX_WALLET_RPC_USER}"
: "${BDX_WALLET_RPC_PASSWORD:?set BDX_WALLET_RPC_PASSWORD}"
: "${BDX_ESCROW_WALLET:=blind-escrow}"
: "${BDX_ESCROW_WALLET_PASSWORD_FILE:=/secrets/escrow-wallet-password}"
: "${BDX_DAEMON_ADDRESS:=daemon:28081}"
: "${BDX_WALLET_RPC_PORT:=29092}"

NETFLAG="--testnet"
[ "$BDX_NETWORK" = "mainnet" ] && NETFLAG="--mainnet"
[ "$BDX_NETWORK" = "devnet" ] && NETFLAG="--devnet"

beldex-wallet-rpc \
  "$NETFLAG" \
  --non-interactive \
  --daemon-address "$BDX_DAEMON_ADDRESS" \
  --rpc-bind-ip 0.0.0.0 --rpc-bind-port "$BDX_WALLET_RPC_PORT" --confirm-external-bind \
  --wallet-dir /wallet \
  --rpc-login "${BDX_WALLET_RPC_USER}:${BDX_WALLET_RPC_PASSWORD}" \
  --disable-rpc-login=false \
  --log-level 1 &
RPC_PID=$!
trap 'kill -TERM "$RPC_PID" 2>/dev/null || true' INT TERM

# Wait for the RPC to answer before asking it to open anything.
i=0
until curl -fsS -u "${BDX_WALLET_RPC_USER}:${BDX_WALLET_RPC_PASSWORD}" \
      -X POST "http://127.0.0.1:${BDX_WALLET_RPC_PORT}/json_rpc" \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":"0","method":"get_version"}' >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { echo "beldex-wallet-rpc did not come up" >&2; exit 1; }
  sleep 2
done

if [ -f "$BDX_ESCROW_WALLET_PASSWORD_FILE" ]; then
  WALLET_PASSWORD="$(cat "$BDX_ESCROW_WALLET_PASSWORD_FILE")"
else
  echo "No wallet password file at $BDX_ESCROW_WALLET_PASSWORD_FILE; opening a passwordless wallet is not supported here." >&2
  WALLET_PASSWORD=""
fi

# Absolute path, because --wallet-dir makes the name relative to it.
open_wallet() {
  curl -fsS -u "${BDX_WALLET_RPC_USER}:${BDX_WALLET_RPC_PASSWORD}" \
    -X POST "http://127.0.0.1:${BDX_WALLET_RPC_PORT}/json_rpc" \
    -H 'content-type: application/json' \
    -d "$(python3 - "$1" "$WALLET_PASSWORD" <<'PY'
import json, sys
print(json.dumps({"jsonrpc": "2.0", "id": "0", "method": "open_wallet",
                  "params": {"filename": sys.argv[1], "password": sys.argv[2]}}))
PY
)"
}

if open_wallet "/wallet/${BDX_ESCROW_WALLET}" >/dev/null 2>&1; then
  echo "escrow wallet ${BDX_ESCROW_WALLET} open"
else
  echo "escrow wallet ${BDX_ESCROW_WALLET} is not open yet." >&2
  echo "Restore it once with: docker compose run --rm --entrypoint /usr/local/bin/restore-wallet.sh signer" >&2
  echo "blind-wallet-rpc keeps running; the app will report walletOpen=false until then." >&2
fi

wait "$RPC_PID"
