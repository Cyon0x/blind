import Link from "next/link";
import { redirect } from "next/navigation";
import { Iris } from "@/components/Iris";
import { SignInPanel } from "@/components/SignInPanel";
import { SiteFooter, SiteHeader } from "@/components/Chrome";
import { providerStatus } from "@/lib/auth";
import { currentSession } from "@/lib/session";
import { beldexStatus } from "@/lib/beldex/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const EXPLANATIONS: Record<string, string> = {
  google_not_configured: "Google sign-in is not configured on this deployment yet.",
  x_not_configured: "X sign-in is not configured on this deployment yet.",
  rate_limited: "Too many sign-in attempts from this network. Wait a minute and try again.",
  missing_code: "That sign-in link arrived without a code. Start again from this page.",
  unknown_provider: "That sign-in provider is not supported.",
  access_denied: "The provider refused the sign-in, or you cancelled it.",
  invalid_state: "That sign-in session expired. Start again from this page.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const session = await currentSession();
  if (session) redirect("/dashboard");
  const params = await searchParams;
  const status = beldexStatus();

  return (
    <>
      <SiteHeader signedIn={false} />
      <main id="main" className="wrap-shell grid items-start gap-12 py-12 lg:grid-cols-[.9fr_1.1fr] lg:py-20">
        <div className="stack gap-6">
          <Iris state="latent" size={220} title="Aperture closed: nothing is developed until you sign in" />
          <h1 className="display text-[clamp(34px,6vw,56px)]">Sign in, then keep your address to yourself.</h1>
          <p className="muted text-[17px]">
            Google and X give you an account. A wallet signature gives you an account <em>and</em> proves you hold the
            keys. Either way Blind stores an internal id, never your handle as the identifier.
          </p>
          <ul className="stack gap-2 muted text-[15px]">
            <li>Session cookies are httpOnly and bound to a CSRF token.</li>
            <li>Wallet proofs are verified with the address&rsquo;s own spend key, on our server.</li>
            <li>X handles and Google emails stay private; they never appear on a payment link.</li>
          </ul>
        </div>

        <div className="panel stack gap-6">
          {params.error ? (
            <p className="error-text">{EXPLANATIONS[params.error] ?? `Sign-in failed: ${params.error}`}</p>
          ) : null}
          <SignInPanel providers={providerStatus()} next={params.next} />
          <p className="faint text-[13px]">
            By continuing you accept that Blind holds deposits in escrow while a claim is open. Read{" "}
            <Link href="/#privacy" className="underline">
              what Blind can see
            </Link>{" "}
            before sending money.
          </p>
        </div>
      </main>
      <SiteFooter nettype={status.nettype} daemon={status.daemon} escrow={status.escrow} />
    </>
  );
}
