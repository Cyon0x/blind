"use client";

import { createContext, useContext } from "react";

/**
 * The Beldex Wallet, as the browser sees it.
 *
 * Everything here is a thin, honest wrapper over the official
 * `@bdxi/web3js` SDK: the wallet answers reads only after the user approves a
 * connection, every send needs fresh approval inside the wallet, and a send
 * that times out locally is reported as UNKNOWN OUTCOME rather than retried
 * (a retry is only ever done with the same idempotency key).
 *
 * The state lives in `<BeldexWalletProvider>`, mounted once in the root layout,
 * and is read back through this context. It used to live in the hook itself,
 * which meant every component that called `useBeldex()` created its own wallet
 * instance: navigating anywhere, or reloading, threw away a connection the
 * wallet had already granted and asked the user to connect again.
 */
export type WalletPhase = "probing" | "absent" | "available" | "connecting" | "connected" | "error";

export type Balance = { unlocked: bigint; approximate: boolean } | null;

export type UseBeldex = {
  phase: WalletPhase;
  /** True while Blind is asking the wallet whether it still holds a grant. */
  restoring: boolean;
  address: string | null;
  network: string | null;
  balance: Balance;
  locked: boolean;
  error: string | null;
  rejected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  /** Wallet sign-in: server nonce → wallet statement → server verification. */
  signIn: (purpose?: "signin" | "link") => Promise<{ ok: boolean; error?: string }>;
  /** Amounts are formatted by the caller; atomic units stay strings end to end. */
  send: (input: { to: string; amountAtomic: string; idempotencyKey: string }) => Promise<
    { ok: true; txHash: string; fee: string } | { ok: false; error: string; unknownOutcome: boolean }
  >;
  resolveBns: (name: string) => Promise<{ ok: true; address: string } | { ok: false; error: string }>;
};

/**
 * The parts of the SDK's `BeldexWeb3` client this app calls. Declared here so
 * the provider and the context agree on one shape, and so a change upstream
 * shows up as a type error in one place.
 */
export type BeldexClient = {
  /** Address from the last successful connect(), without a round-trip. */
  readonly address: string | null;
  connect(): Promise<{ address: string; network: string }>;
  disconnect(): Promise<void>;
  getAddress(): Promise<string>;
  getNetwork(): Promise<{ nettype: string; height: number }>;
  getBalance(): Promise<{ unlocked: bigint; approximate?: boolean }>;
  connectWithProof(opts?: {
    challenge?: { nonce: string; requestId?: string; expiresInMs?: number };
    required?: boolean;
  }): Promise<{ proof: { message: string; signature: string; address: string } | null }>;
  sendTransactionSafe(params: {
    to: string;
    amount: string;
    idempotencyKey: string;
  }): Promise<{ status: string; txHash?: string; fee?: string }>;
  resolveBns(name: string): Promise<{ address: string; verified?: boolean }>;
  on(event: string, fn: (data: unknown) => void): void;
};

export const WalletContext = createContext<UseBeldex | null>(null);

/** Read the wallet state the provider holds. Must be called under the provider. */
export function useBeldex(): UseBeldex {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error(
      "useBeldex() was called outside <BeldexWalletProvider>. Mount the provider once, in the root layout: a wallet instance per component forgets a granted connection on every navigation."
    );
  }
  return value;
}
