import Link from "next/link";
import { Iris, IrisStateFor } from "@/components/Iris";
import { StatePill } from "@/components/StatePill";
import { currentSession } from "@/lib/session";
import { listPaymentsForUser } from "@/lib/store";
import { formatBdx } from "@/lib/beldex/units";
import { timeAgo, untilLabel } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "My payments" };

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "created", label: "I created" },
  { id: "sent", label: "I funded" },
  { id: "received", label: "I was paid" },
  { id: "awaiting_claim", label: "Awaiting a claim" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed or expired" },
] as const;

export default async function MyPaymentsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const session = await currentSession();
  if (!session) return null;
  const params = await searchParams;
  const filter = FILTERS.find((entry) => entry.id === params.filter)?.id ?? "all";
  const payments = await listPaymentsForUser(session.user.id);

  const filtered = payments.filter((payment) => {
    const creator = payment.creator_user_id === session.user.id;
    switch (filter) {
      case "created":
        return creator;
      case "sent":
        return creator && payment.kind === "pay";
      case "received":
        return !creator || payment.counterparty_user_id === session.user.id;
      case "awaiting_claim":
        return creator && payment.kind === "pay" && ["funded", "claim_pending", "payout_submitted"].includes(payment.status);
      case "completed":
        return payment.status === "settled";
      case "failed":
        return ["failed", "expired", "cancelled", "refunded"].includes(payment.status);
      default:
        return true;
    }
  });

  return (
    <div className="stack gap-7 pt-4">
      <header className="stack gap-3">
        <span className="label">My payments</span>
        <h1 className="display text-[clamp(28px,4vw,42px)]">Every payment, with the half you own.</h1>
        <p className="muted max-w-[680px] text-[15px]">
          These lists are filtered by your role: a payer sees funding and settlement, a recipient sees what arrived.
          Neither list contains the other person&rsquo;s wallet address.
        </p>
      </header>

      <div className="scroll-x" role="tablist" aria-label="Filter payments">
        {FILTERS.map((entry) => (
          <Link
            key={entry.id}
            href={entry.id === "all" ? "/dashboard/payments" : `/dashboard/payments?filter=${entry.id}`}
            className={`pill whitespace-nowrap ${filter === entry.id ? "pill-develop" : ""}`}
            role="tab"
            aria-selected={filter === entry.id}
          >
            {entry.label}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="panel stack gap-3 items-start">
          <Iris state="latent" size={64} />
          <p className="muted text-[15px]">Nothing matches this filter yet.</p>
        </div>
      ) : (
        <ul className="stack">
          {filtered.map((payment) => {
            const creator = payment.creator_user_id === session.user.id;
            const direction =
              payment.kind === "pay"
                ? creator
                  ? "you funded this link"
                  : "a claim link aimed at you"
                : creator
                  ? "you requested this"
                  : "someone requested this from you";
            return (
              <li key={payment.id} className="rule-row py-5">
                <Link
                  href={`/dashboard/payments/${payment.reference}`}
                  className="flex flex-wrap items-center justify-between gap-4 no-underline"
                >
                  <div className="flex items-center gap-4">
                    <Iris state={IrisStateFor(payment.status)} size={30} animate={false} />
                    <div className="stack gap-1">
                      <span className="figure text-[20px]">{formatBdx(payment.amount_atomic)} BDX</span>
                      <span className="faint text-[12px]">
                        {direction} · {timeAgo(payment.created_at)}
                        {untilLabel(payment.expires_at) ? ` · ${untilLabel(payment.expires_at)}` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {payment.description ? (
                      <span className="muted max-w-[260px] truncate text-[14px]">{payment.description}</span>
                    ) : null}
                    <StatePill status={payment.status} label={payment.status.replace(/_/g, " ")} />
                    <span className="figure text-[12px] muted">{payment.reference}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
