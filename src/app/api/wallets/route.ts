import { handle, json, readJson } from "@/lib/api";
import { requireMutation, requireSession } from "@/lib/session";
import { beldexConfig } from "@/lib/beldex/config";
import { decodeAddress } from "@/lib/beldex/address";
import { audit, deleteWallet, listWallets, upsertWallet } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const session = await requireSession();
    const wallets = await listWallets(session.user.id);
    return json({
      nettype: beldexConfig().nettype,
      wallets: wallets.map((wallet) => ({
        address: wallet.address,
        nettype: wallet.nettype,
        label: wallet.label,
        ownershipProven: Boolean(wallet.ownership_proven_at),
        lastSeenAt: wallet.last_seen_at,
      })),
    });
  });
}

type Body = { address?: string; label?: string; ownershipProven?: boolean };

/**
 * Linking a wallet. Blind checks the address structure and network itself; the
 * `ownershipProven` flag is only ever set by the wallet-signature routes, never
 * from a client-provided boolean.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireMutation();
    const body = await readJson<Body>(request);
    const address = (body.address ?? "").trim();
    const config = beldexConfig();
    const decoded = decodeAddress(address, config.nettype);
    if (!decoded.ok) {
      return json({ ok: false, error: `Blind cannot use that address: ${decoded.reason}` }, { status: 400 });
    }
    const wallet = await upsertWallet({
      userId: session.user.id,
      nettype: config.nettype,
      address,
      label: body.label ?? null,
      source: "pasted",
      ownershipProven: false,
    });
    await audit({ actorUserId: session.user.id, action: "wallet.linked", subject: decoded.decoded.kind });
    return json({ ok: true, wallet: wallet ? { address: wallet.address, kind: decoded.decoded.kind } : null });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const session = await requireMutation();
    const address = new URL(request.url).searchParams.get("address") ?? "";
    const removed = await deleteWallet(session.user.id, address);
    await audit({ actorUserId: session.user.id, action: "wallet.unlinked" });
    return json({ ok: true, removed });
  });
}
