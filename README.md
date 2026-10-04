# LeacTion!

LT や勉強会の発表に、リアルタイムで質問やコメントを送れる Web サービスです。

- 参加者はログイン不要。URL を開いてすぐコメントできます
- コメントは発表ごとに分かれ、いいねで反応できます
- 主催者もアカウント不要。イベント作成時に発行される管理用 URL で管理します

[tegehoge/leaction](https://github.com/tegehoge/leaction) を Cloudflare Workers / Durable Objects 上に作り直したものです。

## 開発

```sh
pnpm install
cp .dev.vars.example .dev.vars   # COOKIE_SECRET を設定する
pnpm db:migrate   # ローカル D1 にテーブルを作る
pnpm dev
```

Turnstile をローカルで試すときは、`.dev.vars` の `TURNSTILE_SECRET_KEY` と `.env.local`（`.env.example` を参照）の `VITE_TURNSTILE_SITE_KEY` を設定します。どちらも未設定なら Turnstile は省略されます。

## デプロイ

GitHub Actions（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）で行います。PR と main への push で `pnpm lint` / `pnpm typecheck` / `pnpm test` を実行し、通ったときだけデプロイします。

| きっかけ | デプロイ先 | 内容 |
| --- | --- | --- |
| main への push | 本番（Worker `leaction`、D1 `leaction`） | `pnpm db:migrate:remote` のあと `vite build` して `wrangler deploy`。本番デプロイは直列で、途中では取り消さない |
| PR の作成・push | プレビュー（Worker `leaction-preview`、D1 `leaction-preview`） | `pnpm db:migrate:preview` のあと `CLOUDFLARE_ENV=preview vite build` して `wrangler deploy`。URL を PR にコメントする（push ごとに同じコメントを更新） |

- プレビュー環境は全 PR で 1 つです。最後にデプロイされた PR の内容になります。データ（D1・Durable Objects）は本番と分かれています
- プレビューの Turnstile はテスト用キー（常に成功）を使います
- フォークからの PR では、プレビューはデプロイしません（シークレットを渡さないため）。チェックだけ実行します
- 同じ PR に新しい push が来たら、古い実行は取り消されます

### 初回の設定

1. Cloudflare で D1 を作り、`wrangler.jsonc` の `database_id`（本番とプレビューの 2 か所）を出力された ID に置き換える

   ```sh
   pnpm wrangler d1 create leaction
   pnpm wrangler d1 create leaction-preview
   ```

2. Worker のシークレットを設定する。CI からは送らないので、Cloudflare 側に 1 回設定しておく。プレビューのシークレットは本番と別の値にする

   ```sh
   # 本番
   openssl rand -base64 32 | pnpm wrangler secret put COOKIE_SECRET
   pnpm wrangler secret put TURNSTILE_SECRET_KEY   # Turnstile の秘密鍵

   # プレビュー（TURNSTILE_SECRET_KEY はテスト用の 1x0000000000000000000000000000000AA）
   openssl rand -base64 32 | pnpm wrangler secret put COOKIE_SECRET --env preview
   echo 1x0000000000000000000000000000000AA | pnpm wrangler secret put TURNSTILE_SECRET_KEY --env preview
   ```

   Worker がまだないときは `wrangler secret put` が Worker を作るか聞いてくるので、作ってかまいません。

3. Cloudflare の API トークンを作る（「Edit Cloudflare Workers」テンプレートに、アカウントの「D1: Edit」権限を足す）

4. GitHub の Settings → Environments に `production` と `preview` を作り、それぞれに次を設定する

   | 名前 | 種類 | 設定する Environment | 内容 |
   | --- | --- | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | Secret | `production`、`preview` | 3 で作った API トークン |
   | `CLOUDFLARE_ACCOUNT_ID` | Secret | `production`、`preview` | Cloudflare のアカウント ID |
   | `VITE_TURNSTILE_SITE_KEY` | Variable | `production` | Turnstile のサイトキー（ビルド時に埋め込む公開値）。プレビューはワークフローにテスト用キーを書いてある |

   `production` に「Deployment branches: main のみ」を設定しておくと、main 以外から本番の Secret を読めなくなります。

### 手元からデプロイする

```sh
pnpm deploy              # 本番
pnpm deploy:preview      # プレビュー
```

マイグレーションは `pnpm db:migrate:remote`（本番）、`pnpm db:migrate:preview`（プレビュー）で適用します。

## 仕様

仕様は [`docs/`](docs/) を参照してください。

- [要件](docs/requirements.md)
- [アーキテクチャ](docs/architecture.md)
- [画面設計](docs/ui.md)

## ライセンス

MIT
