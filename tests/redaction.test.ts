import { describe, expect, it } from "vitest";
import { paymentView, settlementWording } from "@/lib/views";
import type { PaymentRow } from "@/lib/store";

/** A payment with every field populated, so a leak would have something to leak. */
function row(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "pay_1",
    kind: "pay",
    reference: "bp_1",
    creator_user_id: "payer_user",
    counterparty_user_id: "recipient_user",
    amount_atomic: "12500000000",
    asset: "BDX",
    description: "rent",
    invoice_ref: "INV-9",
    status: "funded",
    expires_at: null,
    deposit_address: "ESCROW_SUBADDRESS",
    deposit_integrated_address: "ESCROW_INTEGRATED",
    deposit_payment_id: "PAYMENT_ID",
    deposit_subaddress_index: 7,
    deposit_tx_hash: "deposit_tx",
    deposit_confirmations: 10,
    deposit_amount_atomic: "12500000000",
    funded_at: "2026-01-01T00:00:00.000Z",
    payout_address: "RECIPIENT_OWN_ADDRESS",
    payout_tx_hash: "payout_tx",
    payout_confirmations: 3,
    settled_at: null,
    claimed_at: null,
    claim_secret_hash: "hash",
    recipient_visibility: "private",
    payout_mode: "escrow",
    failed_reason: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const serialised = (value: unknown) => JSON.stringify(value);

describe("paymentView redaction", () => {
  it("shows the payer their own half and nothing of the recipient's", () => {
    const view = paymentView(row(), "payer_user");
    expect(view.role).toBe("creator");
    expect(view.deposit?.integratedAddress).toBe("ESCROW_INTEGRATED");
    expect(view.payoutAddress).toBeNull();
    expect(serialised(view)).not.toContain("recipient_user");
    expect(serialised(view)).not.toContain("RECIPIENT_OWN_ADDRESS");
  });

  it("shows the recipient their own half and nothing of the payer's", () => {
    const view = paymentView(row(), "recipient_user");
    expect(view.role).toBe("counterparty");
    // The recipient never learns the escrow deposit address either: it is the
    // payer's destination, not theirs.
    expect(view.deposit).toBeNull();
    expect(view.payoutAddress).toBeNull();
    expect(serialised(view)).not.toContain("payer_user");
    expect(serialised(view)).not.toContain("ESCROW_SUBADDRESS");
    expect(serialised(view)).not.toContain("ESCROW_INTEGRATED");
    expect(serialised(view)).not.toContain("deposit_tx");
  });

  it("tells a stranger with the link only the amount, the words and the state", () => {
    const view = paymentView(row(), null);
    expect(view.role).toBe("public");
    expect(view.amountDisplay).toBe("12.5");
    expect(view.description).toBe("rent");
    expect(view.deposit).toBeNull();
    expect(view.payoutAddress).toBeNull();
    expect(view.counterpartyRole).toBe("present");
    for (const secret of ["payer_user", "recipient_user", "ESCROW_INTEGRATED", "escrow_int", "RECIPIENT_OWN_ADDRESS", "deposit_tx", "payout_tx"]) {
      expect(serialised(view)).not.toContain(secret);
    }
  });

  it("gives the requester their own payout address, and no one else's", () => {
    const request = row({ kind: "request", creator_user_id: "asker", counterparty_user_id: "payer_user", payout_address: "ASKER_ADDRESS", status: "awaiting_payment" });
    const asAsker = paymentView(request, "asker");
    expect(asAsker.payoutAddress).toBe("ASKER_ADDRESS");
    expect(paymentView(request, "payer_user").payoutAddress).toBeNull();
    expect(paymentView(request, null).payoutAddress).toBeNull();
    expect(serialised(paymentView(request, "payer_user"))).not.toContain("ASKER_ADDRESS");
  });

  it("does not claim settlement that has not happened", () => {
    expect(settlementWording(paymentView(row(), "payer_user"))).toMatch(/waiting for a claim/);
    expect(settlementWording(paymentView(row({ status: "settled" }), "payer_user"))).toMatch(/verified this against the Beldex chain/);
    expect(settlementWording(paymentView(row({ status: "payout_submitted" }), "payer_user"))).toMatch(/not final yet/);
    expect(settlementWording(paymentView(row({ kind: "request", payout_mode: "direct", status: "settled" }), "asker"))).toMatch(
      /no chain evidence/
    );
  });
});
