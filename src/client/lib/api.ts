import type {
  AddTalkRequest,
  AdminCommentsResponse,
  AdminKeysResponse,
  AdminSessionResponse,
  CreateAdminKeyResponse,
  CreateAdminSessionRequest,
  CreateEventRequest,
  CreateEventResponse,
  CreateSessionRequest,
  DeleteEventResponse,
  ErrorResponse,
  GetAdminResponse,
  GetEventResponse,
  ReorderTalksRequest,
  SessionResponse,
  TalksResponse,
  UpdateEventRequest,
  UpdateEventResponse,
  UpdateTalkRequest,
} from "../../shared/api";
import { getTurnstileToken } from "./turnstile";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API error ${status}: ${code}`);
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorResponse | null;
    throw new ApiError(res.status, body?.error ?? "unknown");
  }
  return res.json() as Promise<T>;
}

export function createEvent(input: CreateEventRequest): Promise<CreateEventResponse> {
  return request("/api/events", { method: "POST", body: JSON.stringify(input) });
}

export function getEvent(id: string): Promise<GetEventResponse> {
  return request(`/api/events/${encodeURIComponent(id)}`, { method: "GET" });
}

/**
 * 参加者セッション（参加者 ID の Cookie）を用意する。
 * すでに Cookie があれば何もせず、なければ Turnstile を 1 回通して発行してもらう。
 */
export async function ensureSession(): Promise<void> {
  try {
    await request<SessionResponse>("/api/session", { method: "GET" });
    return;
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "no_session")) throw err;
  }
  const input: CreateSessionRequest = { turnstileToken: await getTurnstileToken("join") };
  await request<SessionResponse>("/api/session", { method: "POST", body: JSON.stringify(input) });
}

// 管理操作。管理セッションは HttpOnly Cookie なので、ここでは扱わずブラウザに任せる

const eventPath = (id: string) => `/api/events/${encodeURIComponent(id)}`;
const talkPath = (id: string, talkId: string) =>
  `${eventPath(id)}/talks/${encodeURIComponent(talkId)}`;

/** 管理 URL の `#k=` のトークンを、イベント単位の管理セッション Cookie に入れ替えてもらう */
export function createAdminSession(id: string, token: string): Promise<AdminSessionResponse> {
  const input: CreateAdminSessionRequest = { token };
  return request(`${eventPath(id)}/admin/session`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 管理画面の表示内容。管理セッションがなければ 401（ApiError） */
export function getAdmin(id: string): Promise<GetAdminResponse> {
  return request(`${eventPath(id)}/admin`, { method: "GET" });
}

/** イベント情報の更新。変更した項目だけを送る */
export function updateEvent(id: string, input: UpdateEventRequest): Promise<UpdateEventResponse> {
  return request(eventPath(id), { method: "PATCH", body: JSON.stringify(input) });
}

export function addTalk(id: string, input: AddTalkRequest): Promise<TalksResponse> {
  return request(`${eventPath(id)}/talks`, { method: "POST", body: JSON.stringify(input) });
}

export function updateTalk(
  id: string,
  talkId: string,
  input: UpdateTalkRequest,
): Promise<TalksResponse> {
  return request(talkPath(id, talkId), { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteTalk(id: string, talkId: string): Promise<TalksResponse> {
  return request(talkPath(id, talkId), { method: "DELETE" });
}

export function reorderTalks(id: string, ids: string[]): Promise<TalksResponse> {
  const input: ReorderTalksRequest = { ids };
  return request(`${eventPath(id)}/talks/order`, { method: "PUT", body: JSON.stringify(input) });
}

// モデレーション。結果として最新のコメント一覧（非表示も含む、新しい順）が返る

export function getAdminComments(id: string): Promise<AdminCommentsResponse> {
  return request(`${eventPath(id)}/admin/comments`, { method: "GET" });
}

export function setCommentHidden(
  id: string,
  commentId: string,
  hidden: boolean,
): Promise<AdminCommentsResponse> {
  const action = hidden ? "hide" : "unhide";
  return request(`${eventPath(id)}/comments/${encodeURIComponent(commentId)}/${action}`, {
    method: "POST",
  });
}

export function setAuthorHidden(
  id: string,
  authorKey: string,
  hidden: boolean,
): Promise<AdminCommentsResponse> {
  const action = hidden ? "hide" : "unhide";
  return request(`${eventPath(id)}/authors/${encodeURIComponent(authorKey)}/${action}`, {
    method: "POST",
  });
}

// 作成者だけの操作。共同管理者 URL の発行・無効化と、イベントの削除・復元

export function getAdminKeys(id: string): Promise<AdminKeysResponse> {
  return request(`${eventPath(id)}/admin-keys`, { method: "GET" });
}

/** 共同管理者 URL を発行する。トークンはこの応答でしか受け取れない */
export function createAdminKey(id: string): Promise<CreateAdminKeyResponse> {
  return request(`${eventPath(id)}/admin-keys`, { method: "POST" });
}

/** 共同管理者 URL を無効化する。結果として最新の一覧が返る */
export function revokeAdminKey(id: string, keyId: string): Promise<AdminKeysResponse> {
  return request(`${eventPath(id)}/admin-keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE",
  });
}

export function deleteEvent(id: string): Promise<DeleteEventResponse> {
  return request(eventPath(id), { method: "DELETE" });
}

/** 削除したイベントを復元する。結果として管理画面の表示内容が返る */
export function restoreEvent(id: string): Promise<GetAdminResponse> {
  return request(`${eventPath(id)}/restore`, { method: "POST" });
}
