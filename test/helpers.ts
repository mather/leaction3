// Worker・EventRoom のテストで共有するヘルパー。イベントの作成、参加者 Cookie、WebSocket クライアント。

import { exports } from "cloudflare:workers";
import { expect } from "vitest";
import type { CreateEventResponse, GetEventResponse } from "../src/shared/api";
import type { ClientMessage, ServerMessage } from "../src/shared/protocol";

export const ORIGIN = "http://example.com";

export async function createEvent(): Promise<{
  id: string;
  ownerToken: string;
  talkIds: string[];
}> {
  const res = await exports.default.fetch(`${ORIGIN}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "LT 会",
      date: "2026-10-01",
      talks: [
        { speaker: "山田", title: "SolidJS 入門" },
        { speaker: "佐藤", title: "" },
      ],
    }),
  });
  const { id, ownerToken } = await res.json<CreateEventResponse>();
  const event = await exports.default.fetch(`${ORIGIN}/api/events/${id}`);
  const { talks } = await event.json<GetEventResponse>();
  return { id, ownerToken, talkIds: talks.map((t) => t.id) };
}

/** 参加者 Cookie（`pid=...`）を発行してもらう */
export async function participant(): Promise<string> {
  const res = await exports.default.fetch(`${ORIGIN}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

export function upgrade(path: string, headers: Record<string, string>) {
  return exports.default.fetch(`${ORIGIN}${path}`, {
    headers: { Upgrade: "websocket", Origin: ORIGIN, ...headers },
  });
}

/** 受け取ったメッセージを順に取り出せる WebSocket クライアント */
export class Client {
  private readonly queue: ServerMessage[] = [];
  private waiter: ((m: ServerMessage) => void) | undefined;

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string" || e.data === "pong") return;
      const message = JSON.parse(e.data) as ServerMessage;
      if (this.waiter) {
        this.waiter(message);
        this.waiter = undefined;
      } else {
        this.queue.push(message);
      }
    });
    ws.accept();
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("メッセージが届かない")), 2000);
      this.waiter = (m) => {
        clearTimeout(timer);
        resolve(m);
      };
    });
  }

  send(message: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message));
  }

  post(talkId: string, body: string, clientId = crypto.randomUUID()): string {
    this.send({ type: "comment.post", talkId, body, clientId });
    return clientId;
  }
}

export async function connect(eventId: string, cookie: string, since?: number): Promise<Client> {
  const query = since === undefined ? "" : `?since=${since}`;
  const res = await upgrade(`/api/events/${eventId}/ws${query}`, { Cookie: cookie });
  expect(res.status).toBe(101);
  if (!res.webSocket) throw new Error("webSocket がない");
  return new Client(res.webSocket);
}

export async function expectType<T extends ServerMessage["type"]>(
  client: Client,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  const message = await client.next();
  expect(message.type).toBe(type);
  return message as Extract<ServerMessage, { type: T }>;
}

export function request(
  path: string,
  init: { method?: string; cookie?: string; origin?: string | null; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.cookie) headers.Cookie = init.cookie;
  // 既定では同じオリジンのページから送ったものとする。null なら Origin を付けない
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
  return exports.default.fetch(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export function postAdminSession(id: string, token: string, origin?: string | null) {
  return request(`/api/events/${id}/admin/session`, { method: "POST", body: { token }, origin });
}

/** 作成者トークンで管理セッションを作り、管理 Cookie（`adm=...`）を返す */
export async function adminCookie(id: string, token: string): Promise<string> {
  const res = await postAdminSession(id, token);
  expect(res.status).toBe(200);
  return (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

/** イベントを作り、作成者の管理 Cookie を用意する */
export async function setupAdmin() {
  const created = await createEvent();
  return { ...created, cookie: await adminCookie(created.id, created.ownerToken) };
}
