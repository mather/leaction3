// Turnstile の検証。組み込みは MVP ステップ 4 で行う。
// TURNSTILE_SECRET_KEY が未設定の間は検証を省略する（ローカル開発・テスト用）。

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5000;

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
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const result = await res.json<{ success: boolean }>();
    return result.success === true;
  } catch {
    // 通信失敗・タイムアウト・不正な応答は検証失敗として扱う
    return false;
  }
}
