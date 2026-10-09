import Link from "next/link";
import { Iris, IrisStateFor } from "./Iris";
import { StatePill } from "./StatePill";
import { formatBdx } from "@/lib/beldex/units";
import { timeAgo, untilLabel } from "@/lib/format";
import type { PaymentRow } from "@/lib/store";

/** A contact sheet of payments: the same frame every time, so states compare at a glance. */
export function PaymentList({
  title,
  payments,
  emptyHint,
}: {
  title: string;
  payments: PaymentRow[];
  emptyHint: string;
}) {
  return (
    <section className="stack gap-4">
      <h2 className="display text-[24px]">{title}</h2>
      {payments.length === 0 ? (
        <p className="faint text-[14px]">{emptyHint}</p>
      ) : (
        <div className="grid-contact">
          {payments.map((payment) => (
            <Link key={payment.id} href={`/dashboard/payments/${payment.reference}`} className="panel stack gap-3 no-underline">
              <div className="flex items-center justify-between gap-3">
                <span className="figure text-[12px] muted">{payment.reference}</span>
                <Iris state={IrisStateFor(payment.status)} size={22} animate={false} />
              </div>
              <p className="figure text-[24px]">{formatBdx(payment.amount_atomic)} BDX</p>
              <StatePill status={payment.status} label={payment.status.replace(/_/g, " ")} />
              <p className="faint text-[12px]">
                {timeAgo(payment.created_at)}
                {untilLabel(payment.expires_at) ? ` · ${untilLabel(payment.expires_at)}` : ""}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
