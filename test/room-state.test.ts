import { describe, expect, it } from "vitest";
import {
  addPending,
  applyServerMessage,
  hasGap,
  initialRoomState,
  type RoomState,
} from "../src/client/lib/room-state";
import type { Comment, ReactionCounts, ServerMessage } from "../src/shared/protocol";

const event = {
  id: "event001",
  name: "LT 会",
  date: "2026-10-01",
  url: null,
  hashtag: null,
  commentsOpen: true,
};
const talks = [{ id: "talk0001", speaker: "山田", title: "" }];

function comment(id: string, extra: Partial<Comment> = {}): Comment {
  return {
    id,
    talkId: "talk0001",
    body: id,
    createdAt: 0,
    likes: 0,
    mine: false,
    likedByMe: false,
    ...extra,
  };
}

function counts(extra: Partial<ReactionCounts> = {}): ReactionCounts {
  return { useful: 0, fun: 0, try: 0, more: 0, ...extra };
}

function apply(state: RoomState, ...messages: ServerMessage[]): RoomState {
  return messages.reduce(applyServerMessage, state);
}

const loaded = apply(initialRoomState, {
  type: "snapshot",
  seq: 2,
  event,
  talks,
  comments: [comment("c1"), comment("c2")],
  reactions: [{ talkId: "talk0001", counts: counts(), mine: null }],
});

describe("applyServerMessage", () => {
  it("snapshot で全体を置き換える", () => {
    expect(loaded.seq).toBe(2);
    expect(loaded.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("差分を順に適用し、受け取り済みの seq は無視する", () => {
    const state = apply(
      loaded,
      { type: "comment.added", seq: 3, comment: comment("c3") },
      { type: "comment.added", seq: 3, comment: comment("c3") },
      { type: "comment.removed", seq: 4, commentId: "c1" },
      { type: "like.changed", seq: 5, commentId: "c2", likes: 3, likedByMe: true },
      { type: "comment.removed", seq: 2, commentId: "c2" },
    );
    expect(state.seq).toBe(5);
    expect(state.comments.map((c) => [c.id, c.likes, c.likedByMe])).toEqual([
      ["c2", 3, true],
      ["c3", 0, false],
    ]);
  });

  it("表示に戻されたコメントは投稿時刻の位置に差し込む", () => {
    const base = apply(initialRoomState, {
      type: "snapshot",
      seq: 1,
      event,
      talks,
      comments: [comment("c1", { createdAt: 10 }), comment("c3", { createdAt: 30 })],
      reactions: [],
    });
    const state = apply(base, {
      type: "comment.added",
      seq: 2,
      comment: comment("c2", { createdAt: 20 }),
    });
    expect(state.comments.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("talks.updated で発表枠を置き換え、削除された発表のコメントを取り除く", () => {
    const other = { id: "talk0002", speaker: "佐藤", title: "" };
    const state = apply(
      loaded,
      { type: "comment.added", seq: 3, comment: comment("c3", { talkId: other.id }) },
      { type: "talks.updated", seq: 4, talks: [other] },
    );
    expect(state.seq).toBe(4);
    expect(state.talks).toEqual([other]);
    expect(state.comments.map((c) => c.id)).toEqual(["c3"]);
    expect(state.reactions).toEqual([]);
  });

  it("reaction.changed で票数を置き換え、mine は付いているときだけ変える", () => {
    const state = apply(
      loaded,
      {
        type: "reaction.changed",
        seq: 3,
        talkId: "talk0001",
        counts: counts({ fun: 1 }),
        mine: "fun",
      },
      { type: "reaction.changed", seq: 4, talkId: "talk0001", counts: counts({ fun: 1, try: 1 }) },
      { type: "reaction.changed", seq: 5, talkId: "talk0002", counts: counts({ more: 1 }) },
    );
    expect(state.seq).toBe(5);
    expect(state.reactions).toEqual([
      { talkId: "talk0001", counts: counts({ fun: 1, try: 1 }), mine: "fun" },
      { talkId: "talk0002", counts: counts({ more: 1 }), mine: null },
    ]);
    const cleared = apply(state, {
      type: "reaction.changed",
      seq: 6,
      talkId: "talk0001",
      counts: counts({ try: 1 }),
      mine: null,
    });
    expect(cleared.reactions[0]).toEqual({
      talkId: "talk0001",
      counts: counts({ try: 1 }),
      mine: null,
    });
  });

  it("自分の投稿が届いたら送信中から外す", () => {
    const pending = { clientId: "p1", talkId: "talk0001", body: "やあ" };
    const sent = addPending(loaded, pending);
    expect(sent.pending).toEqual([pending]);
    const state = apply(sent, {
      type: "comment.added",
      seq: 3,
      comment: comment("c3", { mine: true, clientId: "p1" }),
    });
    expect(state.pending).toEqual([]);
  });

  it("snapshot に含まれていた投稿・受け付け済み・エラーの投稿も送信中から外す", () => {
    const state = [
      { clientId: "p1", talkId: "talk0001", body: "1" },
      { clientId: "p2", talkId: "talk0001", body: "2" },
      { clientId: "p3", talkId: "talk0001", body: "3" },
      { clientId: "p4", talkId: "talk0001", body: "4" },
    ].reduce(addPending, initialRoomState);
    const next = apply(
      state,
      {
        type: "snapshot",
        seq: 1,
        event,
        talks,
        comments: [comment("c1", { clientId: "p1" })],
        reactions: [],
      },
      { type: "comment.accepted", clientId: "p2", commentId: "c0" },
      { type: "error", code: "rate_limited", clientId: "p3" },
    );
    expect(next.pending.map((p) => p.clientId)).toEqual(["p4"]);
  });
});

describe("hasGap", () => {
  it("seq が飛んだときだけ true", () => {
    const added = (seq: number): ServerMessage => ({
      type: "comment.added",
      seq,
      comment: comment("x"),
    });
    expect(hasGap(loaded, added(3))).toBe(false);
    expect(hasGap(loaded, added(2))).toBe(false);
    expect(hasGap(loaded, added(4))).toBe(true);
    expect(hasGap(initialRoomState, added(4))).toBe(false);
  });
});
