// HTTP API のリクエスト・レスポンス型。クライアントと Worker で共有する。

import type { CommentId, EventInfo, Talk, TalkId } from "./protocol";

export type HealthResponse = {
  ok: true;
  d1: { events: number };
  durableObject: { sqlite: boolean };
};

export type ErrorResponse = {
  error: string;
};

export type {
  CreateAdminSessionInput as CreateAdminSessionRequest,
  CreateEventInput as CreateEventRequest,
  CreateSessionInput as CreateSessionRequest,
  ReorderTalksInput as ReorderTalksRequest,
  TalkInput as AddTalkRequest,
  UpdateEventInput as UpdateEventRequest,
  UpdateTalkInput as UpdateTalkRequest,
} from "./schema";

/** GET /api/events/:id。コメントは WebSocket の snapshot で受け取る */
export type GetEventResponse = {
  event: EventInfo;
  /** 並び順 */
  talks: Talk[];
};

export type CreateEventResponse = {
  id: string;
  /** 作成者トークン。ハッシュしか保存しないため、このレスポンスでしか受け取れない */
  ownerToken: string;
};

/** Turnstile の用途。ウィジェットの action に入れ、Worker で一致を確かめる */
export type TurnstileAction = "join" | "create_event";

/** GET・POST /api/session。参加者 ID そのものはクライアントに渡さない */
export type SessionResponse = {
  ok: true;
};

/** 管理者の権限。作成者（owner）と共同管理者（manager） */
export type AdminRole = "owner" | "manager";

/** POST /api/events/:id/admin/session */
export type AdminSessionResponse = {
  role: AdminRole;
};

/** GET /api/events/:id/admin。管理画面の表示に使う */
export type GetAdminResponse = {
  role: AdminRole;
  event: EventInfo;
  /** 並び順 */
  talks: Talk[];
  /** 発表ごとのコメント数（非表示のものも含む）。発表枠を削除するときの確認に使う */
  commentCounts: Record<TalkId, number>;
};

/** PATCH /api/events/:id */
export type UpdateEventResponse = {
  event: EventInfo;
};

/** 発表枠の追加・編集・削除・並べ替え。操作後の全発表枠（並び順） */
export type TalksResponse = {
  talks: Talk[];
};

/**
 * 管理画面のコメント一覧の 1 件。非表示のものも含む。
 * 投稿者は参加者 ID ではなく、イベントごとに振った不透明なキー（authorKey）で表す
 */
export type AdminComment = {
  id: CommentId;
  talkId: TalkId;
  body: string;
  /** UNIX エポックからのミリ秒 */
  createdAt: number;
  likes: number;
  hidden: boolean;
  /** 投稿者のキー。画面には先頭 4 文字だけを出し、一括非表示の対象の指定に使う */
  authorKey: string;
  /** 投稿者ごと非表示にしているか（以降の投稿も非表示になる） */
  authorHidden: boolean;
};

/** GET /api/events/:id/admin/comments とモデレーション操作の結果。新しい順 */
export type AdminCommentsResponse = {
  comments: AdminComment[];
};
