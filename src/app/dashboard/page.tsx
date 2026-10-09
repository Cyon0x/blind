import Link from "next/link";
import { Iris, IrisStateFor } from "@/components/Iris";
import { StatePill } from "@/components/StatePill";
import { WalletBar } from "@/components/WalletBar";
import { currentSession } from "@/lib/session";
import { listNotifications, listPaymentsForUser, listWallets } from "@/lib/store";
import { formatBdx } from "@/lib/beldex/units";
import { beldexConfig, beldexStatus } from "@/lib/beldex/config";
import { databaseConfigured } from "@/lib/db";
import { timeAgo, untilLabel } from "@/lib/format";
import { escrowHealth } from "@/lib/beldex/escrow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

export default async function DashboardOverview() {
  const session = await currentSession();
  if (!session) return null;
  const [payments, wallets, notifications] = await Promise.all([
    listPaymentsForUser(session.user.id),
    listWallets(session.user.id),
    listNotifications(session.user.id),
  ]);
  const config = beldexConfig();
  const status = beldexStatus();
  const escrow = await escrowHealth();

  const asCreator = payments.filter((payment) => payment.creator_user_id === session.user.id);
  const sent = asCreator.filter((payment) => payment.kind === "pay");
  const requested = asCreator.filter((payment) => payment.kind === "request");
  const received = payments.filter(
    (payment) => payment.creator_user_id !== session.user.id || payment.counterparty_user_id === session.user.id
  );
  const awaitingClaim = sent.filter((payment) => payment.status === "funded");
  const awaitingPayment = requested.filter((payment) => payment.status === "awaiting_payment");
  const settled = payments.filter((payment) => payment.status === "settled");
  const recent = payments.slice(0, 6);

  return (
    <div className="stack gap-8 pt-4">
      <section className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
        <div className="panel stack gap-5">
          <span className="label">Overview</span>
          <h1 className="display text-[clamp(30px,4.4vw,46px)]">
            {session.user.username ? `@${session.user.username}` : session.user.display_name ?? "Your darkroom"}
          </h1>
          <p className="muted text-[16px]">
            {escrow.configured
              ? `Blind's escrow signer is ${escrow.walletOpen ? "open" : "reachable but no wallet is open"}. ` +
                `Payments settle after ${config.confirmationsForSettlement} confirmations on ${config.nettype}.`
              : "Blind's escrow signer is not configured on this deployment, so Blind Pay cannot take a deposit. Blind Request can still be created and shared, a payer's wallet can pay you directly."}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Sent" value={String(sent.length)} note="payments you funded" />
            <Metric label="Received" value={String(received.length)} note="payments and requests aimed at you" />
            <Metric label="Awaiting claim" value={String(awaitingClaim.length)} note="funded links nobody has opened" />
            <Metric label="Awaiting payment" value={String(awaitingPayment.length)} note="requests out in the world" />
            <Metric label="Settled" value={String(settled.length)} note="verified against the chain" />
            <Metric
              label="Settled volume"
              value={`${formatBdx(settled.reduce((sum, payment) => sum + BigInt(payment.deposit_amount_atomic ?? payment.amount_atomic), 0n))} BDX`}
              note="sum of settled payments"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/pay" className="btn btn-primary">
              Create a Blind Pay
            </Link>
            <Link href="/dashboard/request" className="btn btn-ghost">
              Request a payment
            </Link>
          </div>
        </div>

        <div className="stack gap-6">
          <WalletBar />
          <div className="panel stack gap-3">
            <span className="label">Verification</span>
            <Row k="Network" v={status.nettype} />
            <Row k="Chain node" v={status.daemon === "configured" ? "configured" : "not set"} />
            <Row k="Escrow signer" v={escrow.configured ? (escrow.reachable ? "answerable" : "unreachable") : "not set"} />
            <Row k="Escrow hot balance" v={escrow.totalBalanceAtomic ? `${formatBdx(escrow.totalBalanceAtomic)} BDX` : "unknown"} />
            <Row k="Database" v={databaseConfigured ? "connected" : "embedded"} />
            <Row k="Linked wallets" v={wallets.length > 0 ? String(wallets.length) : "none yet"} />
            <p className="faint text-[12px]">{escrow.detail}</p>
          </div>
        </div>
      </section>

      <section className="stack gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="display text-[26px]">Recent activity</h2>
          <Link href="/dashboard/payments" className="pill">
            All payments
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="panel stack gap-3 items-start">
            <Iris state="latent" size={70} />
            <p className="muted text-[15px]">
              Nothing has been developed yet. A Blind Pay puts money in escrow and gives you a link to hand over;
              a Blind Request asks someone to pay you without publishing your address.
            </p>
          </div>
        ) : (
          <div className="grid-contact">
            {recent.map((payment) => {
              const outgoing = payment.creator_user_id === session.user.id;
              return (
                <Link key={payment.id} href={`/dashboard/payments/${payment.reference}`} className="panel stack gap-3 no-underline">
                  <div className="flex items-center justify-between gap-3">
                    <span className="figure text-[12px] muted">{payment.reference}</span>
                    <Iris state={IrisStateFor(payment.status)} size={22} animate={false} />
                  </div>
                  <p className="figure text-[26px]">{formatBdx(payment.amount_atomic)} BDX</p>
                  <StatePill status={payment.status} label={payment.status.replace(/_/g, " ")} />
                  <p className="faint text-[12px]">
                    {payment.kind === "pay" ? (outgoing ? "you funded this" : "aimed at you") : outgoing ? "you requested this" : "you were asked"} ·{" "}
                    {timeAgo(payment.created_at)}
                    {untilLabel(payment.expires_at) ? ` · ${untilLabel(payment.expires_at)}` : ""}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="stack gap-4">
        <h2 className="display text-[26px]">What Blind told you</h2>
        {notifications.length === 0 ? (
          <p className="faint text-[14px]">No notifications yet.</p>
        ) : (
          <ul className="stack gap-2">
            {notifications.slice(0, 6).map((notification) => (
              <li key={notification.id} className="rule-row flex flex-wrap items-baseline justify-between gap-3 pt-3">
                <span className="text-[15px]">{notification.title}</span>
                <span className="faint text-[13px]">{notification.body}</span>
                <span className="faint figure text-[12px]">{timeAgo(notification.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="stack gap-1">
      <span className="label">{label}</span>
      <span className="figure text-[22px]">{value}</span>
      <span className="faint text-[12px]">{note}</span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="faint text-[13px]">{k}</span>
      <span className="figure text-[13px]">{v}</span>
    </div>
  );
}
