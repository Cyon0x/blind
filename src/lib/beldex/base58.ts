/**
 * Monero/Beldex base58. Not Bitcoin base58: input is processed in 8-byte
 * blocks, each block becoming 11 characters (and the final partial block
 * becoming 2, 3, 5, 6, 7, 9 or 10). Both ends of this file are pinned by the
 * address fixture in tests/beldex-address.test.ts, which decodes a real
 * mainnet address published by Beldex.
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const FULL_BLOCK_SIZE = 8;
const FULL_ENCODED_BLOCK_SIZE = 11;
const ENCODED_BLOCK_SIZES: readonly number[] = [0, 2, 3, 5, 6, 7, 9, 10, 11];
const DECODED_BLOCK_SIZES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const DECODE_MAP = (() => {
  const map = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) map[ALPHABET.charCodeAt(i)] = i;
  return map;
})();

function decodeChar(code: number): number {
  const value = code < 128 ? DECODE_MAP[code] : -1;
  if (value < 0) throw new Error("base58: character outside the Monero alphabet");
  return value;
}

function encodeBlock(bytes: Uint8Array, offset: number, size: number): string {
  let num = 0n;
  for (let i = 0; i < size; i += 1) {
    num = (num << 8n) | BigInt(bytes[offset + i]);
  }
  const out = new Array<string>(ENCODED_BLOCK_SIZES[size]);
  for (let i = ENCODED_BLOCK_SIZES[size] - 1; i >= 0; i -= 1) {
    out[i] = ALPHABET[Number(num % 58n)];
    num /= 58n;
  }
  return out.join("");
}

function decodeBlock(text: string, offset: number, charCount: number, byteCount: number): Uint8Array {
  let num = 0n;
  for (let i = 0; i < charCount; i += 1) {
    num = num * 58n + BigInt(decodeChar(text.charCodeAt(offset + i)));
  }
  const length = byteCount;
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = Number(num & 0xffn);
    num >>= 8n;
  }
  if (num !== 0n) throw new Error("base58: block does not fit the decoded size");
  return out;
}

export function base58Encode(data: Uint8Array): string {
  let out = "";
  let offset = 0;
  for (; offset + FULL_BLOCK_SIZE <= data.length; offset += FULL_BLOCK_SIZE) {
    out += encodeBlock(data, offset, FULL_BLOCK_SIZE);
  }
  const remainder = data.length - offset;
  if (remainder > 0) out += encodeBlock(data, offset, remainder);
  return out;
}

export function base58Decode(text: string): Uint8Array {
  const size = text.length;
  const fullBlocks = Math.floor(size / FULL_ENCODED_BLOCK_SIZE);
  const lastBlockSize = size % FULL_ENCODED_BLOCK_SIZE;
  const lastBlockIndex = lastBlockSize === 0 ? 0 : ENCODED_BLOCK_SIZES.indexOf(lastBlockSize);
  if (lastBlockIndex < 0) {
    throw new Error("base58: input length does not match a valid block layout");
  }
  const out = new Uint8Array(fullBlocks * FULL_BLOCK_SIZE + DECODED_BLOCK_SIZES[lastBlockIndex]);
  let offset = 0;
  let written = 0;
  for (; offset + FULL_ENCODED_BLOCK_SIZE <= size; offset += FULL_ENCODED_BLOCK_SIZE) {
    out.set(decodeBlock(text, offset, FULL_ENCODED_BLOCK_SIZE, FULL_BLOCK_SIZE), written);
    written += FULL_BLOCK_SIZE;
  }
  if (lastBlockSize > 0) {
    out.set(decodeBlock(text, offset, lastBlockSize, DECODED_BLOCK_SIZES[lastBlockIndex]), written);
  }
  return out;
}
