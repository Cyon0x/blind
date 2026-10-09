export const ATOMIC_PER_BDX = 1_000_000_000n;
export const BDX_DECIMALS = 9;

/** Display BDX ("1.25") → atomic units. Rejects anything that is not exact. */
export function toAtomic(value: string): bigint {
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("amount must be a positive decimal number");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > BDX_DECIMALS) throw new Error("BDX has at most 9 decimal places");
  const padded = fraction.padEnd(BDX_DECIMALS, "0");
  return BigInt(whole) * ATOMIC_PER_BDX + BigInt(padded === "" ? "0" : padded);
}

/** Atomic units → display BDX, trailing zeros trimmed. */
export function fromAtomic(atomic: bigint | string): string {
  const value = typeof atomic === "string" ? bigintFrom(atomic) : atomic;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / ATOMIC_PER_BDX;
  const fraction = (abs % ATOMIC_PER_BDX).toString().padStart(BDX_DECIMALS, "0").replace(/0+$/, "");
  const body = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${body}` : body;
}

/**
 * Atomic units are integers. A decimal string here means a display value has
 * been passed where an amount was expected, which would otherwise surface as a
 * bare `SyntaxError: Cannot convert 4.2 to a BigInt` from inside a render.
 */
function bigintFrom(text: string): bigint {
  if (!/^-?\d+$/.test(text.trim())) {
    throw new Error(`atomic units must be an integer, received "${text}"`);
  }
  return BigInt(text.trim());
}

export function isPositiveAtomic(value: bigint | string): boolean {
  const atomic = typeof value === "string" ? BigInt(value) : value;
  return atomic > 0n;
}

/** Beldex-style grouping for display: 12,345.678901234 */
export function formatBdx(atomic: bigint | string): string {
  const display = fromAtomic(atomic);
  const [whole, fraction] = display.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}
