import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BdxDaemon } from "@/lib/beldex/daemon";

const KEYS = ["BDX_NETWORK", "BDX_DAEMON_URL", "BDX_DAEMON_USER", "BDX_DAEMON_PASSWORD"] as const;
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

/** Captures the request a daemon call makes, and answers with a minimal get_info. */
function stubFetch() {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> });
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: "0", result: { height: 1, nettype: "testnet" } }),
    } as unknown as Response;
  });
  return calls;
}

describe("daemon credentials", () => {
  it("sends basic auth when a node is configured with a login", async () => {
    // A node reached through a tunnel is reachable by anyone, so it can be
    // started with --rpc-login; the app has to present those credentials.
    process.env.BDX_NETWORK = "testnet";
    process.env.BDX_DAEMON_URL = "https://node.example/json_rpc";
    process.env.BDX_DAEMON_USER = "blind";
    process.env.BDX_DAEMON_PASSWORD = "hunter2";
    const calls = stubFetch();

    await BdxDaemon.fromEnv()?.getInfo();

    expect(calls).toHaveLength(1);
    const expected = `Basic ${Buffer.from("blind:hunter2").toString("base64")}`;
    expect(calls[0].headers.authorization).toBe(expected);
  });

  it("sends no authorization header when the node needs none", async () => {
    process.env.BDX_NETWORK = "testnet";
    process.env.BDX_DAEMON_URL = "http://127.0.0.1:28081/json_rpc";
    const calls = stubFetch();

    await BdxDaemon.fromEnv()?.getInfo();

    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it("ignores a half-configured login rather than sending a broken header", async () => {
    // A user with no password (or the reverse) is a configuration mistake, not a
    // credential: sending "Basic <garbage>" would only produce a confusing 401.
    process.env.BDX_NETWORK = "testnet";
    process.env.BDX_DAEMON_URL = "http://127.0.0.1:28081/json_rpc";
    process.env.BDX_DAEMON_USER = "blind";
    const calls = stubFetch();

    await BdxDaemon.fromEnv()?.getInfo();

    expect(calls[0].headers.authorization).toBeUndefined();
  });
});
