import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engravingSeed, receiptIntegrity, seal, unseal, claimSealingConfigured } from "@/lib/seal";

describe("claim secret sealing", () => {
  const original = process.env.BDX_CLAIM_KEY;

  beforeAll(() => {
    process.env.BDX_CLAIM_KEY = "9".repeat(64);
  });
  afterAll(() => {
    if (original === undefined) delete process.env.BDX_CLAIM_KEY;
    else process.env.BDX_CLAIM_KEY = original;
  });

  it("round-trips a secret and reports that sealing is configured", () => {
    const secret = "a-secret-that-would-be-in-the-fragment";
    const sealed = seal(secret);
    expect(sealed).not.toContain(secret);
    expect(unseal(sealed)).toBe(secret);
    expect(claimSealingConfigured()).toBe(true);
  });

  it("uses a fresh nonce each time, so two seals of one secret differ", () => {
    expect(seal("same")).not.toBe(seal("same"));
  });

  it("refuses to unseal a value that has been tampered with", () => {
    const sealed = seal("claim-me").split(".");
    const data = Buffer.from(sealed[3], "base64url");
    data[0] ^= 0xff;
    const tampered = [sealed[0], sealed[1], sealed[2], data.toString("base64url")].join(".");
    expect(unseal(tampered)).toBeNull();
  });

  it("returns null rather than throwing on junk", () => {
    expect(unseal("not-a-sealed-value")).toBeNull();
    expect(unseal(null)).toBeNull();
  });

  it("will not seal, and says so, when no key is configured", () => {
    delete process.env.BDX_CLAIM_KEY;
    expect(claimSealingConfigured()).toBe(false);
    expect(() => seal("nope")).toThrow(/BDX_CLAIM_KEY/);
    expect(unseal("v1.a.b.c")).toBeNull();
    process.env.BDX_CLAIM_KEY = "9".repeat(64);
  });
});

describe("receipt integrity", () => {
  const fields = {
    asset: "BDX",
    amountAtomic: "1500000000",
    reference: "bp_test",
    depositTxHash: "aa",
    payoutTxHash: "bb",
    blockHeight: 1234,
    side: "payer",
    verified: true,
  };

  it("is stable for the same fields regardless of key order", () => {
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(fields).reverse()) reordered[key] = (fields as Record<string, unknown>)[key];
    expect(receiptIntegrity(reordered)).toBe(receiptIntegrity(fields));
  });

  it("changes when any field changes — so an edit is detectable", () => {
    expect(receiptIntegrity({ ...fields, amountAtomic: "1500000001" })).not.toBe(receiptIntegrity(fields));
    expect(receiptIntegrity({ ...fields, side: "recipient" })).not.toBe(receiptIntegrity(fields));
    expect(receiptIntegrity({ ...fields, verified: false })).not.toBe(receiptIntegrity(fields));
  });

  it("derives a deterministic engraving seed from a reference", () => {
    expect(engravingSeed("bp_x")).toBe(engravingSeed("bp_x"));
    expect(engravingSeed("bp_x")).not.toBe(engravingSeed("bp_y"));
    expect(engravingSeed("bp_x")).toHaveLength(32);
  });
});
