// Turnstile の検証。組み込みは MVP ステップ 4 で行う。
// TURNSTILE_SECRET_KEY が未設定の間は検証を省略する（ローカル開発・テスト用）。

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  env: object,
  token: string | undefined,
  remoteIp: string | undefined,
): Promise<boolean> {
  const secret = (env as Record<string, unknown>).TURNSTILE_SECRET_KEY;
  if (typeof secret !== "string" || secret === "") return true;
  if (!token) return false;

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);
  const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
  if (!res.ok) return false;
  const result = await res.json<{ success: boolean }>();
  return result.success === true;
}
