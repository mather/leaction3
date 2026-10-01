import { Hono } from "hono";
import * as v from "valibot";
import type { CreateEventResponse, ErrorResponse, HealthResponse } from "../shared/api";
import { createEventInputSchema, resolveLimits } from "../shared/schema";
import { generateToken, hashToken, randomId } from "./auth";
import { verifyTurnstile } from "./turnstile";

export { EventRoom } from "./event-room";

const app = new Hono<{ Bindings: Env }>().basePath("/api");

// 雛形段階の疎通確認。Worker から D1 と EventRoom に届くことを確かめる。
app.get("/health", async (c) => {
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

app.post("/events", async (c) => {
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

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app satisfies ExportedHandler<Env>;
