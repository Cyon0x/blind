import { redirect } from "next/navigation";
import { Iris } from "@/components/Iris";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { currentSession } from "@/lib/session";
import { listLinkedAccounts } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up your account" };

export default async function OnboardingPage() {
  const session = await currentSession();
  if (!session) redirect("/signin?next=/onboarding");
  const accounts = await listLinkedAccounts(session.user.id);
  const xAccount = accounts.find((account) => account.provider === "x");

  return (
    <main id="main" className="wrap-shell grid items-start gap-12 py-14 lg:grid-cols-[.8fr_1.2fr]">
      <div className="stack gap-6">
        <Iris state="developing" size={230} title="The aperture opening: your account is being set up" />
        <h1 className="display text-[clamp(32px,5vw,50px)]">Two steps, then you can be paid.</h1>
        <p className="muted text-[16px]">
          Blind keeps your identity and your wallet in separate records. The username is public; the wallet address only
          ever appears to you and to Blind&rsquo;s escrow.
        </p>
        <div className="stack gap-1">
          <span className="label">Signed in as</span>
          <span className="figure text-[14px]">{session.user.display_name ?? "unnamed account"}</span>
          {xAccount?.handle ? (
            <span className="faint text-[13px]">X handle {xAccount.handle} stays private unless you publish it</span>
          ) : null}
        </div>
      </div>
      <div className="panel">
        <OnboardingFlow initialUsername={session.user.username} />
      </div>
    </main>
  );
}
