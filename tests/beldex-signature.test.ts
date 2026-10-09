import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { encodeAddress } from "@/lib/beldex/address";
import {
  buildAuthStatement,
  decodeSigV1,
  encodeSigV1,
  isSigV1,
  parseAuthStatement,
  verifyAuthStatement,
  verifySpendKeySignature,
} from "@/lib/beldex/sig";
import { keypairFromSeed, signWithSpendKey } from "./helpers/sig-signer";

const ACCOUNT = keypairFromSeed(12345678901234567890123456789012345678901234567890n);
const VIEW_PUBLIC = ed25519.Point.BASE.multiply(98765432109876543210987654321098765432109876543210n).toBytes();
const ADDRESS = encodeAddress({
  nettype: "mainnet",
  kind: "standard",
  spendPublicKey: ACCOUNT.spendPublic,
  viewPublicKey: VIEW_PUBLIC,
});

function sign(message: string, framing: "plain" | "monero-prefix" | "beldex-prefix" = "plain") {
  return signWithSpendKey({
    message,
    spendSecret: ACCOUNT.spendSecret,
    spendPublic: ACCOUNT.spendPublic,
    framing,
  });
}

describe("SigV1 envelope", () => {
  it("is monero base58 of (c ‖ r) behind the SigV1 tag", () => {
    const signature = sign("hello blind");
    expect(isSigV1(signature)).toBe(true);
    const parts = decodeSigV1(signature);
    expect(parts).not.toBeNull();
    expect(parts?.c).toHaveLength(32);
    expect(parts?.r).toHaveLength(32);
    if (parts) expect(encodeSigV1(parts.c, parts.r)).toBe(signature);
  });

  it("rejects a signature whose scalars are not canonical", () => {
    // '1' is the zero digit of the Monero alphabet, so this decodes to c = r = 0:
    // decodable, but the verifier must refuse it (Monero requires a nonzero c).
    expect(decodeSigV1(`SigV1${"1".repeat(88)}`)).not.toBeNull();
    const allZero = decodeSigV1(`SigV1${"1".repeat(88)}`);
    if (allZero) {
      const zeroed = verifySpendKeySignature({
        message: "anything",
        address: ADDRESS,
        signature: encodeSigV1(allZero.c, allZero.r),
        nettype: "mainnet",
      });
      expect(zeroed.valid).toBe(false);
    }
    expect(decodeSigV1("notasignature")).toBeNull();
    expect(decodeSigV1(`SigV1${"z".repeat(88)}`)).toBeNull();
  });
});

describe("spend-key signature verification", () => {
  it("accepts a signature made with the address's spend key", () => {
    const message = "Blind login challenge #1";
    const result = verifySpendKeySignature({
      message,
      address: ADDRESS,
      signature: sign(message),
      nettype: "mainnet",
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.framing).toBe("plain");
  });

  it("rejects the same signature for a different message", () => {
    const result = verifySpendKeySignature({
      message: "Blind login challenge #2",
      address: ADDRESS,
      signature: sign("Blind login challenge #1"),
      nettype: "mainnet",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a signature from a different spend key", () => {
    const other = keypairFromSeed(77777777777777777777777777777777777777777777777n);
    const message = "Blind login challenge #3";
    const foreign = signWithSpendKey({
      message,
      spendSecret: other.spendSecret,
      spendPublic: other.spendPublic,
    });
    const result = verifySpendKeySignature({ message, address: ADDRESS, signature: foreign, nettype: "mainnet" });
    expect(result.valid).toBe(false);
  });

  it("rejects a tampered scalar", () => {
    const message = "Blind login challenge #4";
    const parts = decodeSigV1(sign(message));
    expect(parts).not.toBeNull();
    if (!parts) return;
    parts.c[5] ^= 0x01;
    const result = verifySpendKeySignature({
      message,
      address: ADDRESS,
      signature: encodeSigV1(parts.c, parts.r),
      nettype: "mainnet",
    });
    expect(result.valid).toBe(false);
  });

  it("accepts the Monero-style prefixed framing a wallet build may apply", () => {
    const message = "Blind login challenge #5";
    const result = verifySpendKeySignature({
      message,
      address: ADDRESS,
      signature: sign(message, "monero-prefix"),
      nettype: "mainnet",
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.framing).toBe("monero-prefix");
  });

  it("refuses to verify against an address on the wrong network", () => {
    const message = "Blind login challenge #6";
    const result = verifySpendKeySignature({
      message,
      address: ADDRESS,
      signature: sign(message),
      nettype: "testnet",
    });
    expect(result.valid).toBe(false);
  });

  it("verifies the longest statement the wallet will sign (512 chars)", () => {
    const message = "a".repeat(512);
    expect(keccak_256(new TextEncoder().encode(message))).toHaveLength(32);
    const result = verifySpendKeySignature({
      message,
      address: ADDRESS,
      signature: sign(message),
      nettype: "mainnet",
    });
    expect(result.valid).toBe(true);
  });
});

describe("beldex-auth-v1 statements", () => {
  const fields = {
    domain: "blind.app",
    uri: "https://blind.app/signin",
    address: ADDRESS,
    network: "mainnet",
    nonce: "nonce-abc-12345678",
    iat: 1_800_000_000_000,
    exp: 1_800_000_300_000,
    rid: "req-1",
  };

  it("round-trips through build and parse", () => {
    const text = buildAuthStatement(fields);
    expect(text.startsWith("beldex-auth-v1 ")).toBe(true);
    expect(text).not.toContain("\n");
    expect(parseAuthStatement(text)).toEqual(fields);
  });

  it("rejects a statement that is not a beldex-auth-v1 message", () => {
    expect(parseAuthStatement("sign in please")).toBeNull();
    expect(parseAuthStatement("beldex-auth-v1 domain=a uri=b")).toBeNull();
  });

  it("accepts a correctly bound, fresh, correctly signed statement", () => {
    const text = buildAuthStatement(fields);
    const result = verifyAuthStatement({
      text,
      signature: sign(text),
      nettype: "mainnet",
      expectedDomains: ["blind.app"],
      now: fields.iat + 1_000,
    });
    expect(result.valid).toBe(true);
  });

  it("refuses a statement replayed to another domain", () => {
    const text = buildAuthStatement(fields);
    const result = verifyAuthStatement({
      text,
      signature: sign(text),
      nettype: "mainnet",
      expectedDomains: ["evil.example"],
      now: fields.iat + 1_000,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("bound to");
  });

  it("accepts the origin form of the same domain the wallet actually sends", () => {
    // The Beldex Wallet writes the page origin into `domain`
    // ("https://blind.app") while the server holds the bare host ("blind.app").
    // Rejecting that made wallet sign-in impossible on the deployed site.
    const originFields = { ...fields, domain: "https://blind.app", uri: "https://blind.app/signin" };
    const text = buildAuthStatement(originFields);
    const result = verifyAuthStatement({
      text,
      signature: sign(text),
      nettype: "mainnet",
      expectedDomains: ["blind.app"],
      now: fields.iat + 1_000,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a host-with-port from either side", () => {
    const localFields = { ...fields, domain: "http://localhost:3000", uri: "http://localhost:3000/signin" };
    const text = buildAuthStatement(localFields);
    const result = verifyAuthStatement({
      text,
      signature: sign(text),
      nettype: "mainnet",
      expectedDomains: ["localhost:3000"],
      now: fields.iat + 1_000,
    });
    expect(result.valid).toBe(true);
  });

  it("still refuses a lookalike host that merely contains ours", () => {
    for (const domain of ["https://blind.app.example.com", "blind.app.evil.example", "https://blind-app"]) {
      const text = buildAuthStatement({ ...fields, domain });
      const result = verifyAuthStatement({
        text,
        signature: sign(text),
        nettype: "mainnet",
        expectedDomains: ["blind.app"],
        now: fields.iat + 1_000,
      });
      expect(result.valid, `${domain} must not pass`).toBe(false);
    }
  });

  it("leaves a non-web uri alone, since it names no site", () => {
    // An extension page is not claiming a web origin; refusing it would break
    // sign-in for a wallet that reports where it was, not which site it served.
    const text = buildAuthStatement({ ...fields, uri: "chrome-extension://abcdefghijklmnop/signin" });
    const result = verifyAuthStatement({
      text,
      signature: sign(text),
      nettype: "mainnet",
      expectedDomains: ["blind.app"],
      now: fields.iat + 1_000,
    });
    expect(result.valid).toBe(true);
  });

  it("refuses a statement whose uri points at another site", () => {
    const text = buildAuthStatement({ ...fields, uri: "https://evil.example/signin" });
    const result = verifyAuthStatement({
      text,
      signature: sign(text),
      nettype: "mainnet",
      expectedDomains: ["blind.app"],
      now: fields.iat + 1_000,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/uri points at evil\.example/);
  });

  it("refuses every statement when the deployment cannot name its own site", () => {
    // authDomains() is empty when neither APP_URL nor the request host names a
    // site we serve; nothing can legitimately satisfy that, so nothing may pass.
    const text = buildAuthStatement(fields);
    const result = verifyAuthStatement({
      text,
      signature: sign(text),
      nettype: "mainnet",
      expectedDomains: [],
      now: fields.iat + 1_000,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("no configured site");
  });

  it("refuses an expired statement", () => {
    const text = buildAuthStatement(fields);
    const result = verifyAuthStatement({
      text,
      signature: sign(text),
      nettype: "mainnet",
      expectedDomains: ["blind.app"],
      now: fields.exp + 600_000,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("expired");
  });

  it("refuses a statement signed by a different wallet than the one it names", () => {
    const other = keypairFromSeed(42424242424242424242424242424242424242424242n);
    const text = buildAuthStatement(fields);
    const foreign = signWithSpendKey({
      message: text,
      spendSecret: other.spendSecret,
      spendPublic: other.spendPublic,
    });
    const result = verifyAuthStatement({
      text,
      signature: foreign,
      nettype: "mainnet",
      expectedDomains: ["blind.app"],
      now: fields.iat + 1_000,
    });
    expect(result.valid).toBe(false);
  });
});
