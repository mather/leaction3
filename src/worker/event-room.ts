import { DurableObject } from "cloudflare:workers";
import type { GetEventResponse } from "../shared/api";
import type { Talk } from "../shared/protocol";
import type { CreateEventData } from "../shared/schema";
import { randomId } from "./auth";

// EventRoom 内の SQLite。docs/architecture.md「データモデル」を参照。
// 時刻は UNIX エポックからのミリ秒。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS event (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  url TEXT,
  hashtag TEXT,
  comments_open INTEGER NOT NULL DEFAULT 1,
  live_talk_id TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS talks (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  title TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  talk_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comment',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_talk ON comments (talk_id, created_at);
CREATE TABLE IF NOT EXISTS likes (
  comment_id TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, voter_id)
);
CREATE TABLE IF NOT EXISTS admin_keys (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS hidden_authors (
  author_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
`;

export type InitializeParams = {
  id: string;
  event: Omit<CreateEventData, "turnstileToken">;
  ownerTokenHash: string;
};

export type InitializeResult = { ok: true } | { ok: false; reason: "id_taken" };

/**
 * 1 イベント = 1 インスタンス。イベントへの書き込みはすべてここを通して直列化する。
 * ストレージは SQLite API（ctx.storage.sql）を使う。
 */
export class EventRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(SCHEMA);
    });
  }

  /** 疎通確認用。DO の SQLite に触れられることを確かめる。 */
  async ping(): Promise<{ ok: true; sqlite: number }> {
    const row = this.ctx.storage.sql.exec<{ one: number }>("SELECT 1 AS one").one();
    return { ok: true, sqlite: row.one };
  }

  /**
   * イベントを作成する。D1 の索引に登録してから、この DO の SQLite に中身を書く。
   * ID が D1 で使用済みなら何も書かずに id_taken を返す（呼び出し側で ID を作り直す）。
   */
  async initialize({ id, event, ownerTokenHash }: InitializeParams): Promise<InitializeResult> {
    const sql = this.ctx.storage.sql;
    if (sql.exec("SELECT 1 FROM event").toArray().length > 0)
      return { ok: false, reason: "id_taken" };

    const now = Date.now();
    const inserted = await this.env.DB.prepare(
      "INSERT OR IGNORE INTO events (id, name, date, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(id, event.name, event.date, now)
      .run();
    if (inserted.meta.changes === 0) return { ok: false, reason: "id_taken" };

    // SQLite への書き込みはロールバックされるが、D1 の索引は残るので消してから投げ直す
    try {
      this.ctx.storage.transactionSync(() => {
        sql.exec(
          "INSERT INTO event (singleton, id, name, date, url, hashtag, created_at) VALUES (1, ?, ?, ?, ?, ?, ?)",
          id,
          event.name,
          event.date,
          event.url,
          event.hashtag,
          now,
        );
        event.talks.forEach((talk, i) => {
          sql.exec(
            "INSERT INTO talks (id, position, speaker, title) VALUES (?, ?, ?, ?)",
            randomId(),
            i,
            talk.speaker,
            talk.title,
          );
        });
        sql.exec(
          "INSERT INTO admin_keys (id, role, token_hash, created_at) VALUES (?, 'owner', ?, ?)",
          randomId(),
          ownerTokenHash,
          now,
        );
      });
    } catch (err) {
      await this.env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
      throw err;
    }
    return { ok: true };
  }

  /** イベント情報と発表枠（並び順）。未作成・削除済みなら null。 */
  async getEvent(): Promise<GetEventResponse | null> {
    const sql = this.ctx.storage.sql;
    const row = sql
      .exec<{
        id: string;
        name: string;
        date: string;
        url: string | null;
        hashtag: string | null;
        comments_open: number;
        deleted_at: number | null;
      }>("SELECT id, name, date, url, hashtag, comments_open, deleted_at FROM event")
      .toArray()[0];
    if (!row || row.deleted_at !== null) return null;
    const talks = sql
      .exec<Talk>("SELECT id, speaker, title FROM talks ORDER BY position")
      .toArray()
      .map(({ id, speaker, title }) => ({ id, speaker, title }));
    return {
      event: {
        id: row.id,
        name: row.name,
        date: row.date,
        url: row.url,
        hashtag: row.hashtag,
        commentsOpen: row.comments_open === 1,
      },
      talks,
    };
  }
}
