import { afterEach, describe, expect, it, vi } from "vitest";
import { allocateDepositTarget } from "@/lib/beldex/escrow";
import { BdxWalletRpc, newPaymentId } from "@/lib/beldex/wallet-rpc";

const ADDRESS =
  "9vPQ7kt4LCy4sUFo7McuCwSPJ2WdjaVrPA5p1Gvtp6vPi5cde5risUAXNLZZvw52PLi17TKyeNXbFaQu1vB1xu3e21k4JSR";
const INTEGRATED =
  "A6658ZhYwUV4sUFo7McuCwSPJ2WdjaVrPA5p1Gvtp6vPi5cde5risUAXNLZZvw52PLi17TKyeNXbFaQu1vB1xu3e2LebbS7Utmk1vcK3AJ";

/** Records what the escrow asks the wallet for, and answers the way Beldex does. */
function stubWallet() {
  const bodies: Array<{ method: string; params: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { method: string; params: Record<string, unknown> };
    bodies.push(body);
    const result =
      body.method === "create_address"
        ? { address: ADDRESS, address_index: 7 }
        : { integrated_address: INTEGRATED, payment_id: body.params.payment_id };
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: "0", result }),
    } as unknown as Response;
  });
  return bodies;
}

function wallet() {
  return new BdxWalletRpc({ url: "http://127.0.0.1:29092/json_rpc" });
}

afterEach(() => vi.unstubAllGlobals());

describe("escrow deposit targets", () => {
  it("labels the deposit with a payment id, because Beldex rejects the call without one", async () => {
    // Monero invents a payment id when a caller omits it; Beldex answers
    // "Payment ID shouldn't be left unspecified" and the whole payment fails to
    // be created. Regression guard for that.
    const bodies = stubWallet();

    const target = await allocateDepositTarget("blind:pay:test", wallet());

    const integrated = bodies.find((call) => call.method === "make_integrated_address");
    expect(integrated).toBeDefined();
    expect(integrated?.params.payment_id).toMatch(/^[0-9a-f]{16}$/);
    expect(target.paymentId).toBe(integrated?.params.payment_id);
    expect(target.integratedAddress).toBe(INTEGRATED);
    expect(target.subaddressIndex).toBe(7);
  });

  it("mints a fresh id per payment, so deposits cannot be merged or confused", async () => {
    const bodies = stubWallet();

    await allocateDepositTarget("blind:pay:a", wallet());
    await allocateDepositTarget("blind:pay:b", wallet());

    const ids = bodies
      .filter((call) => call.method === "make_integrated_address")
      .map((call) => call.params.payment_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("newPaymentId", () => {
  it("is 8 bytes of lowercase hex, the form the wallet accepts", () => {
    expect(newPaymentId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
