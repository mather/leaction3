// 秘密トークンの発行とハッシュ化、Cookie の署名。トークンは平文で保存せず、SHA-256 のハッシュだけを持つ。

import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";

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
  await setParticipantCookie(c, secret, id);
  return id;
}

/**
 * 同じ参加者 ID で Cookie を出し直し、有効期限をいまから延ばす。
 * イベントページを開くたびに呼ぶので、イベントの最中に期限が切れることはない。
 */
export async function renewParticipantId(c: Context, secret: string, id: string): Promise<void> {
  await setParticipantCookie(c, secret, id);
}

function setParticipantCookie(c: Context, secret: string, id: string): Promise<void> {
  return setSignedCookie(c, PARTICIPANT_COOKIE, id, secret, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: PARTICIPANT_COOKIE_MAX_AGE_SEC,
  });
}

/** 文字列を定数時間で比べる（トークンのハッシュの照合に使う）。長さが違えば false */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

// 管理セッションの Cookie。管理 URL の `#k=` のトークンと引き換えに発行する。
// 値はイベント ID と管理キー（admin_keys）の ID。キーが無効化されていないかは EventRoom が毎回確かめる。
// Path をそのイベントの API に絞り、別のイベントへのリクエストには載せない。

const ADMIN_COOKIE = "adm";
/** 管理セッションの有効期限。管理画面を開くたびに延ばす */
const ADMIN_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

function adminCookiePath(eventId: string): string {
  return `/api/rooms/${eventId}`;
}

/** 署名を検証して、そのイベントの管理キー ID を取り出す。Cookie がない・署名が不正・別のイベントなら null */
export async function getAdminKeyId(
  c: Context,
  secret: string,
  eventId: string,
): Promise<string | null> {
  const value = await getSignedCookie(c, secret, ADMIN_COOKIE);
  if (typeof value !== "string") return null;
  const [cookieEventId, keyId] = value.split(":");
  return cookieEventId === eventId && keyId ? keyId : null;
}

export function setAdminCookie(
  c: Context,
  secret: string,
  eventId: string,
  keyId: string,
): Promise<void> {
  return setSignedCookie(c, ADMIN_COOKIE, `${eventId}:${keyId}`, secret, {
    path: adminCookiePath(eventId),
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: ADMIN_COOKIE_MAX_AGE_SEC,
  });
}

export function clearAdminCookie(c: Context, eventId: string): void {
  deleteCookie(c, ADMIN_COOKIE, { path: adminCookiePath(eventId), secure: true });
}
