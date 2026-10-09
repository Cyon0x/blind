import { beforeAll, describe, expect, it } from "vitest";
import { csrfTokenFor, hashToken, originAllowed, appUrl, authDomain } from "@/lib/session";

beforeAll(() => {
  process.env.AUTH_SECRET = "blind-test-secret-long-enough-to-sign";
});

describe("session token handling", () => {
  it("stores only a hash of the session token", () => {
    const token = "a-session-token";
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("binds the CSRF token to the session, so another session's token is useless", () => {
    const a = csrfTokenFor("session-a");
    const b = csrfTokenFor("session-b");
    expect(a).not.toBe(b);
    expect(a).toBe(csrfTokenFor("session-a"));
    expect(a).not.toContain("session-a");
  });

  it("changes the CSRF token when the signing secret changes", () => {
    const before = csrfTokenFor("session-a");
    process.env.AUTH_SECRET = "a-different-secret-also-long-enough";
    expect(csrfTokenFor("session-a")).not.toBe(before);
    process.env.AUTH_SECRET = "blind-test-secret-long-enough-to-sign";
  });

  it("refuses to mint tokens without a strong secret", () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "short";
    expect(() => csrfTokenFor("session-a")).toThrow(/AUTH_SECRET/);
    process.env.AUTH_SECRET = original;
  });
});

describe("origin and URL handling", () => {
  it("accepts this deployment, localhost and its own previews, and nothing else", () => {
    process.env.APP_URL = "https://blind.example";
    expect(originAllowed("https://blind.example")).toBe(true);
    expect(originAllowed("http://localhost:3000")).toBe(true);
    expect(originAllowed("https://blind-git-main-me.vercel.app")).toBe(true);
    expect(originAllowed("https://evil.example")).toBe(false);
    expect(originAllowed("http://blind.example")).toBe(false);
    expect(originAllowed("not a url")).toBe(false);
  });

  it("answers with the configured app URL and its bare host", () => {
    process.env.APP_URL = "https://blind.example/";
    expect(appUrl()).toBe("https://blind.example");
    expect(authDomain()).toBe("blind.example");
  });

  it("falls back to the request host, and to http only on loopback", () => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(appUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(appUrl("blind.example")).toBe("https://blind.example");
    expect(appUrl()).toBe("http://localhost:3000");
  });
});
