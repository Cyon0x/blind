import type { NextConfig } from "next";

/**
 * React Refresh and Next's dev overlay evaluate code at runtime, so the strict
 * production policy would break `npm run dev` outright. Development therefore
 * gets 'unsafe-eval' and a built bundle does not — the deployed policy is the
 * strict one, and `curl -I` on any deployment shows which is in force.
 */
const isProduction = process.env.NODE_ENV === "production";
const scriptSrc = isProduction
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Blind loads nothing from anywhere else: fonts are self-hosted by
          // next/font, the QR code is drawn locally, there is no analytics and
          // no third-party script. The policy below keeps it that way, and the
          // directives that do not need a nonce (frame-ancestors, base-uri,
          // form-action, object-src) hold even though React's inline bootstrap
          // forces 'unsafe-inline' for script and style.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "worker-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
      {
        // Claim pages carry a one-time claim secret in the fragment; never let a
        // proxy or crawler keep a copy of the URL.
        source: "/claim/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
