import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { xAuthUrl, xScopes } from "@/lib/auth";

const KEYS = ["X_SCOPES", "X_CLIENT_ID"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.X_CLIENT_ID = "test-client";
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("X scopes", () => {
  it("asks only for the handle it actually reads", () => {
    // Blind reads users/me and nothing else; no tweet access is requested.
    expect(xScopes()).toBe("users.read");
  });

  it("lets a deployment override the scope list", () => {
    process.env.X_SCOPES = "users.read offline.access";
    expect(xScopes()).toBe("users.read offline.access");
  });

  it("ignores a blank override rather than sending an empty scope", () => {
    process.env.X_SCOPES = "   ";
    expect(xScopes()).toBe("users.read");
  });
});

describe("X authorize URL", () => {
  it("carries the callback, PKCE challenge and minimal scope", () => {
    const url = new URL(
      xAuthUrl({
        redirectUri: "https://blind.example/api/auth/x/callback",
        state: "state-123",
        challenge: "challenge-456",
      })
    );
    expect(url.origin + url.pathname).toBe("https://twitter.com/i/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://blind.example/api/auth/x/callback");
    expect(url.searchParams.get("scope")).toBe("users.read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-123");
  });
});
