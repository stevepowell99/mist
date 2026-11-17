import { describe, it, expect, vi, beforeEach } from "vitest";
import { driveRoleFor, type DriveGrant } from "~/lib/drive-common";
import { signSession, SESSION_COOKIE, verifyAssetToken } from "~/lib/session.server";

const grants = vi.hoisted(() => ({ current: [] as DriveGrant[] }));
vi.mock("~/lib/google.server", async (importActual) => ({
  ...(await importActual<typeof import("~/lib/google.server")>()),
  isLocalMode: () => false,
  getDriveAccessToken: async () => "token",
  driveListPermissions: async () => grants.current,
}));

const { authorizeDoc, mintDeckToken, clearSharingCache, ANYONE_WITH_LINK_VIEWER } = await import(
  "~/lib/drive-access.server"
);

const SECRET = "test-secret";
const env = { SESSION_SECRET: SECRET } as never;
const drive = { fileId: "file1", folderId: "folder1", name: "agenda.md" } as never;
const anyone = (role: string): DriveGrant => ({ type: "anyone", role });
const user = (emailAddress: string, role: string): DriveGrant => ({ type: "user", role, emailAddress });

async function request(email?: string): Promise<Request> {
  const headers = email ? { Cookie: `${SESSION_COOKIE}=${await signSession(email, SECRET)}` } : undefined;
  return new Request("https://gmist.test/docs/abc?k=key", { headers });
}

describe("driveRoleFor", () => {
  it("admits a visitor who has not signed in only through an anyone grant", () => {
    expect(driveRoleFor([user("a@x.com", "writer"), { type: "domain", role: "writer", domain: "x.com" }], null)).toBeNull();
    expect(driveRoleFor([anyone("commenter"), user("a@x.com", "writer")], null)).toBe("commenter");
  });

  it("gives a signed-in user the highest of their grants", () => {
    expect(driveRoleFor([anyone("reader"), user("a@x.com", "writer")], "A@x.com")).toBe("writer");
    expect(driveRoleFor([user("b@x.com", "writer")], "a@x.com")).toBeNull();
  });
});

describe("authorizeDoc", () => {
  beforeEach(() => {
    grants.current = [];
    clearSharingCache();
  });

  it("decides on the sharing the room hands over, without asking Drive", async () => {
    grants.current = [];
    const res = await authorizeDoc(env, await request(), drive, "edit", [anyone("writer")]);
    expect(res.status).toBe("ok");
    expect(res.role).toBe("edit");
  });

  it("asks Drive for a file's sharing once across the opens of one page load", async () => {
    grants.current = [anyone("writer")];
    expect((await authorizeDoc(env, await request(), drive, "edit")).status).toBe("ok");
    // The sharing changes in Drive; an open moments later still sees the first answer.
    grants.current = [];
    expect((await authorizeDoc(env, await request(), drive, "edit")).status).toBe("ok");
    clearSharingCache();
    expect((await authorizeDoc(env, await request(), drive, "edit")).status).toBe("needsAuth");
  });

  it("asks a visitor to sign in when the file is not shared with anyone with the link", async () => {
    grants.current = [user("a@x.com", "writer")];
    const auth = await authorizeDoc(env, await request(), drive, "edit");
    expect(auth).toMatchObject({ status: "needsAuth", role: null, viewer: null });
  });

  it("admits a visitor without sign-in when the file is shared with anyone with the link", async () => {
    grants.current = [anyone("writer")];
    expect(await authorizeDoc(env, await request(), drive, "edit")).toEqual({
      status: "ok",
      role: "edit",
      email: null,
      viewer: ANYONE_WITH_LINK_VIEWER,
    });
  });

  it("keeps the more restrictive of the link and the anyone grant", async () => {
    grants.current = [anyone("commenter")];
    expect((await authorizeDoc(env, await request(), drive, "edit")).role).toBe("suggest");
    grants.current = [anyone("writer")];
    expect((await authorizeDoc(env, await request(), drive, "suggest")).role).toBe("suggest");
  });

  it("still refuses a bad key, whatever the sharing", async () => {
    grants.current = [anyone("writer")];
    expect((await authorizeDoc(env, await request(), drive, null)).status).toBe("badkey");
  });

  it("forbids a signed-in user the file is not shared with", async () => {
    grants.current = [user("b@x.com", "writer")];
    const auth = await authorizeDoc(env, await request("a@x.com"), drive, "edit");
    expect(auth).toMatchObject({ status: "forbidden", email: "a@x.com", viewer: null });
  });

  it("names the signed-in user as the viewer", async () => {
    grants.current = [user("a@x.com", "commenter")];
    expect(await authorizeDoc(env, await request("a@x.com"), drive, "edit")).toEqual({
      status: "ok",
      role: "suggest",
      email: "a@x.com",
      viewer: "a@x.com",
    });
  });

  it("mints a deck token for a visitor admitted by anyone with the link", async () => {
    grants.current = [anyone("reader")];
    const auth = await authorizeDoc(env, await request(), drive, "suggest");
    const token = await mintDeckToken(env, "file1", auth.viewer);
    expect(await verifyAssetToken(token, SECRET)).toEqual({ deck: "file1", email: ANYONE_WITH_LINK_VIEWER, asset: null });
  });
});
