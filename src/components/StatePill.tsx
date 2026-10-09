import { Iris, IrisStateFor } from "./Iris";

const TONE: Record<string, string> = {
  latent: "pill",
  developing: "pill pill-safelight",
  fixed: "pill pill-develop",
  dead: "pill pill-dead",
};

/**
 * Status is always the same object: a small aperture plus the words. The words
 * come from the domain (src/lib/views.ts), not from the component, so no screen
 * can invent a status.
 */
export function StatePill({ status, label }: { status: string; label: string }) {
  const state = IrisStateFor(status);
  return (
    <span className={TONE[state] ?? "pill"}>
      <Iris state={state} size={18} animate={false} />
      {label}
    </span>
  );
}
