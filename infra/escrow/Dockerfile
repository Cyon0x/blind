# The escrow signer, packaged as a process you run yourself.
#
# Blind's custody design keeps the escrow spend key out of the web app: the app
# talks to beldex-wallet-rpc over HTTP and never holds key material. That means
# the signer needs a host with a persistent disk — not a Vercel function.
#
# Beldex publishes linux-x86_64 and mac-silicon binaries (there is no Intel-mac
# build), so this image uses the Linux build and runs anywhere Docker does.
FROM debian:bookworm-slim

ARG BDX_VERSION=v7.0.4
ARG BDX_ASSET=beldex-linux-x86_64-${BDX_VERSION}.tar.xz

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates xz-utils python3 \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/beldex.tar.xz \
      "https://github.com/Beldex-Coin/beldex/releases/download/${BDX_VERSION}/${BDX_ASSET}" \
 && mkdir -p /opt/beldex \
 && tar -xJf /tmp/beldex.tar.xz -C /opt/beldex \
 && ln -sf "$(find /opt/beldex -type f -name beldexd | head -1)" /usr/local/bin/beldexd \
 && ln -sf "$(find /opt/beldex -type f -name beldex-wallet-rpc | head -1)" /usr/local/bin/beldex-wallet-rpc \
 && rm -f /tmp/beldex.tar.xz \
 && beldexd --version && beldex-wallet-rpc --version

COPY signer-entrypoint.sh /usr/local/bin/signer-entrypoint.sh
COPY restore-wallet.sh /usr/local/bin/restore-wallet.sh
RUN chmod +x /usr/local/bin/signer-entrypoint.sh /usr/local/bin/restore-wallet.sh

ENTRYPOINT ["/usr/local/bin/signer-entrypoint.sh"]
