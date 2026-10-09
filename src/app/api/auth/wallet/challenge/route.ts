import { randomBytes } from "node:crypto";
import { handle, json, limited, readJson } from "@/lib/api";
import { beldexConfig } from "@/lib/beldex/config";
import { createAuthChallenge } from "@/lib/store";
import { authDomain } from "@/lib/session";

export const dynamic = "force-dynamic";

type Body = { purpose?: "signin" | "link" };

/**
 * Issues the nonce for a wallet sign-in. The wallet composes the signed
 * `beldex-auth-v1` statement itself (bdx_connectWithProof), so this route hands
 * out only the nonce — and records the exact domain the statement must carry.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const throttle = await limited("wallet:challenge", 60, 60_000);
    if (throttle) return throttle;
    const body = await readJson<Body>(request);
    const purpose = body.purpose === "link" ? "link" : "signin";
    const nonce = randomBytes(18).toString("base64url").replace(/[^A-Za-z0-9._-]/g, "");
    await createAuthChallenge({ nonce, kind: purpose, ttlMs: 5 * 60 * 1000 });
    const host = request.headers.get("host");
    return json({
      nonce,
      requestId: nonce.slice(0, 12),
      expiresInMs: 5 * 60 * 1000,
      domain: authDomain(host),
      nettype: beldexConfig().nettype,
    });
  });
}
