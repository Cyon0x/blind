"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { post } from "@/lib/client";
import { restoreGrant } from "@/lib/wallet-restore";
import { WalletContext, type Balance, type BeldexClient, type UseBeldex, type WalletPhase } from "@/lib/useBeldex";

type SdkModule = typeof import("@bdxi/web3js");

/**
 * The SDK exposes its typed error predicates on BdxRpcError (`4001` user
 * rejection, `4100` no grant, `4900` wallet locked, `4998` unknown outcome).
 * Routing every check through one place means a rename upstream shows up here
 * and nowhere else.
 */
function predicates(sdk: SdkModule | null) {
  const errors = sdk?.BdxRpcError;
  return {
    isUserRejection: (error: unknown) => Boolean(errors?.isUserRejection(error)),
    isLocked: (error: unknown) => Boolean(errors?.isLocked(error)),
    isUnknownOutcome: (error: unknown) => Boolean(errors?.isUnknownOutcome(error)),
    isUnauthorized: (error: unknown) => Boolean(errors?.isUnauthorized(error)),
  };
}

async function readBalance(instance: BeldexClient): Promise<Balance> {
  try {
    const funds = await instance.getBalance();
    return { unlocked: BigInt(funds.unlocked), approximate: Boolean(funds.approximate) };
  } catch {
    // A wallet that will not report a balance is reported as such, never guessed.
    return null;
  }
}

/**
 * Holds the one wallet connection for the whole app.
 *
 * Mounted once in the root layout, so a client-side navigation does not remount
 * it — and on a full reload it asks the wallet whether the grant is still there
 * (see `restoreGrant`, which cannot open a prompt).
 */
export function BeldexWalletProvider({ children }: { children: React.ReactNode }) {
  const sdkRef = useRef<SdkModule | null>(null);
  const clientRef = useRef<BeldexClient | null>(null);
  const bootRef = useRef<Promise<void> | null>(null);
  const [phase, setPhase] = useState<WalletPhase>("probing");
  const [restoring, setRestoring] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [balance, setBalance] = useState<Balance>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  // The grant probe, shared by the boot path and by `unlock` (a wallet that has
  // just been unlocked can re-activate a session that was granted before).
  const restore = useCallback(async (instance: BeldexClient) => {
    setRestoring(true);
    try {
      const outcome = await restoreGrant(instance, predicates(sdkRef.current).isUnauthorized);
      if (outcome.status === "connected") {
        setAddress(outcome.address);
        setNetwork(outcome.network);
        setPhase("connected");
        const funds = await readBalance(instance);
        setBalance(funds);
      } else {
        setPhase("available");
        if (outcome.note) setError(outcome.note);
      }
    } finally {
      setRestoring(false);
    }
  }, []);

  const boot = useCallback(async () => {
    try {
      const sdk = await import("@bdxi/web3js");
      sdkRef.current = sdk;
      const provider = await sdk.detectProvider({ timeoutMs: 2500 });
      if (!provider) {
        setPhase("absent");
        return;
      }
      const instance = new sdk.BeldexWeb3(provider) as unknown as BeldexClient;
      clientRef.current = instance;

      instance.on("accountsChanged", () => {
        // Grants are per (origin, wallet): a switched wallet needs a fresh connect.
        setAddress(null);
        setBalance(null);
        setPhase("available");
      });
      instance.on("lock", () => setLocked(true));
      instance.on("unlock", () => {
        setLocked(false);
        if (!instance.address) void restore(instance);
      });
      instance.on("disconnect", () => {
        setAddress(null);
        setBalance(null);
        setPhase("available");
      });
      // The wallet pushes this when a grant becomes active again, including when
      // unlocking restores a session — so the page reconnects without a click.
      instance.on("connect", (data) => {
        const next = data as { address?: string; network?: string } | undefined;
        if (!next?.address) return;
        setAddress(next.address);
        setNetwork(next.network ?? null);
        setPhase("connected");
        void readBalance(instance).then(setBalance);
      });
      instance.on("networkChanged", (data) => {
        const next = data as { network?: string } | undefined;
        if (next?.network) setNetwork(next.network);
      });
      instance.on("balanceChanged", (data) => {
        const next = data as { unlocked?: bigint; approximate?: boolean };
        if (next?.unlocked !== undefined) {
          setBalance({ unlocked: BigInt(next.unlocked), approximate: Boolean(next.approximate) });
        }
      });

      if (instance.address) {
        // The SDK already knows an address for this instance (a warm remount).
        setAddress(instance.address);
        setPhase("connected");
        setBalance(await readBalance(instance));
        return;
      }
      await restore(instance);
      // `restore` leaves the phase at "available" when there is no grant; make
      // sure a wallet that answered nothing at all still leaves probing.
      setPhase((current) => (current === "probing" ? "available" : current));
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Could not load the Beldex wallet connector.");
    }
  }, [restore]);

  useEffect(() => {
    // One boot for the app's lifetime, shared across React's double-invoked
    // mount. The provider is mounted once in the root layout and outlives every
    // navigation, so there is nothing to tear down: a late state update after an
    // unmount is ignored by React rather than being a leak worth guarding.
    bootRef.current ??= boot();
  }, [boot]);

  const connect = useCallback(async () => {
    const instance = clientRef.current;
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
      setBalance(await readBalance(instance));
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
  }, []);

  const disconnect = useCallback(async () => {
    await clientRef.current?.disconnect().catch(() => undefined);
    setAddress(null);
    setBalance(null);
    setPhase("available");
  }, []);

  const refreshBalance = useCallback(async () => {
    const instance = clientRef.current;
    if (!instance || !address) return;
    setBalance(await readBalance(instance));
  }, [address]);

  const signIn = useCallback(
    async (purpose: "signin" | "link" = "signin") => {
      const instance = clientRef.current;
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
    []
  );

  const send = useCallback(
    async (input: { to: string; amountAtomic: string; idempotencyKey: string }) => {
      const instance = clientRef.current;
      if (!instance) {
        return { ok: false as const, error: "The Beldex Wallet extension is not installed.", unknownOutcome: false };
      }
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
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : "The wallet refused the send.",
          unknownOutcome: false,
        };
      }
    },
    []
  );

  const resolveBns = useCallback(async (name: string) => {
    const instance = clientRef.current;
    if (!instance) return { ok: false as const, error: "The Beldex Wallet extension is not installed." };
    try {
      const result = await instance.resolveBns(name);
      return { ok: true as const, address: result.address };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "That name could not be resolved." };
    }
  }, []);

  const value = useMemo<UseBeldex>(
    () => ({
      phase,
      restoring,
      address,
      network,
      balance,
      locked,
      error,
      rejected,
      connect,
      disconnect,
      refreshBalance,
      signIn,
      send,
      resolveBns,
    }),
    [phase, restoring, address, network, balance, locked, error, rejected, connect, disconnect, refreshBalance, signIn, send, resolveBns]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
