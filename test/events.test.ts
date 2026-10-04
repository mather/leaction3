import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { CreateEventResponse } from "../src/shared/api";
import { hashToken } from "../src/worker/auth";
import { verifyTurnstile } from "../src/worker/turnstile";

const validInput = {
  name: "  LT 会 #1  ",
  date: "2026-10-01",
  url: "",
  hashtag: "#ltkai",
  talks: [
    { speaker: "山田", title: "SolidJS 入門" },
    { speaker: "佐藤", title: "" },
  ],
};

function postEvent(body: unknown) {
  return exports.default.fetch("http://example.com/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/events", () => {
  it("D1 と EventRoom に保存し、作成者トークンを返す", async () => {
    const res = await postEvent(validInput);
    expect(res.status).toBe(201);
    const { id, ownerToken } = await res.json<CreateEventResponse>();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(ownerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const indexed = await env.DB.prepare("SELECT name, date, deleted_at FROM events WHERE id = ?")
      .bind(id)
      .first();
    expect(indexed).toEqual({ name: "LT 会 #1", date: "2026-10-01", deleted_at: null });

    const stored = await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => {
      const sql = state.storage.sql;
      return {
        event: sql.exec("SELECT id, name, date, url, hashtag, comments_open FROM event").toArray(),
        talks: sql.exec("SELECT position, speaker, title FROM talks ORDER BY position").toArray(),
        keys: sql.exec("SELECT role, token_hash, revoked_at FROM admin_keys").toArray(),
      };
    });
    expect(stored.event).toEqual([
      { id, name: "LT 会 #1", date: "2026-10-01", url: null, hashtag: "ltkai", comments_open: 1 },
    ]);
    expect(stored.talks).toEqual([
      { position: 0, speaker: "山田", title: "SolidJS 入門" },
      { position: 1, speaker: "佐藤", title: "" },
    ]);
    // 平文は保存せず、SHA-256 のハッシュだけを持つ
    expect(stored.keys).toEqual([
      { role: "owner", token_hash: await hashToken(ownerToken), revoked_at: null },
    ]);
  });

  it("作成ごとに別の ID とトークンを発行する", async () => {
    const a = await (await postEvent(validInput)).json<CreateEventResponse>();
    const b = await (await postEvent(validInput)).json<CreateEventResponse>();
    expect(a.id).not.toBe(b.id);
    expect(a.ownerToken).not.toBe(b.ownerToken);
  });

  it.each([
    ["名前が空", { ...validInput, name: "   " }],
    ["存在しない日付", { ...validInput, date: "2026-02-30" }],
    ["http(s) 以外の URL", { ...validInput, url: "javascript:alert(1)" }],
    ["空白を含むハッシュタグ", { ...validInput, hashtag: "lt kai" }],
    ["発表枠がない", { ...validInput, talks: [] }],
    ["発表者もタイトルも空の枠", { ...validInput, talks: [{ speaker: "", title: " " }] }],
    ["名前が長すぎる", { ...validInput, name: "あ".repeat(101) }],
    ["JSON でない", "not json"],
  ])("入力が不正なら 400（%s）", async (_, body) => {
    const res = await postEvent(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input" });
  });

  it("URL は http(s) なら保存する", async () => {
    const res = await postEvent({ ...validInput, url: "https://example.com/lt" });
    const { id } = await res.json<CreateEventResponse>();
    const url = await runInDurableObject(
      env.EVENT_ROOM.getByName(id),
      (_, state) => state.storage.sql.exec<{ url: string }>("SELECT url FROM event").one().url,
    );
    expect(url).toBe("https://example.com/lt");
  });
});

describe("EventRoom.initialize", () => {
  const params = {
    event: {
      name: "x",
      date: "2026-10-01",
      url: null,
      hashtag: null,
      talks: [{ speaker: "a", title: "b" }],
    },
    ownerTokenHash: "0".repeat(64),
  };

  it("D1 で使用済みの ID なら何も書かずに id_taken", async () => {
    await env.DB.prepare(
      "INSERT INTO events (id, name, date, created_at) VALUES ('taken001', 'x', '2026-10-01', 0)",
    ).run();
    const stub = env.EVENT_ROOM.getByName("taken001");
    expect(await stub.initialize({ id: "taken001", ...params })).toEqual({
      ok: false,
      reason: "id_taken",
    });
    const rows = await runInDurableObject(stub, (_, state) =>
      state.storage.sql.exec("SELECT 1 FROM event").toArray(),
    );
    expect(rows).toEqual([]);
  });

  it("SQLite への書き込みに失敗したら D1 の索引も消す", async () => {
    const stub = env.EVENT_ROOM.getByName("broken01");
    // talks.speaker の NOT NULL 制約に違反させる
    const broken = { ...params.event, talks: [{ speaker: null as unknown as string, title: "b" }] };
    // RPC 越しに投げると workerd が未処理の reject として報告するので、DO の中で直接呼ぶ
    await runInDurableObject(stub, (room) =>
      expect(
        room.initialize({ id: "broken01", event: broken, ownerTokenHash: params.ownerTokenHash }),
      ).rejects.toThrow(),
    );
    const indexed = await env.DB.prepare("SELECT 1 FROM events WHERE id = 'broken01'").first();
    expect(indexed).toBeNull();
    const rows = await runInDurableObject(stub, (_, state) =>
      state.storage.sql.exec("SELECT 1 FROM event").toArray(),
    );
    expect(rows).toEqual([]);
  });

  it("初期化済みなら id_taken", async () => {
    const stub = env.EVENT_ROOM.getByName("twice001");
    expect(await stub.initialize({ id: "twice001", ...params })).toEqual({ ok: true });
    expect(await stub.initialize({ id: "twice001", ...params })).toEqual({
      ok: false,
      reason: "id_taken",
    });
  });
});

describe("verifyTurnstile", () => {
  it("秘密鍵が未設定なら検証を省略する", async () => {
    expect(await verifyTurnstile({}, undefined, undefined, "create_event")).toBe(true);
  });

  it("Siteverify に届かなければ拒否する", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network error"));
    try {
      expect(
        await verifyTurnstile(
          { TURNSTILE_SECRET_KEY: "secret" },
          "token",
          undefined,
          "create_event",
        ),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("action が一致したときだけ通す", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ success: true, action: "join" }));
    try {
      const secretEnv = { TURNSTILE_SECRET_KEY: "secret" };
      expect(await verifyTurnstile(secretEnv, "token", undefined, "join")).toBe(true);
      expect(await verifyTurnstile(secretEnv, "token", undefined, "create_event")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("テスト用の秘密鍵の応答なら action を照合しない", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        Response.json({ success: true, metadata: { result_with_testing_key: true } }),
      );
    try {
      expect(
        await verifyTurnstile(
          { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" },
          "XXXX.DUMMY.TOKEN.XXXX",
          undefined,
          "create_event",
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("テスト用の秘密鍵でも失敗の応答なら拒否する", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        Response.json({ success: false, metadata: { result_with_testing_key: true } }),
      );
    try {
      expect(
        await verifyTurnstile(
          { TURNSTILE_SECRET_KEY: "2x0000000000000000000000000000000AA" },
          "XXXX.DUMMY.TOKEN.XXXX",
          undefined,
          "create_event",
        ),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("秘密鍵があるのにトークンがなければ拒否する", async () => {
    expect(
      await verifyTurnstile(
        { TURNSTILE_SECRET_KEY: "secret" },
        undefined,
        undefined,
        "create_event",
      ),
    ).toBe(false);
  });
});
