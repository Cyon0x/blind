import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fail, handle, limited } from "@/lib/api";
import { getReceiptByReference } from "@/lib/store";
import { beldexConfig } from "@/lib/beldex/config";
import { fromAtomic } from "@/lib/beldex/units";

export const dynamic = "force-dynamic";

/**
 * A printable receipt. It carries only what this side of the payment owns: no
 * counterparty address, no email, no wallet history, no keys.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ reference: string }> }) {
  return handle(async () => {
    const throttle = await limited("receipt:pdf", 30, 60_000);
    if (throttle) return throttle;
    const { reference } = await ctx.params;
    const receipt = await getReceiptByReference(reference);
    if (!receipt) return fail(404, "not_found", "That receipt does not exist.");
    const config = beldexConfig();

    const pdf = await PDFDocument.create();
    pdf.setTitle(`Blind receipt ${receipt.reference}`);
    pdf.setProducer("Blind");
    const page = pdf.addPage([595, 842]); // A4
    const mono = await pdf.embedFont(StandardFonts.Courier);
    const sans = await pdf.embedFont(StandardFonts.Helvetica);
    const ink = rgb(0.09, 0.1, 0.11);
    const muted = rgb(0.45, 0.46, 0.46);
    const develop = rgb(0.07, 0.6, 0.36);
    const safelight = rgb(0.85, 0.32, 0.14);

    let y = 800;
    const line = (text: string, opts: { size?: number; font?: typeof mono; color?: typeof ink; gap?: number } = {}) => {
      page.drawText(text, { x: 56, y, size: opts.size ?? 10, font: opts.font ?? sans, color: opts.color ?? ink });
      y -= opts.gap ?? 16;
    };

    line("BLIND", { size: 22, font: mono, color: develop, gap: 10 });
    line("PRIVATE PAYMENT RECEIPT", { size: 9, font: mono, color: muted, gap: 28 });
    line(`${fromAtomic(receipt.amount_atomic)} ${receipt.asset}`, { size: 26, font: mono, gap: 10 });
    line(receipt.settlement_verified ? "SETTLEMENT VERIFIED ON CHAIN" : "NOT CHAIN-VERIFIED", {
      size: 9,
      font: mono,
      color: receipt.settlement_verified ? develop : safelight,
      gap: 26,
    });

    const rows: Array<[string, string]> = [
      ["receipt", receipt.reference],
      ["side", receipt.side],
      ["issued", new Date(receipt.issued_at).toISOString()],
      ["network", config.nettype],
      ["payout tx", receipt.settlement_tx_hash ?? "not recorded"],
      ["confirmations", String(receipt.settlement_confirmations)],
      ["block height", receipt.settlement_block_height ? String(receipt.settlement_block_height) : "unknown"],
      ["integrity", receipt.integrity_hash],
      ["engraving", receipt.engraving_seed],
    ];
    for (const [key, value] of rows) {
      page.drawText(key.toUpperCase(), { x: 56, y, size: 7, font: mono, color: muted });
      const wrapped = value.length > 62 ? `${value.slice(0, 62)}…` : value;
      page.drawText(wrapped, { x: 170, y, size: 9, font: mono, color: ink });
      y -= 18;
    }

    y -= 12;
    const disclosure = String(receipt.payload?.disclosure ?? "");
    for (const chunk of wrap(disclosure, 96)) {
      line(chunk, { size: 8, font: sans, color: muted, gap: 12 });
    }
    y -= 8;
    for (const chunk of wrap(
      receipt.settlement_verified
        ? "Blind verified this payout against the Beldex network. This document records the amount, the settlement hash and the depth of confirmation at the time it was issued."
        : "Blind could not verify settlement on chain for this payment. This document is a record of what Blind observed, not proof of payment.",
      96
    )) {
      page.drawText(chunk, { x: 56, y, size: 8, font: sans, color: muted });
      y -= 12;
    }

    const bytes = await pdf.save();
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="blind-receipt-${receipt.reference}.pdf"`,
        "cache-control": "no-store",
      },
    });
  });
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}
