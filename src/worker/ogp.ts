// /e/:id の HTML にイベントごとの OGP を差し込む。
// 差し込み先のタグ（サービス共通の既定値）は index.html に置いてある。

export type OgpEvent = { name: string; date: string };

/** "2026-10-01" → "2026年10月1日" */
function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

export function eventOgp(event: OgpEvent) {
  return {
    title: `${event.name} | LeacTion!`,
    description: `${formatDate(event.date)}開催「${event.name}」の発表に、ログインなしでコメントといいねを送れます。`,
  };
}

export function injectOgp(html: Response, ogp: ReturnType<typeof eventOgp>): Response {
  // setAttribute は " だけをエスケープするので、名前に含まれる文字参照が解釈されないよう & も変える
  const setContent = (value: string) => ({
    element(el: Element) {
      el.setAttribute("content", value.replaceAll("&", "&amp;"));
    },
  });
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(ogp.title);
      },
    })
    .on('meta[name="description"]', setContent(ogp.description))
    .on('meta[property="og:title"]', setContent(ogp.title))
    .on('meta[property="og:description"]', setContent(ogp.description))
    .transform(html);
}
