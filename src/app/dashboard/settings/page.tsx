import { SettingsPanels } from "@/components/SettingsPanels";
import { currentSession } from "@/lib/session";
import { listLinkedAccounts } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ linked?: string }> }) {
  const session = await currentSession();
  if (!session) return null;
  const params = await searchParams;
  const accounts = await listLinkedAccounts(session.user.id);

  return (
    <div className="stack gap-7 pt-4">
      <header className="stack gap-3">
        <span className="label">Settings</span>
        <h1 className="display text-[clamp(28px,4vw,44px)]">Your handle is public. Everything else is not.</h1>
        {params.linked ? <p className="text-develop text-[14px]">Linked {params.linked} to this account.</p> : null}
      </header>
      <SettingsPanels
        username={session.user.username}
        displayName={session.user.display_name}
        publicProfile={session.user.public_profile}
        showXHandle={session.user.show_x_handle}
        notifyOnPayment={session.user.notify_on_payment}
        xHandle={accounts.find((account) => account.provider === "x")?.handle ?? null}
      />
    </div>
  );
}
