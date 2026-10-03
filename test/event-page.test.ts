import { listDurableObjectIds } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { CreateEventResponse, GetEventResponse } from "../src/shared/api";
import worker from "../src/worker/index";

async function createEvent(name = "LT 会 #1") {
  const res = await exports.default.fetch("http://example.com/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      date: "2026-10-01",
      url: "https://example.com/lt",
      hashtag: "ltkai",
      talks: [
        { speaker: "山田", title: "SolidJS 入門" },
        { speaker: "佐藤", title: "" },
      ],
    }),
  });
  return (await res.json<CreateEventResponse>()).id;
}

describe("GET /api/events/:id", () => {
  it("イベント情報と発表枠を並び順で返す", async () => {
    const id = await createEvent();
    const res = await exports.default.fetch(`http://example.com/api/events/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json<GetEventResponse>();
    expect(body.event).toEqual({
      id,
      name: "LT 会 #1",
      date: "2026-10-01",
      url: "https://example.com/lt",
      hashtag: "ltkai",
      commentsOpen: true,
    });
    expect(body.talks.map(({ speaker, title }) => ({ speaker, title }))).toEqual([
      { speaker: "山田", title: "SolidJS 入門" },
      { speaker: "佐藤", title: "" },
    ]);
    expect(body.talks[0]?.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  it.each([
    ["存在しない ID", "nothere1"],
    ["形式が不正な ID", "bad"],
  ])("見つからなければ 404（%s）", async (_, id) => {
    const res = await exports.default.fetch(`http://example.com/api/events/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("削除済みなら 404", async () => {
    const id = await createEvent();
    await env.DB.prepare("UPDATE events SET deleted_at = 1 WHERE id = ?").bind(id).run();
    const res = await exports.default.fetch(`http://example.com/api/events/${id}`);
    expect(res.status).toBe(404);
  });

  it("D1 にない ID では EventRoom を起こさない", async () => {
    await exports.default.fetch("http://example.com/api/events/ghost001");
    // 起こすとコンストラクタがスキーマを書くので、ストレージを持つ DO として列挙される
    const ghost = env.EVENT_ROOM.idFromName("ghost001");
    const ids = await listDurableObjectIds(env.EVENT_ROOM);
    expect(ids.some((id) => id.equals(ghost))).toBe(false);
  });
});

const INDEX_HTML = `<!doctype html><html><head>
<title>LeacTion!</title>
<meta name="description" content="共通の説明" />
<meta property="og:title" content="LeacTion!" />
<meta property="og:description" content="共通の説明" />
</head><body><div id="root"></div></body></html>`;

/** 静的アセットの代わり。どのパスにも index.html を返す（SPA の not_found_handling と同じ） */
function fetchPage(path: string) {
  const assets = {
    fetch: async () => new Response(INDEX_HTML, { headers: { "Content-Type": "text/html" } }),
  };
  return worker.fetch(
    new Request(`http://example.com${path}`),
    Object.assign(Object.create(env), { ASSETS: assets }),
  );
}

describe("GET /e/:id", () => {
  it("イベント名入りの OGP を差し込む", async () => {
    const id = await createEvent();
    const res = await fetchPage(`/e/${id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>LT 会 #1 | LeacTion!</title>");
    expect(html).toContain('<meta property="og:title" content="LT 会 #1 | LeacTion!" />');
    expect(html).toContain(
      '<meta property="og:description" content="2026年10月1日開催「LT 会 #1」の発表に、ログインなしでコメントといいねを送れます。" />',
    );
    expect(html).toContain('<meta name="description" content="2026年10月1日開催');
  });

  it("イベント名の記号はエスケープする", async () => {
    const id = await createEvent(`"><script>alert(1)</script>&amp;`);
    const html = await (await fetchPage(`/e/${id}`)).text();
    // 属性値の中では " と & だけを変えれば、タグを閉じられず文字参照としても解釈されない
    expect(html).toContain(
      '<meta property="og:title" content="&quot;><script>alert(1)</script>&amp;amp; | LeacTion!" />',
    );
    expect(html).toContain(
      '<title>"&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;amp; | LeacTion!</title>',
    );
  });

  it("見つからなければ共通の OGP のまま 404", async () => {
    const res = await fetchPage("/e/nothere1");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("<title>LeacTion!</title>");
  });

  it("管理画面には差し込まない", async () => {
    const id = await createEvent();
    const res = await fetchPage(`/e/${id}/manage`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>LeacTion!</title>");
  });
});
