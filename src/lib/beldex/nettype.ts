/**
 * Network definitions. The base58 address prefixes are taken from Beldex's own
 * `@bdxi/beldex-nettype` package (BSD-3-Clause, github.com/Beldex-Coin/beldex-utils),
 * so the app can never disagree with the wallets about what a `bx...` string means.
 */
export type BdxNettype = "mainnet" | "testnet" | "devnet";

export type AddressKind = "standard" | "subaddress" | "integrated";

type PrefixTable = Record<AddressKind, number>;

export const NETTYPE_PREFIXES: Record<BdxNettype, PrefixTable> = {
  mainnet: { standard: 0xd1, integrated: 19, subaddress: 42 },
  testnet: { standard: 53, integrated: 54, subaddress: 63 },
  devnet: { standard: 24, integrated: 25, subaddress: 36 },
};

export function isBdxNettype(value: unknown): value is BdxNettype {
  return value === "mainnet" || value === "testnet" || value === "devnet";
}

export function prefixToKind(nettype: BdxNettype, prefix: number): AddressKind | null {
  const table = NETTYPE_PREFIXES[nettype];
  for (const kind of ["standard", "subaddress", "integrated"] as AddressKind[]) {
    if (table[kind] === prefix) return kind;
  }
  return null;
}

/** The kind a prefix belongs to on *any* network, used to report a wrong-network address. */
export function prefixKindAnyNetwork(prefix: number): { nettype: BdxNettype; kind: AddressKind } | null {
  for (const nettype of Object.keys(NETTYPE_PREFIXES) as BdxNettype[]) {
    const kind = prefixToKind(nettype, prefix);
    if (kind) return { nettype, kind };
  }
  return null;
}
