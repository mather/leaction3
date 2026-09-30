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
