import { handle, json } from "@/lib/api";
import { requireMutation, requireSession } from "@/lib/session";
import { listNotifications, markNotificationsRead } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const session = await requireSession();
    const notifications = await listNotifications(session.user.id);
    return json({
      ok: true,
      notifications: notifications.map((notification) => ({
        id: notification.id,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        paymentId: notification.payment_id,
        read: Boolean(notification.read_at),
        createdAt: notification.created_at,
      })),
    });
  });
}

export async function POST() {
  return handle(async () => {
    const session = await requireMutation();
    await markNotificationsRead(session.user.id);
    return json({ ok: true });
  });
}
