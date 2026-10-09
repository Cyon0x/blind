import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58Decode, base58Encode } from "./base58";
import {
  NETTYPE_PREFIXES,
  prefixKindAnyNetwork,
  prefixToKind,
  type AddressKind,
  type BdxNettype,
} from "./nettype";

export type DecodedAddress = {
  address: string;
  nettype: BdxNettype;
  kind: AddressKind;
  spendPublicKey: Uint8Array;
  viewPublicKey: Uint8Array;
  paymentId: string | null;
  subaddressIndex: { account: number; index: number } | null;
};

/**
 * The network prefix is written as an LEB128 varint, so its length varies with
 * the value: mainnet standard (209) needs two bytes and yields a 97-character
 * `bx...` address, while testnet standard (53) needs one byte and yields 95.
 * Both cases are pinned by fixtures from Beldex's own WASM wallet core in
 * tests/beldex-address.test.ts.
 */
export function varintEncode(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new Error("varint: value must be a non-negative integer");
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest > 0) byte |= 0x80;
    out.push(byte);
  } while (rest > 0);
  return Uint8Array.from(out);
}

export function varintDecode(bytes: Uint8Array): { value: number; length: number } {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (shift > 28) throw new Error("varint: too long");
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if ((byte & 0x80) === 0) return { value, length: i + 1 };
  }
  throw new Error("varint: truncated");
}

function checksum(payload: Uint8Array): Uint8Array {
  return keccak_256(payload).slice(0, 4);
}

export function encodeAddress(opts: {
  nettype: BdxNettype;
  kind: AddressKind;
  spendPublicKey: Uint8Array;
  viewPublicKey: Uint8Array;
  paymentId?: Uint8Array | null;
}): string {
  if (opts.spendPublicKey.length !== 32 || opts.viewPublicKey.length !== 32) {
    throw new Error("encodeAddress: public keys must be 32 bytes each");
  }
  const prefix = varintEncode(NETTYPE_PREFIXES[opts.nettype][opts.kind]);
  const parts: Uint8Array[] = [prefix, opts.spendPublicKey, opts.viewPublicKey];
  if (opts.kind === "integrated") {
    const paymentId = opts.paymentId;
    if (!paymentId || paymentId.length !== 8) {
      throw new Error("encodeAddress: integrated addresses carry an 8-byte payment id");
    }
    parts.push(paymentId);
  }
  const body = concat(parts);
  return base58Encode(concat([body, checksum(body)]));
}

/** Produces the 8-byte payment id used by `encodeAddress` for integrated addresses. */
export function paymentIdFromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(clean)) throw new Error("payment id must be 8 bytes of hex");
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export type AddressProblem =
  | { ok: true; decoded: DecodedAddress }
  | { ok: false; reason: string; wrongNetwork?: BdxNettype };

/**
 * Full structural validation: base58, checksum, network prefix, key lengths.
 * The wallet re-validates before signing regardless — this only stops the app
 * from ever showing a user an address it cannot account for.
 */
export function decodeAddress(address: string, expectedNettype: BdxNettype): AddressProblem {
  let raw: Uint8Array;
  try {
    raw = base58Decode(address);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "not base58" };
  }
  let prefix = -1;
  let length = 0;
  try {
    const parsed = varintDecode(raw);
    prefix = parsed.value;
    length = parsed.length;
  } catch {
    return { ok: false, reason: "address prefix is not a valid varint" };
  }
  const remainder = raw.length - length;
  if (remainder !== 68 && remainder !== 76) {
    return { ok: false, reason: "address payload has an unexpected length" };
  }
  const body = raw.slice(0, raw.length - 4);
  const given = raw.slice(raw.length - 4);
  const expected = checksum(body);
  for (let i = 0; i < 4; i += 1) {
    if (given[i] !== expected[i]) return { ok: false, reason: "address checksum does not match" };
  }

  const kind = prefixToKind(expectedNettype, prefix);
  if (!kind) {
    const elsewhere = prefixKindAnyNetwork(prefix);
    return {
      ok: false,
      reason: elsewhere
        ? `this is a ${elsewhere.nettype} address, but the app is configured for ${expectedNettype}`
        : "address prefix does not belong to any Beldex network",
      wrongNetwork: elsewhere?.nettype,
    };
  }

  const spendPublicKey = raw.slice(length, length + 32);
  const viewPublicKey = raw.slice(length + 32, length + 64);
  const paymentId =
    remainder === 76 ? toHex(raw.slice(length + 64, length + 72)) : null;

  return {
    ok: true,
    decoded: {
      address,
      nettype: expectedNettype,
      kind,
      spendPublicKey,
      viewPublicKey,
      paymentId,
      subaddressIndex: null,
    },
  };
}

export function isValidAddress(address: string, nettype: BdxNettype): boolean {
  return decodeAddress(address, nettype).ok;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export { concat as concatBytes };

/** Short form used in UI only: never in a signed payload or a claim link. */
export function shortenAddress(address: string, head = 8, tail = 6): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
