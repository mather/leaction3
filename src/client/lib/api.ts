import type {
  CreateEventRequest,
  CreateEventResponse,
  CreateSessionRequest,
  ErrorResponse,
  GetEventResponse,
  SessionResponse,
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
