# CLAUDE.md

LeacTion! を Cloudflare 上に再実装するプロジェクト。LT・勉強会の発表に、参加者がログインなしでリアルタイムにコメントといいねを送れる Web サービス。

詳細な仕様は `docs/` にある。実装前に該当するファイルを必ず読むこと。

| ファイル | 内容 |
| --- | --- |
| `docs/requirements.md` | 背景、機能・非機能要件、MVP の範囲、権限モデル |
| `docs/architecture.md` | 構成、データモデル、HTTP API、WebSocket プロトコル、セキュリティ |
| `docs/ui.md` | 画面一覧、操作仕様、デザイントークン |

## 技術スタック

- ランタイム: Cloudflare Workers（静的アセット配信込み）、Durable Objects（SQLite バックエンド）、D1
- フロントエンド: SolidJS + TypeScript（UI ライブラリは使わない。SUID は不採用）
- ビルド: Vite + `@cloudflare/vite-plugin`、デプロイは Wrangler
- パッケージ管理: pnpm
- テスト: Vitest（Worker / DO は `@cloudflare/vitest-pool-workers`、`test/` に置く）
- ルーティング: Hono（Worker の `/api/*`）
- 入力検証: Valibot（スキーマは `src/shared/schema.ts`）
- スタイル: CSS Modules（`*.module.css`）。デザイントークンは `src/client/styles/global.css` の CSS 変数
- Lint / Format: Biome

## ディレクトリ構成（予定）

```
src/
  client/            SolidJS の SPA
    pages/           Top, EventPage, NewEvent, Created, Manage
    components/
    lib/             ws クライアント、API クライアント
  worker/
    index.ts         Worker エントリ（ルーティング、Cookie）
    ogp.ts           /e/:id への OGP 差し込み（HTMLRewriter）
    event-room.ts    Durable Object「EventRoom」
    auth.ts          Cookie 署名、トークンのハッシュ化・照合
    turnstile.ts
  shared/
    api.ts           HTTP API の型（クライアント・サーバー共用）
    protocol.ts      WebSocket メッセージ型（クライアント・サーバー共用）
    schema.ts        入力検証スキーマ、上限値
test/                Vitest（Workers ランタイム上で実行）
migrations/          D1 マイグレーション
wrangler.jsonc
worker-configuration.d.ts   `pnpm cf-typegen` で生成（wrangler.jsonc を変えたら再生成）
```

## コマンド

```sh
pnpm dev                # Vite + Workers ランタイムでローカル起動（DO・D1 もローカル）
pnpm test               # Vitest
pnpm typecheck          # wrangler types --check と tsc -b
pnpm lint               # Biome（修正は pnpm format）
pnpm deploy             # vite build して wrangler deploy
pnpm db:migrate         # ローカル D1 にマイグレーションを適用
pnpm db:migrate:remote  # 本番 D1 に適用
pnpm cf-typegen         # worker-configuration.d.ts を再生成
```

## 守るべき設計ルール

実装が以下に反する場合は、コードではなく先にこのファイルか `docs/` を更新して合意を取ること。

1. **書き込みは必ず EventRoom を通す。** クライアントやWorkerがイベントの中身を直接書き換えない。1 イベント = 1 DO インスタンスで直列化し、競合を仕組みで防ぐ。
2. **投稿者・投票者はサーバーが決める。** `author_id` / `voter_id` は署名付き Cookie から取り出す。クライアントから受け取った ID は使わない。
3. **更新は差分で即時反映。** イベントを丸ごと上書きする API は作らない。発表枠の並べ替えは ID 配列で送る。
4. **秘密トークンは平文で保存しない。** 32 バイト乱数を作り、SHA-256 のハッシュだけを保存する。照合は定数時間比較。
5. **管理 URL のトークンは `#k=` に置く。** 管理画面を開いたら `POST .../admin/session` で HttpOnly Cookie に入れ替え、`history.replaceState` で `#k=` を消す。
6. **権限は作成者 (owner) と共同管理者 (manager) の 2 段階。** 削除・復元・共同管理者 URL の発行と無効化は owner のみ。
7. **コメントはプレーンテキスト。** `innerHTML` を使わない。URL はリンク化するが、開く前に確認を出す。
8. **普通の参加者に制限を感じさせない。** 連投上限は「10 秒に 20 件」程度の緩い値で、設定値として変更可能にする。Turnstile は入室時と作成時の 1 回だけ。
9. **無料プランに収める。** WebSocket は Hibernation API を使う。DO のストレージは SQLite API（`ctx.storage.sql`）を使う。
10. **非表示は削除ではない。** `hidden` フラグで管理し、管理画面から戻せる。
11. **イベントページから不意に離れさせない。** 外へ出る導線はメニューの中に入れ（1 タップで発火させない）、新しいタブで開く。未送信のコメントがあるときだけ離脱を警告する。詳細は `docs/ui.md` の「不意の離脱を防ぐ」。

## 実装の進め方

MVP を次の順で作る。各ステップで動く状態にしてから次へ進む。

1. プロジェクト雛形: Vite + SolidJS + Worker + wrangler 設定、D1 と DO（`new_sqlite_classes`）のバインディング
2. イベント作成: `POST /api/events`、owner トークン発行、D1 と EventRoom の初期化、作成完了画面
3. イベントページ閲覧: `GET /api/events/:id`、`/e/:id` の OGP 差し込み、発表切り替え UI
4. 参加者セッション: Turnstile 検証、参加者 ID Cookie の発行
5. WebSocket: `snapshot`、`comment.post`、差分配信、`seq` による再接続時の取りこぼし補完
6. いいね・自分のコメント削除
7. 管理セッションと管理画面: 発表枠の編集・並べ替え、イベント情報の更新
8. モデレーション: 非表示・再表示、投稿者単位の一括非表示、受付停止
9. 共同管理者 URL の発行・無効化、イベントの論理削除と 7 日後の掃除（DO アラーム）
10. 共有: 端末内 QR 生成、URL コピー、X、Web Share API
11. トップページと、イベントページのメニュー（トップへは新しいタブ）、未送信コメントがあるときの離脱警告

「発表中」の設定、質問とコメントの区別、登壇者向け表示、アーカイブは MVP 後。

## コーディング規約

- TypeScript strict。`any` は使わない
- WebSocket メッセージと API の型は `src/shared/` に置き、クライアントとサーバーで共有する
- 上限値（文字数、連投上限など）は `src/shared/schema.ts` に定数として集め、環境変数で上書きできるようにする
- UI の文言は日本語
- コミットメッセージは日本語でも英語でもよい
