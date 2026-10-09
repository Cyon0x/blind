import { describe, expect, it } from "vitest";
import { formatBdx, fromAtomic, toAtomic } from "@/lib/beldex/units";

describe("BDX units", () => {
  it("converts a display amount to atomic units and back", () => {
    expect(toAtomic("1.25")).toBe(1_250_000_000n);
    expect(toAtomic("0.000000001")).toBe(1n);
    expect(fromAtomic(1_250_000_000n)).toBe("1.25");
    expect(formatBdx("12500000000")).toBe("12.5");
    expect(formatBdx("1234567890123")).toBe("1,234.567890123");
  });

  it("refuses a display value where atomic units belong", () => {
    // This is the mistake that crashed the receipts page: a value that had
    // already been formatted was fed back in as if it were atomic units.
    expect(() => formatBdx("4.2")).toThrow(/atomic units must be an integer/);
    expect(() => fromAtomic("12.5")).toThrow(/atomic units must be an integer/);
  });

  it("refuses amounts it cannot represent exactly", () => {
    expect(() => toAtomic("1.0000000001")).toThrow(/9 decimal places/);
    expect(() => toAtomic("-1")).toThrow(/positive decimal/);
    expect(() => toAtomic("1e3")).toThrow(/positive decimal/);
  });
});
