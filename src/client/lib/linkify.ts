// コメント本文の URL を見つけて、テキストとリンクの断片に分ける。
// 本文は HTML として解釈せず、断片ごとにテキストノードと <a> を作って表示する（innerHTML は使わない）。

export type Segment = { type: "text"; text: string } | { type: "url"; text: string; url: string };

// 日本語の文中に置かれることが多いので、全角の句読点・括弧で URL を切る
const URL_PATTERN = /https?:\/\/[^\s<>"'`、。，．「」『』（）【】]+/giu;
/** URL の末尾に付いていても URL の一部とみなさない記号 */
const TRAILING = /[.,:;!?'"]+$/u;

export function linkify(body: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(URL_PATTERN)) {
    let text = match[0].replace(TRAILING, "");
    // 「(https://example.com)」のような閉じ括弧は、URL 内に開き括弧がなければ外す
    while (text.endsWith(")") && count(text, "(") < count(text, ")")) text = text.slice(0, -1);
    const url = parseUrl(text);
    if (!url) continue;
    if (match.index > last) segments.push({ type: "text", text: body.slice(last, match.index) });
    segments.push({ type: "url", text, url });
    last = match.index + text.length;
  }
  if (last < body.length) segments.push({ type: "text", text: body.slice(last) });
  return segments;
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

function parseUrl(text: string): string | null {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
