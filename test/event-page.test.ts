import { listDurableObjectIds } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { CreateEventResponse, GetEventResponse } from "../src/shared/api";
import worker from "../src/worker/index";
import { ogImageVersion } from "../src/worker/ogp";

async function createEvent(name = "LT 会 #1") {
  const res = await exports.default.fetch("http://example.com/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      date: "2026-10-01",
      url: "https://example.com/lt",
      hashtags: ["ltkai", "collab"],
      talks: [
        { speaker: "山田", title: "SolidJS 入門" },
        { speaker: "佐藤", title: "" },
      ],
    }),
  });
  return (await res.json<CreateEventResponse>()).id;
}

describe("GET /api/rooms/:id", () => {
  it("イベント情報と発表枠を並び順で返す", async () => {
    const id = await createEvent();
    const res = await exports.default.fetch(`http://example.com/api/rooms/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json<GetEventResponse>();
    expect(body.event).toEqual({
      id,
      name: "LT 会 #1",
      date: "2026-10-01",
      url: "https://example.com/lt",
      hashtags: ["ltkai", "collab"],
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
    const res = await exports.default.fetch(`http://example.com/api/rooms/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("削除済みなら 404", async () => {
    const id = await createEvent();
    await env.DB.prepare("UPDATE events SET deleted_at = 1 WHERE id = ?").bind(id).run();
    const res = await exports.default.fetch(`http://example.com/api/rooms/${id}`);
    expect(res.status).toBe(404);
  });

  it("D1 にない ID では EventRoom を起こさない", async () => {
    await exports.default.fetch("http://example.com/api/rooms/ghost001");
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
<meta property="og:image" content="/ogp.png" />
<meta property="og:image:alt" content="LeacTion!" />
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
    expect(html).toContain('<meta property="og:image:alt" content="LT 会 #1 | LeacTion!" />');
  });

  it("OGP 画像はイベントの画像を絶対 URL で指し、名前と開催日から決まる版を付ける", async () => {
    const id = await createEvent();
    const html = await (await fetchPage(`/e/${id}`)).text();
    const version = await ogImageVersion({ id, name: "LT 会 #1", date: "2026-10-01" });
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(html).toContain(
      `<meta property="og:image" content="http://example.com/e/${id}/og.png?v=${version}" />`,
    );
    // 名前が変われば版も変わる
    expect(await ogImageVersion({ id, name: "LT 会 #2", date: "2026-10-01" })).not.toBe(version);
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
    const html = await res.text();
    expect(html).toContain("<title>LeacTion!</title>");
    expect(html).toContain('<meta property="og:image" content="http://example.com/ogp.png" />');
  });

  it("管理画面には差し込まない", async () => {
    const id = await createEvent();
    const res = await fetchPage(`/e/${id}/manage`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>LeacTion!</title>");
  });
});

describe("共通の OGP 画像", () => {
  it("トップページなどでは共通の画像を絶対 URL にする", async () => {
    for (const path of ["/", "/new", "/terms"]) {
      const html = await (await fetchPage(path)).text();
      expect(html).toContain('<meta property="og:image" content="http://example.com/ogp.png" />');
    }
  });
});

describe("GET /e/:id/og.png", () => {
  it("描けないときは共通の画像へリダイレクトする", async () => {
    // テスト環境ではビルド済みの背景画像がなく、Images もオフライン版で文字を描けない
    const id = await createEvent();
    const res = await exports.default.fetch(`http://example.com/e/${id}/og.png`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/ogp.png");
  });

  it("見つからなければ 404", async () => {
    const res = await exports.default.fetch("http://example.com/e/ghost002/og.png");
    expect(res.status).toBe(404);
  });
});
