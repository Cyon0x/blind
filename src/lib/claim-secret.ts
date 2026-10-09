import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A claim link's bearer credential.
 *
 * The secret is generated client-side-safe (32 random bytes, base64url) and
 * normally travels in the URL *fragment*, which browsers never send to a
 * server. The server stores only its SHA-256, so a database dump does not hand
 * an attacker the ability to drain a claim; a stolen link still does, which is
 * exactly why docs/SECURITY.md treats a claim link as a bearer token.
 */
export const CLAIM_SECRET_BYTES = 32;

export function newClaimSecret(): string {
  return randomBytes(CLAIM_SECRET_BYTES).toString("base64url");
}

export function hashClaimSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function claimSecretMatches(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashClaimSecret(secret), "hex");
  let expected: Buffer;
  try {
    expected = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** Reference + secret pair for the opaque halves of a claim link. */
export function newClaimReference(): string {
  return randomBytes(16).toString("base64url");
}

export function publicIdentifier(bytes = 12): string {
  return randomBytes(bytes).toString("base64url");
}
