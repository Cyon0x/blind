#!/bin/sh
# Expose the escrow signer (and optionally the daemon) to the deployed app.
#
# The app reaches a wallet RPC that can move funds, so this is deliberately not
# an open URL: beldex-wallet-rpc requires the credentials in BDX_WALLET_RPC_USER
# and BDX_WALLET_RPC_PASSWORD on every request, and the tunnel only ever forwards
# to loopback on this machine. A quick tunnel's hostname also changes whenever it
# restarts, so the app's BDX_WALLET_RPC_URL has to be updated when it does — a
# named tunnel or a private network removes that step.
set -eu

: "${BDX_WALLET_RPC_PORT:=29092}"
: "${BDX_DAEMON_RPC_PORT:=28081}"
: "${WITH_DAEMON:=1}"

command -v cloudflared >/dev/null || { echo "cloudflared is not installed (brew install cloudflared)" >&2; exit 1; }

mkdir -p /tmp/blind-escrow-tunnel
rm -f /tmp/blind-escrow-tunnel/*.log /tmp/blind-escrow-tunnel/*.url

start() {
  name="$1" port="$2"
  nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${port}" \
    > "/tmp/blind-escrow-tunnel/${name}.log" 2>&1 &
  echo $! > "/tmp/blind-escrow-tunnel/${name}.pid"
}

wait_for_url() {
  name="$1"
  i=0
  while [ "$i" -lt 60 ]; do
    url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "/tmp/blind-escrow-tunnel/${name}.log" | head -1 || true)"
    if [ -n "${url:-}" ]; then
      printf '%s' "$url" > "/tmp/blind-escrow-tunnel/${name}.url"
      echo "${name}: ${url}"
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "${name}: no URL after 120s — see /tmp/blind-escrow-tunnel/${name}.log" >&2
  return 1
}

start signer "$BDX_WALLET_RPC_PORT"
[ "$WITH_DAEMON" = "1" ] && start daemon "$BDX_DAEMON_RPC_PORT"

wait_for_url signer || true
[ "$WITH_DAEMON" = "1" ] && { wait_for_url daemon || true; }

echo
echo "Set these on the app (Vercel → Settings → Environment Variables), then redeploy:"
echo "  BDX_WALLET_RPC_URL=https://<signer host>/json_rpc"
echo "  BDX_WALLET_RPC_USER=<see infra/escrow/.env>"
echo "  BDX_WALLET_RPC_PASSWORD=<see infra/escrow/.env>"
[ "$WITH_DAEMON" = "1" ] && echo "  BDX_DAEMON_URL=https://<daemon host>/json_rpc"
echo
echo "Stop the tunnels: kill \$(cat /tmp/blind-escrow-tunnel/*.pid)"
