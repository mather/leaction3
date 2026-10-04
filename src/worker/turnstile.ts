// Turnstile の検証。入室時（参加者セッションの発行）とイベント作成時に 1 回ずつ使う。
// TURNSTILE_SECRET_KEY が未設定の間は検証を省略する（ローカル開発・テスト用）。

import type { TurnstileAction } from "../shared/api";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5000;

export async function verifyTurnstile(
  env: object,
  token: string | undefined,
  remoteIp: string | undefined,
  action: TurnstileAction,
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
    const result = await res.json<{
      success: boolean;
      action?: string;
      metadata?: { result_with_testing_key?: boolean };
    }>();
    if (result.success !== true) return false;
    // テスト用の秘密鍵（プレビュー環境）の応答には action が入らないので照合しない
    if (result.metadata?.result_with_testing_key === true) return true;
    // 別の用途で取ったトークンの使い回しを防ぐ
    return result.action === action;
  } catch {
    // 通信失敗・タイムアウト・不正な応答は検証失敗として扱う
    return false;
  }
}
