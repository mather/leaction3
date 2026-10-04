// HTTP API のリクエスト・レスポンス型。クライアントと Worker で共有する。

import type { EventInfo, Talk } from "./protocol";

export type HealthResponse = {
  ok: true;
  d1: { events: number };
  durableObject: { sqlite: boolean };
};

export type ErrorResponse = {
  error: string;
};

export type {
  CreateEventInput as CreateEventRequest,
  CreateSessionInput as CreateSessionRequest,
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
