import { redirect } from "next/navigation";
import { DashNav } from "@/components/DashNav";
import { currentSession } from "@/lib/session";
import { countUnreadNotifications } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/signin?next=/dashboard");
  const unread = await countUnreadNotifications(session.user.id);

  return (
    <>
      <DashNav username={session.user.username} unread={unread} />
      <main id="main" className="wrap-shell pb-24">
        {children}
      </main>
    </>
  );
}
