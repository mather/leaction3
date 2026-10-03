// 秘密トークンの発行とハッシュ化、Cookie の署名。トークンは平文で保存せず、SHA-256 のハッシュだけを持つ。

import type { Context } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";

/** nanoid 互換の ID（64 文字の英数字・記号から size 文字）。 */
export function randomId(size = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  // 64 = 2^6 なので下位 6 ビットを使えば偏りが出ない
  for (const b of bytes) id += ID_ALPHABET[b & 63];
  return id;
}

/** 32 バイト乱数の base64url 文字列（43 文字）。 */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}

/** トークンの SHA-256（16 進文字列）。DB にはこれだけを保存する。 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 参加者 ID の Cookie。値は HMAC-SHA256 で署名し、改ざんされたものは無視する。
// 投稿者・投票者は常にここから決め、クライアントから受け取った ID は使わない。

const PARTICIPANT_COOKIE = "pid";
/** 参加者 ID の長さ（randomId の文字数。64^16 = 96 ビット） */
const PARTICIPANT_ID_SIZE = 16;
/** 同じ端末なら後日のイベントでも自分の投稿を消せるよう長めに持たせる（ブラウザ上限は 400 日） */
const PARTICIPANT_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

/** Cookie 署名の秘密鍵。未設定なら null（呼び出し側で 500 にする） */
export function cookieSecret(env: object): string | null {
  const secret = (env as Record<string, unknown>).COOKIE_SECRET;
  return typeof secret === "string" && secret !== "" ? secret : null;
}

/** 署名を検証して参加者 ID を取り出す。Cookie がない・署名が不正なら null。 */
export async function getParticipantId(c: Context, secret: string): Promise<string | null> {
  const id = await getSignedCookie(c, secret, PARTICIPANT_COOKIE);
  return typeof id === "string" && id.length === PARTICIPANT_ID_SIZE ? id : null;
}

/** 新しい参加者 ID を発行し、署名付き Cookie に入れる。 */
export async function issueParticipantId(c: Context, secret: string): Promise<string> {
  const id = randomId(PARTICIPANT_ID_SIZE);
  await setSignedCookie(c, PARTICIPANT_COOKIE, id, secret, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: PARTICIPANT_COOKIE_MAX_AGE_SEC,
  });
  return id;
}
