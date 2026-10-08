import * as v from "valibot";
import {
  ANALYTICS_PAGES,
  type AnalyticsPage,
  EventIdSchema,
  FOOTPRINTS_MAX_ITEMS,
  type Footprint,
  type FootprintsInput,
  TRAFFIC_SOURCES,
  type TrafficSource,
  type Visitor,
} from "../../shared/schema";
import { landingSource, pageOf, SRC_PARAM } from "./traffic";

// アクセス解析。匿名 ID と初回接触を localStorage に持ち、計測をためて自分の Worker にまとめて送る。
// docs/analytics.md を参照。計測の失敗で画面の操作を妨げないよう、例外はすべてここで握りつぶす。

const STORAGE_KEY = "leaction:visitor";
/** 「観客としての参加」から除くために覚えておく、このブラウザで作ったイベントの数 */
const CREATED_RETAINED = 20;
/** ためた計測を送るまでの時間と件数 */
const FLUSH_DELAY_MS = 5000;
const FLUSH_COUNT = 10;

/** localStorage に保存する形。送るときは created を件数にする */
const StoredVisitorSchema = v.object({
  anon: v.string(),
  src: v.picklist(TRAFFIC_SOURCES),
  entry: v.picklist(ANALYTICS_PAGES),
  ref: v.string(),
  eventId: v.string(),
  at: v.number(),
  joinedAt: v.nullable(v.number()),
  created: v.array(v.string()),
});

type StoredVisitor = v.InferOutput<typeof StoredVisitorSchema>;

let visitor: StoredVisitor | undefined;
/** 今回ページを読み込んだときの流入元 */
let visitSrc: TrafficSource = "direct";
const queue: Footprint[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function load(): StoredVisitor | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = v.safeParse(StoredVisitorSchema, JSON.parse(raw));
    return parsed.success ? parsed.output : undefined;
  } catch {
    return undefined;
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visitor));
  } catch {
    // 保存できなければ、このページを開いている間だけの ID になる
  }
}

/**
 * 画面を描く前に 1 回呼ぶ。今回の流入元を決め、初回なら匿名 ID と初回接触を保存する。
 * `?src=` はアドレスバーから消し、その URL がさらに配られたときに別の経路の値が混ざらないようにする
 */
export function startAnalytics(): void {
  try {
    const url = new URL(location.href);
    const landing = landingSource(url.searchParams.get(SRC_PARAM), document.referrer, url.origin);
    visitSrc = landing.src;
    if (url.searchParams.has(SRC_PARAM)) {
      url.searchParams.delete(SRC_PARAM);
      history.replaceState(history.state, "", url);
    }
    visitor = load();
    if (!visitor) {
      const { page, eventId } = pageOf(url.pathname);
      visitor = {
        anon: crypto.randomUUID(),
        src: landing.src,
        entry: page,
        ref: landing.ref,
        eventId,
        at: Date.now(),
        joinedAt: null,
        created: [],
      };
      save();
    }
    addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  } catch {
    visitor = undefined;
  }
}

/** 送る形の初回接触。startAnalytics の前や失敗したときは undefined */
export function currentVisitor(): Visitor | undefined {
  if (!visitor) return undefined;
  const { created, ...rest } = visitor;
  return { ...rest, created: created.length };
}

/** 計測 1 件の種類ごとに src を除いたもの。src は今回の流入元を付ける */
type FootprintInput = OmitSrc<Footprint>;
type OmitSrc<T> = T extends unknown ? Omit<T, "src"> : never;

/** 計測を 1 件ためる。件数か時間がたまったら送る */
export function track(item: FootprintInput): void {
  if (!visitor) return;
  // 不正な値が 1 件でもあるとまとめて捨てられるので、URL から来たイベント ID はここで確かめる
  const eventId = v.is(EventIdSchema, item.eventId) ? item.eventId : "";
  queue.push({ ...item, eventId, src: visitSrc } as Footprint);
  if (queue.length >= FLUSH_COUNT) {
    flush();
  } else if (timer === undefined) {
    timer = setTimeout(flush, FLUSH_DELAY_MS);
  }
}

export function trackView(page: AnalyticsPage, eventId = ""): void {
  track({ name: "view", page, eventId });
}

/** イベントページを開いた。自分が作ったイベントでなければ、観客として参加したことにする */
export function markJoined(eventId: string): void {
  if (!visitor || visitor.joinedAt !== null || visitor.created.includes(eventId)) return;
  visitor.joinedAt = Date.now();
  save();
}

/** イベントを作成した */
export function markCreated(eventId: string): void {
  if (!visitor) return;
  visitor.created = [...visitor.created, eventId].slice(-CREATED_RETAINED);
  save();
}

function flush(): void {
  clearTimeout(timer);
  timer = undefined;
  const sending = currentVisitor();
  if (!sending || queue.length === 0) return;
  // ブロッカーに ping として一括遮断されないよう、sendBeacon ではなく keepalive の fetch で送る
  while (queue.length > 0) {
    const body: FootprintsInput = {
      visitor: sending,
      items: queue.splice(0, FOOTPRINTS_MAX_ITEMS),
    };
    fetch("/api/footprints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      // 送れなくても再送しない
    });
  }
}
