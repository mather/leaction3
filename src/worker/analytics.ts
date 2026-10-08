// アクセス解析の書き込み。docs/analytics.md の「データの置き場所」の列の割り当てに合わせる。
// 計測の失敗で本来の処理を失敗させないよう、ここで投げた例外は呼び出し側で握りつぶす。

import * as v from "valibot";
import { type Footprint, type Visitor, VisitorSchema } from "../shared/schema";

type DataPoint = {
  name: Footprint["name"] | "create";
  page: Footprint["page"];
  eventId: string;
  src: Footprint["src"];
  target?: string;
};

/** 国コード。ローカル開発やテストでは cf がない */
function countryOf(request: Request): string {
  const country = (request as { cf?: { country?: unknown } }).cf?.country;
  return typeof country === "string" ? country : "";
}

function write(env: Env, request: Request, visitor: Visitor, point: DataPoint, now: number): void {
  env.ANALYTICS.writeDataPoint({
    indexes: [visitor.anon],
    blobs: [
      point.name,
      point.page,
      point.eventId,
      point.src,
      visitor.src,
      visitor.entry,
      visitor.ref,
      visitor.eventId,
      point.target ?? "",
      countryOf(request),
    ],
    doubles: [
      Math.max(0, Math.round((now - visitor.at) / 1000)),
      visitor.joinedAt === null ? 0 : 1,
      visitor.created,
    ],
  });
}

/** ブラウザから送られた計測（POST /api/footprints）を書き込む */
export function writeFootprints(
  env: Env,
  request: Request,
  visitor: Visitor,
  items: Footprint[],
): void {
  const now = Date.now();
  for (const item of items) write(env, request, visitor, item, now);
}

/**
 * イベントの作成を記録する。作成者の初回接触を D1 の event_creations に恒久保存し、Analytics Engine にも書く。
 * visitor は作成の本文に添えられたもの。壊れている・ないときは初回接触なしで記録する
 */
export async function recordCreation(
  env: Env,
  request: Request,
  eventId: string,
  rawVisitor: unknown,
): Promise<void> {
  const now = Date.now();
  const parsed = v.safeParse(VisitorSchema, rawVisitor);
  const visitor = parsed.success ? parsed.output : null;
  await env.DB.prepare(
    `INSERT INTO event_creations
       (event_id, created_at, anon_id, first_src, first_entry, first_ref, first_event_id, first_seen_at, joined_at, prior_events)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      eventId,
      now,
      visitor?.anon ?? null,
      visitor?.src ?? null,
      visitor?.entry ?? null,
      visitor?.ref || null,
      visitor?.eventId || null,
      visitor?.at ?? null,
      visitor?.joinedAt ?? null,
      visitor?.created ?? null,
    )
    .run();
  if (visitor) {
    write(env, request, visitor, { name: "create", page: "new", eventId, src: "internal" }, now);
  }
}
