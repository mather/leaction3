import { Hono } from "hono";
import type { HealthResponse } from "../shared/api";

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

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app satisfies ExportedHandler<Env>;
