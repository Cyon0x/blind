import { handle, json } from "@/lib/api";
import { beldexStatus, beldexConfig } from "@/lib/beldex/config";
import { escrowHealth } from "@/lib/beldex/escrow";
import { BdxDaemon } from "@/lib/beldex/daemon";
import { databaseConfigured, usingEmbeddedDatabase } from "@/lib/db";
import { providerStatus } from "@/lib/auth";
import { claimSealingConfigured } from "@/lib/seal";

export const dynamic = "force-dynamic";

/**
 * The honest status of every moving part. `npm run bdx:doctor` prints the same
 * picture for an operator; this endpoint is what the app itself shows when a
 * feature is unavailable.
 */
export async function GET() {
  return handle(async () => {
    const config = beldexConfig();
    const daemon = BdxDaemon.fromEnv();
    let chain: { height: number; nettype: string; untrusted: boolean } | { error: string } = {
      error: "BDX_DAEMON_URL is not set",
    };
    if (daemon) {
      try {
        const info = await daemon.getInfo();
        chain = { height: info.height, nettype: info.nettype, untrusted: info.untrusted };
      } catch (error) {
        chain = { error: error instanceof Error ? error.message : "daemon unreachable" };
      }
    }
    const escrow = await escrowHealth();
    return json({
      ok: true,
      database: databaseConfigured ? "configured" : usingEmbeddedDatabase ? "embedded (development)" : "missing",
      beldex: beldexStatus(),
      chain,
      escrow,
      auth: { providers: providerStatus(), walletSignIn: true, claimSealing: claimSealingConfigured() },
      nettype: config.nettype,
    });
  });
}
