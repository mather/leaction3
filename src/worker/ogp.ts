// /e/:id の HTML にイベントごとの OGP を差し込む。
// 差し込み先のタグ（サービス共通の既定値）は index.html に置いてある。

export type OgpEvent = { id: string; name: string; date: string };

/** "2026-10-01" → "2026年10月1日" */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/**
 * OGP 画像の版。画像の URL に付け、名前や開催日を変えたら別の URL にする。
 * X などは画像を URL ごとにキャッシュするので、同じ URL のままだと古い画像が出続ける。
 */
export async function ogImageVersion(event: OgpEvent): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${event.name}\n${event.date}`),
  );
  return [...new Uint8Array(digest).slice(0, 6)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function eventOgp(event: OgpEvent, origin: string) {
  return {
    title: `${event.name} | LeacTion!`,
    description: `${formatDate(event.date)}開催「${event.name}」の発表に、ログインなしでコメントといいねを送れます。`,
    image: `${origin}/e/${event.id}/og.png?v=${await ogImageVersion(event)}`,
  };
}

// setAttribute は " だけをエスケープするので、名前に含まれる文字参照が解釈されないよう & も変える
function setContent(value: string) {
  return {
    element(el: Element) {
      el.setAttribute("content", value.replaceAll("&", "&amp;"));
    },
  };
}

export function injectOgp(html: Response, ogp: Awaited<ReturnType<typeof eventOgp>>): Response {
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(ogp.title);
      },
    })
    .on('meta[name="description"]', setContent(ogp.description))
    .on('meta[property="og:title"]', setContent(ogp.title))
    .on('meta[property="og:description"]', setContent(ogp.description))
    .on('meta[property="og:image"]', setContent(ogp.image))
    .on('meta[property="og:image:alt"]', setContent(ogp.title))
    .transform(html);
}

/**
 * index.html の og:image は相対パスで書いてあるので、リクエストのオリジンで絶対 URL にする。
 * X や Facebook は相対パスの画像を読まない。
 */
export function absolutizeOgImage(html: Response, origin: string): Response {
  return new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(el) {
        const path = el.getAttribute("content");
        if (path?.startsWith("/")) el.setAttribute("content", `${origin}${path}`);
      },
    })
    .transform(html);
}
