import Link from "next/link";
import { Iris } from "@/components/Iris";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main id="main" className="wrap-shell grid min-h-[70vh] place-items-center py-16">
      <div className="panel stack max-w-[560px] items-start gap-5">
        <Iris state="dead" size={110} title="Aperture shut: there is nothing at this address" />
        <span className="label">404 · nothing developed here</span>
        <h1 className="display text-[clamp(28px,4.4vw,44px)]">This link does not lead anywhere.</h1>
        <p className="muted text-[15px]">
          A claim link, a request link or a receipt reference that does not exist looks exactly like this. Check the link
          you were sent, or ask for it again, Blind never guesses a payment into existence.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="btn btn-primary">
            Back to Blind
          </Link>
          <Link href="/dashboard" className="btn btn-ghost">
            Your dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
