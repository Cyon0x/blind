import { Iris } from "@/components/Iris";
import { PayComposer } from "@/components/PayComposer";
import { PaymentList } from "@/components/PaymentList";
import { currentSession } from "@/lib/session";
import { listPaymentsForUser } from "@/lib/store";
import { beldexConfig } from "@/lib/beldex/config";
import { escrowHealth } from "@/lib/beldex/escrow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blind Pay" };

export default async function BlindPayPage() {
  const session = await currentSession();
  if (!session) return null;
  const escrow = await escrowHealth();
  const payments = (await listPaymentsForUser(session.user.id)).filter(
    (payment) => payment.kind === "pay" && payment.creator_user_id === session.user.id
  );

  return (
    <div className="stack gap-8 pt-4">
      <header className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <div className="stack gap-3">
          <span className="label">Blind Pay</span>
          <h1 className="display text-[clamp(30px,4.6vw,50px)]">Fund a payment now, hand it over later.</h1>
          <p className="muted max-w-[620px] text-[16px]">
            Blind reserves one fresh escrow address for the payment. You send the money, Blind counts confirmations,
            and you hand over a link that only its holder can claim. The recipient never needs your address; you never
            need theirs.
          </p>
        </div>
        <div className="panel stack gap-3">
          <span className="label">Escrow signer</span>
          <p className="text-[15px]">
            {escrow.configured
              ? escrow.walletOpen
                ? "Connected and holding a wallet."
                : escrow.reachable
                  ? "Reachable, but no wallet is open, funding will fail until an operator opens it."
                  : "Configured but unreachable."
              : "Not configured on this deployment."}
          </p>
          <p className="faint text-[13px]">{escrow.detail}</p>
          <p className="faint text-[13px]">
            Settlements need {beldexConfig().confirmationsForSettlement} confirmations on {beldexConfig().nettype}.
          </p>
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div className="panel">
          <PayComposer escrowConfigured={escrow.configured} />
        </div>
        <div className="stack gap-4">
          <Iris state={escrow.configured ? "developing" : "dead"} size={150} />
          <h2 className="display text-[24px]">What the recipient gets</h2>
          <ul className="stack gap-2 muted text-[15px]">
            <li>An amount and a description, never your wallet address, name or email.</li>
            <li>A claim link whose secret sits after the <code>#</code>, so it stays out of server logs.</li>
            <li>A payout they approve in their own wallet, to an address they choose at claim time.</li>
          </ul>
          <h2 className="display text-[24px]">What you get</h2>
          <ul className="stack gap-2 muted text-[15px]">
            <li>A receiver&rsquo;s receipt the moment the payout is verified on chain.</li>
            <li>The ability to take the money back while nobody has claimed it.</li>
            <li>No knowledge of who claimed it beyond what a wallet address already tells you.</li>
          </ul>
        </div>
      </section>

      <PaymentList
        title="Payments you funded"
        payments={payments}
        emptyHint="No funded links yet. The first one is created to your right."
      />
    </div>
  );
}
