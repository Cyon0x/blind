import { beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "./helpers/database";
import * as store from "@/lib/store";
import { claimLinkFor } from "@/lib/payments";
import { hashClaimSecret, newClaimSecret } from "@/lib/claim-secret";
import { seal } from "@/lib/seal";

beforeAll(async () => {
  await testDatabase();
  process.env.BDX_CLAIM_KEY = "7".repeat(64);
  process.env.APP_URL = "https://blind.test";
});

let counter = 0;
const uniq = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(counter += 1)}`;

async function aUser() {
  const name = uniq("user").replace(/_/g, "").slice(0, 20);
  return store.createUser({ displayName: name, username: name });
}

async function aPayment(kind: "pay" | "request", extra: Partial<Parameters<typeof store.createPaymentRow>[0]> = {}) {
  const user = await aUser();
  const secret = newClaimSecret();
  const payment = await store.createPaymentRow({
    kind,
    reference: uniq(kind === "pay" ? "bp" : "br"),
    creatorUserId: user.id,
    amountAtomic: "1000000000",
    claimSecretHash: kind === "pay" ? hashClaimSecret(secret) : null,
    payoutAddress: kind === "request" ? "fake-address" : null,
    payoutMode: "escrow",
    ...extra,
  });
  return { user, payment, secret };
}

describe("Blind Pay state machine", () => {
  it("starting state is created, and funding is a one-shot transition", async () => {
    const { payment } = await aPayment("pay");
    expect(payment.status).toBe("created");

    const first = await store.markFunded({ paymentId: payment.id, txHash: "tx1", amountAtomic: "1000000000", confirmations: 10 });
    expect(first?.status).toBe("funded");
    expect(first?.funded_at).toBeTruthy();

    // A replayed observation must not move money a second time.
    const second = await store.markFunded({ paymentId: payment.id, txHash: "tx2", amountAtomic: "9999999999", confirmations: 99 });
    expect(second).toBeNull();
    const current = await store.getPaymentById(payment.id);
    expect(current?.deposit_tx_hash).toBe("tx1");
    expect(current?.deposit_amount_atomic).toBe("1000000000");
  });

  it("only one claimer can win, and only with the right secret", async () => {
    const { payment, secret } = await aPayment("pay");
    await store.markFunded({ paymentId: payment.id, txHash: "tx", amountAtomic: "1000000000", confirmations: 10 });
    const address = "bx".padEnd(97, "a");

    const wrong = await store.beginClaim({ paymentId: payment.id, secretHash: hashClaimSecret("not-the-secret"), payoutAddress: address });
    expect(wrong).toBeNull();

    const won = await store.beginClaim({ paymentId: payment.id, secretHash: hashClaimSecret(secret), payoutAddress: address });
    expect(won?.status).toBe("claim_pending");
    expect(won?.payout_address).toBe(address);

    const lost = await store.beginClaim({ paymentId: payment.id, secretHash: hashClaimSecret(secret), payoutAddress: "bx".padEnd(97, "b") });
    expect(lost).toBeNull();
    const current = await store.getPaymentById(payment.id);
    expect(current?.payout_address).toBe(address);
  });

  it("refuses to claim a payment that was never funded", async () => {
    const { payment, secret } = await aPayment("pay");
    const attempt = await store.beginClaim({ paymentId: payment.id, secretHash: hashClaimSecret(secret), payoutAddress: "bx".padEnd(97, "a") });
    expect(attempt).toBeNull();
  });

  it("refuses to claim an expired payment", async () => {
    const { user, payment, secret } = await aPayment("pay", { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await store.markFunded({ paymentId: payment.id, txHash: "tx", amountAtomic: "1000000000", confirmations: 10 });
    const attempt = await store.beginClaim({ paymentId: payment.id, secretHash: hashClaimSecret(secret), payoutAddress: "bx".padEnd(97, "a") });
    expect(attempt).toBeNull();
    expect(user.id).toBeTruthy();
  });
});

describe("Blind Request state machine", () => {
  it("a payer's deposit advances a request, and never a link of the other kind", async () => {
    const { payment } = await aPayment("request");
    expect(payment.status).toBe("awaiting_payment");

    // The payment-link transition must not match a request row.
    expect(await store.markFunded({ paymentId: payment.id, txHash: "tx", amountAtomic: "1", confirmations: 5 })).toBeNull();

    const funded = await store.markRequestFunded({ paymentId: payment.id, txHash: "tx", amountAtomic: "1000000000", confirmations: 10 });
    expect(funded?.status).toBe("funded");
    expect(await store.markRequestFunded({ paymentId: payment.id, txHash: "tx2", amountAtomic: "1", confirmations: 5 })).toBeNull();
  });

  it("a payment link is never advanced by the request transition", async () => {
    const { payment } = await aPayment("pay");
    expect(await store.markRequestFunded({ paymentId: payment.id, txHash: "tx", amountAtomic: "1", confirmations: 5 })).toBeNull();
  });
});

describe("concurrency guards", () => {
  it("reserves exactly one payout slot per payment and kind", async () => {
    const { payment } = await aPayment("pay");
    const first = await store.beginPayoutOperation({
      paymentId: payment.id, kind: "payout", idempotencyKey: `${payment.reference}:payout`, toAddress: "bx".padEnd(97, "a"), amountAtomic: "1000000000",
    });
    const second = await store.beginPayoutOperation({
      paymentId: payment.id, kind: "payout", idempotencyKey: `${payment.reference}:payout`, toAddress: "bx".padEnd(97, "b"), amountAtomic: "1",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.operation.id).toBe(first.operation.id);
    expect(second.operation.to_address).toBe("bx".padEnd(97, "a"));
  });

  it("issues one receipt per (payment, side) however often it is asked", async () => {
    const { payment } = await aPayment("pay");
    const base = {
      paymentId: payment.id, ownerUserId: payment.creator_user_id, amountAtomic: "1000000000",
      settlementTxHash: "tx", settlementConfirmations: 10, settlementBlockHeight: "5", settlementBlockHash: null,
      settlementVerified: true, integrityHash: "hash", engravingSeed: "seed", payload: { side: "payer" },
    };
    const first = await store.insertReceipt({ reference: uniq("rc"), side: "payer", ...base });
    const second = await store.insertReceipt({ reference: uniq("rc"), side: "payer", ...base });
    expect(first?.reference).toBeTruthy();
    expect(second).toBeNull();
  });

  it("fails a rate-limit window closed after the allowance", async () => {
    const bucket = uniq("bucket");
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await store.consumeRateLimit(bucket, 3, 60_000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
  });
});

describe("expiry", () => {
  it("retires an expired, unfunded link but never one holding money", async () => {
    const stale = await aPayment("pay", { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const held = await aPayment("pay", { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    await store.markFunded({ paymentId: held.payment.id, txHash: "tx", amountAtomic: "1000000000", confirmations: 10 });

    await store.expireStalePayments(50);

    expect((await store.getPaymentById(stale.payment.id))?.status).toBe("expired");
    expect((await store.getPaymentById(held.payment.id))?.status).toBe("funded");
  });
});

describe("claim-link disclosure", () => {
  it("gives a claim link to the payer who created the payment", async () => {
    const { user, payment } = await aPayment("pay");
    const secret = newClaimSecret();
    await store.getPaymentByReference(payment.reference);
    const { query } = await import("@/lib/db");
    await query("update payments set claim_secret_hash = $2, claim_secret_sealed = $3 where id = $1", [
      payment.id, hashClaimSecret(secret), seal(secret),
    ]);
    const link = await claimLinkFor({ ...payment, claim_secret_hash: hashClaimSecret(secret) }, user.id);
    expect(link.url).toBe(`https://blind.test/claim/${payment.reference}#${secret}`);
  });

  it("never hands an addressed payment's link to the payer", async () => {
    const { user, payment } = await aPayment("pay");
    const recipient = await aUser();
    const secret = newClaimSecret();
    const { query } = await import("@/lib/db");
    await query("update payments set counterparty_user_id = $2, claim_secret_sealed = $3 where id = $1", [
      payment.id, recipient.id, seal(secret),
    ]);

    const forPayer = await claimLinkFor({ ...payment, counterparty_user_id: recipient.id }, user.id);
    expect(forPayer.url).toBeNull();
    expect(forPayer.reason).toMatch(/addressed to someone else/);

    const forRecipient = await claimLinkFor({ ...payment, counterparty_user_id: recipient.id }, recipient.id);
    expect(forRecipient.url).toBe(`https://blind.test/claim/${payment.reference}#${secret}`);

    // A stranger gets nothing, whatever state the payment is in.
    const stranger = await aUser();
    expect((await claimLinkFor({ ...payment, counterparty_user_id: recipient.id }, stranger.id)).url).toBeNull();
  });

  it("refuses a request row outright", async () => {
    const { user, payment } = await aPayment("request");
    expect((await claimLinkFor(payment, user.id)).url).toBeNull();
  });
});
