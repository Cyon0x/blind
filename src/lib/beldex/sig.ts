import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58Decode, base58Encode } from "./base58";
import { decodeAddress } from "./address";
import type { BdxNettype } from "./nettype";

/**
 * Verification of the `SigV1` scheme the Beldex Wallet uses for message and
 * ownership signatures (bdx-web3js PROTOCOL.md §4.6):
 *
 *   signature = "SigV1" + monero_base58(c ‖ r)
 *   c ‖ r     = an ed25519 Schnorr signature (Monero's `crypto::generate_signature`)
 *               over keccak256(message), made with the account *spend* key.
 *
 * The construction is Monero's `crypto::check_signature`. Its commitment hash
 * covers the struct `{hash, key, comm}` — the message hash FIRST, then the
 * public key, then the compressed point:
 *
 *   comm = compress(c·P + r·G);  c == H_s(msg_hash ‖ P ‖ comm)
 *
 * and signing uses the minus convention `r = k − c·x` (Monero's `sc_mulsub`).
 * Verified against src/crypto/crypto.cpp in monero-project/monero.
 * Nothing here signs anything: the app never holds a spend key.
 */

const SCALAR_ORDER = ed25519.Point.CURVE().n;

/**
 * The protocol pins `keccak256(message)`. Wallet builds that reuse Monero's
 * `wallet2::sign` prefix the message with "<Name> signed Message:\n<len>"
 * before hashing; a candidate list keeps an older or newer wallet from being
 * unable to sign in. The framing that matched is returned with every result so
 * a mismatch is visible in diagnostics instead of silent. Add candidates with
 * BDX_SIGNATURE_FRAMINGS (comma-separated) without shipping a new build.
 */
export const BUILT_IN_FRAMINGS = ["plain", "monero-prefix", "beldex-prefix"] as const;
export type FramingName = (typeof BUILT_IN_FRAMINGS)[number] | string;

function framedMessage(message: string, framing: FramingName): string {
  if (framing === "plain") return message;
  const bytes = Buffer.byteLength(message, "utf8");
  if (framing === "monero-prefix") return `Monero signed Message:\n${bytes}${message}`;
  if (framing === "beldex-prefix") return `Beldex signed Message:\n${bytes}${message}`;
  throw new Error(`unknown signature framing: ${framing}`);
}

function configuredFramings(): FramingName[] {
  const extra = (process.env.BDX_SIGNATURE_FRAMINGS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...BUILT_IN_FRAMINGS, ...extra];
}

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

function bigIntToBytesLE(value: bigint, length = 32): Uint8Array {
  const out = new Uint8Array(length);
  let rest = value;
  for (let i = 0; i < length; i += 1) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** Monero's `sc_reduce32`: keccak output reduced into the ed25519 scalar field. */
function hashToScalar(data: Uint8Array): bigint {
  return bytesToBigIntLE(keccak_256(data)) % SCALAR_ORDER;
}

/** Monero's `sc_check`: a scalar must already be canonical. */
function isCanonicalScalar(bytes: Uint8Array): boolean {
  return bytesToBigIntLE(bytes) < SCALAR_ORDER;
}

/** ed25519's identity point, which Monero's check_signature refuses explicitly. */
function isIdentityEncoding(encoded: Uint8Array): boolean {
  if (encoded[0] !== 1) return false;
  for (let i = 1; i < encoded.length; i += 1) if (encoded[i] !== 0) return false;
  return true;
}

export function isSigV1(signature: string): boolean {
  return typeof signature === "string" && signature.startsWith("SigV1");
}

export function decodeSigV1(signature: string): { c: Uint8Array; r: Uint8Array } | null {
  if (!isSigV1(signature)) return null;
  let raw: Uint8Array;
  try {
    raw = base58Decode(signature.slice(5));
  } catch {
    return null;
  }
  if (raw.length !== 64) return null;
  const c = raw.slice(0, 32);
  const r = raw.slice(32, 64);
  if (!isCanonicalScalar(c) || !isCanonicalScalar(r)) return null;
  return { c, r };
}

export function encodeSigV1(c: Uint8Array, r: Uint8Array): string {
  const joined = new Uint8Array(64);
  joined.set(c, 0);
  joined.set(r, 32);
  return `SigV1${base58Encode(joined)}`;
}

export type SignatureCheck =
  | { valid: true; framing: FramingName; address: string; nettype: BdxNettype }
  | { valid: false; reason: string; triedFramings?: FramingName[] };

/**
 * Verifies a `SigV1` signature against the spend key encoded in `address`.
 * Fails closed: anything unexplained is a rejection with a reason.
 */
export function verifySpendKeySignature(opts: {
  message: string;
  address: string;
  signature: string;
  nettype: BdxNettype;
}): SignatureCheck {
  const decodedAddress = decodeAddress(opts.address, opts.nettype);
  if (!decodedAddress.ok) {
    return { valid: false, reason: `address rejected: ${decodedAddress.reason}` };
  }
  const sig = decodeSigV1(opts.signature);
  if (!sig) return { valid: false, reason: "signature is not a well-formed SigV1 value" };

  let point: InstanceType<typeof ed25519.Point>;
  try {
    point = ed25519.Point.fromBytes(decodedAddress.decoded.spendPublicKey);
  } catch {
    return { valid: false, reason: "address spend key is not a valid curve point" };
  }

  if (bytesToBigIntLE(sig.c) === 0n) return { valid: false, reason: "signature challenge is zero" };
  const c = bytesToBigIntLE(sig.c);
  const r = bytesToBigIntLE(sig.r);
  let R: InstanceType<typeof ed25519.Point>;
  try {
    R = point.multiply(c < 0n ? c + SCALAR_ORDER : c).add(ed25519.Point.BASE.multiply(r));
  } catch {
    return { valid: false, reason: "signature scalars are out of range" };
  }
  const Rbytes = R.toBytes();
  if (isIdentityEncoding(Rbytes)) return { valid: false, reason: "signature resolves to the identity point" };

  const candidates = configuredFramings();
  for (const framing of candidates) {
    let framed: string;
    try {
      framed = framedMessage(opts.message, framing);
    } catch {
      continue;
    }
    const prefixHash = keccak_256(new TextEncoder().encode(framed));
    const digest = new Uint8Array(96);
    digest.set(prefixHash, 0);
    digest.set(decodedAddress.decoded.spendPublicKey, 32);
    digest.set(Rbytes, 64);
    if (hashToScalar(digest) === c) {
      return { valid: true, framing, address: opts.address, nettype: opts.nettype };
    }
  }
  return { valid: false, reason: "signature does not verify with this address", triedFramings: candidates };
}

/* -------------------------------------------------------------- wallet auth */

export const AUTH_STATEMENT_PREFIX = "beldex-auth-v1";

export type AuthStatementFields = {
  domain: string;
  uri: string;
  address: string;
  network: string;
  nonce: string;
  iat: number;
  exp: number;
  rid?: string;
};

/** Mirrors the wallet's own composition, so the server can rebuild or parse it. */
export function buildAuthStatement(fields: AuthStatementFields): string {
  const parts = [
    AUTH_STATEMENT_PREFIX,
    `domain=${fields.domain}`,
    `uri=${fields.uri}`,
    `address=${fields.address}`,
    `network=${fields.network}`,
    `nonce=${fields.nonce}`,
    `iat=${fields.iat}`,
    `exp=${fields.exp}`,
  ];
  if (fields.rid) parts.push(`rid=${fields.rid}`);
  return parts.join(" ");
}

export function parseAuthStatement(text: string): AuthStatementFields | null {
  const tokens = text.split(" ");
  if (tokens[0] !== AUTH_STATEMENT_PREFIX) return null;
  const fields: Record<string, string> = {};
  for (const token of tokens.slice(1)) {
    const index = token.indexOf("=");
    if (index <= 0) return null;
    const key = token.slice(0, index);
    const value = token.slice(index + 1);
    if (value.length === 0 || value.includes("\n")) return null;
    fields[key] = value;
  }
  const iat = Number(fields.iat);
  const exp = Number(fields.exp);
  if (!fields.domain || !fields.uri || !fields.address || !fields.network || !fields.nonce) return null;
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  return {
    domain: fields.domain,
    uri: fields.uri,
    address: fields.address,
    network: fields.network,
    nonce: fields.nonce,
    iat,
    exp,
    rid: fields.rid,
  };
}

export type AuthStatementCheck =
  | { valid: true; fields: AuthStatementFields; framing: FramingName }
  | { valid: false; reason: string };

/**
 * Full server-side check of a wallet sign-in proof. Every condition must pass:
 * signature, domain binding, network, claimed address, statement freshness.
 * The nonce is checked by the caller, which owns the single-use store.
 */
export function verifyAuthStatement(opts: {
  text: string;
  signature: string;
  nettype: BdxNettype;
  expectedDomain: string;
  now?: number;
  clockSkewMs?: number;
}): AuthStatementCheck {
  const fields = parseAuthStatement(opts.text);
  if (!fields) return { valid: false, reason: "statement is not a beldex-auth-v1 message" };
  const now = opts.now ?? Date.now();
  const skew = opts.clockSkewMs ?? 60_000;
  if (fields.exp < now - skew) return { valid: false, reason: "statement has expired" };
  if (fields.iat > now + skew) return { valid: false, reason: "statement is dated in the future" };
  if (fields.exp <= fields.iat) return { valid: false, reason: "statement lifetime is not positive" };
  if (fields.network !== opts.nettype) {
    return { valid: false, reason: `statement was made on ${fields.network}, this app serves ${opts.nettype}` };
  }
  if (fields.domain !== opts.expectedDomain) {
    return { valid: false, reason: `statement is bound to ${fields.domain}, not ${opts.expectedDomain}` };
  }
  const check = verifySpendKeySignature({
    message: opts.text,
    address: fields.address,
    signature: opts.signature,
    nettype: opts.nettype,
  });
  if (!check.valid) return { valid: false, reason: check.reason };
  return { valid: true, fields, framing: check.framing };
}
