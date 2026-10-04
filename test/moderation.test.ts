import { describe, expect, it } from "vitest";
import type { AdminCommentsResponse, UpdateEventResponse } from "../src/shared/api";
import { type Client, connect, expectType, participant, request, setupAdmin } from "./helpers";

/** イベントと管理 Cookie に加え、投稿者 2 人（alice・bob）の接続を用意する */
async function setup() {
  const admin = await setupAdmin();
  const aliceCookie = await participant();
  const alice = await connect(admin.id, aliceCookie);
  const bob = await connect(admin.id, await participant());
  await expectType(alice, "snapshot");
  await expectType(bob, "snapshot");
  return { ...admin, alice, aliceCookie, bob, talk: admin.talkIds[0] as string };
}

/** 投稿し、両方の接続に comment.added が届くのを待って ID を返す */
async function post(from: Client, other: Client, talk: string, body: string): Promise<string> {
  from.post(talk, body);
  const added = await expectType(from, "comment.added");
  await expectType(other, "comment.added");
  return added.comment.id;
}

async function listComments(id: string, cookie: string) {
  const res = await request(`/api/events/${id}/admin/comments`, { cookie });
  expect(res.status).toBe(200);
  return (await res.json<AdminCommentsResponse>()).comments;
}

function moderate(id: string, cookie: string, path: string) {
  return request(`/api/events/${id}/${path}`, { method: "POST", cookie });
}

describe("GET /api/events/:id/admin/comments", () => {
  it("非表示のものも含めて新しい順に返し、投稿者は参加者 ID ではなくキーで表す", async () => {
    const { id, cookie, alice, aliceCookie, bob, talk } = await setup();
    const first = await post(alice, bob, talk, "1 件目");
    const second = await post(bob, alice, talk, "2 件目");
    const third = await post(alice, bob, talk, "3 件目");
    await moderate(id, cookie, `comments/${first}/hide`);

    const comments = await listComments(id, cookie);
    expect(comments.map((c) => [c.id, c.hidden])).toEqual([
      [third, false],
      [second, false],
      [first, true],
    ]);
    expect(comments[0]).toMatchObject({ talkId: talk, body: "3 件目", likes: 0 });
    // 同じ投稿者は同じキー、別の投稿者は別のキー
    expect(comments[0]?.authorKey).toMatch(/^[0-9a-f]{16}$/);
    expect(comments[0]?.authorKey).toBe(comments[2]?.authorKey);
    expect(comments[0]?.authorKey).not.toBe(comments[1]?.authorKey);
    // 参加者 ID（Cookie の値）は返さない
    const participantId = decodeURIComponent(aliceCookie.split("=")[1] ?? "").split(".")[0] ?? "";
    expect(participantId).toHaveLength(16);
    expect(JSON.stringify(comments)).not.toContain(participantId);
  });

  it("管理 Cookie がなければ 401", async () => {
    const { id } = await setup();
    const res = await request(`/api/events/${id}/admin/comments`);
    expect(res.status).toBe(401);
  });
});

describe("コメントの非表示・表示に戻す", () => {
  it("非表示にすると参加者に本文なしの comment.removed を配信し、snapshot にも含めない", async () => {
    const { id, cookie, alice, bob, talk } = await setup();
    const commentId = await post(alice, bob, talk, "荒らし");

    const res = await moderate(id, cookie, `comments/${commentId}/hide`);
    expect(res.status).toBe(200);
    const { comments } = await res.json<AdminCommentsResponse>();
    expect(comments[0]).toMatchObject({ id: commentId, hidden: true });

    const removed = await expectType(bob, "comment.removed");
    expect(removed).toEqual({ type: "comment.removed", seq: 2, commentId });
    expect(await expectType(alice, "comment.removed")).toEqual(removed);

    const snapshot = await expectType(await connect(id, await participant()), "snapshot");
    expect(snapshot.comments).toEqual([]);
  });

  it("表示に戻すと、閲覧者ごとの内容で comment.added を配信する", async () => {
    const { id, cookie, alice, bob, talk } = await setup();
    const commentId = await post(alice, bob, talk, "戻すコメント");
    bob.send({ type: "like.set", commentId, liked: true });
    await expectType(alice, "like.changed");
    await expectType(bob, "like.changed");
    await moderate(id, cookie, `comments/${commentId}/hide`);
    await expectType(alice, "comment.removed");
    await expectType(bob, "comment.removed");

    const res = await moderate(id, cookie, `comments/${commentId}/unhide`);
    expect(res.status).toBe(200);
    const toAlice = await expectType(alice, "comment.added");
    const toBob = await expectType(bob, "comment.added");
    expect(toAlice.comment).toMatchObject({ id: commentId, mine: true, likes: 1 });
    expect(toBob.comment).toMatchObject({ id: commentId, mine: false, likes: 1, likedByMe: true });
  });

  it("すでに同じ状態なら何も配信しない", async () => {
    const { id, cookie, alice, bob, talk } = await setup();
    const commentId = await post(alice, bob, talk, "表示中");
    expect((await moderate(id, cookie, `comments/${commentId}/unhide`)).status).toBe(200);
    // 次に届くのは、この後の投稿
    await post(alice, bob, talk, "次の投稿");
  });

  it("再接続時の補完では、非表示にしたコメントを comment.removed として送る", async () => {
    const { id, cookie, alice, bob, talk } = await setup();
    const commentId = await post(alice, bob, talk, "あとで非表示");
    await moderate(id, cookie, `comments/${commentId}/hide`);

    const client = await connect(id, await participant(), 0);
    expect(await expectType(client, "comment.removed")).toMatchObject({ seq: 1, commentId });
    expect(await expectType(client, "comment.removed")).toMatchObject({ seq: 2, commentId });
  });

  it("存在しないコメントは 404、Origin が違えば 403", async () => {
    const { id, cookie, alice, bob, talk } = await setup();
    expect((await moderate(id, cookie, "comments/nothere123/hide")).status).toBe(404);
    const commentId = await post(alice, bob, talk, "x");
    const res = await request(`/api/events/${id}/comments/${commentId}/hide`, {
      method: "POST",
      cookie,
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });
});

describe("投稿者単位の非表示", () => {
  it("既存の投稿をすべて非表示にし、以降の投稿も非表示で受け付ける", async () => {
    const { id, cookie, alice, bob, talk } = await setup();
    const a1 = await post(alice, bob, talk, "a1");
    await post(bob, alice, talk, "b1");
    const a2 = await post(alice, bob, talk, "a2");
    const authorKey = (await listComments(id, cookie)).find((c) => c.id === a1)?.authorKey;

    const res = await moderate(id, cookie, `authors/${authorKey}/hide`);
    expect(res.status).toBe(200);
    const { comments } = await res.json<AdminCommentsResponse>();
    expect(comments.map((c) => [c.body, c.hidden, c.authorHidden])).toEqual([
      ["a2", true, true],
      ["b1", false, false],
      ["a1", true, true],
    ]);
    expect((await expectType(bob, "comment.removed")).commentId).toBe(a1);
    expect((await expectType(bob, "comment.removed")).commentId).toBe(a2);
    await expectType(alice, "comment.removed");
    await expectType(alice, "comment.removed");

    // 以降の投稿は本人に受け付けたことだけを伝え、誰にも配信しない
    const clientId = alice.post(talk, "a3");
    const accepted = await expectType(alice, "comment.accepted");
    expect(accepted.clientId).toBe(clientId);
    await post(bob, alice, talk, "b2");
    const latest = await listComments(id, cookie);
    expect(latest.find((c) => c.body === "a3")).toMatchObject({ hidden: true });

    const snapshot = await expectType(await connect(id, await participant()), "snapshot");
    expect(snapshot.comments.map((c) => c.body)).toEqual(["b1", "b2"]);
  });

  it("戻すと、その投稿者のコメントを表示に戻し、以降の投稿も表示する", async () => {
    const { id, cookie, alice, bob, talk } = await setup();
    const a1 = await post(alice, bob, talk, "a1");
    const authorKey = (await listComments(id, cookie)).find((c) => c.id === a1)?.authorKey;
    await moderate(id, cookie, `authors/${authorKey}/hide`);
    await expectType(bob, "comment.removed");
    await expectType(alice, "comment.removed");

    const res = await moderate(id, cookie, `authors/${authorKey}/unhide`);
    expect(res.status).toBe(200);
    expect((await expectType(bob, "comment.added")).comment.id).toBe(a1);
    await expectType(alice, "comment.added");
    await post(alice, bob, talk, "a2");
    const comments = await listComments(id, cookie);
    expect(comments.map((c) => [c.body, c.hidden, c.authorHidden])).toEqual([
      ["a2", false, false],
      ["a1", false, false],
    ]);
  });

  it("知らない投稿者のキーは 404", async () => {
    const { id, cookie } = await setup();
    expect((await moderate(id, cookie, "authors/0123456789abcdef/hide")).status).toBe(404);
  });
});

describe("コメント受付の一時停止", () => {
  it("PATCH で停止すると参加者に event.updated を配信し、投稿を comments_closed で拒否する", async () => {
    const { id, cookie, alice, bob, talk } = await setup();
    const res = await request(`/api/events/${id}`, {
      method: "PATCH",
      cookie,
      body: { commentsOpen: false },
    });
    expect(res.status).toBe(200);
    expect((await res.json<UpdateEventResponse>()).event.commentsOpen).toBe(false);
    expect((await expectType(bob, "event.updated")).event.commentsOpen).toBe(false);
    await expectType(alice, "event.updated");

    const clientId = alice.post(talk, "停止中の投稿");
    expect(await expectType(alice, "error")).toEqual({
      type: "error",
      code: "comments_closed",
      clientId,
    });

    await request(`/api/events/${id}`, { method: "PATCH", cookie, body: { commentsOpen: true } });
    expect((await expectType(alice, "event.updated")).event.commentsOpen).toBe(true);
    await expectType(bob, "event.updated");
    await post(alice, bob, talk, "再開後の投稿");
  });
});
