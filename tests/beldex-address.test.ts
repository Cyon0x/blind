import { describe, expect, it } from "vitest";
import { base58Decode, base58Encode } from "@/lib/beldex/base58";
import { decodeAddress, encodeAddress, paymentIdFromHex, varintDecode, varintEncode } from "@/lib/beldex/address";

/**
 * Addresses below were produced by Beldex's own wallet core — the same C++
 * wallet code the mobile, desktop and extension wallets run — through
 * `@bdxi/beldex-app-bridge` (address_and_keys_from_seed with the fixed seed
 * 0011…eeff). Regenerate with: node scripts/bdx/fixtures.mjs
 */
const MAINNET = {
  address: "bxbz7CtrYjjjSRoE426vcDFfeuCWPk7Ek7HSmm4psZ98FHiBqPHmNLBa61MEgXEupADCsU3nkCVYmBV7SkuDwU1T28QZUERf8",
  spend: "1787e64786c2fdb8ff9cd5926f6657af562441bce8ed259115395afefaf7556c",
  view: "49cf1995b9ecc5cf64759932a68748f7854120e65daa3eaf0ba6f803c1d68358",
};
const TESTNET = {
  address: "9t4NTtku1BAXwibCCepiUnWKz3pHymo3SRGVBftA9Jk4K7XsiEqsk3Nbgy3VeHCNeTiQG2nCeHDvVWHAKsHLf4eNB2fMbfR",
  spend: "1787e64786c2fdb8ff9cd5926f6657af562441bce8ed259115395afefaf7556c",
  view: "49cf1995b9ecc5cf64759932a68748f7854120e65daa3eaf0ba6f803c1d68358",
};

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function unhex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe("monero base58", () => {
  it("round-trips every block length the format allows", () => {
    for (const length of [1, 2, 3, 5, 6, 7, 8, 9, 16, 31, 32, 64, 69, 70]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      expect(Array.from(base58Decode(base58Encode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base58Decode("0OIl")).toThrow();
  });
});

describe("address codec against Beldex's own wallet core", () => {
  it("decodes the mainnet fixture (two-byte varint prefix)", () => {
    const raw = base58Decode(MAINNET.address);
    expect(raw).toHaveLength(70);
    const result = decodeAddress(MAINNET.address, "mainnet");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decoded.kind).toBe("standard");
    expect(hex(result.decoded.spendPublicKey)).toBe(MAINNET.spend);
    expect(hex(result.decoded.viewPublicKey)).toBe(MAINNET.view);
  });

  it("decodes the testnet fixture (one-byte varint prefix)", () => {
    const raw = base58Decode(TESTNET.address);
    expect(raw).toHaveLength(69);
    const result = decodeAddress(TESTNET.address, "testnet");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decoded.kind).toBe("standard");
    expect(hex(result.decoded.spendPublicKey)).toBe(TESTNET.spend);
  });

  it("re-encodes both fixtures byte-for-byte", () => {
    expect(
      encodeAddress({
        nettype: "mainnet",
        kind: "standard",
        spendPublicKey: unhex(MAINNET.spend),
        viewPublicKey: unhex(MAINNET.view),
      })
    ).toBe(MAINNET.address);
    expect(
      encodeAddress({
        nettype: "testnet",
        kind: "standard",
        spendPublicKey: unhex(TESTNET.spend),
        viewPublicKey: unhex(TESTNET.view),
      })
    ).toBe(TESTNET.address);
  });

  it("names the wrong network instead of silently accepting it", () => {
    const mainnetOnTestnet = decodeAddress(MAINNET.address, "testnet");
    expect(mainnetOnTestnet.ok).toBe(false);
    if (!mainnetOnTestnet.ok) expect(mainnetOnTestnet.wrongNetwork).toBe("mainnet");

    const testnetOnMainnet = decodeAddress(TESTNET.address, "mainnet");
    expect(testnetOnMainnet.ok).toBe(false);
    if (!testnetOnMainnet.ok) expect(testnetOnMainnet.wrongNetwork).toBe("testnet");
  });

  it("rejects a tampered checksum", () => {
    const mangled = MAINNET.address.slice(0, -2) + (MAINNET.address.endsWith("f8") ? "f9" : "f8");
    expect(decodeAddress(mangled, "mainnet").ok).toBe(false);
  });

  it("rejects garbage without throwing", () => {
    for (const bad of ["", "bx", "1", "not an address", "0".repeat(97)]) {
      expect(decodeAddress(bad, "mainnet").ok).toBe(false);
    }
  });

  it("round-trips subaddresses and integrated addresses", () => {
    const keys = { spendPublicKey: unhex(MAINNET.spend), viewPublicKey: unhex(MAINNET.view) };
    const subaddress = encodeAddress({ nettype: "mainnet", kind: "subaddress", ...keys });
    const decodedSub = decodeAddress(subaddress, "mainnet");
    expect(decodedSub.ok).toBe(true);
    if (decodedSub.ok) expect(decodedSub.decoded.kind).toBe("subaddress");

    const integrated = encodeAddress({
      nettype: "mainnet",
      kind: "integrated",
      ...keys,
      paymentId: paymentIdFromHex("0011223344556677"),
    });
    const decodedIntegrated = decodeAddress(integrated, "mainnet");
    expect(decodedIntegrated.ok).toBe(true);
    if (decodedIntegrated.ok) {
      expect(decodedIntegrated.decoded.kind).toBe("integrated");
      expect(decodedIntegrated.decoded.paymentId).toBe("0011223344556677");
    }
  });
});

describe("varint", () => {
  it("round-trips every prefix the network table uses", () => {
    for (const value of [0xd1, 19, 42, 53, 54, 63, 24, 25, 36]) {
      const encoded = varintEncode(value);
      expect(varintDecode(encoded)).toEqual({ value, length: encoded.length });
    }
  });
});
