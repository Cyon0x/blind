import { describe, expect, it } from "vitest";
import { encodeAddress } from "@/lib/beldex/address";
import { isIdempotencyInFlight, isUnknownOutcome, sendWithWallet, type WalletSender } from "@/lib/beldex/wallet-send";

/**
 * The keys are the fixtures from `tests/beldex-address.test.ts`, produced by
 * Beldex's own wallet core, so the addresses below are real encodings rather
 * than strings that merely look right.
 */
const SPEND = "1787e64786c2fdb8ff9cd5926f6657af562441bce8ed259115395afefaf7556c";
const VIEW = "49cf1995b9ecc5cf64759932a68748f7854120e65daa3eaf0ba6f803c1d68358";

function unhex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** What the escrow hands a payer: one fresh subaddress per payment. */
const TESTNET_SUBADDRESS = encodeAddress({
  nettype: "testnet",
  kind: "subaddress",
  spendPublicKey: unhex(SPEND),
  viewPublicKey: unhex(VIEW),
});

const MAINNET_STANDARD =
  "bxbz7CtrYjjjSRoE426vcDFfeuCWPk7Ek7HSmm4psZ98FHiBqPHmNLBa61MEgXEupADCsU3nkCVYmBV7SkuDwU1T28QZUERf8";

const KEY = "bp_Pf3kQ2mZ9wLxT7vRb1nHcAe"; // a payment reference: 25 chars

/** A wallet that records what it was asked and answers with a scripted reply. */
function fakeWallet(replies: Array<unknown>) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client: WalletSender = {
    async request(method, params) {
      calls.push({ method, params });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { client, calls };
}

function rpcError(code: number, message: string): Error & { code: number } {
  const error = new Error(message) as Error & { code: number };
  error.code = code;
  return error;
}

const unknownOutcome = () =>
  rpcError(4998, "bdx_sendTransaction timed out — outcome UNKNOWN");
const alreadyInProgress = () =>
  rpcError(-32603, "idempotency key is already in progress");

describe("sending to a testnet destination", () => {
  it("sends to the escrow's testnet subaddress, which the SDK's own guard refuses", async () => {
    // The regression, stated the way the SDK states it. This is `checkAddress()`
    // from @bdxi/web3js@1.0.1 verbatim, and it is the whole of the bug: the
    // escrow's deposit destination is a testnet *subaddress*, whose base58
    // prefix (63) encodes to something beginning with "B", so the guard that
    // only knows mainnet's "bx" throws before the wallet is ever asked —
    //   invalid "to" address: must start with "bx"
    const sdkAccept = (address: string) =>
      address.startsWith("bx") && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
    expect(sdkAccept(TESTNET_SUBADDRESS)).toBe(false);
    expect(sdkAccept(MAINNET_STANDARD)).toBe(true);
    expect(TESTNET_SUBADDRESS).toMatch(/^B/);

    const { client, calls } = fakeWallet([{ txHash: "abc123", fee: "1234" }]);
    const result = await sendWithWallet(client, {
      to: TESTNET_SUBADDRESS,
      amountAtomic: "1250000000",
      idempotencyKey: KEY,
      nettype: "testnet",
    });

    expect(result).toMatchObject({ status: "confirmed", txHash: "abc123", fee: "1234" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("bdx_sendTransaction");
    expect(calls[0].params).toEqual({ to: TESTNET_SUBADDRESS, amount: "1250000000", idempotencyKey: KEY });
  });

  it("refuses a mainnet address before the wallet is ever asked", async () => {
    const { client, calls } = fakeWallet([{ txHash: "abc123" }]);
    await expect(
      sendWithWallet(client, {
        to: MAINNET_STANDARD,
        amountAtomic: "1250000000",
        idempotencyKey: KEY,
        nettype: "testnet",
      })
    ).rejects.toThrow(/not a testnet address/);
    expect(calls).toHaveLength(0);
  });

  it("leaves the decision to the wallet when it will not name its network", async () => {
    const { client, calls } = fakeWallet([{ txHash: "abc123" }]);
    const result = await sendWithWallet(client, {
      to: TESTNET_SUBADDRESS,
      amountAtomic: "1",
      idempotencyKey: KEY,
      nettype: null,
    });
    expect(result).toMatchObject({ status: "confirmed" });
    expect(calls).toHaveLength(1);
  });
});

describe("the checks the SDK used to make", () => {
  it("refuses a decimal where atomic units belong", async () => {
    const { client, calls } = fakeWallet([{ txHash: "abc" }]);
    await expect(
      sendWithWallet(client, { to: TESTNET_SUBADDRESS, amountAtomic: "1.25", idempotencyKey: KEY, nettype: "testnet" })
    ).rejects.toThrow(/whole number of atomic units/);
    expect(calls).toHaveLength(0);
  });

  it("refuses an idempotency key the wallet would reject", async () => {
    const { client } = fakeWallet([{ txHash: "abc" }]);
    await expect(
      sendWithWallet(client, { to: TESTNET_SUBADDRESS, amountAtomic: "1", idempotencyKey: "bp_9Qx2", nettype: "testnet" })
    ).rejects.toThrow(/8-128 characters/);
  });
});

describe("an unknown outcome is never turned into a second payment", () => {
  it("re-asks the wallet with the same key when the approval timed out", async () => {
    const { client, calls } = fakeWallet([unknownOutcome(), { txHash: "abc123" }]);
    const result = await sendWithWallet(client, {
      to: TESTNET_SUBADDRESS,
      amountAtomic: "1",
      idempotencyKey: KEY,
      nettype: "testnet",
      sleep: async () => {},
    });
    expect(result).toMatchObject({ status: "confirmed", txHash: "abc123" });
    expect(calls).toHaveLength(2);
    expect(calls[0].params.idempotencyKey).toBe(KEY);
    expect(calls[1].params.idempotencyKey).toBe(KEY);
  });

  it("treats 'already in progress' as a reason to ask again, not to give up", async () => {
    const { client, calls } = fakeWallet([alreadyInProgress(), alreadyInProgress(), { txHash: "abc123" }]);
    const result = await sendWithWallet(client, {
      to: TESTNET_SUBADDRESS,
      amountAtomic: "1",
      idempotencyKey: KEY,
      nettype: "testnet",
      sleep: async () => {},
    });
    expect(result).toMatchObject({ status: "confirmed" });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((call) => call.params.idempotencyKey))).toEqual(new Set([KEY]));
  });

  it("reports unresolved, with the key to resume from, once the deadline passes", async () => {
    let clock = 0;
    const { client, calls } = fakeWallet([unknownOutcome()]);
    const result = await sendWithWallet(client, {
      to: TESTNET_SUBADDRESS,
      amountAtomic: "1",
      idempotencyKey: KEY,
      nettype: "testnet",
      resolveTimeoutMs: 5_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(result).toEqual({ status: "unresolved", idempotencyKey: KEY });
    expect(calls.length).toBeGreaterThan(1);
  });

  it("passes a declined approval straight through", async () => {
    const { client, calls } = fakeWallet([rpcError(4001, "user rejected the request")]);
    await expect(
      sendWithWallet(client, { to: TESTNET_SUBADDRESS, amountAtomic: "1", idempotencyKey: KEY, nettype: "testnet" })
    ).rejects.toThrow(/user rejected/);
    expect(calls).toHaveLength(1);
  });
});

describe("error classification", () => {
  it("recognises only the SDK's unknown-outcome and in-flight codes", () => {
    expect(isUnknownOutcome(unknownOutcome())).toBe(true);
    expect(isUnknownOutcome(rpcError(4001, "user rejected"))).toBe(false);
    expect(isIdempotencyInFlight(alreadyInProgress())).toBe(true);
    expect(isIdempotencyInFlight(rpcError(-32603, "something else"))).toBe(false);
    expect(isUnknownOutcome(undefined)).toBe(false);
  });
});
