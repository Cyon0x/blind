import Link from "next/link";
import { notFound } from "next/navigation";
import { Iris } from "@/components/Iris";
import { PayUserPanel } from "@/components/PayUserPanel";
import { SiteFooter, SiteHeader } from "@/components/Chrome";
import { currentSession } from "@/lib/session";
import { getUserByUsername, listLinkedAccounts, listPaymentsAddressedTo } from "@/lib/store";
import { beldexStatus } from "@/lib/beldex/config";
import { formatBdx } from "@/lib/beldex/units";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

/** A public profile is a handle and nothing else, no address, no email, no balance. */
export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await getUserByUsername(username);
  if (!user || !user.public_profile) return { title: "Profile" };
  return { title: `@${user.username}`, description: `Pay @${user.username} on Blind without exchanging wallet addresses.` };
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const clean = username.trim().replace(/^@/, "").toLowerCase();
  const user = await getUserByUsername(clean);
  if (!user || !user.public_profile || !user.username || user.status !== "active") notFound();

  const session = await currentSession();
  const status = beldexStatus();
  const accounts = user.show_x_handle ? await listLinkedAccounts(user.id) : [];
  const xHandle = accounts.find((account) => account.provider === "x")?.handle ?? null;
  const isSelf = session?.user.id === user.id;
  const open = isSelf ? await listPaymentsAddressedTo(user.id, 6) : [];

  return (
    <>
      <SiteHeader signedIn={Boolean(session)} />
      <main id="main" className="wrap-shell grid items-start gap-12 py-10 lg:grid-cols-[.85fr_1.15fr] lg:py-16">
        <div className="stack gap-6">
          <Iris state="developing" size={190} title="The aperture open: this profile accepts payments" />
          <div className="stack gap-2">
            <span className="label">Blind profile</span>
            <h1 className="display text-[clamp(34px,6vw,58px)]">@{user.username}</h1>
            {user.display_name ? <p className="muted text-[16px]">{user.display_name}</p> : null}
            {xHandle ? <p className="faint text-[13px]">also known as {xHandle} on X</p> : null}
          </div>
          <ul className="stack gap-2 muted text-[15px]">
            <li>Paying this handle never asks you to learn a wallet address.</li>
            <li>Blind resolves the handle to an account internally; the handle is never used as an identity key.</li>
            <li>This profile publishes no address, no balance and no transaction history.</li>
          </ul>
        </div>

        <div className="panel stack gap-6">
          {isSelf ? (
            <div className="stack gap-4">
              <span className="label">This is your profile</span>
              <p className="muted text-[15px]">
                Anyone can pay <code>@{user.username}</code> from here. Money addressed to you stays sealed with Blind
                until you claim it from your dashboard.
              </p>
              {open.length > 0 ? (
                <ul className="stack gap-3">
                  {open.map((payment) => (
                    <li key={payment.id} className="rule-row flex flex-wrap items-center justify-between gap-3 pt-3">
                      <span className="figure text-[15px]">{formatBdx(payment.amount_atomic)} BDX</span>
                      <span className="faint text-[12px]">{payment.status.replace(/_/g, " ")} · {timeAgo(payment.created_at)}</span>
                      <Link className="pill" href={`/dashboard/payments/${payment.reference}`}>
                        open
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="faint text-[14px]">Nothing has been addressed to you yet.</p>
              )}
              <Link className="btn btn-ghost" href="/dashboard/settings">
                Turn this profile off
              </Link>
            </div>
          ) : !session ? (
            <div className="stack gap-4">
              <span className="label">Pay @{user.username}</span>
              <p className="muted text-[15px]">
                Blind needs an account to hold the payment and to give both sides a receipt. Sign in with Google or X, then
                come back to this page.
              </p>
              <Link className="btn btn-primary" href={`/signin?next=/u/${user.username}`}>
                Sign in to pay @{user.username}
              </Link>
              <p className="faint text-[13px]">The payment is addressed to them; you never see their wallet address.</p>
            </div>
          ) : (
            <PayUserPanel username={user.username} displayName={user.display_name} />
          )}
        </div>
      </main>
      <SiteFooter nettype={status.nettype} daemon={status.daemon} escrow={status.escrow} />
    </>
  );
}
