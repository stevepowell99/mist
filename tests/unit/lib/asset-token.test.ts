import { describe, it, expect } from "vitest";
import { signAssetToken, verifyAssetToken, assetScopeAllows, type AssetScope } from "~/lib/session.server";
import { ASSET_TOKEN_PLACEHOLDER, signAssetUrls } from "~/lib/drive-access.server";
import { driveAssetUrl, resolveAssetSrc } from "~/lib/asset-urls";

const SECRET = "test-secret-asset";
const DECK = { deck: "deckFile1", email: "steve@example.com" };

describe("asset token", () => {
  it("round-trips a deck token's scope", async () => {
    const t = await signAssetToken(SECRET, DECK);
    expect(await verifyAssetToken(t, SECRET)).toEqual({ deck: "deckFile1", email: "steve@example.com", asset: null });
  });

  it("rejects a wrong secret", async () => {
    const t = await signAssetToken(SECRET, DECK);
    expect(await verifyAssetToken(t, "other-secret")).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const t = await signAssetToken(SECRET, DECK);
    expect(await verifyAssetToken("x" + t.slice(1), SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const past = Date.now() - 10_000;
    const t = await signAssetToken(SECRET, DECK, 1, past); // 1s TTL, signed 10s ago
    expect(await verifyAssetToken(t, SECRET)).toBeNull();
  });

  it("rejects empty input or empty secret", async () => {
    expect(await verifyAssetToken("", SECRET)).toBeNull();
    expect(await verifyAssetToken(await signAssetToken(SECRET, DECK), "")).toBeNull();
  });

  it("rejects a token that names nothing", async () => {
    expect(await verifyAssetToken(await signAssetToken(SECRET, {}), SECRET)).toBeNull();
  });

  it("rejects the old unscoped token, which admitted everything", async () => {
    // The pre-scope format: {a:1, exp}, signed with the same HMAC.
    const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const payload = b64(JSON.stringify({ a: 1, exp: Math.floor(Date.now() / 1000) + 3600 }));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
    const legacy = `${payload}.${b64(String.fromCharCode(...sig))}`;
    expect(await verifyAssetToken(legacy, SECRET)).toBeNull();
  });
});

describe("assetScopeAllows", () => {
  const deckToken: AssetScope = { deck: "D", email: "v@example.com", asset: null };
  const onePath: AssetScope = { deck: "D", email: null, asset: "path:img/a b.png" };
  const oneId: AssetScope = { deck: null, email: null, asset: "id:LIB1" };

  it("lets a deck token reach its own deck's assets and library images", () => {
    expect(assetScopeAllows(deckToken, { deck: "D", path: "img/x.png" })).toBe(true);
    expect(assetScopeAllows(deckToken, { deck: "D", path: "../_shared/theme.css" })).toBe(true);
    expect(assetScopeAllows(deckToken, { id: "LIB1" })).toBe(true);
  });

  it("keeps a deck token to its own deck", () => {
    expect(assetScopeAllows(deckToken, { deck: "OTHER", path: "img/x.png" })).toBe(false);
  });

  it("lets a single-asset token reach that asset and nothing else", () => {
    expect(assetScopeAllows(onePath, { deck: "D", path: "img/a b.png" })).toBe(true);
    expect(assetScopeAllows(onePath, { deck: "D", path: "img/other.png" })).toBe(false);
    expect(assetScopeAllows(onePath, { deck: "OTHER", path: "img/a b.png" })).toBe(false);
    expect(assetScopeAllows(onePath, { id: "LIB1" })).toBe(false);
    expect(assetScopeAllows(oneId, { id: "LIB1" })).toBe(true);
    expect(assetScopeAllows(oneId, { id: "LIB2" })).toBe(false);
    expect(assetScopeAllows(oneId, { deck: "D", path: "img/a b.png" })).toBe(false);
  });

  it("does not treat a deck name without a viewer as a deck token", () => {
    expect(assetScopeAllows({ deck: "D", email: null, asset: null }, { deck: "D", path: "img/x.png" })).toBe(false);
    expect(assetScopeAllows({ deck: "D", email: null, asset: null }, { id: "LIB1" })).toBe(false);
  });
});

describe("signAssetUrls", () => {
  const env = { SESSION_SECRET: SECRET } as never;
  const drive = { fileId: "D", name: "deck.md", folderId: "F" };
  const ctx = { drive, origin: "https://m.example", driveToken: ASSET_TOKEN_PLACEHOLDER };

  it("gives each asset URL a token for exactly that asset", async () => {
    const img = resolveAssetSrc("img/a b (1).png", ctx);
    const css = driveAssetUrl(drive, ctx.origin, "../_shared/theme.css", ASSET_TOKEN_PLACEHOLDER);
    const lib = resolveAssetSrc("drive:LIB1", ctx);
    const html = `<img src="${img}"> <link href="${css}&cb=print"> ![](${lib})`;
    const out = await signAssetUrls(html, env);
    expect(out).not.toContain(ASSET_TOKEN_PLACEHOLDER);
    const urls = [...out.matchAll(/https:\/\/m\.example\/drive\/asset\?[^"\s]*?token=[\w.%-]*/g)].map((m) => new URL(m[0]));
    expect(urls).toHaveLength(3);
    const scopes = await Promise.all(urls.map((u) => verifyAssetToken(u.searchParams.get("token"), SECRET)));
    expect(assetScopeAllows(scopes[0]!, { deck: "D", path: urls[0].searchParams.get("path")! })).toBe(true);
    expect(urls[0].searchParams.get("path")).toBe("img/a b (1).png");
    expect(assetScopeAllows(scopes[0]!, { deck: "D", path: "img/other.png" })).toBe(false);
    expect(assetScopeAllows(scopes[1]!, { deck: "D", path: "../_shared/theme.css" })).toBe(true);
    expect(assetScopeAllows(scopes[2]!, { id: "LIB1" })).toBe(true);
    expect(assetScopeAllows(scopes[2]!, { id: "LIB2" })).toBe(false);
  });
});
