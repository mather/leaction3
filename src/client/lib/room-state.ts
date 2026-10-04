import type {
  Comment,
  CommentId,
  EventInfo,
  ServerMessage,
  Talk,
  TalkId,
} from "../../shared/protocol";

// イベントページの状態。WebSocket で受け取ったメッセージを順に適用して作る。
// DOM に依存しない純粋な関数にしておき、テストできるようにする。

/** 送信したが、まだサーバーから受け付けの知らせがない投稿 */
export type PendingComment = {
  clientId: string;
  talkId: TalkId;
  body: string;
};

export type RoomState = {
  /** 最後に受け取った seq。snapshot を受け取るまでは null */
  seq: number | null;
  event: EventInfo | null;
  talks: Talk[] | null;
  /** 表示中のコメント（古い順） */
  comments: Comment[];
  pending: PendingComment[];
};

export const initialRoomState: RoomState = {
  seq: null,
  event: null,
  talks: null,
  comments: [],
  pending: [],
};

/**
 * 差分の seq が飛んでいないか。飛んでいたら取りこぼしがあるので、接続し直して補完する。
 * 古い・重複した seq は applyServerMessage で無視するので、ここでは問題にしない。
 */
export function hasGap(state: RoomState, message: ServerMessage): boolean {
  if (state.seq === null || !("seq" in message) || message.type === "snapshot") return false;
  return message.seq > state.seq + 1;
}

export function applyServerMessage(state: RoomState, message: ServerMessage): RoomState {
  switch (message.type) {
    case "snapshot": {
      const confirmed = new Set(message.comments.map((c) => c.clientId));
      return {
        seq: message.seq,
        event: message.event,
        talks: message.talks,
        comments: message.comments,
        pending: state.pending.filter((p) => !confirmed.has(p.clientId)),
      };
    }
    case "comment.accepted":
      return withoutPending(state, message.clientId);
    case "error":
      return message.clientId ? withoutPending(state, message.clientId) : state;
  }

  // 以降は seq 付きの差分。受け取り済みのものは無視する
  if (state.seq !== null && message.seq <= state.seq) return state;
  const next = { ...state, seq: message.seq };
  switch (message.type) {
    case "comment.added": {
      const { comment } = message;
      const added = state.comments.some((c) => c.id === comment.id)
        ? next
        : { ...next, comments: [...state.comments, comment] };
      return comment.clientId ? withoutPending(added, comment.clientId) : added;
    }
    case "comment.removed":
      return { ...next, comments: state.comments.filter((c) => c.id !== message.commentId) };
    case "like.changed":
      return {
        ...next,
        comments: updateComment(state.comments, message.commentId, (c) => ({
          ...c,
          likes: message.likes,
          likedByMe: message.likedByMe ?? c.likedByMe,
        })),
      };
    case "event.updated":
      return { ...next, event: message.event };
    case "talks.updated":
      return { ...next, talks: message.talks };
  }
}

export function addPending(state: RoomState, pending: PendingComment): RoomState {
  return { ...state, pending: [...state.pending, pending] };
}

function withoutPending(state: RoomState, clientId: string): RoomState {
  if (!state.pending.some((p) => p.clientId === clientId)) return state;
  return { ...state, pending: state.pending.filter((p) => p.clientId !== clientId) };
}

function updateComment(
  comments: Comment[],
  id: CommentId,
  update: (c: Comment) => Comment,
): Comment[] {
  return comments.map((c) => (c.id === id ? update(c) : c));
}
