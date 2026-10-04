import { DurableObject } from "cloudflare:workers";
import * as v from "valibot";
import type { GetEventResponse } from "../shared/api";
import {
  type ClientMessage,
  type Comment,
  type ErrorCode,
  type ServerMessage,
  type Talk,
  WS_PING,
  WS_PONG,
  WS_SINCE_PARAM,
} from "../shared/protocol";
import {
  type CreateEventData,
  clientMessageSchema,
  type Limits,
  maxClientMessageLength,
  resolveLimits,
} from "../shared/schema";
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
  client_id TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comment',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_talk ON comments (talk_id, created_at);
-- 連投上限の判定と、投稿者単位の一括非表示に使う
CREATE INDEX IF NOT EXISTS comments_author ON comments (author_id, created_at);
-- 再送された同じ投稿（clientId）を二重に登録しない
CREATE UNIQUE INDEX IF NOT EXISTS comments_client ON comments (author_id, client_id);
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
-- 配信した差分の記録。seq は差分の連番で、再接続時に取りこぼした分だけを送り直すのに使う。
-- 本文などは持たず、送り直すときに今の comments から組み立てる（その間に非表示になったものは送らない）
CREATE TABLE IF NOT EXISTS updates (
  seq INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  comment_id TEXT,
  created_at INTEGER NOT NULL
);
`;

/** Worker が Cookie から取り出した参加者 ID を EventRoom に渡すヘッダー */
export const PARTICIPANT_HEADER = "X-Participant-Id";

/** 再接続時の補完に使う差分の保持件数。これより古い seq からの再接続には snapshot を送る */
const UPDATES_RETAINED = 1000;

type UpdateType = "comment.added" | "comment.removed" | "like.changed";

type CommentRow = {
  id: string;
  talk_id: string;
  author_id: string;
  client_id: string;
  body: string;
  created_at: number;
  likes: number;
  liked_by_me: number;
};

/** 表示中のコメントを、閲覧者（viewer）から見た形で引く。条件は WHERE 句に AND でつなぐ */
const COMMENT_SELECT = `
SELECT c.id, c.talk_id, c.author_id, c.client_id, c.body, c.created_at,
  (SELECT COUNT(*) FROM likes l WHERE l.comment_id = c.id) AS likes,
  EXISTS (SELECT 1 FROM likes l WHERE l.comment_id = c.id AND l.voter_id = ?1) AS liked_by_me
FROM comments c
WHERE c.hidden = 0`;

function toComment(row: CommentRow, viewer: string): Comment {
  const mine = row.author_id === viewer;
  return {
    id: row.id,
    talkId: row.talk_id,
    body: row.body,
    createdAt: row.created_at,
    likes: row.likes,
    mine,
    likedByMe: row.liked_by_me === 1,
    ...(mine ? { clientId: row.client_id } : {}),
  };
}

/** `?since=` の値。なし・不正なら null（snapshot を送る） */
function parseSince(value: string | null): number | null {
  if (value === null || !/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}

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
  /** 最後に配信した差分の seq。差分がまだなければ 0 */
  private seq = 0;
  private readonly limits: Limits;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.limits = resolveLimits(env);
    // 死活確認の ping には DO を起こさずに応答する（休止中の課金を増やさない）
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(WS_PING, WS_PONG));
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(SCHEMA);
      this.seq = ctx.storage.sql
        .exec<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) AS seq FROM updates")
        .one().seq;
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
    return this.readEvent();
  }

  private readEvent(): GetEventResponse | null {
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

  /**
   * WebSocket の受付。Worker が参加者 Cookie と Origin を確かめ、参加者 ID をヘッダーに入れて転送してくる。
   * Hibernation API で受け付け、メッセージがない間は DO を休止させる。
   */
  override async fetch(request: Request): Promise<Response> {
    const participantId = request.headers.get(PARTICIPANT_HEADER);
    if (!participantId || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response(null, { status: 400 });
    }
    if (!this.isActive()) return new Response(null, { status: 404 });

    const since = parseSince(new URL(request.url).searchParams.get(WS_SINCE_PARAM));
    const { 0: client, 1: server } = new WebSocketPair();
    // タグに参加者 ID を付け、配信時に「自分の投稿か」を閲覧者ごとに決める
    this.ctx.acceptWebSocket(server, [participantId]);
    for (const message of this.syncMessages(participantId, since)) send(server, message);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const participantId = this.ctx.getTags(ws)[0];
    if (!participantId) return;
    if (typeof raw !== "string" || raw.length > maxClientMessageLength(this.limits)) {
      return send(ws, { type: "error", code: "invalid_message" });
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return send(ws, { type: "error", code: "invalid_message" });
    }
    const parsed = v.safeParse(clientMessageSchema(this.limits), data);
    if (!parsed.success) {
      return send(ws, { type: "error", code: "invalid_message", ...clientIdOf(data) });
    }
    const message: ClientMessage = parsed.output;
    switch (message.type) {
      case "comment.post":
        return this.postComment(ws, participantId, message);
      case "comment.delete":
        return this.deleteComment(ws, participantId, message.commentId);
      case "like.set":
        return this.setLike(ws, participantId, message);
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // 1005・1006 など送り返せないコードや、すでに閉じている場合
    }
  }

  /** イベントが作成済みで、削除されていないか */
  private isActive(): boolean {
    const row = this.ctx.storage.sql
      .exec<{ deleted_at: number | null }>("SELECT deleted_at FROM event")
      .toArray()[0];
    return row !== undefined && row.deleted_at === null;
  }

  /**
   * 接続直後に送るメッセージ。`?since=` の seq 以降の差分が手元に残っていればそれだけを、
   * なければ snapshot を送る。
   */
  private syncMessages(viewer: string, since: number | null): ServerMessage[] {
    if (since !== null && since <= this.seq) {
      const sql = this.ctx.storage.sql;
      const oldest = sql
        .exec<{ seq: number | null }>("SELECT MIN(seq) AS seq FROM updates")
        .one().seq;
      if (since === this.seq || (oldest !== null && since >= oldest - 1)) {
        const updates = sql
          .exec<{ seq: number; type: UpdateType; comment_id: string }>(
            "SELECT seq, type, comment_id FROM updates WHERE seq > ? ORDER BY seq",
            since,
          )
          .toArray();
        const comments = new Map(
          sql
            .exec<CommentRow>(
              `${COMMENT_SELECT} AND c.id IN (SELECT comment_id FROM updates WHERE seq > ?2 AND type != 'comment.removed')`,
              viewer,
              since,
            )
            .toArray()
            .map((row) => [row.id, toComment(row, viewer)]),
        );
        // seq が飛ぶとクライアントは取りこぼしとみなして接続し直すので、差分 1 件につき必ず 1 通送る
        return updates.map((u): ServerMessage => {
          const comment = comments.get(u.comment_id);
          // その後に非表示・削除されたコメントは本文を送らず、消えたことだけを伝える
          if (u.type === "comment.removed" || !comment) {
            return { type: "comment.removed", seq: u.seq, commentId: u.comment_id };
          }
          if (u.type === "comment.added") return { type: "comment.added", seq: u.seq, comment };
          // いいね数は送り直す時点の値。同じコメントの差分が続いても結果は変わらない
          return {
            type: "like.changed",
            seq: u.seq,
            commentId: comment.id,
            likes: comment.likes,
            likedByMe: comment.likedByMe,
          };
        });
      }
    }
    return [this.snapshot(viewer)];
  }

  private snapshot(viewer: string): ServerMessage {
    const found = this.readEvent();
    if (!found) throw new Error("event not found");
    const comments = this.ctx.storage.sql
      .exec<CommentRow>(`${COMMENT_SELECT} ORDER BY c.created_at, c.rowid`, viewer)
      .toArray()
      .map((row) => toComment(row, viewer));
    return { type: "snapshot", seq: this.seq, ...found, comments };
  }

  private postComment(
    ws: WebSocket,
    author: string,
    { talkId, body, clientId }: Extract<ClientMessage, { type: "comment.post" }>,
  ): void {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const rejected = this.checkPost(author, talkId, clientId, now);
    if (rejected) {
      send(ws, rejected);
      return;
    }

    const id = randomId(10);
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        "INSERT INTO comments (id, talk_id, author_id, client_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        talkId,
        author,
        clientId,
        body,
        now,
      );
      this.recordUpdate("comment.added", id, now);
    });

    const row: CommentRow = {
      id,
      talk_id: talkId,
      author_id: author,
      client_id: clientId,
      body,
      created_at: now,
      likes: 0,
      liked_by_me: 0,
    };
    this.broadcast((viewer) => ({
      type: "comment.added",
      seq: this.seq,
      comment: toComment(row, viewer),
    }));
  }

  /** 自分のコメントを削除する。いいねも一緒に消す。他人のコメントは見つからない扱いにする */
  private deleteComment(ws: WebSocket, author: string, commentId: string): void {
    const sql = this.ctx.storage.sql;
    const own =
      this.isActive() &&
      sql.exec("SELECT 1 FROM comments WHERE id = ? AND author_id = ?", commentId, author).toArray()
        .length > 0;
    if (!own) {
      send(ws, { type: "error", code: "not_found", commentId });
      return;
    }
    this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM likes WHERE comment_id = ?", commentId);
      sql.exec("DELETE FROM comments WHERE id = ?", commentId);
      this.recordUpdate("comment.removed", commentId, Date.now());
    });
    this.broadcast(() => ({ type: "comment.removed", seq: this.seq, commentId }));
  }

  /**
   * いいねの付け外し。投票者は接続の参加者 ID で、1 人 1 回は likes の主キーで守る。
   * 自分のコメントにはいいねできない。状態が変わらなければ何も配信しない。
   */
  private setLike(
    ws: WebSocket,
    voter: string,
    { commentId, liked }: Extract<ClientMessage, { type: "like.set" }>,
  ): void {
    const sql = this.ctx.storage.sql;
    const comment = this.isActive()
      ? sql
          .exec<{ author_id: string }>(
            "SELECT author_id FROM comments WHERE id = ? AND hidden = 0",
            commentId,
          )
          .toArray()[0]
      : undefined;
    if (!comment) {
      send(ws, { type: "error", code: "not_found", commentId });
      return;
    }
    if (comment.author_id === voter) {
      send(ws, { type: "error", code: "invalid_message", commentId });
      return;
    }

    const now = Date.now();
    const changed = this.ctx.storage.transactionSync(() => {
      const cursor = liked
        ? sql.exec(
            "INSERT OR IGNORE INTO likes (comment_id, voter_id, created_at) VALUES (?, ?, ?)",
            commentId,
            voter,
            now,
          )
        : sql.exec("DELETE FROM likes WHERE comment_id = ? AND voter_id = ?", commentId, voter);
      cursor.toArray();
      if (cursor.rowsWritten === 0) return false;
      this.recordUpdate("like.changed", commentId, now);
      return true;
    });
    if (!changed) return;

    const likes = sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM likes WHERE comment_id = ?",
        commentId,
      )
      .one().count;
    // 他の人の「いいね済み」は変わらないので、投票者本人の接続にだけ likedByMe を付ける
    this.broadcast((viewer) => ({
      type: "like.changed",
      seq: this.seq,
      commentId,
      likes,
      ...(viewer === voter ? { likedByMe: liked } : {}),
    }));
  }

  /** 投稿を受け付けられるか。受け付けないときは、投稿者に返すメッセージ */
  private checkPost(
    author: string,
    talkId: string,
    clientId: string,
    now: number,
  ): ServerMessage | null {
    const sql = this.ctx.storage.sql;
    const fail = (code: ErrorCode): ServerMessage => ({ type: "error", code, clientId });

    const event = sql
      .exec<{ comments_open: number; deleted_at: number | null }>(
        "SELECT comments_open, deleted_at FROM event",
      )
      .toArray()[0];
    if (!event || event.deleted_at !== null) return fail("not_found");
    if (event.comments_open !== 1) return fail("comments_closed");

    // 再送された投稿はすでに登録済み。受け付けたことだけを伝える
    const existing = sql
      .exec<{ id: string }>(
        "SELECT id FROM comments WHERE author_id = ? AND client_id = ?",
        author,
        clientId,
      )
      .toArray()[0];
    if (existing) return { type: "comment.accepted", clientId, commentId: existing.id };

    if (sql.exec("SELECT 1 FROM talks WHERE id = ?", talkId).toArray().length === 0) {
      return fail("not_found");
    }

    const recent = sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM comments WHERE author_id = ? AND created_at > ?",
        author,
        now - this.limits.rateLimitWindowSec * 1000,
      )
      .one().count;
    if (recent >= this.limits.rateLimitCount) return fail("rate_limited");
    return null;
  }

  /** 差分を記録して seq を進める。古い差分は保持件数を超えた分だけ消す。トランザクション内で呼ぶ */
  private recordUpdate(type: UpdateType, commentId: string, now: number): void {
    const sql = this.ctx.storage.sql;
    const seq = this.seq + 1;
    sql.exec(
      "INSERT INTO updates (seq, type, comment_id, created_at) VALUES (?, ?, ?, ?)",
      seq,
      type,
      commentId,
      now,
    );
    sql.exec("DELETE FROM updates WHERE seq <= ?", seq - UPDATES_RETAINED);
    this.seq = seq;
  }

  /** 全接続に配信する。閲覧者ごとに内容が変わる（自分の投稿か等）ので、参加者 ID ごとに組み立てる */
  private broadcast(build: (viewer: string) => ServerMessage): void {
    const cache = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      const viewer = this.ctx.getTags(ws)[0];
      if (!viewer) continue;
      let json = cache.get(viewer);
      if (json === undefined) {
        json = JSON.stringify(build(viewer));
        cache.set(viewer, json);
      }
      try {
        ws.send(json);
      } catch {
        // 閉じかけの接続。再接続時に seq で補完される
      }
    }
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // 閉じかけの接続
  }
}

/** 検証に通らなかったメッセージからも、clientId が読めればエラーに添える */
function clientIdOf(data: unknown): { clientId?: string } {
  if (typeof data !== "object" || data === null || !("clientId" in data)) return {};
  const { clientId } = data;
  return typeof clientId === "string" && clientId.length <= 64 ? { clientId } : {};
}
