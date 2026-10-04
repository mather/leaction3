import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as v from "valibot";
import type {
  AdminCommentsResponse,
  AdminKeysResponse,
  AdminSessionResponse,
  CreateAdminKeyResponse,
  CreateEventResponse,
  DeleteEventResponse,
  ErrorResponse,
  GetAdminResponse,
  GetEventResponse,
  HealthResponse,
  SessionResponse,
  TalksResponse,
  UpdateEventResponse,
} from "../shared/api";
import {
  createAdminSessionInputSchema,
  createEventInputSchema,
  createSessionInputSchema,
  EventIdSchema,
  reorderTalksInputSchema,
  resolveLimits,
  talkInputSchema,
  updateEventInputSchema,
  updateTalkInputSchema,
} from "../shared/schema";
import {
  clearAdminCookie,
  cookieSecret,
  generateToken,
  getAdminKeyId,
  getParticipantId,
  hashToken,
  issueParticipantId,
  randomId,
  renewParticipantId,
  setAdminCookie,
} from "./auth";
import { type AdminError, type AdminResult, PARTICIPANT_HEADER } from "./event-room";
import { eventOgp, injectOgp } from "./ogp";
import { verifyTurnstile } from "./turnstile";

export { EventRoom } from "./event-room";

/**
 * D1 の索引からイベントを引く。存在しない・削除済みなら null（includeDeleted なら削除済みも返す）。
 * 不正な ID や存在しない ID で EventRoom を起こさない（空の DO を作らない）ために使う。
 */
async function findIndexedEvent(
  db: D1Database,
  id: string,
  options: { includeDeleted?: boolean } = {},
) {
  if (!v.is(EventIdSchema, id)) return null;
  const where = options.includeDeleted ? "id = ?" : "id = ? AND deleted_at IS NULL";
  return db
    .prepare(`SELECT id, name, date FROM events WHERE ${where}`)
    .bind(id)
    .first<{ id: string; name: string; date: string }>();
}

/** 同じオリジンのページからのリクエストか。別サイトから Cookie 付きで送らせる攻撃（CSRF・CSWSH）を防ぐ */
function isSameOrigin(c: Context): boolean {
  return c.req.header("Origin") === new URL(c.req.url).origin;
}

/** JSON の本文を検証する。JSON でない・スキーマに合わなければ null */
async function parseBody<T extends v.GenericSchema>(
  c: Context,
  schema: T,
): Promise<v.InferOutput<T> | null> {
  const body = await c.req.json<unknown>().catch(() => undefined);
  const parsed = v.safeParse(schema, body);
  return parsed.success ? parsed.output : null;
}

const ADMIN_ERROR_STATUS = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
} as const satisfies Record<AdminError, ContentfulStatusCode>;

const api = new Hono<{ Bindings: Env }>();

type AdminEnv = { Bindings: Env; Variables: { keyId: string } };

/**
 * 管理操作の前処理。書き込みは Origin を確かめ（CSRF 対策）、管理セッション Cookie から管理キー ID を取り出す。
 * キーが無効化されていないかは EventRoom が確かめる
 */
const requireAdmin = createMiddleware<AdminEnv>(async (c, next) => {
  if (c.req.method !== "GET" && !isSameOrigin(c)) {
    return c.json<ErrorResponse>({ error: "forbidden_origin" }, 403);
  }
  const secret = cookieSecret(c.env);
  if (!secret) return c.json<ErrorResponse>({ error: "server_misconfigured" }, 500);
  const id = c.req.param("id") ?? "";
  const keyId = v.is(EventIdSchema, id) ? await getAdminKeyId(c, secret, id) : null;
  if (!keyId) return c.json<ErrorResponse>({ error: "no_admin_session" }, 401);
  c.set("keyId", keyId);
  await next();
});

/** EventRoom の管理操作の結果を HTTP の応答にする */
function adminResponse<T, R>(c: Context, result: AdminResult<T>, body: (value: T) => R): Response {
  if (!result.ok) {
    const error = result.error === "unauthorized" ? "no_admin_session" : result.error;
    return c.json<ErrorResponse>({ error }, ADMIN_ERROR_STATUS[result.error]);
  }
  return c.json(body(result.value));
}

// 雛形段階の疎通確認。Worker から D1 と EventRoom に届くことを確かめる。
api.get("/health", async (c) => {
  const d1 = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM events").first<{
    count: number;
  }>();
  const room = c.env.EVENT_ROOM.getByName("health-check");
  const pong = await room.ping();
  return c.json<HealthResponse>({
    ok: true,
    d1: { events: d1?.count ?? 0 },
    durableObject: { sqlite: pong.sqlite === 1 },
  });
});

// 参加者セッション。イベントページを開いたときに GET で確かめ、なければ Turnstile を通して POST で発行する。
// 有効な Cookie が届いたら同じ ID で出し直し、有効期限を延ばす（イベント中に切れないように）
api.get("/session", async (c) => {
  const secret = cookieSecret(c.env);
  if (!secret) return c.json<ErrorResponse>({ error: "server_misconfigured" }, 500);
  const id = await getParticipantId(c, secret);
  if (!id) return c.json<ErrorResponse>({ error: "no_session" }, 401);
  await renewParticipantId(c, secret, id);
  return c.json<SessionResponse>({ ok: true });
});

api.post("/session", async (c) => {
  const secret = cookieSecret(c.env);
  if (!secret) return c.json<ErrorResponse>({ error: "server_misconfigured" }, 500);
  // 有効な Cookie があれば Turnstile を通さず、同じ ID のまま有効期限だけ延ばす
  const current = await getParticipantId(c, secret);
  if (current) {
    await renewParticipantId(c, secret, current);
    return c.json<SessionResponse>({ ok: true });
  }

  const body = await c.req.json<unknown>().catch(() => undefined);
  const parsed = v.safeParse(createSessionInputSchema, body);
  if (!parsed.success) return c.json<ErrorResponse>({ error: "invalid_input" }, 400);
  const ip = c.req.header("CF-Connecting-IP");
  if (!(await verifyTurnstile(c.env, parsed.output.turnstileToken, ip, "join"))) {
    return c.json<ErrorResponse>({ error: "turnstile_failed" }, 403);
  }
  await issueParticipantId(c, secret);
  return c.json<SessionResponse>({ ok: true });
});

/** ID の衝突時に作り直す回数の上限（64^8 通りなので実際にはまず衝突しない） */
const MAX_ID_ATTEMPTS = 5;

api.post("/events", async (c) => {
  const body = await c.req.json<unknown>().catch(() => undefined);
  const parsed = v.safeParse(createEventInputSchema(resolveLimits(c.env)), body);
  if (!parsed.success) return c.json<ErrorResponse>({ error: "invalid_input" }, 400);
  const { turnstileToken, ...event } = parsed.output;

  const ip = c.req.header("CF-Connecting-IP");
  if (!(await verifyTurnstile(c.env, turnstileToken, ip, "create_event"))) {
    return c.json<ErrorResponse>({ error: "turnstile_failed" }, 403);
  }

  const ownerToken = generateToken();
  const ownerTokenHash = await hashToken(ownerToken);
  for (let i = 0; i < MAX_ID_ATTEMPTS; i++) {
    const id = randomId();
    const result = await c.env.EVENT_ROOM.getByName(id).initialize({ id, event, ownerTokenHash });
    if (result.ok) return c.json<CreateEventResponse>({ id, ownerToken }, 201);
  }
  return c.json<ErrorResponse>({ error: "id_exhausted" }, 500);
});

api.get("/events/:id", async (c) => {
  const id = c.req.param("id");
  const indexed = await findIndexedEvent(c.env.DB, id);
  const found = indexed && (await c.env.EVENT_ROOM.getByName(id).getEvent());
  if (!found) return c.json<ErrorResponse>({ error: "not_found" }, 404);
  return c.json<GetEventResponse>(found);
});

// WebSocket への切り替え。参加者 Cookie と Origin を確かめてから EventRoom に転送する。
// 参加者 ID はサーバーが Cookie から決め、EventRoom にはヘッダーで渡す（クライアントの値は上書きする）
api.get("/events/:id/ws", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json<ErrorResponse>({ error: "upgrade_required" }, 426);
  }
  // 別サイトのページから、参加者の Cookie を使って接続されるのを防ぐ（Cross-Site WebSocket Hijacking）
  if (!isSameOrigin(c)) {
    return c.json<ErrorResponse>({ error: "forbidden_origin" }, 403);
  }
  const secret = cookieSecret(c.env);
  if (!secret) return c.json<ErrorResponse>({ error: "server_misconfigured" }, 500);
  const participantId = await getParticipantId(c, secret);
  if (!participantId) return c.json<ErrorResponse>({ error: "no_session" }, 401);

  const id = c.req.param("id");
  if (!(await findIndexedEvent(c.env.DB, id))) {
    return c.json<ErrorResponse>({ error: "not_found" }, 404);
  }
  const headers = new Headers(c.req.raw.headers);
  headers.set(PARTICIPANT_HEADER, participantId);
  return c.env.EVENT_ROOM.getByName(id).fetch(new Request(c.req.raw, { headers }));
});

// 管理セッション。管理 URL の `#k=` のトークンを照合し、イベント単位の HttpOnly Cookie に入れ替える
api.post("/events/:id/admin/session", async (c) => {
  if (!isSameOrigin(c)) return c.json<ErrorResponse>({ error: "forbidden_origin" }, 403);
  const secret = cookieSecret(c.env);
  if (!secret) return c.json<ErrorResponse>({ error: "server_misconfigured" }, 500);
  const input = await parseBody(c, createAdminSessionInputSchema);
  if (!input) return c.json<ErrorResponse>({ error: "invalid_input" }, 400);
  const id = c.req.param("id");
  // 削除済みのイベントも、復元のために作成者は開ける（EventRoom が作成者のトークンだけを通す）
  if (!(await findIndexedEvent(c.env.DB, id, { includeDeleted: true }))) {
    return c.json<ErrorResponse>({ error: "not_found" }, 404);
  }
  const key = await c.env.EVENT_ROOM.getByName(id).authenticate(await hashToken(input.token));
  if (!key) return c.json<ErrorResponse>({ error: "invalid_token" }, 401);
  await setAdminCookie(c, secret, id, key.keyId);
  return c.json<AdminSessionResponse>({ role: key.role });
});

// 管理画面の表示に使う。イベントページのメニューも、これで管理セッションがあるかを確かめる
api.get("/events/:id/admin", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const result = await c.env.EVENT_ROOM.getByName(id).getAdmin(c.var.keyId);
  if (!result.ok && result.error === "unauthorized") {
    // 無効化されたキーの Cookie は持たせ続けない
    clearAdminCookie(c, id);
  } else if (result.ok) {
    // 管理画面を開くたびに有効期限を延ばす
    const secret = cookieSecret(c.env);
    if (secret) await setAdminCookie(c, secret, id, c.var.keyId);
  }
  return adminResponse(c, result, (value): GetAdminResponse => value);
});

api.patch("/events/:id", requireAdmin, async (c) => {
  const input = await parseBody(c, updateEventInputSchema(resolveLimits(c.env)));
  if (!input) return c.json<ErrorResponse>({ error: "invalid_input" }, 400);
  const room = c.env.EVENT_ROOM.getByName(c.req.param("id"));
  const result = await room.updateEvent(c.var.keyId, input);
  return adminResponse(c, result, (event): UpdateEventResponse => ({ event }));
});

api.post("/events/:id/talks", requireAdmin, async (c) => {
  const input = await parseBody(c, talkInputSchema(resolveLimits(c.env)));
  if (!input) return c.json<ErrorResponse>({ error: "invalid_input" }, 400);
  const room = c.env.EVENT_ROOM.getByName(c.req.param("id"));
  const result = await room.addTalk(c.var.keyId, input);
  return adminResponse(c, result, (talks): TalksResponse => ({ talks }));
});

// /talks/:talkId より先に登録し、order を発表枠の ID とみなさない
api.put("/events/:id/talks/order", requireAdmin, async (c) => {
  const input = await parseBody(c, reorderTalksInputSchema(resolveLimits(c.env)));
  if (!input) return c.json<ErrorResponse>({ error: "invalid_input" }, 400);
  const room = c.env.EVENT_ROOM.getByName(c.req.param("id"));
  const result = await room.reorderTalks(c.var.keyId, input.ids);
  return adminResponse(c, result, (talks): TalksResponse => ({ talks }));
});

api.patch("/events/:id/talks/:talkId", requireAdmin, async (c) => {
  const input = await parseBody(c, updateTalkInputSchema(resolveLimits(c.env)));
  if (!input) return c.json<ErrorResponse>({ error: "invalid_input" }, 400);
  const room = c.env.EVENT_ROOM.getByName(c.req.param("id"));
  const result = await room.updateTalk(c.var.keyId, c.req.param("talkId"), input);
  return adminResponse(c, result, (talks): TalksResponse => ({ talks }));
});

api.delete("/events/:id/talks/:talkId", requireAdmin, async (c) => {
  const room = c.env.EVENT_ROOM.getByName(c.req.param("id"));
  const result = await room.deleteTalk(c.var.keyId, c.req.param("talkId"));
  return adminResponse(c, result, (talks): TalksResponse => ({ talks }));
});

// モデレーション。コメント一覧（非表示も含む）、コメント単位・投稿者単位の非表示と表示に戻す操作。
// 操作の結果として、最新のコメント一覧を返す

api.get("/events/:id/admin/comments", requireAdmin, async (c) => {
  const result = await c.env.EVENT_ROOM.getByName(c.req.param("id")).listComments(c.var.keyId);
  return adminResponse(c, result, (comments): AdminCommentsResponse => ({ comments }));
});

for (const [action, hidden] of [
  ["hide", true],
  ["unhide", false],
] as const) {
  api.post(`/events/:id/comments/:cid/${action}`, requireAdmin, async (c) => {
    const room = c.env.EVENT_ROOM.getByName(c.req.param("id"));
    const result = await room.setCommentHidden(c.var.keyId, c.req.param("cid"), hidden);
    return adminResponse(c, result, (comments): AdminCommentsResponse => ({ comments }));
  });

  api.post(`/events/:id/authors/:aid/${action}`, requireAdmin, async (c) => {
    const room = c.env.EVENT_ROOM.getByName(c.req.param("id"));
    const result = await room.setAuthorHidden(c.var.keyId, c.req.param("aid"), hidden);
    return adminResponse(c, result, (comments): AdminCommentsResponse => ({ comments }));
  });
}

// 作成者だけの操作。共同管理者 URL の発行・無効化と、イベントの削除・復元。
// 共同管理者の管理セッションでは 403 になる

api.get("/events/:id/admin-keys", requireAdmin, async (c) => {
  const result = await c.env.EVENT_ROOM.getByName(c.req.param("id")).listAdminKeys(c.var.keyId);
  return adminResponse(c, result, (keys): AdminKeysResponse => ({ keys }));
});

api.post("/events/:id/admin-keys", requireAdmin, async (c) => {
  const token = generateToken();
  const room = c.env.EVENT_ROOM.getByName(c.req.param("id"));
  const result = await room.createAdminKey(c.var.keyId, await hashToken(token));
  return adminResponse(c, result, (key): CreateAdminKeyResponse => ({ key, token }));
});

api.delete("/events/:id/admin-keys/:keyId", requireAdmin, async (c) => {
  const room = c.env.EVENT_ROOM.getByName(c.req.param("id"));
  const result = await room.revokeAdminKey(c.var.keyId, c.req.param("keyId"));
  return adminResponse(c, result, (keys): AdminKeysResponse => ({ keys }));
});

api.delete("/events/:id", requireAdmin, async (c) => {
  const result = await c.env.EVENT_ROOM.getByName(c.req.param("id")).deleteEvent(c.var.keyId);
  return adminResponse(c, result, (deletion): DeleteEventResponse => ({ deletion }));
});

api.post("/events/:id/restore", requireAdmin, async (c) => {
  const result = await c.env.EVENT_ROOM.getByName(c.req.param("id")).restoreEvent(c.var.keyId);
  return adminResponse(c, result, (value): GetAdminResponse => value);
});

api.all("*", (c) => c.json<ErrorResponse>({ error: "not_found" }, 404));

const app = new Hono<{ Bindings: Env }>();

app.route("/api", api);

// イベントページの HTML。D1 の索引だけを見て OGP を差し込み、EventRoom は起こさない。
app.get("/e/:id", async (c) => {
  const [html, event] = await Promise.all([
    c.env.ASSETS.fetch(new URL("/", c.req.url)),
    findIndexedEvent(c.env.DB, c.req.param("id")),
  ]);
  // 見つからないときも SPA を返し、画面側で「見つかりません」を出す
  if (!event) return new Response(html.body, { status: 404, headers: html.headers });
  return injectOgp(html, eventOgp(event));
});

// /e/:id/manage など、OGP を差し込まない画面はそのまま静的アセット（SPA）に任せる
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app satisfies ExportedHandler<Env>;
