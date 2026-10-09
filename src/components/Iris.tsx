export type IrisState = "latent" | "developing" | "fixed" | "dead";

/**
 * The aperture. Blind's one big custom graphic: eight blades whose opening is
 * the state of a payment — closed while nothing has happened (latent), part open
 * while money is moving (developing), open and green once settlement is verified
 * (fixed), and shut grey when a payment is dead.
 *
 * Geometry is computed, not hand-drawn, so every size stays crisp.
 */
const BLADE_COUNT = 8;

function bladePath(outerRadius: number, innerRadius: number, index: number): string {
  const step = (Math.PI * 2) / BLADE_COUNT;
  const start = index * step;
  const end = start + step * 0.78;
  const point = (radius: number, angle: number) => [100 + radius * Math.cos(angle), 100 + radius * Math.sin(angle)];
  const [x1, y1] = point(outerRadius, start);
  const [x2, y2] = point(outerRadius, end);
  const [x3, y3] = point(innerRadius, end - step * 0.3);
  const [x4, y4] = point(innerRadius * 0.62, start + step * 0.24);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} L ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

const OPENING: Record<IrisState, { inner: number; stroke: string; opacity: number }> = {
  latent: { inner: 26, stroke: "var(--safelight)", opacity: 0.75 },
  developing: { inner: 40, stroke: "var(--safelight)", opacity: 0.95 },
  fixed: { inner: 62, stroke: "var(--develop)", opacity: 1 },
  dead: { inner: 20, stroke: "var(--ink-3)", opacity: 0.5 },
};

export function Iris({
  state = "latent",
  size = 200,
  animate = true,
  className = "",
  title,
}: {
  state?: IrisState;
  size?: number;
  animate?: boolean;
  className?: string;
  title?: string;
}) {
  const config = OPENING[state];
  const blades = Array.from({ length: BLADE_COUNT }, (_, index) => bladePath(78, config.inner, index));

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id="blind-iris-glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--safelight)" />
          <stop offset="100%" stopColor="var(--develop)" />
        </linearGradient>
      </defs>

      <circle
        cx="100"
        cy="100"
        r="86"
        fill="none"
        stroke="var(--rule-strong)"
        strokeWidth="0.75"
        strokeDasharray="2 6"
      />
      <circle
        cx="100"
        cy="100"
        r="92"
        fill="none"
        stroke={config.stroke}
        strokeWidth="1.25"
        opacity={config.opacity * 0.5}
        className={state === "developing" && animate ? "safelight-pulse" : undefined}
      />

      <g className={animate ? "iris-blades" : undefined}>
        {blades.map((path, index) => (
          <path
            key={index}
            d={path}
            fill={index % 2 === 0 ? "var(--raised-2)" : "var(--raised)"}
            stroke={config.stroke}
            strokeWidth="0.9"
            opacity={config.opacity * 0.85}
            className={animate ? "iris-draw" : undefined}
            style={{ ["--draw-length" as string]: "420" }}
          />
        ))}
      </g>

      <circle
        cx="100"
        cy="100"
        r={config.inner * 0.42}
        fill="none"
        stroke={state === "fixed" ? "var(--develop)" : "var(--ink-3)"}
        strokeWidth="1"
        opacity="0.9"
      />
      {state === "developing" ? (
        <circle cx="100" cy="100" r={config.inner * 0.42} fill="var(--safelight)" opacity="0.18" />
      ) : null}
    </svg>
  );
}

export function IrisStateFor(status: string): IrisState {
  if (status === "settled") return "fixed";
  if (["funded", "claim_pending", "payout_submitted", "refunding"].includes(status)) return "developing";
  if (["expired", "cancelled", "failed", "refunded"].includes(status)) return "dead";
  return "latent";
}
