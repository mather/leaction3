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
  hashtag: string | null;
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
};

/** サーバー → クライアント */
export type ServerMessage =
  | {
      type: "snapshot";
      seq: number;
      event: EventInfo;
      talks: Talk[];
      comments: Comment[];
    }
  | { type: "comment.added"; seq: number; comment: Comment; clientId?: string }
  | { type: "comment.removed"; seq: number; commentId: CommentId }
  | { type: "like.changed"; seq: number; commentId: CommentId; likes: number; likedByMe?: boolean }
  | { type: "event.updated"; seq: number; event: EventInfo }
  | { type: "talks.updated"; seq: number; talks: Talk[] }
  | { type: "error"; code: ErrorCode; clientId?: string };

/** クライアント → サーバー */
export type ClientMessage =
  | { type: "resume"; lastSeq: number }
  | { type: "comment.post"; talkId: TalkId; body: string; clientId: string }
  | { type: "comment.delete"; commentId: CommentId }
  | { type: "like.set"; commentId: CommentId; liked: boolean };

export type ErrorCode = "rate_limited" | "comments_closed" | "invalid_message" | "not_found";
