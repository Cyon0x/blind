#!/bin/sh
# Point the deployed app at the escrow signer.
#
# The signer is reached through a Cloudflare **quick** tunnel, whose hostname is
# new every time it starts — so BDX_WALLET_RPC_URL goes stale on every reboot or
# `docker compose restart tunnel`, and the deployed app silently loses escrow
# until it is updated. (A named tunnel would remove the step; it needs a
# Cloudflare account with a domain on it, which this deployment does not have.)
#
# Where the hostname is read from is the part that had to be got right. It comes
# from `.tunnel/tunnel.log`, the file the container writes through a mount, not
# from `docker logs` — see the compose file for the restart where the container's
# stdout had the new hostname and `docker logs` did not. The container log is
# still consulted as a fallback, and every candidate is *probed*: both sources
# keep hostnames the tunnel has since abandoned, so the only one worth
# publishing is the one the wallet actually answers on.
#
#   sh infra/escrow/vercel-tunnel-url.sh                      print the live URL
#   sh infra/escrow/vercel-tunnel-url.sh --set                set it on Vercel
#   sh infra/escrow/vercel-tunnel-url.sh --set --redeploy     …and redeploy
#
# After --set the running app keeps the old value until it is redeployed, which
# is why --redeploy exists.
set -eu

here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
log="$here/.tunnel/tunnel.log"

# The wallet-rpc asks for credentials on a request that reached it: alive.
probe() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
    -X POST "https://$1/json_rpc" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":"0","method":"get_version"}' || true
}

hosts=""
if [ -s "$log" ]; then
  hosts="$(grep -Eo '[a-z0-9-]+\.trycloudflare\.com' "$log" | awk '!seen[$0]++')"
fi

container="$(docker ps --filter name=escrow-tunnel --format '{{.Names}}' | head -1)"
if [ -z "$hosts" ] && [ -n "$container" ]; then
  hosts="$(docker logs "$container" 2>&1 | grep -Eo '[a-z0-9-]+\.trycloudflare\.com' | awk '!seen[$0]++')"
fi

if [ -z "$hosts" ]; then
  echo "no tunnel hostname to test yet." >&2
  if [ -z "$container" ]; then
    echo "the escrow tunnel is not running — bring the stack up first:" >&2
    echo "  cd infra/escrow && docker compose up -d" >&2
  else
    echo "the tunnel is up but has not announced a hostname yet — wait a few" >&2
    echo "seconds and run this again." >&2
  fi
  exit 1
fi

# Newest first: both sources only append, so the last announcement is the most
# likely live one — but the probe below, not the order, is what decides.
ordered="$(printf '%s\n' "$hosts" | awk '{a[NR]=$0} END{for(i=NR;i>0;i--) print a[i]}')"

url=""
for host in $ordered; do
  code="$(probe "$host")"
  if [ "$code" = "401" ]; then
    url="https://$host/json_rpc"
    break
  fi
done

if [ -z "$url" ]; then
  echo "none of the announced tunnel hostnames answered (tried: $(printf '%s ' $ordered))" >&2
  echo "check that the tunnel is connected: docker compose logs tunnel" >&2
  exit 1
fi

if [ "${1:-}" != "--set" ]; then
  echo "$url"
  exit 0
fi

vercel env rm BDX_WALLET_RPC_URL production --yes >/dev/null
printf '%s' "$url" | vercel env add BDX_WALLET_RPC_URL production >/dev/null
echo "BDX_WALLET_RPC_URL set to $url on Vercel production."

case " ${*:-} " in
  *" --redeploy "*)
    vercel --prod
    ;;
  *)
    echo "Redeploy so the running app picks it up: vercel --prod (or any push to main)."
    ;;
esac
