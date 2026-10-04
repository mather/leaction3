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

/** 空文字は null として扱う任意項目 */
function optionalText<T extends v.GenericSchema<string, string>>(schema: T) {
  return v.pipe(
    v.optional(v.nullable(v.string()), null),
    v.transform((s) => (s == null ? null : s.trim() || null)),
    v.nullable(schema),
  );
}

/** イベント作成の入力。上限値は環境変数で変わるので limits から組み立てる。 */
export function createEventInputSchema(limits: Limits) {
  const talk = v.pipe(
    v.object({
      speaker: v.pipe(v.string(), v.trim(), v.maxLength(limits.speakerMaxLength)),
      title: v.pipe(v.string(), v.trim(), v.maxLength(limits.talkTitleMaxLength)),
    }),
    v.check((t) => t.speaker !== "" || t.title !== "", "発表者かタイトルのどちらかが必要です"),
  );
  return v.object({
    name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(limits.eventNameMaxLength)),
    date: DateSchema,
    url: optionalText(
      v.pipe(v.string(), v.maxLength(limits.eventUrlMaxLength), v.url(), v.regex(/^https?:\/\//i)),
    ),
    hashtag: optionalText(
      v.pipe(
        v.string(),
        v.transform((s) => s.replace(/^[#＃]/, "")),
        v.minLength(1),
        v.maxLength(limits.hashtagMaxLength),
        v.regex(/^[^\s#＃]+$/u),
      ),
    ),
    talks: v.pipe(v.array(talk), v.minLength(1), v.maxLength(limits.talksMaxCount)),
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
