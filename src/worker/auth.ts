// 秘密トークンの発行とハッシュ化。トークンは平文で保存せず、SHA-256 のハッシュだけを持つ。

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
