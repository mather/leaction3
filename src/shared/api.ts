// HTTP API のリクエスト・レスポンス型。クライアントと Worker で共有する。

export type HealthResponse = {
  ok: true;
  d1: { events: number };
  durableObject: { sqlite: boolean };
};

export type ErrorResponse = {
  error: string;
};

export type { CreateEventInput as CreateEventRequest } from "./schema";

export type CreateEventResponse = {
  id: string;
  /** 作成者トークン。ハッシュしか保存しないため、このレスポンスでしか受け取れない */
  ownerToken: string;
};
