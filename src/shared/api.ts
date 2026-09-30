// HTTP API のリクエスト・レスポンス型。クライアントと Worker で共有する。

export type HealthResponse = {
  ok: true;
  d1: { events: number };
  durableObject: { sqlite: boolean };
};

export type ErrorResponse = {
  error: string;
};
