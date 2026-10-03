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

export type { CreateEventInput as CreateEventRequest } from "./schema";

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
