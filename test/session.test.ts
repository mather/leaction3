import { env, exports } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { getParticipantId, issueParticipantId } from "../src/worker/auth";
import worker from "../src/worker/index";

const BASE = "http://example.com/api/session";

function getSession(cookie?: string) {
  return exports.default.fetch(BASE, { headers: cookie ? { Cookie: cookie } : {} });
}

function postSession(body: unknown, cookie?: string, fetchEnv?: object) {
  const req = new Request(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return fetchEnv ? worker.fetch(req, fetchEnv) : exports.default.fetch(req);
}

/** Set-Cookie から `name=value` の部分だけを取り出す */
function cookiePair(res: Response): string {
  const header = res.headers.get("Set-Cookie");
  if (!header) throw new Error("Set-Cookie がない");
  return header.split(";")[0] ?? "";
}

describe("参加者セッション", () => {
  it("POST で署名付きの参加者 Cookie を発行する", async () => {
    const res = await postSession({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const header = res.headers.get("Set-Cookie") ?? "";
    expect(header).toMatch(/^pid=[^;]+\.[^;]+;/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
  });

  it("発行した Cookie があれば GET が成功し、なければ 401", async () => {
    expect((await getSession()).status).toBe(401);
    const cookie = cookiePair(await postSession({}));
    expect((await getSession(cookie)).status).toBe(200);
  });

  it("署名が合わない Cookie は無視する", async () => {
    const cookie = cookiePair(await postSession({}));
    const [name, value] = cookie.split("=") as [string, string];
    const [id, sig] = decodeURIComponent(value).split(".") as [string, string];
    // ID だけを書き換えても署名が合わない
    const forged = `${name}=${encodeURIComponent(`AAAAAAAAAAAAAAAA.${sig}`)}`;
    expect(id).not.toBe("AAAAAAAAAAAAAAAA");
    expect((await getSession(forged)).status).toBe(401);
    expect((await getSession("pid=AAAAAAAAAAAAAAAA")).status).toBe(401);
  });

  it("GET は同じ ID で Cookie を出し直し、有効期限を延ばす", async () => {
    const cookie = cookiePair(await postSession({}));
    const res = await getSession(cookie);
    expect(res.status).toBe(200);
    const header = res.headers.get("Set-Cookie") ?? "";
    expect(header.split(";")[0]).toBe(cookie);
    expect(header).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
  });

  it("有効な Cookie があれば POST は Turnstile を通さず、同じ ID で出し直す", async () => {
    const cookie = cookiePair(await postSession({}));
    const res = await postSession({}, cookie, { ...env, TURNSTILE_SECRET_KEY: "secret" });
    expect(res.status).toBe(200);
    expect(cookiePair(res)).toBe(cookie);
  });

  it("Cookie がなければ GET は Cookie を出さない", async () => {
    expect((await getSession()).headers.get("Set-Cookie")).toBeNull();
  });

  it("Turnstile に失敗したら Cookie を発行しない", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ success: false }));
    try {
      const secretEnv = { ...env, TURNSTILE_SECRET_KEY: "secret" };
      for (const body of [{}, { turnstileToken: "bad" }]) {
        const res = await postSession(body, undefined, secretEnv);
        expect(res.status).toBe(403);
        expect(res.headers.get("Set-Cookie")).toBeNull();
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("Turnstile の action が join のときだけ発行する", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ success: true, action: "create_event" }));
    try {
      const secretEnv = { ...env, TURNSTILE_SECRET_KEY: "secret" };
      expect((await postSession({ turnstileToken: "t" }, undefined, secretEnv)).status).toBe(403);
      spy.mockImplementation(async () => Response.json({ success: true, action: "join" }));
      expect((await postSession({ turnstileToken: "t" }, undefined, secretEnv)).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("不正な入力は 400", async () => {
    expect((await postSession({ turnstileToken: 1 })).status).toBe(400);
  });

  it("COOKIE_SECRET が未設定なら 500", async () => {
    const res = await worker.fetch(new Request(BASE), { ...env, COOKIE_SECRET: "" });
    expect(res.status).toBe(500);
  });
});

describe("getParticipantId", () => {
  // 以降の API（WebSocket など）は Cookie からサーバー側で参加者 ID を取り出す
  const app = new Hono()
    .post("/issue", async (c) => c.text(await issueParticipantId(c, "secret")))
    .get("/whoami", async (c) => c.json({ id: await getParticipantId(c, "secret") }));

  it("発行した ID を Cookie から取り出せる", async () => {
    const issued = await app.request("/issue", { method: "POST" });
    const id = await issued.text();
    expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    const cookie = cookiePair(issued);
    const res = await app.request("/whoami", { headers: { Cookie: cookie } });
    expect(await res.json()).toEqual({ id });
  });

  it("別の秘密鍵で署名された Cookie は受け付けない", async () => {
    const other = new Hono().post("/issue", async (c) => c.text(await issueParticipantId(c, "x")));
    const cookie = cookiePair(await other.request("/issue", { method: "POST" }));
    const res = await app.request("/whoami", { headers: { Cookie: cookie } });
    expect(await res.json()).toEqual({ id: null });
  });
});
