import { decodeAddress } from "./address";
import { isBdxNettype, type BdxNettype } from "./nettype";

/**
 * Paying from the browser wallet, on the network Blind is actually on.
 *
 * `@bdxi/web3js@1.0.1` validates the destination inside its own
 * `sendTransaction()` with a rule that knows exactly one network:
 *
 *     if (!s.startsWith("bx")) return { valid: false, reason: 'must start with "bx"' };
 *
 * `bx` is the *mainnet* standard prefix. Blind runs on Beldex testnet, where a
 * standard address is 95 characters with prefix 53 and begins with `9`, and
 * where the deposit destination the escrow hands out is a **subaddress** whose
 * prefix (63) encodes to something beginning with `B`. Neither form starts with
 * `bx`, so that guard rejects every address Blind can legitimately pay, before
 * the request ever reaches the wallet — and the user is told `invalid "to"
 * address: must start with "bx"`, as if they had mistyped an address, when in
 * fact the address is correct for the chain the whole deployment is on.
 *
 * The SDK's own README says the send path is tested with "a funded **testnet**
 * wallet", so testnet sends are intended to work; the guard is the defect. 1.0.1
 * is the latest release and exposes no network setting, so Blind answers the
 * question itself — with the same codec it uses to render, checksum and verify
 * every address in the UI — and then speaks the same wire method the SDK would
 * have spoken. The wallet stays the authority: it is what signs, and it knows
 * which chain it is on.
 *
 * Nothing else about the SDK's `sendTransactionSafe()` is given up:
 *   - one idempotency key per payment, so a retry cannot pay twice;
 *   - a local approval timeout is reported as *unresolved* (the payment may
 *     still complete) rather than retried blind;
 *   - the wallet saying "already in progress" is a reason to ask again with the
 *     SAME key — a confirmed operation is replayed, and only a genuinely absent
 *     one would open a second approval.
 */

/** `BdxRpcError` codes this module has to recognise (see the SDK's ERROR_CODES). */
const UNKNOWN_OUTCOME = 4998;
const INTERNAL_ERROR = -32603;

/** The SDK's own constraint on the key, kept because the wallet enforces it too. */
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._-]{8,128}$/;

/** The only part of the SDK client this needs, structurally. */
export type WalletSender = {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
};

export type WalletSendResult =
  | ({ status: "confirmed" } & Record<string, unknown>)
  | { status: "unresolved"; idempotencyKey: string };

function codeOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

/** The local approval timeout: the wallet may still execute the payment. */
export function isUnknownOutcome(error: unknown): boolean {
  return codeOf(error) === UNKNOWN_OUTCOME;
}

/** The wallet is already executing this exact idempotency key. */
export function isIdempotencyInFlight(error: unknown): boolean {
  return codeOf(error) === INTERNAL_ERROR && /idempotency key is already in progress/i.test(messageOf(error));
}

/**
 * The check the SDK should have made: is this a well-formed address *for the
 * network being paid on*? `nettype` is the wallet's own report of its network;
 * when the wallet will not name one, this stays out of the way and lets the
 * wallet make the call.
 */
export function assertSendableAddress(address: string, nettype: BdxNettype | null): void {
  if (!nettype) return;
  const decoded = decodeAddress(address, nettype);
  if (!decoded.ok) {
    throw new Error(`This wallet is on ${nettype}, and that is not a ${nettype} address: ${decoded.reason}.`);
  }
}

export function parseNettype(value: unknown): BdxNettype | null {
  return isBdxNettype(value) ? value : null;
}

export type WalletSendInput = {
  /** Destination, already chosen by the app (escrow deposit, payout address). */
  to: string;
  /** Atomic units as an integer string — never a decimal. */
  amountAtomic: string;
  /** Stable per payment: the payment reference, so a retry cannot pay twice. */
  idempotencyKey: string;
  /** The network the wallet reports. `null` skips the local shape check. */
  nettype?: BdxNettype | null;
  resolveTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Injected so the retry loop is testable without waiting on a clock. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends BDX through the wallet, returning only when the outcome is *known*.
 *
 * Resolves `status: "confirmed"` with the wallet's reply, or
 * `status: "unresolved"` — which means the payment may still complete and must
 * be treated as pending, never as "nothing happened". Anything else (a declined
 * approval, a locked wallet, a malformed request) is thrown as it came.
 */
export async function sendWithWallet(
  client: WalletSender,
  input: WalletSendInput
): Promise<WalletSendResult> {
  const { to, amountAtomic, idempotencyKey } = input;

  assertSendableAddress(to, input.nettype ?? null);

  // The SDK's sendTransaction() made these two checks before handing the request
  // to the wallet; skipping its address guard means keeping them here.
  if (!/^\d+$/.test(amountAtomic)) {
    throw new Error("A payment amount must be a whole number of atomic units.");
  }
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    throw new Error("A payment's idempotency key must be 8-128 characters of A-Za-z0-9._-");
  }

  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? defaultSleep;
  const deadline = now() + (input.resolveTimeoutMs ?? 30_000);
  let delay = input.pollIntervalMs ?? 1_000;

  for (;;) {
    try {
      const reply = await client.request("bdx_sendTransaction", { to, amount: amountAtomic, idempotencyKey });
      if (typeof reply !== "object" || reply === null) return { status: "confirmed" };
      return { status: "confirmed", ...(reply as Record<string, unknown>) };
    } catch (error) {
      if (!isUnknownOutcome(error) && !isIdempotencyInFlight(error)) throw error;
      if (now() >= deadline) return { status: "unresolved", idempotencyKey };
      await sleep(Math.min(delay, Math.max(0, deadline - now())));
      delay = Math.min(delay * 2, 8_000);
    }
  }
}
