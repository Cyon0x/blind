import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

/**
 * Sealing for the one secret Blind has to be able to hand back: a payment's
 * claim secret, so the payer can copy their own link again later.
 *
 * The database stores ciphertext; the key lives in BDX_CLAIM_KEY. A stolen
 * database dump therefore does not let an attacker drain claims, and an
 * operator can rotate the key (old links then need re-issuing, which the UI
 * says plainly rather than pretending they still work).
 */
const VERSION = "v1";

function key(): Buffer | null {
  const raw = process.env.BDX_CLAIM_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  const base64 = Buffer.from(trimmed, "base64");
  if (base64.length === 32) return base64;
  // Any other passphrase is stretched to 32 bytes; documented in .env.example.
  return scryptSync(trimmed, "blind-claim-key-v1", 32);
}

export const claimSealingConfigured = (): boolean => key() !== null;

export class SealingUnavailable extends Error {
  constructor() {
    super("BDX_CLAIM_KEY is not set, so Blind cannot re-display a stored claim link.");
    this.name = "SealingUnavailable";
  }
}

export function seal(plaintext: string): string {
  const secretKey = key();
  if (!secretKey) throw new SealingUnavailable();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function unseal(sealed: string | null): string | null {
  if (!sealed) return null;
  const secretKey = key();
  if (!secretKey) return null;
  const [version, ivPart, tagPart, dataPart] = sealed.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", secretKey, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Integrity hash for receipts: tamper-evident, not a signature. */
export function receiptIntegrity(input: Record<string, unknown>): string {
  const canonical = Object.keys(input)
    .sort()
    .map((k) => `${k}=${JSON.stringify(input[k] ?? null)}`)
    .join("&");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Deterministic seed so a receipt's engraving is reproducible from its own data. */
export function engravingSeed(reference: string): string {
  return createHash("sha256").update(`blind-engraving:${reference}`).digest("hex").slice(0, 32);
}
