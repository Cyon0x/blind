import { beforeAll, describe, expect, it } from "vitest";
import { csrfTokenFor, hashToken, originAllowed, appUrl, authDomain, authDomains } from "@/lib/session";

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

  it("binds wallet sign-in to the configured site and the host the request arrived on", () => {
    // The wallet signs the origin the user is actually browsing, which on a
    // preview alias or in local dev is not APP_URL. Binding only to APP_URL
    // made wallet sign-in impossible everywhere except the configured host.
    process.env.APP_URL = "https://blind.example";
    expect(authDomains("blind.example")).toEqual(["blind.example"]);
    expect(authDomains("localhost:3000")).toEqual(["blind.example", "localhost:3000"]);
    expect(authDomains("127.0.0.1:3000")).toEqual(["blind.example", "127.0.0.1:3000"]);
    expect(authDomains("blind-git-main-me.vercel.app")).toEqual(["blind.example", "blind-git-main-me.vercel.app"]);
  });

  it("does not let a spoofed Host header widen the wallet binding", () => {
    process.env.APP_URL = "https://blind.example";
    expect(authDomains("evil.example")).toEqual(["blind.example"]);
    expect(authDomains("blind.example.evil.example")).toEqual(["blind.example"]);
    expect(authDomains("not a host")).toEqual(["blind.example"]);
    expect(authDomains(null)).toEqual(["blind.example"]);
  });

  it("binds wallet sign-in to the request host when no app URL is configured", () => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(authDomains("localhost:3000")).toEqual(["localhost:3000"]);
    // Nothing we serve is named here, so there is no honest answer to "which
    // site is this?" — the list is empty and every statement is refused rather
    // than deriving the binding from the header under suspicion.
    expect(authDomains("evil.example")).toEqual([]);
  });
});
