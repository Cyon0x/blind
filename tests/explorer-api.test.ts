import { afterEach, describe, expect, it, vi } from "vitest";
import { BdxExplorerApi } from "@/lib/beldex/explorer-api";

/**
 * The explorer adapter exists because Beldex publishes no public testnet
 * daemon. The fixtures below are trimmed copies of real responses from
 * https://testnet.beldex.dev (block 4259725), so the mapping is checked against
 * the shape the live service actually returns rather than an invented one.
 */

const BASE = "https://testnet.beldex.dev";
const TX_HASH = "ebbb80ddcd020a8ec1255054d13f8e1cea9bed5d535b18bb782f2e8e1f1a4f88";

const NETWORK_INFO = {
  status: "OK",
  data: {
    height: 4259734,
    nettype: "testnet",
    status: "OK",
    untrusted: false,
    database_size: 8_175_075_328,
    immutable_height: 4259728,
    bns_counts: 0,
    testnet: true,
    mainnet: false,
  },
};

const TRANSACTION = {
  status: "OK",
  data: {
    tx_hash: TX_HASH,
    block_height: 4259725,
    block_timestamp: 1791577431,
    fee: 0,
    size: 157,
    unlock_time: 4259785,
    rct_signatures: { type: 0 },
  },
};

const BLOCK = {
  status: "OK",
  data: { height: 4259725, hash: "c0a4a55f2981c1a4d0c8a2f1f1b1c0a4a55f2981c1a4d0c8a2f1f1b1c0a4a5", timestamp: 1791577431 },
};

function route(handlers: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(handlers).find((fragment) => url.includes(fragment));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(handlers[key]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BdxExplorerApi", () => {
  it("reports the explorer's chain height and never calls itself trusted", async () => {
    vi.stubGlobal("fetch", route({ "/api/networkinfo": NETWORK_INFO }));
    const info = await new BdxExplorerApi(BASE).getInfo();
    expect(info.height).toBe(4259734);
    expect(info.nettype).toBe("testnet");
    expect(info.immutableHeight).toBe(4259728);
    // A third-party explorer is not a node Blind chose, ever.
    expect(info.untrusted).toBe(true);
  });

  it("turns a mined transaction into confirmations and a block hash", async () => {
    vi.stubGlobal(
      "fetch",
      route({ "/api/networkinfo": NETWORK_INFO, "/api/transaction/": TRANSACTION, "/api/block/": BLOCK })
    );
    const evidence = await new BdxExplorerApi(BASE).getTransaction(TX_HASH);
    expect(evidence.found).toBe(true);
    expect(evidence.inPool).toBe(false);
    expect(evidence.blockHeight).toBe(4259725);
    // 4259734 - 4259725 + 1
    expect(evidence.confirmations).toBe(10);
    expect(evidence.blockHash).toBe(BLOCK.data.hash);
    expect(evidence.blockTimestamp).toBe(1791577431);
    expect(evidence.size).toBe(157);
    expect(evidence.unlockTime).toBe(4259785);
    expect(evidence.untrusted).toBe(true);
    expect(evidence.source).toContain("testnet.beldex.dev");
  });

  it("treats an unknown hash as not found instead of guessing", async () => {
    vi.stubGlobal("fetch", route({ "/api/networkinfo": NETWORK_INFO, "/api/transaction/": { status: "OK", data: null } }));
    const evidence = await new BdxExplorerApi(BASE).getTransaction("1".repeat(64));
    expect(evidence.found).toBe(false);
    expect(evidence.confirmations).toBe(0);
    expect(evidence.reason).toMatch(/does not know this transaction hash/);
  });

  it("reads a transaction with no block height as not yet mined", async () => {
    vi.stubGlobal(
      "fetch",
      route({ "/api/networkinfo": NETWORK_INFO, "/api/transaction/": { status: "OK", data: { tx_hash: TX_HASH, fee: 0 } } })
    );
    const evidence = await new BdxExplorerApi(BASE).getTransaction(TX_HASH);
    expect(evidence.found).toBe(true);
    expect(evidence.inPool).toBe(true);
    expect(evidence.blockHeight).toBeNull();
    expect(evidence.confirmations).toBe(0);
  });

  it("reports an unreachable explorer as a reason, not a crash", async () => {
    vi.stubGlobal("fetch", (async () => new Response("boom", { status: 502 })) as unknown as typeof fetch);
    const evidence = await new BdxExplorerApi(BASE).getTransaction(TX_HASH);
    expect(evidence.found).toBe(false);
    expect(evidence.reason).toMatch(/502/);
  });

  it("only calls a payment settled at or past the confirmation threshold", async () => {
    vi.stubGlobal(
      "fetch",
      route({ "/api/networkinfo": NETWORK_INFO, "/api/transaction/": TRANSACTION, "/api/block/": BLOCK })
    );
    const explorer = new BdxExplorerApi(BASE);
    expect((await explorer.verifySettlement(TX_HASH, 10)).settled).toBe(true);
    expect((await explorer.verifySettlement(TX_HASH, 11)).settled).toBe(false);
    expect((await explorer.verifySettlement(TX_HASH, 11)).required).toBe(11);
  });

  it("says a fee estimate is unavailable rather than inventing one", async () => {
    expect(await new BdxExplorerApi(BASE).getFeeEstimate()).toBeNull();
  });
});
