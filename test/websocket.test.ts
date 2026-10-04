import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { CreateEventResponse, GetEventResponse } from "../src/shared/api";
import type { ClientMessage, ServerMessage } from "../src/shared/protocol";
import { DEFAULT_LIMITS } from "../src/shared/schema";

const ORIGIN = "http://example.com";

async function createEvent(): Promise<{ id: string; talkIds: string[] }> {
  const res = await exports.default.fetch(`${ORIGIN}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "LT 会",
      date: "2026-10-01",
      talks: [
        { speaker: "山田", title: "SolidJS 入門" },
        { speaker: "佐藤", title: "" },
      ],
    }),
  });
  const { id } = await res.json<CreateEventResponse>();
  const event = await exports.default.fetch(`${ORIGIN}/api/events/${id}`);
  const { talks } = await event.json<GetEventResponse>();
  return { id, talkIds: talks.map((t) => t.id) };
}

/** 参加者 Cookie（`pid=...`）を発行してもらう */
async function participant(): Promise<string> {
  const res = await exports.default.fetch(`${ORIGIN}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

function upgrade(path: string, headers: Record<string, string>) {
  return exports.default.fetch(`${ORIGIN}${path}`, {
    headers: { Upgrade: "websocket", Origin: ORIGIN, ...headers },
  });
}

/** 受け取ったメッセージを順に取り出せる WebSocket クライアント */
class Client {
  private readonly queue: ServerMessage[] = [];
  private waiter: ((m: ServerMessage) => void) | undefined;

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string" || e.data === "pong") return;
      const message = JSON.parse(e.data) as ServerMessage;
      if (this.waiter) {
        this.waiter(message);
        this.waiter = undefined;
      } else {
        this.queue.push(message);
      }
    });
    ws.accept();
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("メッセージが届かない")), 2000);
      this.waiter = (m) => {
        clearTimeout(timer);
        resolve(m);
      };
    });
  }

  send(message: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message));
  }

  post(talkId: string, body: string, clientId = crypto.randomUUID()): string {
    this.send({ type: "comment.post", talkId, body, clientId });
    return clientId;
  }
}

async function connect(eventId: string, cookie: string, since?: number): Promise<Client> {
  const query = since === undefined ? "" : `?since=${since}`;
  const res = await upgrade(`/api/events/${eventId}/ws${query}`, { Cookie: cookie });
  expect(res.status).toBe(101);
  if (!res.webSocket) throw new Error("webSocket がない");
  return new Client(res.webSocket);
}

async function expectType<T extends ServerMessage["type"]>(
  client: Client,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  const message = await client.next();
  expect(message.type).toBe(type);
  return message as Extract<ServerMessage, { type: T }>;
}

describe("GET /api/events/:id/ws の検証", () => {
  it("WebSocket でなければ 426", async () => {
    const { id } = await createEvent();
    const res = await exports.default.fetch(`${ORIGIN}/api/events/${id}/ws`, {
      headers: { Cookie: await participant() },
    });
    expect(res.status).toBe(426);
  });

  it("Origin が違えば 403", async () => {
    const { id } = await createEvent();
    const cookie = await participant();
    for (const origin of ["https://evil.example", ""]) {
      const res = await upgrade(`/api/events/${id}/ws`, { Cookie: cookie, Origin: origin });
      expect(res.status).toBe(403);
    }
  });

  it("参加者 Cookie がなければ 401", async () => {
    const { id } = await createEvent();
    expect((await upgrade(`/api/events/${id}/ws`, {})).status).toBe(401);
  });

  it("イベントがなければ 404", async () => {
    const res = await upgrade("/api/events/nothere1/ws", { Cookie: await participant() });
    expect(res.status).toBe(404);
  });
});

describe("snapshot", () => {
  it("接続直後にイベント・発表枠・コメントを送る", async () => {
    const { id, talkIds } = await createEvent();
    const client = await connect(id, await participant());
    const snapshot = await expectType(client, "snapshot");
    expect(snapshot.seq).toBe(0);
    expect(snapshot.event.name).toBe("LT 会");
    expect(snapshot.talks.map((t) => t.id)).toEqual(talkIds);
    expect(snapshot.comments).toEqual([]);
  });

  it("投稿済みのコメントを古い順に、閲覧者から見た形で含める", async () => {
    const { id, talkIds } = await createEvent();
    const [talk] = talkIds as [string];
    const alice = await participant();
    const a = await connect(id, alice);
    await expectType(a, "snapshot");
    const clientId = a.post(talk, "1 件目");
    await expectType(a, "comment.added");
    a.post(talk, "2 件目");
    await expectType(a, "comment.added");

    const mine = await expectType(await connect(id, alice), "snapshot");
    expect(mine.seq).toBe(2);
    expect(mine.comments.map((c) => c.body)).toEqual(["1 件目", "2 件目"]);
    expect(mine.comments[0]).toMatchObject({ mine: true, clientId, likes: 0, likedByMe: false });

    const others = await expectType(await connect(id, await participant()), "snapshot");
    expect(others.comments[0]?.mine).toBe(false);
    expect(others.comments[0]).not.toHaveProperty("clientId");
  });
});

describe("comment.post", () => {
  it("全接続に comment.added を配信し、投稿者を Cookie から決める", async () => {
    const { id, talkIds } = await createEvent();
    const [talk] = talkIds as [string];
    const a = await connect(id, await participant());
    const b = await connect(id, await participant());
    await expectType(a, "snapshot");
    await expectType(b, "snapshot");

    // クライアントから投稿者を偽っても無視される
    a.send({
      type: "comment.post",
      talkId: talk,
      body: "  こんにちは \n",
      clientId: "c1",
      authorId: "x",
    });
    const toA = await expectType(a, "comment.added");
    const toB = await expectType(b, "comment.added");
    expect(toA.seq).toBe(1);
    expect(toA.comment).toMatchObject({
      talkId: talk,
      body: "こんにちは",
      likes: 0,
      mine: true,
      clientId: "c1",
    });
    expect(toB).toEqual({ ...toA, comment: { ...toA.comment, mine: false, clientId: undefined } });
    expect(toB.comment).not.toHaveProperty("clientId");
  });

  it("同じ clientId の再送は登録せず comment.accepted を返す", async () => {
    const { id, talkIds } = await createEvent();
    const [talk] = talkIds as [string];
    const cookie = await participant();
    const a = await connect(id, cookie);
    await expectType(a, "snapshot");
    a.post(talk, "一度だけ", "dup");
    const added = await expectType(a, "comment.added");
    a.post(talk, "一度だけ", "dup");
    expect(await a.next()).toEqual({
      type: "comment.accepted",
      clientId: "dup",
      commentId: added.comment.id,
    });
    const snapshot = await expectType(await connect(id, cookie), "snapshot");
    expect(snapshot.comments).toHaveLength(1);
  });

  it("文字数上限を超える・空の本文は invalid_message", async () => {
    const { id, talkIds } = await createEvent();
    const [talk] = talkIds as [string];
    const a = await connect(id, await participant());
    await expectType(a, "snapshot");

    const max = DEFAULT_LIMITS.commentMaxLength;
    // 絵文字も 1 文字と数える
    a.post(talk, "😀".repeat(max));
    expect((await expectType(a, "comment.added")).comment.body).toHaveLength(max * 2);
    for (const body of ["a".repeat(max + 1), " \n "]) {
      const clientId = a.post(talk, body);
      expect(await a.next()).toEqual({ type: "error", code: "invalid_message", clientId });
    }
    a.ws.send("not json");
    expect(await a.next()).toEqual({ type: "error", code: "invalid_message" });
  });

  it("存在しない発表には not_found", async () => {
    const { id } = await createEvent();
    const a = await connect(id, await participant());
    await expectType(a, "snapshot");
    const clientId = a.post("nothere1", "どこ？");
    expect(await a.next()).toEqual({ type: "error", code: "not_found", clientId });
  });

  it(`連投は ${DEFAULT_LIMITS.rateLimitWindowSec} 秒に ${DEFAULT_LIMITS.rateLimitCount} 件まで`, async () => {
    const { id, talkIds } = await createEvent();
    const [talk] = talkIds as [string];
    const cookie = await participant();
    const a = await connect(id, cookie);
    await expectType(a, "snapshot");
    for (let i = 0; i < DEFAULT_LIMITS.rateLimitCount; i++) {
      a.post(talk, `${i}`);
      await expectType(a, "comment.added");
    }
    const clientId = a.post(talk, "多すぎ");
    expect(await a.next()).toEqual({ type: "error", code: "rate_limited", clientId });

    // 別の参加者は制限されない
    const b = await connect(id, await participant());
    await expectType(b, "snapshot");
    b.post(talk, "別の人");
    expect((await expectType(b, "comment.added")).comment.mine).toBe(true);
  });

  it("受付停止中は comments_closed", async () => {
    const { id, talkIds } = await createEvent();
    const [talk] = talkIds as [string];
    await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => {
      state.storage.sql.exec("UPDATE event SET comments_open = 0");
    });
    const a = await connect(id, await participant());
    await expectType(a, "snapshot");
    const clientId = a.post(talk, "閉まってる？");
    expect(await a.next()).toEqual({ type: "error", code: "comments_closed", clientId });
  });
});

describe("再接続（?since=）", () => {
  async function setup(count: number) {
    const { id, talkIds } = await createEvent();
    const [talk] = talkIds as [string];
    const cookie = await participant();
    const a = await connect(id, cookie);
    await expectType(a, "snapshot");
    for (let i = 1; i <= count; i++) {
      a.post(talk, `${i} 件目`);
      await expectType(a, "comment.added");
    }
    return { id, talk, cookie };
  }

  it("最後に受け取った seq より後の差分だけを送る", async () => {
    const { id, cookie } = await setup(3);
    const b = await connect(id, cookie, 1);
    const second = await expectType(b, "comment.added");
    const third = await expectType(b, "comment.added");
    expect([second.seq, third.seq]).toEqual([2, 3]);
    expect([second.comment.body, third.comment.body]).toEqual(["2 件目", "3 件目"]);
    expect(second.comment.mine).toBe(true);
  });

  it("取りこぼしがなければ何も送らない", async () => {
    const { id, talk, cookie } = await setup(2);
    const b = await connect(id, cookie, 2);
    b.post(talk, "続き");
    // 最初に届くのが新しい投稿なら、接続直後には何も送られていない
    expect(await expectType(b, "comment.added")).toMatchObject({ seq: 3 });
  });

  it("その後に非表示になったコメントは送り直さない", async () => {
    const { id, cookie } = await setup(2);
    await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => {
      state.storage.sql.exec("UPDATE comments SET hidden = 1 WHERE body = '1 件目'");
    });
    const b = await connect(id, cookie, 0);
    expect((await expectType(b, "comment.added")).comment.body).toBe("2 件目");
    const snapshot = await expectType(await connect(id, cookie), "snapshot");
    expect(snapshot.comments.map((c) => c.body)).toEqual(["2 件目"]);
  });

  it.each([
    ["サーバーより新しい seq", 99],
    ["不正な値", "abc"],
  ])("%s なら snapshot", async (_, since) => {
    const { id, cookie } = await setup(1);
    const res = await upgrade(`/api/events/${id}/ws?since=${since}`, { Cookie: cookie });
    if (!res.webSocket) throw new Error("webSocket がない");
    const snapshot = await expectType(new Client(res.webSocket), "snapshot");
    expect(snapshot.seq).toBe(1);
  });

  it("差分が残っていないほど古ければ snapshot", async () => {
    const { id, cookie } = await setup(2);
    await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => {
      state.storage.sql.exec("DELETE FROM updates WHERE seq = 1");
    });
    expect((await connect(id, cookie, 0).then((c) => c.next())).type).toBe("snapshot");
    expect((await connect(id, cookie, 1).then((c) => c.next())).type).toBe("comment.added");
  });
});

it("ping には pong を返す", async () => {
  const { id } = await createEvent();
  const res = await upgrade(`/api/events/${id}/ws`, { Cookie: await participant() });
  const ws = res.webSocket;
  if (!ws) throw new Error("webSocket がない");
  const pong = new Promise<unknown>((resolve) => {
    ws.addEventListener("message", (e) => {
      if (e.data === "pong") resolve(e.data);
    });
  });
  ws.accept();
  ws.send("ping");
  expect(await pong).toBe("pong");
});
