import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type {
  AdminSessionResponse,
  GetAdminResponse,
  TalksResponse,
  UpdateEventResponse,
} from "../src/shared/api";
import {
  connect,
  createEvent,
  expectType,
  ORIGIN,
  participant,
  postAdminSession,
  request,
  setupAdmin as setup,
} from "./helpers";

describe("POST /api/rooms/:id/admin/session", () => {
  it("作成者トークンを、そのイベントの API に絞った HttpOnly Cookie に入れ替える", async () => {
    const { id, ownerToken } = await createEvent();
    const res = await postAdminSession(id, ownerToken);
    expect(res.status).toBe(200);
    expect(await res.json<AdminSessionResponse>()).toEqual({ role: "owner" });
    const header = res.headers.get("Set-Cookie") ?? "";
    expect(header).toMatch(/^adm=[^;]+;/);
    // Cookie にトークンそのものは入れない
    expect(header).not.toContain(ownerToken);
    expect(header).toContain(`Path=/api/rooms/${id}`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
  });

  it("トークンが違えば 401", async () => {
    const { id } = await createEvent();
    const other = await createEvent();
    // 別のイベントの作成者トークンでも入れない
    const res = await postAdminSession(id, other.ownerToken);
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("トークンの形式が不正なら 400", async () => {
    const { id } = await createEvent();
    expect((await postAdminSession(id, "short")).status).toBe(400);
  });

  it("Origin が違えば 403", async () => {
    const { id, ownerToken } = await createEvent();
    expect((await postAdminSession(id, ownerToken, "https://evil.example")).status).toBe(403);
    expect((await postAdminSession(id, ownerToken, null)).status).toBe(403);
  });

  it("イベントがなければ 404", async () => {
    const { ownerToken } = await createEvent();
    expect((await postAdminSession("nothere1", ownerToken)).status).toBe(404);
  });
});

describe("GET /api/rooms/:id/admin", () => {
  it("権限・イベント情報・発表枠・発表ごとのコメント数を返す", async () => {
    const { id, talkIds, cookie } = await setup();
    const [talk] = talkIds as [string];
    const ws = await connect(id, await participant());
    await expectType(ws, "snapshot");
    ws.post(talk, "こんにちは");
    await expectType(ws, "comment.added");

    const res = await request(`/api/rooms/${id}/admin`, { cookie });
    expect(res.status).toBe(200);
    const body = await res.json<GetAdminResponse>();
    expect(body.role).toBe("owner");
    expect(body.event.name).toBe("LT 会");
    expect(body.talks.map((t) => t.id)).toEqual(talkIds);
    expect(body.commentCounts).toEqual({ [talk]: 1 });
  });

  it("管理 Cookie がなければ 401", async () => {
    const { id } = await createEvent();
    expect((await request(`/api/rooms/${id}/admin`)).status).toBe(401);
  });

  it("別のイベントの管理 Cookie は使えない", async () => {
    const a = await setup();
    const b = await createEvent();
    expect((await request(`/api/rooms/${b.id}/admin`, { cookie: a.cookie })).status).toBe(401);
  });

  it("管理キーが無効化されたら 401 にして Cookie を消す", async () => {
    const { id, cookie } = await setup();
    await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => {
      state.storage.sql.exec("UPDATE admin_keys SET revoked_at = 1");
    });
    const res = await request(`/api/rooms/${id}/admin`, { cookie });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toMatch(/^adm=;/);
  });
});

describe("PATCH /api/rooms/:id", () => {
  it("変更した項目だけを更新し、D1 の索引と参加者の画面に反映する", async () => {
    const { id, cookie } = await setup();
    const ws = await connect(id, await participant());
    await expectType(ws, "snapshot");

    const res = await request(`/api/rooms/${id}`, {
      method: "PATCH",
      cookie,
      body: { name: " 新しい名前 ", hashtag: "#newtag" },
    });
    expect(res.status).toBe(200);
    const { event } = await res.json<UpdateEventResponse>();
    expect(event).toMatchObject({ name: "新しい名前", date: "2026-10-01", hashtag: "newtag" });

    const updated = await expectType(ws, "event.updated");
    expect(updated).toEqual({ type: "event.updated", seq: 1, event });

    const indexed = await env.DB.prepare("SELECT name, date FROM events WHERE id = ?")
      .bind(id)
      .first();
    expect(indexed).toEqual({ name: "新しい名前", date: "2026-10-01" });
  });

  it("空文字で URL・ハッシュタグを消せる", async () => {
    const { id, cookie } = await setup();
    await request(`/api/rooms/${id}`, {
      method: "PATCH",
      cookie,
      body: { url: "https://example.com", hashtag: "tag" },
    });
    const res = await request(`/api/rooms/${id}`, {
      method: "PATCH",
      cookie,
      body: { url: "", hashtag: null },
    });
    const { event } = await res.json<UpdateEventResponse>();
    expect(event).toMatchObject({ url: null, hashtag: null });
  });

  it.each([
    ["項目がない", {}],
    ["名前が空", { name: " " }],
    ["存在しない日付", { date: "2026-02-30" }],
    ["http(s) 以外の URL", { url: "javascript:alert(1)" }],
    ["知らない項目", { unknown: 1 }],
    ["受付の切り替えが真偽値でない", { commentsOpen: "no" }],
  ])("入力が不正なら 400（%s）", async (_, body) => {
    const { id, cookie } = await setup();
    const res = await request(`/api/rooms/${id}`, { method: "PATCH", cookie, body });
    expect(res.status).toBe(400);
  });

  it("Origin が違えば 403（CSRF 対策）", async () => {
    const { id, cookie } = await setup();
    for (const origin of ["https://evil.example", null]) {
      const res = await request(`/api/rooms/${id}`, {
        method: "PATCH",
        cookie,
        origin,
        body: { name: "乗っ取り" },
      });
      expect(res.status).toBe(403);
    }
  });

  it("管理 Cookie がなければ 401", async () => {
    const { id } = await createEvent();
    const cookie = await participant();
    const res = await request(`/api/rooms/${id}`, {
      method: "PATCH",
      cookie,
      body: { name: "x" },
    });
    expect(res.status).toBe(401);
  });
});

describe("発表枠の管理", () => {
  it("POST で末尾に追加し、talks.updated を配信する", async () => {
    const { id, talkIds, cookie } = await setup();
    const ws = await connect(id, await participant());
    await expectType(ws, "snapshot");

    const res = await request(`/api/rooms/${id}/talks`, {
      method: "POST",
      cookie,
      body: { speaker: " 鈴木 ", title: "" },
    });
    expect(res.status).toBe(200);
    const { talks } = await res.json<TalksResponse>();
    expect(talks.slice(0, 2).map((t) => t.id)).toEqual(talkIds);
    expect(talks[2]).toMatchObject({ speaker: "鈴木", title: "" });
    expect(await expectType(ws, "talks.updated")).toEqual({ type: "talks.updated", seq: 1, talks });
  });

  it("発表者もタイトルも空なら追加できない", async () => {
    const { id, cookie } = await setup();
    const res = await request(`/api/rooms/${id}/talks`, {
      method: "POST",
      cookie,
      body: { speaker: "", title: " " },
    });
    expect(res.status).toBe(400);
  });

  it("PATCH で変更した項目だけを編集する", async () => {
    const { id, talkIds, cookie } = await setup();
    const [talk] = talkIds as [string];
    const res = await request(`/api/rooms/${id}/talks/${talk}`, {
      method: "PATCH",
      cookie,
      body: { title: "Solid 2.0" },
    });
    expect(res.status).toBe(200);
    const { talks } = await res.json<TalksResponse>();
    expect(talks[0]).toEqual({ id: talk, speaker: "山田", title: "Solid 2.0" });
  });

  it("編集で発表者もタイトルも空になるなら 400", async () => {
    const { id, talkIds, cookie } = await setup();
    // 2 番目は発表者だけの枠（タイトルは空）
    const talk = talkIds[1] as string;
    const res = await request(`/api/rooms/${id}/talks/${talk}`, {
      method: "PATCH",
      cookie,
      body: { speaker: "" },
    });
    expect(res.status).toBe(400);
  });

  it("存在しない発表枠は 404", async () => {
    const { id, cookie } = await setup();
    const res = await request(`/api/rooms/${id}/talks/nothere1`, {
      method: "PATCH",
      cookie,
      body: { title: "x" },
    });
    expect(res.status).toBe(404);
    expect(
      (await request(`/api/rooms/${id}/talks/nothere1`, { method: "DELETE", cookie })).status,
    ).toBe(404);
  });

  it("DELETE でその発表のコメントといいねも消す", async () => {
    const { id, talkIds, cookie } = await setup();
    const [first, second] = talkIds as [string, string];
    const alice = await connect(id, await participant());
    const bob = await connect(id, await participant());
    await expectType(alice, "snapshot");
    await expectType(bob, "snapshot");
    alice.post(first, "消える");
    const removed = await expectType(alice, "comment.added");
    await expectType(bob, "comment.added");
    alice.post(second, "残る");
    await expectType(alice, "comment.added");
    await expectType(bob, "comment.added");
    bob.send({ type: "like.set", commentId: removed.comment.id, liked: true });
    await expectType(alice, "like.changed");

    const res = await request(`/api/rooms/${id}/talks/${first}`, { method: "DELETE", cookie });
    expect(res.status).toBe(200);
    const { talks } = await res.json<TalksResponse>();
    expect(talks.map((t) => t.id)).toEqual([second]);
    expect((await expectType(alice, "talks.updated")).talks).toEqual(talks);

    const stored = await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => ({
      comments: state.storage.sql.exec("SELECT body FROM comments").toArray(),
      likes: state.storage.sql.exec("SELECT 1 FROM likes").toArray(),
    }));
    expect(stored).toEqual({ comments: [{ body: "残る" }], likes: [] });
  });

  it("最後の 1 枠は削除できない", async () => {
    const { id, talkIds, cookie } = await setup();
    const [first, second] = talkIds as [string, string];
    await request(`/api/rooms/${id}/talks/${first}`, { method: "DELETE", cookie });
    const res = await request(`/api/rooms/${id}/talks/${second}`, { method: "DELETE", cookie });
    expect(res.status).toBe(409);
  });

  it("PUT /talks/order で並べ替える", async () => {
    const { id, talkIds, cookie } = await setup();
    const reversed = [...talkIds].reverse();
    const res = await request(`/api/rooms/${id}/talks/order`, {
      method: "PUT",
      cookie,
      body: { ids: reversed },
    });
    expect(res.status).toBe(200);
    expect((await res.json<TalksResponse>()).talks.map((t) => t.id)).toEqual(reversed);

    const event = await exports.default.fetch(`${ORIGIN}/api/rooms/${id}`);
    const { talks } = await event.json<TalksResponse>();
    expect(talks.map((t) => t.id)).toEqual(reversed);
  });

  it.each([
    ["足りない", (ids: string[]) => ids.slice(1)],
    ["重複している", (ids: string[]) => [ids[0], ids[0]]],
    ["知らない ID がある", (ids: string[]) => [ids[0], "nothere1"]],
  ])("並べ替えの ID が今の発表枠と合わなければ 409（%s）", async (_, make) => {
    const { id, talkIds, cookie } = await setup();
    const res = await request(`/api/rooms/${id}/talks/order`, {
      method: "PUT",
      cookie,
      body: { ids: make(talkIds) },
    });
    expect(res.status).toBe(409);
  });

  it("Origin が違えば 403（CSRF 対策）", async () => {
    const { id, talkIds, cookie } = await setup();
    const res = await request(`/api/rooms/${id}/talks/${talkIds[0]}`, {
      method: "DELETE",
      cookie,
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });
});

describe("再接続時の補完", () => {
  it("取りこぼした event.updated・talks.updated を今の内容で送り直す", async () => {
    const { id, talkIds, cookie } = await setup();
    await request(`/api/rooms/${id}`, { method: "PATCH", cookie, body: { name: "古い名前" } });
    await request(`/api/rooms/${id}/talks/order`, {
      method: "PUT",
      cookie,
      body: { ids: [...talkIds].reverse() },
    });
    await request(`/api/rooms/${id}`, { method: "PATCH", cookie, body: { name: "今の名前" } });

    const ws = await connect(id, await participant(), 0);
    const first = await expectType(ws, "event.updated");
    expect(first).toMatchObject({ seq: 1, event: { name: "今の名前" } });
    const talks = await expectType(ws, "talks.updated");
    expect(talks.seq).toBe(2);
    expect(talks.talks.map((t) => t.id)).toEqual([...talkIds].reverse());
    expect(await expectType(ws, "event.updated")).toMatchObject({ seq: 3 });
  });
});
