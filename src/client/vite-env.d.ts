interface ImportMetaEnv {
  /** Turnstile のサイトキー。未設定なら Turnstile を使わない（ローカル開発用） */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
