import * as v from "valibot";

// 上限値はここに集める。Worker では resolveLimits(env) で環境変数による上書きを反映する。

export const DEFAULT_LIMITS = {
  /** コメント本文の最大文字数 */
  commentMaxLength: 500,
  /** 連投上限: rateLimitWindowSec 秒あたり rateLimitCount 件まで */
  rateLimitCount: 20,
  rateLimitWindowSec: 10,
  eventNameMaxLength: 100,
  talkTitleMaxLength: 100,
  speakerMaxLength: 50,
  talksMaxCount: 50,
  eventUrlMaxLength: 500,
  hashtagMaxLength: 50,
  /** 同時に有効にできる共同管理者 URL の数 */
  managerKeysMaxCount: 20,
  /** 削除したイベントを復元できる日数。過ぎたら全データを消す */
  deletedRetentionDays: 7,
} as const satisfies Record<string, number>;

export type Limits = { -readonly [K in keyof typeof DEFAULT_LIMITS]: number };

/** 上書きに使う環境変数名（wrangler の vars や .dev.vars で設定する） */
export const LIMIT_ENV_KEYS = {
  commentMaxLength: "LIMIT_COMMENT_MAX_LENGTH",
  rateLimitCount: "LIMIT_RATE_COUNT",
  rateLimitWindowSec: "LIMIT_RATE_WINDOW_SEC",
  eventNameMaxLength: "LIMIT_EVENT_NAME_MAX_LENGTH",
  talkTitleMaxLength: "LIMIT_TALK_TITLE_MAX_LENGTH",
  speakerMaxLength: "LIMIT_SPEAKER_MAX_LENGTH",
  talksMaxCount: "LIMIT_TALKS_MAX_COUNT",
  eventUrlMaxLength: "LIMIT_EVENT_URL_MAX_LENGTH",
  hashtagMaxLength: "LIMIT_HASHTAG_MAX_LENGTH",
  managerKeysMaxCount: "LIMIT_MANAGER_KEYS_MAX_COUNT",
  deletedRetentionDays: "LIMIT_DELETED_RETENTION_DAYS",
} as const satisfies Record<keyof Limits, string>;

const positiveIntFromString = v.pipe(
  v.string(),
  v.trim(),
  v.regex(/^\d+$/),
  v.transform(Number),
  v.integer(),
  v.minValue(1),
);

/** 環境変数で上書きした上限値を返す。不正な値は無視して既定値を使う。 */
export function resolveLimits(env: object): Limits {
  const vars = env as Record<string, unknown>;
  const limits: Limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(LIMIT_ENV_KEYS) as (keyof Limits)[]) {
    const parsed = v.safeParse(positiveIntFromString, vars[LIMIT_ENV_KEYS[key]]);
    if (parsed.success) limits[key] = parsed.output;
  }
  return limits;
}

/** イベント ID（nanoid 8 文字） */
export const EventIdSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{8}$/));

/** 開催日 YYYY-MM-DD（実在する日付に限る） */
const DateSchema = v.pipe(
  v.string(),
  v.regex(/^\d{4}-\d{2}-\d{2}$/),
  v.check((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }),
);

/** 空文字は null として扱う項目（null で消せる） */
function nullableText<T extends v.GenericSchema<string, string>>(schema: T) {
  return v.pipe(
    v.nullable(v.string()),
    v.transform((s) => (s == null ? null : s.trim() || null)),
    v.nullable(schema),
  );
}

/** 空文字は null として扱う任意項目（省略時は null） */
function optionalText<T extends v.GenericSchema<string, string>>(schema: T) {
  return v.optional(nullableText(schema), null);
}

/** イベント情報と発表枠の各項目。作成と管理画面での更新で共有する */
function eventFields(limits: Limits) {
  return {
    name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(limits.eventNameMaxLength)),
    date: DateSchema,
    url: v.pipe(
      v.string(),
      v.maxLength(limits.eventUrlMaxLength),
      v.url(),
      v.regex(/^https?:\/\//i),
    ),
    hashtag: v.pipe(
      v.string(),
      v.transform((s) => s.replace(/^[#＃]/, "")),
      v.minLength(1),
      v.maxLength(limits.hashtagMaxLength),
      v.regex(/^[^\s#＃]+$/u),
    ),
    speaker: v.pipe(v.string(), v.trim(), v.maxLength(limits.speakerMaxLength)),
    title: v.pipe(v.string(), v.trim(), v.maxLength(limits.talkTitleMaxLength)),
  };
}

/** 発表者とタイトルのどちらかは空でない */
export function isValidTalk(t: { speaker: string; title: string }): boolean {
  return t.speaker !== "" || t.title !== "";
}

/** 発表枠 1 件（作成時と、管理画面での追加） */
export function talkInputSchema(limits: Limits) {
  const f = eventFields(limits);
  return v.pipe(
    v.object({ speaker: f.speaker, title: f.title }),
    v.check(isValidTalk, "発表者かタイトルのどちらかが必要です"),
  );
}

/** イベント作成の入力。上限値は環境変数で変わるので limits から組み立てる。 */
export function createEventInputSchema(limits: Limits) {
  const f = eventFields(limits);
  return v.object({
    name: f.name,
    date: f.date,
    url: optionalText(f.url),
    hashtag: optionalText(f.hashtag),
    talks: v.pipe(
      v.array(talkInputSchema(limits)),
      v.minLength(1),
      v.maxLength(limits.talksMaxCount),
    ),
    turnstileToken: v.optional(v.string()),
  });
}

export type CreateEventInput = v.InferInput<ReturnType<typeof createEventInputSchema>>;
export type CreateEventData = v.InferOutput<ReturnType<typeof createEventInputSchema>>;

/** 参加者セッションの発行（POST /api/session） */
export const createSessionInputSchema = v.object({
  turnstileToken: v.optional(v.string()),
});

export type CreateSessionInput = v.InferInput<typeof createSessionInputSchema>;

/** 管理用トークン（generateToken の 32 バイト乱数を base64url にしたもの） */
export const AdminTokenSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/));

/** 管理セッションの発行（POST /api/events/:id/admin/session）。token は管理 URL の `#k=` の値 */
export const createAdminSessionInputSchema = v.object({ token: AdminTokenSchema });

export type CreateAdminSessionInput = v.InferInput<typeof createAdminSessionInputSchema>;

/** 1 項目以上あること（変更した項目だけを送る API で、空の更新を受け付けない） */
function nonEmptyPatch<T extends object>(o: T): boolean {
  return Object.values(o).some((value) => value !== undefined);
}

/**
 * イベント情報の更新（PATCH /api/events/:id）。変更した項目だけを送る。URL・ハッシュタグは null か空文字で消す。
 * コメント受付の一時停止もここで切り替える
 */
export function updateEventInputSchema(limits: Limits) {
  const f = eventFields(limits);
  return v.pipe(
    v.strictObject({
      name: v.optional(f.name),
      date: v.optional(f.date),
      url: v.optional(nullableText(f.url)),
      hashtag: v.optional(nullableText(f.hashtag)),
      /** コメントの受付。false で一時停止する */
      commentsOpen: v.optional(v.boolean()),
    }),
    v.check(nonEmptyPatch),
  );
}

export type UpdateEventInput = v.InferInput<ReturnType<typeof updateEventInputSchema>>;
export type UpdateEventData = v.InferOutput<ReturnType<typeof updateEventInputSchema>>;

export type TalkInput = v.InferInput<ReturnType<typeof talkInputSchema>>;
export type TalkData = v.InferOutput<ReturnType<typeof talkInputSchema>>;

/**
 * 発表枠の編集（PATCH /api/events/:id/talks/:talkId）。変更した項目だけを送る。
 * 発表者・タイトルの両方が空にならないかは、今の値と合わせて EventRoom で確かめる
 */
export function updateTalkInputSchema(limits: Limits) {
  const f = eventFields(limits);
  return v.pipe(
    v.strictObject({ speaker: v.optional(f.speaker), title: v.optional(f.title) }),
    v.check(nonEmptyPatch),
  );
}

export type UpdateTalkInput = v.InferInput<ReturnType<typeof updateTalkInputSchema>>;
export type UpdateTalkData = v.InferOutput<ReturnType<typeof updateTalkInputSchema>>;

/** 発表枠の並び順（PUT /api/events/:id/talks/order）。今あるすべての発表枠の ID を新しい順に並べる */
export function reorderTalksInputSchema(limits: Limits) {
  return v.object({
    ids: v.pipe(
      v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
      v.minLength(1),
      v.maxLength(limits.talksMaxCount),
    ),
  });
}

export type ReorderTalksInput = v.InferInput<ReturnType<typeof reorderTalksInputSchema>>;

/** コメント本文の文字数。サロゲートペア（絵文字など）も 1 文字と数え、クライアントの表示と揃える */
export function commentLength(body: string): number {
  return [...body].length;
}

/** クライアントが生成する ID（clientId）。crypto.randomUUID() を想定し、形式だけを確かめる */
export const ClientIdSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/));

/** WebSocket の 1 メッセージの最大長。本文の上限よりは十分大きく、巨大な入力は解析前に捨てる */
export function maxClientMessageLength(limits: Limits): number {
  return limits.commentMaxLength * 4 + 1024;
}

/**
 * WebSocket でクライアントから受け取るメッセージ。protocol.ts の ClientMessage と対応する。
 * 本文の前後の空白は落とし、空になったものは受け付けない。
 */
export function clientMessageSchema(limits: Limits) {
  const id = v.pipe(v.string(), v.minLength(1), v.maxLength(64));
  return v.variant("type", [
    v.object({
      type: v.literal("comment.post"),
      talkId: id,
      body: v.pipe(
        v.string(),
        v.trim(),
        v.minLength(1),
        v.check((s) => commentLength(s) <= limits.commentMaxLength),
      ),
      clientId: ClientIdSchema,
    }),
    v.object({ type: v.literal("comment.delete"), commentId: id }),
    v.object({ type: v.literal("like.set"), commentId: id, liked: v.boolean() }),
  ]);
}
