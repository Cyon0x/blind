import Link from "next/link";
import { currentSession } from "@/lib/session";
import { listReceiptsForUser } from "@/lib/store";
import { receiptView } from "@/lib/views";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipts" };

export default async function ReceiptsPage() {
  const session = await currentSession();
  if (!session) return null;
  const receipts = (await listReceiptsForUser(session.user.id)).map(receiptView);

  return (
    <div className="stack gap-7 pt-4">
      <header className="stack gap-3">
        <span className="label">Receipts</span>
        <h1 className="display text-[clamp(28px,4vw,44px)]">A record that knows its own limits.</h1>
        <p className="muted max-w-[680px] text-[15px]">
          Every receipt states whether Blind verified the settlement against the chain. Where it could not, a direct
          request, or a payout that has not reached {">"}its confirmation depth, the receipt says so instead of implying
          proof it does not have.
        </p>
      </header>

      {receipts.length === 0 ? (
        <p className="faint text-[14px]">No receipts yet. They are issued when a payout is verified.</p>
      ) : (
        <ul className="stack">
          {receipts.map((receipt) => (
            <li key={receipt.reference} className="rule-row flex flex-wrap items-center justify-between gap-4 py-5">
              <div className="stack gap-1">
                {/* amountDisplay is already formatted BDX; passing it through formatBdx
                    again tried to read "4.2" as atomic units and crashed the page. */}
                <span className="figure text-[18px]">{receipt.amountDisplay} BDX</span>
                <span className="faint text-[12px]">
                  {receipt.side} side · issued {timeAgo(receipt.issuedAt)} · {receipt.reference}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className={receipt.settlementVerified ? "pill pill-develop" : "pill pill-safelight"}>
                  {receipt.settlementVerified
                    ? `verified · ${receipt.settlementConfirmations} conf`
                    : "not chain-verified"}
                </span>
                <Link href={`/verify/${receipt.reference}`} className="pill">
                  verify
                </Link>
                <a href={`/api/receipts/${receipt.reference}/pdf`} className="pill">
                  PDF
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
