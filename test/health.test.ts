import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("Worker から D1 と EventRoom に届く", async () => {
    const res = await exports.default.fetch("http://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      d1: { events: 0 },
      durableObject: { sqlite: true },
    });
  });

  it("D1 の events を数える", async () => {
    await env.DB.prepare(
      "INSERT INTO events (id, name, date, created_at) VALUES ('abcd1234', 'LT 会', '2026-10-01', 0)",
    ).run();
    const res = await exports.default.fetch("http://example.com/api/health");
    expect(await res.json()).toMatchObject({ d1: { events: 1 } });
  });
});

describe("未定義の API", () => {
  it("404 を JSON で返す", async () => {
    const res = await exports.default.fetch("http://example.com/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
