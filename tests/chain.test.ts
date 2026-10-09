import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainReader, chainSource } from "@/lib/beldex/chain";

const KEYS = ["BDX_NETWORK", "BDX_DAEMON_URL", "BDX_EXPLORER_API_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

describe("chain reader selection", () => {
  it("defaults to testnet, and to the official testnet explorer", () => {
    // An unconfigured deployment must fail safe, so testnet is the default.
    expect(chainSource()).toBe("explorer");
    expect(chainReader()).not.toBeNull();
  });

  it("prefers a daemon when one is configured", () => {
    process.env.BDX_DAEMON_URL = "http://127.0.0.1:29095/json_rpc";
    process.env.BDX_EXPLORER_API_URL = "https://testnet.beldex.dev";
    expect(chainSource()).toBe("daemon");
  });

  it("falls back to the explorer when only the explorer is configured", () => {
    process.env.BDX_NETWORK = "devnet";
    process.env.BDX_EXPLORER_API_URL = "https://example.invalid";
    expect(chainSource()).toBe("explorer");
  });

  it("has no reader at all when neither is configured", () => {
    process.env.BDX_NETWORK = "devnet";
    expect(chainSource()).toBeNull();
    expect(chainReader()).toBeNull();
  });

  it("lets BDX_EXPLORER_API_URL point at another explorer", () => {
    process.env.BDX_EXPLORER_API_URL = "https://my-own-node.example";
    expect(chainSource()).toBe("explorer");
  });
});
