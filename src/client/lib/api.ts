import type { CreateEventRequest, CreateEventResponse, ErrorResponse } from "../../shared/api";

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
