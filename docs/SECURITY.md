# Security

Security decisions that are actually implemented, and the limitations that remain.
Where something is a code-review discipline rather than an enforced control, it says
so.

## Authentication

- **Google and X OAuth 2.0 with PKCE**, hand-rolled. `state` and the PKCE verifier
  are stored server-side in `oauth_states` with a 10-minute TTL; the callback
  consumes the state in the same statement that reads it, so a replayed callback
  URL cannot start a second session.
- **`next=` is validated** to be a relative path before the callback redirects to
  it, so the callback cannot be used as an open redirect.
- **Provider identity is not the account.** Each user has an internal UUID. A
  Google subject id, an X handle and a wallet address are all *linked accounts*
  attached to it, so a changed X handle cannot take over an account.
- **Link mode.** `?link=1` attaches a provider to the signed-in account instead of
  switching accounts, and is audited as `auth.provider_linked`.
- **Wallet sign-in** replaces the code exchange with an ed25519 `SigV1` signature
  over a domain-bound statement, verified server-side against the address's own
  spend key. The challenge is single-use (`auth_challenges`), expires, and is bound
  to this app's host — a signature harvested on another site is useless here.
  Accepted framings are configurable via `BDX_SIGNATURE_FRAMINGS`, and the default
  accepts plain, `Beldex signed Message:` and `Monero signed Message:` prefixes.
- **The binding compares hosts, and accepts exactly the hosts we serve.** The wallet
  writes the page *origin* into `domain` (`https://blind.app`) while this app's
  configuration holds the bare host (`blind.app`), so both are normalised to a host
  and compared (`src/lib/site.ts`). The accepted set is the configured `APP_URL`
  host plus the request host, and the request host only counts when it is one we
  already serve — a spoofed `Host` header cannot widen the binding. When neither
  names a site we serve the set is empty and every statement is refused rather
  than trusting the header under suspicion. A statement whose `uri` claims a web
  origin other than ours is refused too; a non-web scheme (`chrome-extension://…`)
  names no site and is left alone.
- **Sign-out** deletes the session row and clears both cookies.
- **Rate limits** on sign-in start, wallet challenge/verify, username checks, claim
  attempts, claim-link disclosure and settlement checks.
- **Least scope.** The X flow asks for `users.read` and nothing more, because the
  handle from `users/me` is the only X field Blind reads; `X_SCOPES` exists to
  override that deliberately, not to widen it by default. Google asks for
  `openid email profile`. Both are PKCE (`S256`).
- **The start redirect is `no-store`.** The 302 that hands the browser to a
  provider carries a one-time `state` and the PKCE challenge, so it is marked
  uncacheable rather than left for a shared cache to keep a copy.
- **Confidential vs public X clients are explicit.** X token requests use HTTP
  Basic when a client secret is set, and PKCE-only when `X_USE_PKCE=1` is set —
  so a client of either type can be configured without a code change, and neither
  is guessed at runtime.

## Sessions

- Opaque 32-byte random tokens; only `sha256(token)` is stored, so a database dump
  does not yield live sessions.
- Cookies are `httpOnly`, `SameSite=Lax`, `Secure` in production, 30-day expiry.
- The CSRF token is `HMAC(AUTH_SECRET, "csrf:" + sessionToken)`: it is bound to the
  session, so a token lifted from another session is useless. Mutations require
  both a same-origin check and the `x-blind-csrf` header.
- `AUTH_SECRET` must be ≥ 24 characters; the app refuses to mint sessions or CSRF
  tokens without it rather than falling back to a default.
- Sessions are listed in Wallet & security with device and last-seen, and revocable
  by signing out.

## Authorization

- Every route that reads or mutates a payment resolves it by reference and then
  compares `creator_user_id` / `counterparty_user_id` against the session.
- **No route accepts a payment status, a confirmation count or a settlement verdict
  from a request body.** Statuses advance only in `src/lib/payments.ts`, only from
  wallet or chain evidence.
- `/api/payments/<ref>/claim-link` hands a link only to an entitled viewer, and
  audited each time: `claim.link_disclosed` or `claim.link_disclosed_addressee`.
- A payment addressed to a username **never** gives its claim link to the payer, by
  design: the payer funded it, and holding the credential that releases it would
  defeat the point of addressing it.
- Internal database ids are never an authorization mechanism: requests carry the
  public `reference`, and the server decides.

## Claim links

A claim link is a bearer credential: whoever holds it can have the money paid to an
address they choose. This is stated in the UI wherever a link is displayed, and the
design reflects it:

- 32 random bytes, base64url, in the URL **fragment** — never sent to a server until
  the holder presses claim, never in a `Referer`, never in a request log.
- Stored as SHA-256 only, plus an AES-256-GCM sealed copy under `BDX_CLAIM_KEY` so
  the payer can re-display their own link.
- `/claim/*` is `Cache-Control: no-store`.
- The comparison is constant-time and happens **inside** the state transition.
- `beginClaim` matches only `status='funded'` and an unexpired payment, so a claim
  cannot be replayed, cannot be doubled, and cannot resurrect an expired link.
- The `payout_operations (payment_id, kind)` unique index makes a second payout
  impossible even if two claimers pass the state check.

## Wallet security

- Blind never asks for, and has no field for, a seed phrase, view key or spend key.
- No key material reaches the server. User sends are approved inside the wallet
  extension; the app receives only a transaction hash.
- Escrow key material lives in `beldex-wallet-rpc` on a separate host, outside the
  web app's process and configuration. Blind calls `transfer`; it never holds the
  key.
- Every send carries an idempotency key (the payment reference), and an ambiguous
  outcome is parked as `unknown` for an operator instead of being retried — a
  deliberate choice to risk a stuck payment rather than a double one.
- Addresses are validated for the configured network before any spend.
- A **hot-balance cap** (`BDX_ESCROW_HOT_CAP_ATOMIC`) is checked before every
  payout; exceeding it refuses the send.

## Input validation and injection

- Every database statement is parameterised. There is no string interpolation of
  user input into SQL anywhere.
- Amounts are parsed into atomic `bigint` with a strict regex (up to 9 decimals),
  bounded by `BDX_MAX_PAYMENT_ATOMIC`; a bad amount never reaches the database.
- Addresses are decoded and checksum-verified before use.
- Descriptions are capped (280 characters), invoice references 64; usernames match
  `^[a-z0-9_]{3,20}$` against a reserved-word list.
- Output encoding is React's by default. The one `dangerouslySetInnerHTML` is the
  server-rendered QR SVG, whose payload is a URL Blind itself generated.
- Request bodies are parsed defensively (`readJson` returns `{}` on malformed JSON).

## Secrets and configuration

- Real credentials never enter the repository; `.env.example` holds names and
  placeholders only.
- `AUTH_SECRET` signs sessions, CSRF tokens and the IP hash. `BDX_CLAIM_KEY` seals
  claim secrets. Rotating `BDX_CLAIM_KEY` makes existing sealed links unrecoverable,
  which the UI states.
- Access tokens are used inside a single request and not persisted; only the
  profile fields needed (handle, name, email, avatar) are stored.
- The app logs one line for an unhandled error — no payloads, no tokens, no
  addresses. Anything else is a code-review discipline, not a runtime guarantee.

## Abuse prevention

- Fixed-window rate limits, implemented as a single upsert so two serverless
  invocations cannot both believe they are first. Buckets: OAuth start, username
  checks, claim attempts (30/min), claim-link disclosure, request reads and funding,
  settlement checks, receipt reads.
- Username changes are limited to one per day by the `UPDATE`'s own `WHERE` clause.
- `usernameAvailable` is rate-limited so the namespace cannot be enumerated quickly.
- Claim attempts deliberately do not distinguish "wrong secret" from "unknown
  payment".

## Transport and headers

- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- No third-party scripts, analytics or CDN assets, so there is no
  supply-chain surface in the browser beyond the app itself.
- HTTPS is Vercel's responsibility; Blind's own code makes no plaintext outbound
  call except to a daemon or wallet-rpc the operator configures (the Beldex public
  mainnet node only answers over plain HTTP, which is noted in `.env.example`).

## Known limitations

1. **No independent security review.** The cryptography in use is standard
   (ed25519, keccak-256, AES-GCM) and the address codec is verified against Beldex's
   own WASM core, but the integration as a whole is unaudited.
2. **Escrow is trusted during the claim window.** Not a bug — a property of a
   chain with no scripts. Documented in
   [PRIVACY_THREAT_MODEL.md](PRIVACY_THREAT_MODEL.md).
3. **CSP allows inline script and style.** `next.config.ts` sends a
   `Content-Security-Policy` that pins every fetch to `'self'` and sets
   `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` and
   `object-src 'none'`. React's inline hydration bootstrap still requires
   `'unsafe-inline'` for `script-src` and `style-src`, so the policy does not by
   itself defeat an injection that already runs same-origin. A nonce-based policy
   generated in middleware is the next step if Blind ever adds a third-party
   script or an HTML sink.

   Development builds additionally allow `'unsafe-eval'`, because React Refresh
   evaluates code at runtime; `next.config.ts` adds it only when
   `NODE_ENV !== "production"`. A deployment can be checked with
   `curl -sI $APP_URL | grep -i content-security-policy` — if `unsafe-eval` is
   in the answer, that is not a production build.
4. **`audit_log` has no retention policy** and no tamper-evidence beyond being
   append-only by convention.
5. **Rate limiting is per-instance-fixed-window**, not a distributed token bucket;
   a burst across regions can exceed the nominal limit.
6. **Refund authority is the payer's session only.** There is no multi-party or
   time-locked recovery if a payer loses access to their account; the requirement is
   deliberately conservative.
7. **The public daemon is untrusted.** Blind records `untrusted: true` when a
   bootstrap node answers, but it cannot make a bad node tell the truth — point
   `BDX_DAEMON_URL` at a node you run for settlement evidence you can rely on.
8. **`BDX_SIGNATURE_FRAMINGS` widening is a judgment call.** Accepting three
   framings reduces false rejections across wallet versions at the cost of accepting
   a signature over what is, in effect, a different message string. Tighten it to
   one framing once the wallet's exact behaviour is pinned down.
