import type { TurnstileAction } from "../../shared/api";

// Turnstile のウィジェット。普段は見えず（interaction-only）、確認が必要なときだけ画面下に出る。
// サイトキー（VITE_TURNSTILE_SITE_KEY）が未設定ならトークンなしで送り、Worker 側も秘密鍵が未設定なら検証を省略する。

const SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Turnstile = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      appearance: "interaction-only";
      callback: (token: string) => void;
      "error-callback": () => void;
      "timeout-callback": () => void;
    },
  ): string | undefined;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | undefined;

function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject());
    script.onerror = () => reject(new Error("Turnstile を読み込めませんでした"));
    document.head.append(script);
  }).catch((err: unknown) => {
    // 次の呼び出しで読み込み直せるようにする
    loading = undefined;
    throw err;
  });
  return loading;
}

export async function getTurnstileToken(action: TurnstileAction): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  const turnstile = await loadTurnstile();

  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed",
    left: "50%",
    bottom: "calc(16px + env(safe-area-inset-bottom))",
    transform: "translateX(-50%)",
    zIndex: "100",
  });
  document.body.append(container);
  let widgetId: string | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const fail = () => reject(new Error("Turnstile の確認に失敗しました"));
      widgetId = turnstile.render(container, {
        sitekey: SITE_KEY,
        action,
        appearance: "interaction-only",
        callback: resolve,
        "error-callback": fail,
        "timeout-callback": fail,
      });
    });
  } finally {
    if (widgetId) turnstile.remove(widgetId);
    container.remove();
  }
}
