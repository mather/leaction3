import { Hono } from "hono";
import * as v from "valibot";
import type {
  CreateEventResponse,
  ErrorResponse,
  GetEventResponse,
  HealthResponse,
} from "../shared/api";
import { createEventInputSchema, EventIdSchema, resolveLimits } from "../shared/schema";
import { generateToken, hashToken, randomId } from "./auth";
import { eventOgp, injectOgp } from "./ogp";
import { verifyTurnstile } from "./turnstile";

export { EventRoom } from "./event-room";

/**
 * D1 の索引からイベントを引く。存在しない・削除済みなら null。
 * 不正な ID や存在しない ID で EventRoom を起こさない（空の DO を作らない）ために使う。
 */
async function findIndexedEvent(db: D1Database, id: string) {
  if (!v.is(EventIdSchema, id)) return null;
  return db
    .prepare("SELECT id, name, date FROM events WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<{ id: string; name: string; date: string }>();
}

const api = new Hono<{ Bindings: Env }>();

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

/** ID の衝突時に作り直す回数の上限（64^8 通りなので実際にはまず衝突しない） */
const MAX_ID_ATTEMPTS = 5;

api.post("/events", async (c) => {
  const body = await c.req.json<unknown>().catch(() => undefined);
  const parsed = v.safeParse(createEventInputSchema(resolveLimits(c.env)), body);
  if (!parsed.success) return c.json<ErrorResponse>({ error: "invalid_input" }, 400);
  const { turnstileToken, ...event } = parsed.output;

  const ip = c.req.header("CF-Connecting-IP");
  if (!(await verifyTurnstile(c.env, turnstileToken, ip))) {
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
