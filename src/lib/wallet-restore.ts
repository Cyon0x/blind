/**
 * Asking the wallet whether it still holds a grant — in a way that cannot open
 * a prompt, because a page must never pop the wallet's approval window on load.
 *
 * A reload or a navigation inside the app throws away React state but not the
 * *wallet's* grant, which is scoped to (origin, wallet) and outlives the page.
 * So Blind asks again. `bdx_connect` is the wrong question: it is idempotent
 * when a grant exists, but when none does it opens the approval UI, which is
 * exactly the interruption we are trying to remove.
 *
 * `bdx_getAddress` is a *connected*-tier read: it answers from the grant with
 * no UI when there is one, and fails `4100` with no UI when there is not. That
 * asymmetry is what makes a silent restore possible.
 */
export type RestoreOutcome =
  | { status: "connected"; address: string; network: string | null }
  | { status: "available"; note: string | null };

/** The two granted-tier calls this needs, structurally. */
export type GrantReader = {
  getAddress(): Promise<string>;
  getNetwork(): Promise<{ nettype?: string }>;
};

/**
 * @param isNoGrant tells a refusal ("this origin holds no grant") apart from a
 * transient failure. Only the former is an ordinary, quiet outcome.
 */
export async function restoreGrant(client: GrantReader, isNoGrant: (error: unknown) => boolean): Promise<RestoreOutcome> {
  let address: string;
  try {
    address = await client.getAddress();
  } catch (error) {
    if (isNoGrant(error)) return { status: "available", note: null };
    return { status: "available", note: error instanceof Error ? error.message : "The wallet did not answer." };
  }
  if (!address) return { status: "available", note: null };
  let network: string | null = null;
  try {
    network = (await client.getNetwork()).nettype ?? null;
  } catch {
    // The address is proof enough of the grant; the network is only a label and
    // the wallet withholds nothing about it that matters here.
    network = null;
  }
  return { status: "connected", address, network };
}
