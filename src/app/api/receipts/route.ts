import { handle, json } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listReceiptsForUser } from "@/lib/store";
import { receiptView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const session = await requireSession();
    const receipts = await listReceiptsForUser(session.user.id);
    return json({ ok: true, receipts: receipts.map(receiptView) });
  });
}
