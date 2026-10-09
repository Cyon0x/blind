import { handle, json, fail, limited } from "@/lib/api";
import { currentSession } from "@/lib/session";
import { getReceiptByReference } from "@/lib/store";
import { receiptIntegrityCheck, receiptView } from "@/lib/views";

export const dynamic = "force-dynamic";

/**
 * Receipt verification. A receipt is a bearer document — the reference is the
 * credential — so anyone holding it may read it, but the recorded integrity
 * hash is recomputed from the stored fields and reported as matched or not.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    const throttle = await limited("receipt:read", 120, 60_000);
    if (throttle) return throttle;
    const { reference } = await ctx.params;
    const receipt = await getReceiptByReference(reference);
    if (!receipt) return fail(404, "not_found", "That receipt does not exist.");
    const session = await currentSession();

    const { matches: integrityMatches } = receiptIntegrityCheck(receipt);

    return json({
      ok: true,
      receipt: receiptView(receipt),
      integrity: {
        matches: integrityMatches,
        algorithm: "sha256 over the sorted receipt fields",
        note: integrityMatches
          ? "The stored fields still hash to the value Blind recorded when it issued this receipt."
          : "These fields no longer match the recorded hash, so this copy has been altered.",
      },
      settlesPayment: receipt.settlement_verified,
      statement: receipt.settlement_verified
        ? "Settlement of the payout was verified against the Beldex chain by Blind."
        : "Blind has no chain-verified settlement for this receipt; treat it as a record, not as proof.",
      viewer: session ? { signedIn: true, ownsReceipt: receipt.owner_user_id === session.user.id } : { signedIn: false },
    });
  });
}
