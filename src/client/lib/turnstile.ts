// Turnstile の差し込み口。ウィジェットの組み込みは MVP ステップ 4 で行う。
// それまではトークンなしで送り、Worker 側も秘密鍵が未設定なら検証を省略する。

export async function getTurnstileToken(): Promise<string | undefined> {
  return undefined;
}
