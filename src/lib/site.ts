/**
 * Comparing "which site is this?" across the two shapes it arrives in.
 *
 * The Beldex Wallet composes the sign-in statement itself and writes the page
 * *origin* into `domain` (`https://blind.app`), where SIWE-shaped statements and
 * this app's own configuration carry the bare host (`blind.app`). Both name the
 * same site, so binding is compared host-to-host rather than by string equality.
 */

/** The host of a value written either way: `blind.app`, `blind.app:3000`, `https://blind.app/signin`. */
export function siteHost(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.host ? url.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Does this value name the same site as that one?
 *
 * Strict where it matters: a different host, a lookalike suffix
 * (`blind.app.example.com`), a missing host or an unparseable value all fail.
 */
export function sameSite(value: string, expected: string): boolean {
  const left = siteHost(value);
  const right = siteHost(expected);
  return left !== null && right !== null && left === right;
}

/**
 * The host of a value only when it actually claims a web origin.
 *
 * The wallet may write the `uri` it was on, and that is worth checking — but
 * only for `http(s)`, the schemes that name a site. A page served from a custom
 * or extension scheme (`chrome-extension://…`) makes no claim about which web
 * site authorised the statement, so it is neither confirmed nor refused here.
 */
export function webHost(value: string): string | null {
  const raw = value.trim();
  if (!raw.includes("://")) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.host ? url.host.toLowerCase() : null;
  } catch {
    return null;
  }
}
