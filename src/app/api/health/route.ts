import { handle, json } from "@/lib/api";
import { beldexStatus, beldexConfig } from "@/lib/beldex/config";
import { escrowHealth } from "@/lib/beldex/escrow";
import { chainReader, chainSource } from "@/lib/beldex/chain";
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
    const reader = chainReader();
    const source = chainSource();
    let chain: { height: number; nettype: string; untrusted: boolean; source: string } | { error: string; source: string | null } = {
      error: "no daemon or explorer is configured",
      source,
    };
    if (reader && source) {
      try {
        const info = await reader.getInfo();
        chain = { height: info.height, nettype: info.nettype, untrusted: info.untrusted, source };
      } catch (error) {
        chain = { error: error instanceof Error ? error.message : "unreachable", source };
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
