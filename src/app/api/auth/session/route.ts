import { handle, json } from "@/lib/api";
import { currentSession } from "@/lib/session";
import { providerStatus } from "@/lib/auth";
import { listLinkedAccounts, listWallets, countUnreadNotifications } from "@/lib/store";
import { beldexConfig } from "@/lib/beldex/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const session = await currentSession();
    const config = beldexConfig();
    if (!session) {
      return json({ authenticated: false, providers: providerStatus(), nettype: config.nettype });
    }
    const [accounts, wallets, unread] = await Promise.all([
      listLinkedAccounts(session.user.id),
      listWallets(session.user.id),
      countUnreadNotifications(session.user.id),
    ]);
    return json({
      authenticated: true,
      csrfToken: session.csrfToken,
      nettype: config.nettype,
      user: {
        id: session.user.id,
        username: session.user.username,
        displayName: session.user.display_name,
        avatarUrl: session.user.avatar_url,
        publicProfile: session.user.public_profile,
        showXHandle: session.user.show_x_handle,
        notifyOnPayment: session.user.notify_on_payment,
        onboarded: Boolean(session.user.onboarded_at),
      },
      accounts: accounts.map((account) => ({
        provider: account.provider,
        handle: account.handle,
        // Email is returned to its owner only, never in a public payload.
        email: account.email,
        linkedAt: account.created_at,
      })),
      wallets: wallets.map((wallet) => ({
        address: wallet.address,
        nettype: wallet.nettype,
        label: wallet.label,
        ownershipProven: Boolean(wallet.ownership_proven_at),
      })),
      unreadNotifications: unread,
    });
  });
}
