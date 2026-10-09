"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { post } from "./client";

/**
 * The Beldex Wallet, as the browser sees it.
 *
 * Everything here is a thin, honest wrapper over the official
 * `@bdxi/web3js` SDK: the wallet answers reads only after the user approves a
 * connection, every send needs fresh approval inside the wallet, and a send
 * that times out locally is reported as UNKNOWN OUTCOME rather than retried
 * (a retry is only ever done with the same idempotency key).
 *
 * The SDK is imported lazily so no server render ever touches `window`.
 */
export type WalletPhase = "probing" | "absent" | "available" | "connecting" | "connected" | "error";

export type Balance = { unlocked: bigint; approximate: boolean } | null;

export type UseBeldex = {
  phase: WalletPhase;
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

type SdkModule = typeof import("@bdxi/web3js");

/**
 * The SDK exposes its typed error predicates on BdxRpcError (`4001` user
 * rejection, `4900` wallet locked, `4998` unknown outcome). Routing every check
 * through one place means a rename upstream shows up here and nowhere else.
 */
function predicates(sdk: SdkModule | null) {
  const errors = sdk?.BdxRpcError;
  return {
    isUserRejection: (error: unknown) => Boolean(errors?.isUserRejection(error)),
    isLocked: (error: unknown) => Boolean(errors?.isLocked(error)),
    isUnknownOutcome: (error: unknown) => Boolean(errors?.isUnknownOutcome(error)),
  };
}

export function useBeldex(): UseBeldex {
  const sdkRef = useRef<SdkModule | null>(null);
  const clientInstance = useRef<{ connect: () => Promise<unknown>; getBalance: () => Promise<unknown> } | null>(null);
  const [phase, setPhase] = useState<WalletPhase>("probing");
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [balance, setBalance] = useState<Balance>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  const client = useCallback(() => {
    return clientInstance.current as unknown as {
      connect(): Promise<{ address: string; network: string }>;
      disconnect(): Promise<void>;
      getBalance(): Promise<{ unlocked: bigint; approximate?: boolean }>;
      connectWithProof(opts?: { challenge?: { nonce: string; requestId?: string; expiresInMs?: number }; required?: boolean }): Promise<{ proof: { message: string; signature: string; address: string } | null }>;
      sendTransactionSafe(params: { to: string; amount: string; idempotencyKey: string }): Promise<{ status: string; txHash?: string; fee?: string }>;
      resolveBns(name: string): Promise<{ address: string; verified?: boolean }>;
      on(event: string, fn: (data: unknown) => void): void;
    } | null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sdk = await import("@bdxi/web3js");
        sdkRef.current = sdk;
        const provider = await sdk.detectProvider({ timeoutMs: 2500 });
        if (cancelled) return;
        if (!provider) {
          setPhase("absent");
          return;
        }
        const instance = new sdk.BeldexWeb3(provider);
        clientInstance.current = instance as unknown as never;
        setPhase("available");
        instance.on("accountsChanged", () => {
          setAddress(null);
          setBalance(null);
          setPhase("available");
        });
        instance.on("lock", () => setLocked(true));
        instance.on("unlock", () => setLocked(false));
        instance.on("disconnect", () => {
          setAddress(null);
          setBalance(null);
          setPhase("available");
        });
        instance.on("balanceChanged", (data) => {
          const next = data as { unlocked?: bigint; approximate?: boolean };
          if (next?.unlocked !== undefined) setBalance({ unlocked: BigInt(next.unlocked), approximate: Boolean(next.approximate) });
        });
      } catch (err) {
        if (!cancelled) {
          setPhase("error");
          setError(err instanceof Error ? err.message : "Could not load the Beldex wallet connector.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    const instance = client();
    if (!instance) {
      setError("The Beldex Wallet extension is not installed in this browser.");
      return;
    }
    setPhase("connecting");
    setError(null);
    setRejected(false);
    try {
      const result = await instance.connect();
      setAddress(result.address);
      setNetwork(result.network);
      setPhase("connected");
      try {
        const funds = await instance.getBalance();
        setBalance({ unlocked: BigInt(funds.unlocked), approximate: Boolean(funds.approximate) });
      } catch {
        setBalance(null);
      }
    } catch (err) {
      const { isUserRejection, isLocked } = predicates(sdkRef.current);
      if (isUserRejection(err)) {
        setRejected(true);
        setPhase("available");
        return;
      }
      if (isLocked(err)) {
        setLocked(true);
        setError("Open the Beldex Wallet extension, enter its password, then try again.");
        setPhase("available");
        return;
      }
      setError(err instanceof Error ? err.message : "The wallet refused the connection.");
      setPhase("available");
    }
  }, [client]);

  const disconnect = useCallback(async () => {
    await client()?.disconnect().catch(() => undefined);
    setAddress(null);
    setBalance(null);
    setPhase("available");
  }, [client]);

  const refreshBalance = useCallback(async () => {
    const instance = client();
    if (!instance || !address) return;
    try {
      const funds = await instance.getBalance();
      setBalance({ unlocked: BigInt(funds.unlocked), approximate: Boolean(funds.approximate) });
    } catch {
      setBalance(null);
    }
  }, [address, client]);

  const signIn = useCallback(
    async (purpose: "signin" | "link" = "signin") => {
      const instance = client();
      if (!instance) return { ok: false, error: "The Beldex Wallet extension is not installed." };
      const challenge = await post<{ nonce: string; requestId?: string; expiresInMs?: number }>(
        "/api/auth/wallet/challenge",
        { purpose }
      );
      if (!challenge.ok) return { ok: false, error: challenge.error };
      try {
        const { proof } = await instance.connectWithProof({ challenge: challenge.data, required: true });
        if (!proof) return { ok: false, error: "The wallet did not return a signature." };
        const verified = await post<{ ok: boolean; redirectTo?: string }>("/api/auth/wallet/verify", {
          statement: proof.message,
          signature: proof.signature,
          purpose,
        });
        if (!verified.ok) return { ok: false, error: verified.error };
        setAddress(proof.address);
        setPhase("connected");
        return { ok: true };
      } catch (err) {
        if (predicates(sdkRef.current).isUserRejection(err)) {
          setRejected(true);
          return { ok: false, error: "You declined the signature request." };
        }
        return { ok: false, error: err instanceof Error ? err.message : "The wallet could not sign the challenge." };
      }
    },
    [client]
  );

  const send = useCallback(
    async (input: { to: string; amountAtomic: string; idempotencyKey: string }) => {
      const instance = client();
      if (!instance) return { ok: false as const, error: "The Beldex Wallet extension is not installed.", unknownOutcome: false };
      try {
        const result = await instance.sendTransactionSafe({
          to: input.to,
          amount: input.amountAtomic,
          idempotencyKey: input.idempotencyKey,
        });
        if (result.status === "confirmed" && result.txHash) {
          return { ok: true as const, txHash: result.txHash, fee: String(result.fee ?? "0") };
        }
        return {
          ok: false as const,
          error:
            "The wallet has not reported the result of this send yet. Blind will not resend it — check your wallet before trying again.",
          unknownOutcome: true,
        };
      } catch (err) {
        const { isUserRejection, isUnknownOutcome } = predicates(sdkRef.current);
        if (isUserRejection(err)) {
          setRejected(true);
          return { ok: false as const, error: "You declined the payment in your wallet.", unknownOutcome: false };
        }
        if (isUnknownOutcome(err)) {
          return {
            ok: false as const,
            error:
              "Your wallet did not answer in time. The payment may still be going through, so Blind will not send it again.",
            unknownOutcome: true,
          };
        }
        return { ok: false as const, error: err instanceof Error ? err.message : "The wallet refused the send.", unknownOutcome: false };
      }
    },
    [client]
  );

  const resolveBns = useCallback(
    async (name: string) => {
      const instance = client();
      if (!instance) return { ok: false as const, error: "The Beldex Wallet extension is not installed." };
      try {
        const result = await instance.resolveBns(name);
        return { ok: true as const, address: result.address };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "That name could not be resolved." };
      }
    },
    [client]
  );

  return { phase, address, network, balance, locked, error, rejected, connect, disconnect, refreshBalance, signIn, send, resolveBns };
}
