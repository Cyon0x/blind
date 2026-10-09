import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { encodeSigV1 } from "@/lib/beldex/sig";

/**
 * TEST-ONLY signer. It implements the same documented construction the wallet
 * uses (Monero's `crypto::generate_signature` over keccak256(message), spend
 * key as the scalar, `SigV1` + monero_base58(c‖r) encoding) so the verifier in
 * src/lib/beldex/sig.ts can be exercised on real arithmetic.
 *
 * This file must never be imported by application code: the app is not allowed
 * to hold a spend key.
 */
const ORDER = ed25519.Point.CURVE().n;

function randomScalar(): bigint {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]);
  return value % ORDER;
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

function hashToScalar(data: Uint8Array): bigint {
  return bytesToBigIntLE(keccak_256(data)) % ORDER;
}

export function signWithSpendKey(opts: {
  message: string;
  spendSecret: bigint;
  spendPublic: Uint8Array;
  framing?: "plain" | "monero-prefix" | "beldex-prefix";
}): string {
  const framing = opts.framing ?? "plain";
  const bytes = Buffer.byteLength(opts.message, "utf8");
  const framed =
    framing === "plain"
      ? opts.message
      : framing === "monero-prefix"
        ? `Monero signed Message:\n${bytes}${opts.message}`
        : `Beldex signed Message:\n${bytes}${opts.message}`;
  const prefixHash = keccak_256(new TextEncoder().encode(framed));

  const k = randomScalar() || 1n;
  const R = ed25519.Point.BASE.multiply(k);
  const Rbytes = R.toBytes();
  // Monero's s_comm struct order: message hash, public key, commitment.
  const digest = new Uint8Array(96);
  digest.set(prefixHash, 0);
  digest.set(opts.spendPublic, 32);
  digest.set(Rbytes, 64);
  const c = hashToScalar(digest);
  // Monero's sc_mulsub: r = k − c·x  (mod l). Distinct from ed25519's k + c·x.
  const s = (((k - c * opts.spendSecret) % ORDER) + ORDER) % ORDER;
  return encodeSigV1(bigIntToBytesLE(c), bigIntToBytesLE(s));
}

/** Spawns a spend keypair the way the wallet core does: P = x·G. */
export function keypairFromSeed(seed: bigint) {
  const spendSecret = seed % ORDER;
  const spendPublic = ed25519.Point.BASE.multiply(spendSecret).toBytes();
  return { spendSecret, spendPublic };
}
