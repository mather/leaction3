# アーキテクチャ

1 つの Worker が画面と API を配信し、イベントへの書き込みはそのイベント専用の Durable Object「EventRoom」に集める。書き込みが 1 か所で順番に処理されるので、いいねや編集の競合が仕組み上起きない。

## 構成

```mermaid
flowchart LR
  B["ブラウザ<br/>SolidJS SPA<br/>Cookieで識別"]
  W["Worker<br/>静的ファイル・OGP差し込み<br/>API・Cookie発行<br/>Turnstileの検証"]
  R["EventRoom（DO）<br/>1イベント＝1インスタンス<br/>SQLite：コメント・いいね<br/>WS配信・待機中は休止"]
  T["Turnstile<br/>入室時・作成時に1回"]
  D["D1<br/>イベントの索引（events）"]
  A["R2（後日）<br/>終了イベントのアーカイブ"]
  B -- "HTTP / WS" --> W
  W -- "転送" --> R
  B -- "トークン取得" --> T
  W -- "読み書き" --> D
  R -. "書き出し" .-> A
```

| 要素 | 役割 |
| --- | --- |
| Worker（静的アセット付き） | SPA の配信、`/e/:id` への OGP 差し込み（HTMLRewriter）、API、Cookie の発行と検証、Turnstile の検証 |
| EventRoom（Durable Object、SQLite） | イベントの全データ。WebSocket の受付と配信（Hibernation API）、連投上限、削除後の掃除アラーム |
| D1 | イベントの索引。OGP 生成や ID の存在確認で、EventRoom を起こさずに済む読み取りを担う |
| Turnstile | イベントページを開いたときと作成時に 1 回だけ |
| R2（後日） | 終了イベントの JSON アーカイブ |

開発環境は Wrangler と Vite（Cloudflare Vite プラグイン）で、DO・D1 も含めてローカルで動かす。デプロイは GitHub Actions から行い、PR ごとにプレビューを出す現行の運用を引き継ぐ。

## データモデル

イベントの中身はすべてその EventRoom 内の SQLite に置き、D1 には全体の索引だけを置く。削除時はその DO をまるごと消せばコメントも残らない。

### D1（グローバル）

| テーブル | 主な列 | 用途 |
| --- | --- | --- |
| `events` | `id`（nanoid 8 文字）, `name`, `date`, `created_at`, `deleted_at` | OGP 生成、ID の存在確認、削除済みの掃除 |

イベント一覧や検索の画面は持たないので、D1 はこの 1 表で足りる。将来の集計や掃除のために残す。

イベント名・開催日を変更したときは、EventRoom が D1 の `events` も更新する（OGP を最新に保つため）。

### EventRoom 内の SQLite（1 イベント = 1 インスタンス）

| テーブル | 主な列 | 備考 |
| --- | --- | --- |
| `event` | `name`, `date`, `url`, `hashtag`, `comments_open`, `live_talk_id`, `deleted_at` | 1 行のみ |
| `talks` | `id`, `position`, `speaker`, `title` | `position` で並べ替え |
| `comments` | `id`, `talk_id`, `author_id`, `body`, `kind`, `hidden`, `created_at` | `kind` は将来の質問区別用、当面は `comment` 固定 |
| `likes` | `comment_id`, `voter_id`, `created_at` | 主キーを `(comment_id, voter_id)` にして二重いいねを防ぐ |
| `admin_keys` | `id`, `role`（owner / manager）, `token_hash`, `created_at`, `revoked_at` | owner は 1 件、manager は複数 |
| `hidden_authors` | `author_id`, `created_at` | 一括非表示した投稿者。以降の投稿も非表示にする |

- 非表示は削除ではなくフラグにし、管理画面から「表示に戻す」ができるようにする
- 発表枠を削除したときは、その発表のコメントといいねも同じトランザクションで消す
- イベント削除は `deleted_at` を入れる論理削除とし、7 日後に DO のアラームで全データを消す

## HTTP API

参加者の操作（投稿・いいね・削除）は WebSocket で送り、管理操作は HTTP で送る。どちらも最終的に EventRoom が処理し、結果を全接続に配信する。

| メソッド・パス | 権限 | 内容 |
| --- | --- | --- |
| `GET /`、`GET /new` | 誰でも | SPA の HTML。サービス共通の OGP |
| `GET /e/:id` | 誰でも | SPA の HTML。イベント名入りの OGP を差し込む |
| `GET /api/session` | 誰でも | 有効な参加者 Cookie があるかを返す（ないときは 401） |
| `POST /api/session` | 誰でも | Turnstile トークンを検証し、参加者 ID の Cookie を発行。有効な Cookie があれば検証せずそのまま使う |
| `POST /api/events` | 誰でも（Turnstile 必須） | イベント作成。返り値に作成者トークンを一度だけ含める |
| `GET /api/events/:id` | 誰でも | イベント情報と発表枠 |
| `GET /api/events/:id/ws` | 参加者 Cookie | WebSocket への切り替え |
| `POST /api/events/:id/admin/session` | 作成者・共同管理者トークン | トークンを管理セッション Cookie に入れ替える |
| `PATCH /api/events/:id` | 管理 | イベント情報の更新（変更した項目だけ） |
| `POST` / `PATCH` / `DELETE /api/events/:id/talks[/:talkId]` | 管理 | 発表枠の追加・編集・削除 |
| `PUT /api/events/:id/talks/order` | 管理 | 並び順（ID の配列） |
| `POST /api/events/:id/comments/:cid/hide`（と `unhide`） | 管理 | コメントの非表示・再表示 |
| `POST /api/events/:id/authors/:aid/hide` | 管理 | 投稿者単位の一括非表示 |
| `POST` / `DELETE /api/events/:id/admin-keys[/:keyId]` | 作成者 | 共同管理者 URL の発行・無効化 |
| `DELETE /api/events/:id`（と `POST .../restore`） | 作成者 | 論理削除と復元 |

## WebSocket メッセージ

| 向き | 種別 | 内容 |
| --- | --- | --- |
| サーバー→ | `snapshot` | 接続直後に送る。イベント・発表枠・表示中の全コメント・いいね数・自分がいいねしたコメント |
| サーバー→ | `comment.added` / `comment.removed` / `like.changed` | 差分。各メッセージに連番 `seq` を付ける |
| サーバー→ | `event.updated` / `talks.updated` | 管理操作の反映 |
| クライアント→ | `comment.post` | `talkId`, `body`, クライアント生成の `clientId`（二重送信防止・自分の投稿の照合） |
| クライアント→ | `comment.delete` / `like.set` | 自分のコメントの削除、いいねの付け外し |

- 全発表分をまとめて配信し、発表の絞り込みはクライアントで行う。発表を切り替えても通信が起きず、一覧シートの件数表示もそのまま出せる
- 再接続時は最後に受け取った `seq` を送り、それ以降の差分だけを受け取る（足りなければ `snapshot`）
- WebSocket Hibernation API を使い、発言がない間は DO を休止させて実行時間の課金を止める
- 非表示にしたコメントは参加者には `comment.removed` として配信し、本文を送らない

## スパム対策・セキュリティ

機械的な攻撃は入室時の Turnstile で止め、人による荒らしは管理者の操作で止める。普通の参加者はどの対策にも気づかないことを条件にする。

| 対策 | 防ぐもの | 設定値（初期値） |
| --- | --- | --- |
| Turnstile（イベントページを開いたときに 1 回、Invisible またはマネージド） | スクリプトによる ID の大量生成・書き込み | — |
| Turnstile（イベント作成時） | イベントの大量作成 | — |
| 緩い連投上限（EventRoom 内、参加者 ID ごと） | 取得した Cookie でのスクリプト暴走 | 10 秒に 20 件 |
| 文字数上限 | 巨大な投稿 | 500 文字 |
| 管理者の非表示・投稿者単位の一括非表示 | 手による荒らし | — |
| コメント受付の一時停止 | 荒らしが続くときの緊急停止 | — |

上限値は環境変数で変えられるようにし、運用しながら調整する。上限に当たったときは、投稿を捨てず「少し待ってから送信してください」と返す。

### その他のセキュリティ

- コメントはプレーンテキストとして扱い、HTML として解釈しない。URL はリンク化するが、開く前に確認を出す
- Cookie は `HttpOnly; Secure; SameSite=Lax`。値は `COOKIE_SECRET` で HMAC-SHA256 署名する。参加者 ID はクライアントに返さない
- Turnstile は用途ごとに action（`join`・`create_event`）を付け、Worker で一致を確かめる
- 管理操作の HTTP は `Origin` ヘッダーを検証して CSRF を防ぐ
- WebSocket 接続時も `Origin` を検証する
- トークンの照合は定数時間比較で行う
- CSP を設定し、外部スクリプトは Turnstile など必要なものに限る

## 料金の目安（無料プラン）

Durable Objects は無料プランでも SQLite バックエンドなら使える。上限は 1 日あたりリクエスト 10 万、SQLite の書き込み 10 万行、読み取り 500 万行、ストレージ 5GB。受信した WebSocket メッセージは 20 件で 1 リクエストと数える。50 人・300 コメント程度の LT 会なら十分に収まる見込み。

参考: [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing)（2026-09 時点）
