import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateEventResponse } from "../src/shared/api";
import type { FootprintsInput, Visitor } from "../src/shared/schema";
import { ORIGIN, request } from "./helpers";

const visitor: Visitor = {
  anon: "0b6f7a52-5f3e-4c1e-9d55-2f1c3f0a9e11",
  src: "qr",
  entry: "event",
  ref: "",
  eventId: "abcdEFGH",
  at: 1_790_000_000_000,
  joinedAt: 1_790_000_100_000,
  created: 0,
};

function createEvent(extra: Record<string, unknown>) {
  return exports.default.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "LT 会",
      date: "2026-10-01",
      talks: [{ speaker: "山田", title: "" }],
      ...extra,
    }),
  });
}

function creationRow(id: string) {
  return env.DB.prepare("SELECT * FROM event_creations WHERE event_id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/footprints", () => {
  const body: FootprintsInput = {
    visitor,
    items: [
      { name: "view", page: "event", eventId: "abcdEFGH", src: "qr" },
      { name: "click", page: "event", eventId: "abcdEFGH", src: "qr", target: "event_menu_top" },
    ],
  };

  it("検証した計測を Analytics Engine に書く", async () => {
    const write = vi.spyOn(env.ANALYTICS, "writeDataPoint");
    const res = await request("/api/footprints", { method: "POST", body });
    expect(res.status).toBe(204);
    expect(write).toHaveBeenCalledTimes(2);
    const point = write.mock.calls[1]?.[0];
    expect(point?.indexes).toEqual([visitor.anon]);
    expect(point?.blobs).toEqual([
      "click",
      "event",
      "abcdEFGH",
      "qr",
      "qr",
      "event",
      "",
      "abcdEFGH",
      "event_menu_top",
      "",
    ]);
    expect(point?.doubles?.[1]).toBe(1);
    expect(point?.doubles?.[2]).toBe(0);
  });

  it("不正な本文は書かずに 204 を返す", async () => {
    const write = vi.spyOn(env.ANALYTICS, "writeDataPoint");
    const bad = { ...body, items: [{ name: "view", page: "event", eventId: "x", src: "qr" }] };
    const res = await request("/api/footprints", { method: "POST", body: bad });
    expect(res.status).toBe(204);
    expect(write).not.toHaveBeenCalled();
  });

  it("別のオリジンからの送信は書かない", async () => {
    const write = vi.spyOn(env.ANALYTICS, "writeDataPoint");
    const res = await request("/api/footprints", {
      method: "POST",
      body,
      origin: "https://evil.example",
    });
    expect(res.status).toBe(204);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("イベント作成の計測", () => {
  it("作成者の初回接触を event_creations に残す", async () => {
    const res = await createEvent({ visitor });
    expect(res.status).toBe(201);
    const { id } = await res.json<CreateEventResponse>();
    expect(await creationRow(id)).toMatchObject({
      anon_id: visitor.anon,
      first_src: "qr",
      first_entry: "event",
      first_ref: null,
      first_event_id: "abcdEFGH",
      first_seen_at: visitor.at,
      joined_at: visitor.joinedAt,
      prior_events: 0,
    });
  });

  it("計測情報がない・壊れていても作成でき、初回接触なしで残す", async () => {
    for (const extra of [{}, { visitor: { anon: "<script>" } }]) {
      const res = await createEvent(extra);
      expect(res.status).toBe(201);
      const { id } = await res.json<CreateEventResponse>();
      expect(await creationRow(id)).toMatchObject({ anon_id: null, first_src: null });
    }
  });
});
