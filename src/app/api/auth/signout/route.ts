import { handle, json } from "@/lib/api";
import { endSession, requireSession } from "@/lib/session";
import { audit } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    const session = await requireSession().catch(() => null);
    if (session) await audit({ actorUserId: session.user.id, action: "auth.signout" });
    await endSession();
    return json({ ok: true });
  });
}
