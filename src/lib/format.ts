/** Display formatting shared by client components (atomic units → BDX). */
const ATOMIC_PER_BDX = 1_000_000_000n;

export function formatAtomic(atomic: bigint | string): string {
  const value = typeof atomic === "string" ? BigInt(atomic) : atomic;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / ATOMIC_PER_BDX;
  const fraction = (abs % ATOMIC_PER_BDX).toString().padStart(9, "0").replace(/0+$/, "");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fraction ? `${grouped}.${fraction}` : grouped;
  return negative ? `-${body}` : body;
}

export function toAtomicString(display: string): bigint {
  const text = display.trim();
  if (!/^\d+(\.\d{0,9})?$/.test(text)) throw new Error("Enter a number with up to 9 decimals.");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * ATOMIC_PER_BDX + BigInt(fraction.padEnd(9, "0") || "0");
}

export function shortAddress(address: string, head = 8, tail = 6): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function untilLabel(iso: string | null): string | null {
  if (!iso) return null;
  const delta = new Date(iso).getTime() - Date.now();
  if (delta <= 0) return "expired";
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 1) return `expires in ${Math.max(1, Math.round(delta / 60_000))}m`;
  if (hours < 48) return `expires in ${hours}h`;
  return `expires in ${Math.round(hours / 24)}d`;
}
