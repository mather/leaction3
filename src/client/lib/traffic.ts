// アクセス解析の流入元と画面の判定。DOM に依存しないのでテストからも使える。docs/analytics.md を参照。

import * as v from "valibot";
import {
  type AnalyticsPage,
  EventIdSchema,
  SHARE_SOURCES,
  type TrafficSource,
} from "../../shared/schema";

/** 共有用の URL に付けるクエリ。どの経路で配った URL かを表す */
export const SRC_PARAM = "src";

export type ShareSource = (typeof SHARE_SOURCES)[number];

const SEARCH_ENGINES =
  /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.co\.jp|yahoo\.com|duckduckgo\.com|ecosia\.org|baidu\.com|yandex\.[a-z.]+|naver\.com)$/;
const X_HOSTS = /(^|\.)(x\.com|t\.co|twitter\.com)$/;

/**
 * 今回の訪問の流入元。`?src=` が決まった値ならそれを、なければリファラのホストから決める。
 * ref はリファラのホスト名（同じオリジンやリファラなしでは空）
 */
export function landingSource(
  src: string | null,
  referrer: string,
  origin: string,
): { src: TrafficSource; ref: string } {
  let ref = "";
  try {
    const url = new URL(referrer);
    if (url.origin === origin) return { src: isShareSource(src) ? src : "internal", ref };
    ref = url.hostname;
  } catch {
    // リファラなし、または読めない値
  }
  if (src !== null) return { src: isShareSource(src) ? src : "other", ref };
  if (ref === "") return { src: "direct", ref };
  if (SEARCH_ENGINES.test(ref)) return { src: "search", ref };
  if (X_HOSTS.test(ref)) return { src: "x", ref };
  return { src: "referral", ref };
}

function isShareSource(src: string | null): src is ShareSource {
  return (SHARE_SOURCES as readonly (string | null)[]).includes(src);
}

/** パスから画面とイベント ID を決める */
export function pageOf(pathname: string): { page: AnalyticsPage; eventId: string } {
  if (pathname === "/") return { page: "top", eventId: "" };
  if (pathname === "/new") return { page: "new", eventId: "" };
  const match = /^\/e\/([^/]+)(\/manage)?\/?$/.exec(pathname);
  if (match && v.is(EventIdSchema, match[1])) {
    return { page: match[2] ? "manage" : "event", eventId: match[1] };
  }
  return { page: "other", eventId: "" };
}

/** 共有用の URL に流入元を付ける */
export function withSource(url: string, src: ShareSource): string {
  const u = new URL(url);
  u.searchParams.set(SRC_PARAM, src);
  return u.href;
}
