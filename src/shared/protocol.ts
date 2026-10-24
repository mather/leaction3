// WebSocket メッセージ型。クライアントと EventRoom で共有する。
// 仕様は docs/architecture.md「WebSocket メッセージ」を参照。

export type TalkId = string;
export type CommentId = string;

export type EventInfo = {
  id: string;
  name: string;
  /** 開催日 YYYY-MM-DD */
  date: string;
  url: string | null;
  /** # を除いたハッシュタグ。なければ空の配列 */
  hashtags: string[];
  commentsOpen: boolean;
};

export type Talk = {
  id: TalkId;
  speaker: string;
  title: string;
};

export type Comment = {
  id: CommentId;
  talkId: TalkId;
  body: string;
  /** UNIX エポックからのミリ秒 */
  createdAt: number;
  likes: number;
  /** 接続中の参加者自身の投稿か。author_id そのものは送らない */
  mine: boolean;
  likedByMe: boolean;
  /** 自分の投稿にだけ付く、投稿時の clientId。再接続後に未確認の投稿を照合するのに使う */
  clientId?: string;
};

/** 発表への感想の種類。並びは画面の並び順 */
export const REACTION_KINDS = ["useful", "fun", "try", "more"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** 発表ごとの感想の票数 */
export type ReactionCounts = Record<ReactionKind, number>;

export type TalkReactions = {
  talkId: TalkId;
  counts: ReactionCounts;
  /** 接続中の参加者自身の票。voter_id そのものは送らない */
  mine: ReactionKind | null;
};

/** サーバー → クライアント */
export type ServerMessage =
  | {
      type: "snapshot";
      seq: number;
      event: EventInfo;
      talks: Talk[];
      comments: Comment[];
      /** すべての発表の感想 */
      reactions: TalkReactions[];
    }
  | { type: "comment.added"; seq: number; comment: Comment }
  | { type: "comment.removed"; seq: number; commentId: CommentId }
  | { type: "like.changed"; seq: number; commentId: CommentId; likes: number; likedByMe?: boolean }
  /** mine は投票した本人の接続にだけ付ける */
  | {
      type: "reaction.changed";
      seq: number;
      talkId: TalkId;
      counts: ReactionCounts;
      mine?: ReactionKind | null;
    }
  | { type: "event.updated"; seq: number; event: EventInfo }
  | { type: "talks.updated"; seq: number; talks: Talk[] }
  /** 再送された投稿がすでに登録済みだったとき、送った本人の接続にだけ返す（seq なし） */
  | { type: "comment.accepted"; clientId: string; commentId: CommentId }
  /** 投稿への応答なら clientId、いいね・削除への応答なら commentId、感想への応答なら talkId を付ける */
  | {
      type: "error";
      code: ErrorCode;
      clientId?: string;
      commentId?: CommentId;
      talkId?: TalkId;
    };

/**
 * クライアント → サーバー。
 * 再接続時は接続 URL の `?since=` に最後に受け取った seq を付ける（WS_SINCE_PARAM）。
 */
export type ClientMessage =
  | { type: "comment.post"; talkId: TalkId; body: string; clientId: string }
  | { type: "comment.delete"; commentId: CommentId }
  | { type: "like.set"; commentId: CommentId; liked: boolean }
  /** kind が null なら取り消し */
  | { type: "reaction.set"; talkId: TalkId; kind: ReactionKind | null };

export type ErrorCode = "rate_limited" | "comments_closed" | "invalid_message" | "not_found";

/**
 * イベントが削除されたときに、サーバーが WebSocket を閉じるコード。
 * クライアントは再接続せず、イベントが見つからない表示にする
 */
export const WS_CLOSE_EVENT_DELETED = 4404;

/** 再接続時に最後に受け取った seq を渡すクエリパラメータ */
export const WS_SINCE_PARAM = "since";

/**
 * 接続の死活確認。クライアントが PING を送ると、DO を起こさずに PONG が返る
 * （setWebSocketAutoResponse）。
 */
export const WS_PING = "ping";
export const WS_PONG = "pong";
