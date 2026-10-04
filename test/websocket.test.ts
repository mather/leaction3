import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/shared/schema";
import { Client, connect, createEvent, expectType, ORIGIN, participant, upgrade } from "./helpers";

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

/** 投稿者 author と、もう 1 人の参加者 other が接続し、author が 1 件投稿した状態 */
async function withComment() {
  const { id, talkIds } = await createEvent();
  const [talk] = talkIds as [string];
  const authorCookie = await participant();
  const otherCookie = await participant();
  const author = await connect(id, authorCookie);
  const other = await connect(id, otherCookie);
  await expectType(author, "snapshot");
  await expectType(other, "snapshot");
  author.post(talk, "いいねしてね");
  const { comment } = await expectType(author, "comment.added");
  await expectType(other, "comment.added");
  return { id, talk, commentId: comment.id, author, authorCookie, other, otherCookie };
}

describe("like.set", () => {
  it("いいねの付け外しを全接続に配信し、likedByMe は本人にだけ付ける", async () => {
    const { commentId, author, other } = await withComment();

    other.send({ type: "like.set", commentId, liked: true, voterId: "x" });
    expect(await expectType(other, "like.changed")).toEqual({
      type: "like.changed",
      seq: 2,
      commentId,
      likes: 1,
      likedByMe: true,
    });
    expect(await expectType(author, "like.changed")).toEqual({
      type: "like.changed",
      seq: 2,
      commentId,
      likes: 1,
    });

    other.send({ type: "like.set", commentId, liked: false });
    expect(await expectType(other, "like.changed")).toMatchObject({ likes: 0, likedByMe: false });
    expect(await expectType(author, "like.changed")).toMatchObject({ seq: 3, likes: 0 });
  });

  it("二重いいね・いいねしていないものの取り消しは何も配信しない", async () => {
    const { talk, commentId, author, other } = await withComment();
    other.send({ type: "like.set", commentId, liked: false });
    other.send({ type: "like.set", commentId, liked: true });
    other.send({ type: "like.set", commentId, liked: true });
    expect(await expectType(other, "like.changed")).toMatchObject({ seq: 2, likes: 1 });
    // 次に届くのが新しい投稿なら、2 回目のいいねでは何も配信されていない
    author.post(talk, "次");
    expect(await expectType(other, "comment.added")).toMatchObject({ seq: 3 });
  });

  it("snapshot にいいね数と自分がいいねしたかを含める", async () => {
    const { id, commentId, other, authorCookie, otherCookie } = await withComment();
    other.send({ type: "like.set", commentId, liked: true });
    await expectType(other, "like.changed");
    const mine = await expectType(await connect(id, otherCookie), "snapshot");
    expect(mine.comments[0]).toMatchObject({ likes: 1, likedByMe: true });
    const author = await expectType(await connect(id, authorCookie), "snapshot");
    expect(author.comments[0]).toMatchObject({ likes: 1, likedByMe: false });
  });

  it("自分のコメントにはいいねできない", async () => {
    const { commentId, author } = await withComment();
    author.send({ type: "like.set", commentId, liked: true });
    expect(await author.next()).toEqual({ type: "error", code: "invalid_message", commentId });
  });

  it("存在しない・非表示のコメントには not_found", async () => {
    const { id, commentId, other } = await withComment();
    other.send({ type: "like.set", commentId: "nothere1", liked: true });
    expect(await other.next()).toEqual({
      type: "error",
      code: "not_found",
      commentId: "nothere1",
    });
    await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => {
      state.storage.sql.exec("UPDATE comments SET hidden = 1");
    });
    other.send({ type: "like.set", commentId, liked: true });
    expect(await other.next()).toEqual({ type: "error", code: "not_found", commentId });
  });

  it("再接続時は送り直す時点のいいね数を送る", async () => {
    const { id, commentId, other, otherCookie } = await withComment();
    other.send({ type: "like.set", commentId, liked: true });
    await expectType(other, "like.changed");
    other.send({ type: "like.set", commentId, liked: false });
    await expectType(other, "like.changed");

    const b = await connect(id, otherCookie, 1);
    for (const seq of [2, 3]) {
      expect(await expectType(b, "like.changed")).toEqual({
        type: "like.changed",
        seq,
        commentId,
        likes: 0,
        likedByMe: false,
      });
    }
  });
});

describe("comment.delete", () => {
  it("自分のコメントを消し、いいねも消して comment.removed を配信する", async () => {
    const { id, commentId, author, other, otherCookie } = await withComment();
    other.send({ type: "like.set", commentId, liked: true });
    await expectType(other, "like.changed");
    await expectType(author, "like.changed");

    author.send({ type: "comment.delete", commentId });
    for (const client of [author, other]) {
      expect(await client.next()).toEqual({ type: "comment.removed", seq: 3, commentId });
    }
    const snapshot = await expectType(await connect(id, otherCookie), "snapshot");
    expect(snapshot.comments).toEqual([]);
    await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => {
      expect(state.storage.sql.exec("SELECT * FROM likes").toArray()).toEqual([]);
    });
  });

  it("他人のコメントは消せない", async () => {
    const { id, commentId, other, otherCookie } = await withComment();
    other.send({ type: "comment.delete", commentId, authorId: "x" });
    expect(await other.next()).toEqual({ type: "error", code: "not_found", commentId });
    const snapshot = await expectType(await connect(id, otherCookie), "snapshot");
    expect(snapshot.comments).toHaveLength(1);
  });

  it("再接続時、その間に消されたコメントは本文を送らない", async () => {
    const { id, commentId, author, otherCookie } = await withComment();
    author.send({ type: "comment.delete", commentId });
    await expectType(author, "comment.removed");
    const b = await connect(id, otherCookie, 0);
    expect(await b.next()).toEqual({ type: "comment.removed", seq: 1, commentId });
    expect(await b.next()).toEqual({ type: "comment.removed", seq: 2, commentId });
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

  it("その後に非表示になったコメントは本文を送らず、seq を飛ばさずに comment.removed を送る", async () => {
    const { id, cookie } = await setup(2);
    await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => {
      state.storage.sql.exec("UPDATE comments SET hidden = 1 WHERE body = '1 件目'");
    });
    const b = await connect(id, cookie, 0);
    expect(await expectType(b, "comment.removed")).toMatchObject({ seq: 1 });
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
