import { afterEach, describe, expect, it, vi } from "vitest";
import { allocateDepositTarget, findDeposit } from "@/lib/beldex/escrow";
import { BdxWalletRpc, newPaymentId } from "@/lib/beldex/wallet-rpc";

const SUBADDRESS =
  "9vPQ7kt4LCy4sUFo7McuCwSPJ2WdjaVrPA5p1Gvtp6vPi5cde5risUAXNLZZvw52PLi17TKyeNXbFaQu1vB1xu3e21k4JSR";

type Call = { method: string; params: Record<string, unknown> };

/** Answers the way beldex-wallet-rpc does, and records what escrow asked for. */
function stubWallet(transfers: unknown[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const call = JSON.parse(String(init.body)) as Call;
    calls.push(call);
    const result =
      call.method === "create_address"
        ? { address: SUBADDRESS, address_index: 4 }
        : call.method === "get_transfers"
          ? { in: transfers }
          : call.method === "get_height"
            ? { height: 100 }
            : {};
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: "0", result }),
    } as unknown as Response;
  });
  return calls;
}

function wallet() {
  return new BdxWalletRpc({ url: "http://127.0.0.1:29092/json_rpc" });
}

afterEach(() => vi.unstubAllGlobals());

describe("escrow deposit destinations", () => {
  it("hands out a fresh subaddress and never asks Beldex for an integrated address", async () => {
    // Beldex answers "Subaddress shouldn't be used" if an integrated address is
    // built from a subaddress, and a payment id can only ever encode the
    // standard address. Creating a payment therefore allocates a subaddress and
    // nothing else. Regression guard for that.
    const calls = stubWallet();

    const target = await allocateDepositTarget("blind:pay:test", wallet());

    expect(target.address).toBe(SUBADDRESS);
    expect(target.integratedAddress).toBe(SUBADDRESS);
    expect(target.paymentId).toBeNull();
    expect(target.subaddressIndex).toBe(4);
    expect(calls.map((call) => call.method)).toEqual(["create_address"]);
  });

  it("counts only what landed on this payment's subaddress", async () => {
    stubWallet([
      { tx_hash: "aa", amount: "100", height: 95, confirmations: 6, subaddr_index: { major: 0, minor: 5 } },
      { tx_hash: "bb", amount: "40", height: 92, confirmations: 9, subaddr_index: { major: 0, minor: 4 } },
      { tx_hash: "cc", amount: "60", height: 90, confirmations: 11, subaddr_index: { major: 0, minor: 4 } },
    ]);

    const deposit = await findDeposit({ paymentId: null, subaddressIndex: 4 }, wallet());

    expect(deposit).not.toBeNull();
    expect(deposit?.amountAtomic).toBe("100");
    expect(deposit?.txHash).toBe("cc");
    expect(deposit?.blockHeight).toBe(90);
    // 100 (wallet height) - 90 + 1
    expect(deposit?.confirmations).toBe(11);
    expect(deposit?.paymentId).toBeNull();
    expect(deposit?.claimable).toBe(true);
  });

  it("reports an unseen deposit as unseen rather than guessing", async () => {
    stubWallet([{ tx_hash: "aa", amount: "5", height: 99, confirmations: 2, subaddr_index: { major: 0, minor: 9 } }]);

    expect(await findDeposit({ paymentId: null, subaddressIndex: 4 }, wallet())).toBeNull();
  });

  it("holds a deposit back while its output is still locked", async () => {
    stubWallet([
      { tx_hash: "dd", amount: "5", height: 99, confirmations: 2, unlock_time: 1_000_000, subaddr_index: { minor: 4 } },
    ]);

    const deposit = await findDeposit({ paymentId: null, subaddressIndex: 4 }, wallet());

    expect(deposit?.claimable).toBe(false);
    expect(deposit?.reason).toMatch(/not unlocked/);
  });
});

describe("newPaymentId", () => {
  it("is 8 bytes of lowercase hex, the form the wallet accepts", () => {
    expect(newPaymentId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
