import { describe, expect, it } from "vitest";
import { restoreGrant, type GrantReader } from "@/lib/wallet-restore";

/** A refusal: this origin holds no grant (protocol error 4100). */
class NoGrantError extends Error {
  readonly code = 4100;
  constructor() {
    super("Origin holds no grant for the active wallet.");
  }
}

const isNoGrant = (error: unknown) => (error as { code?: number })?.code === 4100;

function reader(overrides: Partial<GrantReader> = {}): GrantReader {
  return {
    getAddress: async () => "bdx1testnetaddress",
    getNetwork: async () => ({ nettype: "testnet" }),
    ...overrides,
  };
}

describe("silently restoring a wallet grant", () => {
  it("reconnects from a grant that outlived the page, with its network", async () => {
    const outcome = await restoreGrant(reader(), isNoGrant);
    expect(outcome).toEqual({ status: "connected", address: "bdx1testnetaddress", network: "testnet" });
  });

  it("stays quiet, and does not pretend to be connected, when there is no grant", async () => {
    const outcome = await restoreGrant(
      reader({
        getAddress: async () => {
          throw new NoGrantError();
        },
      }),
      isNoGrant
    );
    // note: null — an un-granted origin is the normal case, not an error to show.
    expect(outcome).toEqual({ status: "available", note: null });
  });

  it("surfaces an unexpected failure instead of hiding it behind a refusal", async () => {
    const outcome = await restoreGrant(
      reader({
        getAddress: async () => {
          throw new Error("the extension is not responding");
        },
      }),
      isNoGrant
    );
    expect(outcome.status).toBe("available");
    if (outcome.status === "available") expect(outcome.note).toContain("not responding");
  });

  it("treats an empty address as no connection", async () => {
    const outcome = await restoreGrant(reader({ getAddress: async () => "" }), isNoGrant);
    expect(outcome).toEqual({ status: "available", note: null });
  });

  it("still reports the connection when only the network label fails", async () => {
    const outcome = await restoreGrant(
      reader({
        getNetwork: async () => {
          throw new Error("network unavailable");
        },
      }),
      isNoGrant
    );
    expect(outcome).toEqual({ status: "connected", address: "bdx1testnetaddress", network: null });
  });
});
