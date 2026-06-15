import { describe, it, expect } from "vitest";
import {
  signSession,
  verifySession,
  readSessionCookie,
  sessionCookieHeader,
  clearSessionCookieHeader,
  SESSION_COOKIE,
} from "~/lib/session.server";

const SECRET = "test-secret-please-rotate";

describe("session cookie", () => {
  it("round-trips a signed email", async () => {
    const v = await signSession("alice@causalmap.app", SECRET);
    expect(await verifySession(v, SECRET)).toBe("alice@causalmap.app");
  });

  it("rejects a tampered payload", async () => {
    const v = await signSession("alice@causalmap.app", SECRET);
    const [, sig] = v.split(".");
    const forged = `${Buffer.from(JSON.stringify({ email: "evil@x.com", exp: 9999999999 })).toString("base64url")}.${sig}`;
    expect(await verifySession(forged, SECRET)).toBeNull();
  });

  it("rejects the wrong secret", async () => {
    const v = await signSession("alice@causalmap.app", SECRET);
    expect(await verifySession(v, "other-secret")).toBeNull();
  });

  it("rejects an expired session", async () => {
    const past = Date.now() - 60_000;
    const v = await signSession("alice@causalmap.app", SECRET, 10, past); // expired 50s ago
    expect(await verifySession(v, SECRET)).toBeNull();
  });

  it("returns null for missing or malformed values", async () => {
    expect(await verifySession(null, SECRET)).toBeNull();
    expect(await verifySession("", SECRET)).toBeNull();
    expect(await verifySession("nodot", SECRET)).toBeNull();
    expect(await verifySession("a.b", "")).toBeNull();
  });

  it("reads the cookie from a request header", () => {
    const req = new Request("https://x/", {
      headers: { Cookie: `other=1; ${SESSION_COOKIE}=abc.def; more=2` },
    });
    expect(readSessionCookie(req)).toBe("abc.def");
    expect(readSessionCookie(new Request("https://x/"))).toBeNull();
  });

  it("builds set and clear cookie headers", () => {
    expect(sessionCookieHeader("v")).toContain(`${SESSION_COOKIE}=v`);
    expect(sessionCookieHeader("v")).toContain("HttpOnly");
    expect(sessionCookieHeader("v")).toContain("Secure");
    expect(clearSessionCookieHeader()).toContain("Max-Age=0");
  });
});
