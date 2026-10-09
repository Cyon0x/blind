import { Iris } from "@/components/Iris";
import { RequestComposer } from "@/components/RequestComposer";
import { PaymentList } from "@/components/PaymentList";
import { currentSession } from "@/lib/session";
import { listPaymentsForUser } from "@/lib/store";
import { beldexConfig } from "@/lib/beldex/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blind Request" };

export default async function BlindRequestPage() {
  const session = await currentSession();
  if (!session) return null;
  const config = beldexConfig();
  const requests = (await listPaymentsForUser(session.user.id)).filter(
    (payment) => payment.kind === "request" && payment.creator_user_id === session.user.id
  );

  return (
    <div className="stack gap-8 pt-4">
      <header className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <div className="stack gap-3">
          <span className="label">Blind Request</span>
          <h1 className="display text-[clamp(30px,4.6vw,50px)]">Ask for money without handing over your address.</h1>
          <p className="muted max-w-[620px] text-[16px]">
            A request link carries an amount and a description. If you route it through the escrow, the payer&rsquo;s
            wallet never sees where the money ends up, and you never see where it came from.
          </p>
        </div>
        <div className="panel stack gap-4 items-start">
          <Iris state={config.escrowEnabled ? "developing" : "latent"} size={120} />
          <p className="faint text-[13px]">
            {config.escrowEnabled
              ? `Escrow routing is available on ${config.nettype}. Your address stays inside Blind + the escrow signer.`
              : "Escrow routing is not configured here, so requests settle directly, the payer will see your address in their wallet."}
          </p>
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div className="panel">
          <RequestComposer escrowConfigured={config.escrowEnabled} nettype={config.nettype} />
        </div>
        <div className="stack gap-4">
          <h2 className="display text-[24px]">What the payer sees</h2>
          <ul className="stack gap-2 muted text-[15px]">
            <li>The amount, your description and the invoice reference.</li>
            <li>A one-time escrow address, or your address, if you chose direct mode.</li>
            <li>Nothing about who you are, your balance or your other payments.</li>
          </ul>
          <h2 className="display text-[24px]">What you see</h2>
          <ul className="stack gap-2 muted text-[15px]">
            <li>When the money landed in escrow, with confirmations.</li>
            <li>The forward transaction and its verification against the chain.</li>
            <li>A receipt for your records, printable as a PDF.</li>
          </ul>
        </div>
      </section>

      <PaymentList
        title="Requests you created"
        payments={requests}
        emptyHint="No requests yet, the first one is yours to create above."
      />
    </div>
  );
}
