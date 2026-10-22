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
  E["Analytics Engine<br/>閲覧・操作の計測"]
  I["Images<br/>OGP画像の描画"]
  B -- "HTTP / WS" --> W
  W -- "転送" --> R
  W -- "描画" --> I
  B -- "トークン取得" --> T
  W -- "読み書き" --> D
  W -- "計測" --> E
```

| 要素 | 役割 |
| --- | --- |
| Worker（静的アセット付き） | SPA の配信、`/e/:id` への OGP 差し込み（HTMLRewriter）、API、Cookie の発行と検証、Turnstile の検証 |
| EventRoom（Durable Object、SQLite） | イベントの全データ。WebSocket の受付と配信（Hibernation API）、連投上限、削除後の掃除アラーム |
| Images（バインディング） | イベントごとの OGP 画像の描画。下の「OGP 画像」を参照 |
| D1 | イベントの索引。OGP 生成や ID の存在確認で、EventRoom を起こさずに済む読み取りを担う |
| Turnstile | イベントページを開いたときと作成時に 1 回だけ |
| Analytics Engine | アクセス解析（閲覧・操作・流入元）。詳細は [analytics.md](analytics.md) |

開発環境は Wrangler と Vite（Cloudflare Vite プラグイン）で、DO・D1 も含めてローカルで動かす。デプロイは GitHub Actions から行い、PR ごとにプレビューを出す現行の運用を引き継ぐ。main への push で本番にデプロイし、PR はプレビュー環境（`wrangler.jsonc` の `env.preview`。Worker `leaction-preview` と D1 `leaction-preview` で本番とデータを分ける）に上書きでデプロイする。プレビュー環境は全 PR で 1 つで、Turnstile はテスト用キーを使う。手順は README の「デプロイ」を参照。

### ドメイン

本番は独自ドメイン `leaction.net` だけで配信する（Workers の Custom Domain。`wrangler.jsonc` の `routes`）。`leaction.<サブドメイン>.workers.dev` は `workers_dev: false` で止める。Cookie（参加者 ID・管理セッション）はドメインごとに分かれ、共有 URL も開いているページのオリジンから作るので、同じイベントを 2 つのドメインで開かせないため。

- プレビュー環境は workers.dev だけで配信する。`routes` と `workers_dev` は `env.preview` に継承されるので、`env.preview` では `"routes": []` と `"workers_dev": true` で打ち消す

## データモデル

イベントの中身はすべてその EventRoom 内の SQLite に置き、D1 には全体の索引だけを置く。削除時はその DO をまるごと消せばコメントも残らない。

### D1（グローバル）

| テーブル | 主な列 | 用途 |
| --- | --- | --- |
| `events` | `id`（nanoid 8 文字）, `name`, `date`, `created_at`, `deleted_at` | OGP 生成、ID の存在確認、削除済みの掃除 |
| `event_creations` | `event_id`, `created_at`, `anon_id`, `first_src` など作成者の初回接触 | アクセス解析（観客から作成者への転換）。イベントを削除しても残す。[analytics.md](analytics.md) を参照 |

イベント一覧や検索の画面は持たないので、イベントの索引は `events` の 1 表で足りる。将来の集計や掃除のために残す。

イベント名・開催日を変更したときは、EventRoom が D1 の `events` も更新する（OGP を最新に保つため）。

### EventRoom 内の SQLite（1 イベント = 1 インスタンス）

| テーブル | 主な列 | 備考 |
| --- | --- | --- |
| `event` | `name`, `date`, `url`, `hashtag`, `comments_open`, `live_talk_id`, `archive_after`, `deleted_at` | 1 行のみ。`archive_after` はアーカイブを解除したときだけ入れる |
| `talks` | `id`, `position`, `speaker`, `title` | `position` で並べ替え |
| `comments` | `id`, `talk_id`, `author_id`, `body`, `kind`, `hidden`, `created_at` | `kind` は将来の質問区別用、当面は `comment` 固定 |
| `likes` | `comment_id`, `voter_id`, `created_at` | 主キーを `(comment_id, voter_id)` にして二重いいねを防ぐ |
| `reactions` | `talk_id`, `voter_id`, `kind`, `created_at`, `updated_at` | 発表への感想。主キーを `(talk_id, voter_id)` にして 1 人 1 票にし、付け替えは `kind` の更新で行う。`kind` は `useful` / `fun` / `try` / `more` |
| `admin_keys` | `id`, `role`（owner / manager）, `label`, `token_hash`, `created_at`, `revoked_at` | owner は 1 件、manager は複数。`label` は共同管理者 URL の名前（渡す相手や用途）で、owner は空文字 |
| `hidden_authors` | `author_id`, `created_at` | 一括非表示した投稿者。以降の投稿も非表示にする |
| `author_keys` | `author_id`, `key`, `created_at` | 管理画面で投稿者を表すキー（乱数）。参加者 ID は管理者にも見せない |

- 非表示は削除ではなくフラグにし、管理画面から「表示に戻す」ができるようにする
- 発表枠を削除したときは、その発表のコメント・いいね・感想も同じトランザクションで消す
- イベント削除は `deleted_at` を入れる論理削除とし、7 日後に DO のアラームで全データを消す。D1 の `events` も削除時に `deleted_at` を入れ、掃除のときに行ごと消す
- 復元の日数は `LIMIT_DELETED_RETENTION_DAYS` で変えられる

### アーカイブ

アーカイブ済みかどうかは保存せず、読み書きのたびに計算する。DO アラームも使わない（アラームは削除後の掃除専用のまま）。

- `archiveAt = max(既定のアーカイブ日時, archive_after)`。既定のアーカイブ日時は「`date` と `created_at` の日付（JST）の遅いほうの翌日 0:00 JST ＋ `LIMIT_ARCHIVE_AFTER_DAYS` 日」
- 今が `archiveAt` 以降ならアーカイブ済み
- 解除は `archive_after = 今 ＋ LIMIT_ARCHIVE_AFTER_DAYS 日` を入れる。`max` を取るので、解除で `archiveAt` が早まることはない
- 計算は `src/shared/` に置き、EventRoom（書き込みの拒否）とクライアント（表示）で同じ関数を使う
- 既存のイベントにも移行作業なしで効く

## HTTP API

参加者の操作（投稿・いいね・感想・削除）は WebSocket で送り、管理操作は HTTP で送る。どちらも最終的に EventRoom が処理し、結果を全接続に配信する。

| メソッド・パス | 権限 | 内容 |
| --- | --- | --- |
| `GET /`、`GET /new`、`GET /terms`、`GET /privacy` | 誰でも | SPA の HTML。サービス共通の OGP |
| `GET /e/:id` | 誰でも | SPA の HTML。イベント名入りの OGP を差し込む |
| `GET /e/:id/og.png` | 誰でも | イベントの OGP 画像（1200×630 の PNG）。見つからなければ 404 |
| `GET /api/session` | 誰でも | 有効な参加者 Cookie があるかを返す（ないときは 401）。あれば同じ ID で出し直して有効期限を延ばす |
| `POST /api/session` | 誰でも | Turnstile トークンを検証し、参加者 ID の Cookie を発行。有効な Cookie があれば検証せずそのまま使う |
| `POST /api/rooms` | 誰でも（Turnstile 必須） | イベント作成。返り値に作成者トークンを一度だけ含める |
| `GET /api/rooms/:id` | 誰でも | イベント情報と発表枠 |
| `GET /api/rooms/:id/ws` | 参加者 Cookie | WebSocket への切り替え |
| `POST /api/rooms/:id/admin/session` | 作成者・共同管理者トークン | トークンを管理セッション Cookie に入れ替える。削除済みのイベントは作成者トークンだけ通す（復元のため） |
| `GET /api/rooms/:id/admin` | 管理 | 権限・イベント情報・発表枠・発表ごとのコメント数・削除の状態（管理画面の表示と、メニューに「イベントを管理する」を出すかの判定）。削除済みなら作成者にだけ返す |
| `PATCH /api/rooms/:id` | 管理 | イベント情報の更新（変更した項目だけ）。コメント受付の一時停止（`commentsOpen`）もここで切り替える |
| `POST` / `PATCH` / `DELETE /api/rooms/:id/talks[/:talkId]` | 管理 | 発表枠の追加・編集・削除。最後の 1 枠は削除できない（409） |
| `PUT /api/rooms/:id/talks/order` | 管理 | 並び順（今あるすべての ID の配列。過不足があれば 409） |
| `GET /api/rooms/:id/admin/comments` | 管理 | コメント一覧（非表示も含む、新しい順）。投稿者は `author_keys` のキーで表す |
| `POST /api/rooms/:id/comments/:cid/hide`（と `unhide`） | 管理 | コメントの非表示・再表示 |
| `POST /api/rooms/:id/authors/:aid/hide`（と `unhide`） | 管理 | 投稿者単位の一括非表示と、その解除（`:aid` は投稿者のキー）。解除するとその投稿者の非表示のコメントをすべて表示に戻す |
| `GET /api/rooms/:id/admin-keys` | 作成者 | 共同管理者 URL の一覧（名前・発行日・無効化日時。トークンは含めない） |
| `POST` / `DELETE /api/rooms/:id/admin-keys[/:keyId]` | 作成者 | 共同管理者 URL の発行・無効化。発行時は名前（`label`、必須・50 文字まで）を受け取り、トークンはこのときだけ返す。有効な URL は上限（初期値 20）まで |
| `DELETE /api/rooms/:id`（と `POST .../restore`） | 作成者 | 論理削除と復元。復元は期限（7 日）内だけで、過ぎていれば 404 |
| `POST /api/rooms/:id/unarchive` | 作成者 | アーカイブの解除。アーカイブ済みでなければ 409 |
| `POST /api/footprints` | 誰でも（同じオリジン） | アクセス解析の計測をまとめて送る。常に 204。[analytics.md](analytics.md) を参照 |

`GET /api/rooms/:id` と `GET /api/rooms/:id/admin` は `archiveAt`（ミリ秒）を返す。アーカイブ済みのイベントに対するイベント情報・発表枠の編集と、コメント受付の切り替えは 409 を返す。

API のパスは、広告・トラッカーブロッカーのフィルタリストに当たらないものにする。以前は `/api/events/…` だったが、EasyPrivacy の `||workers.dev/api/event`（workers.dev 上でパスが `/api/event` で始まるリクエストをすべて遮断する）に当たり、ブロッカーを組み込んだブラウザ（Dia）ではイベントの作成・閲覧・WebSocket がすべて失敗した（#27）。`/api/event…`、`/track`、`/collect`、`/beacon`、`/analytics`、`/metrics` などで始まる・終わるパスは使わない。パスを変えるときは EasyPrivacy で `||workers.dev/` と、変えたパスを検索して確かめる。

作成者だけの操作を共同管理者の管理セッションで呼ぶと 403 を返す。

### OGP 画像

- 画像の背景は `scripts/ogp-images.ts`（`pnpm ogp:images`）で作り、`public/` の PNG をコミットする。デザインはアクセント色の地に白抜きのロゴ。イベント用はカードの位置を `src/worker/og-layout.ts` で文字の配置と揃える
- トップページなどは共通の画像（`public/ogp.png`）を使う。`index.html` の `og:image` は相対パスで書き、Worker がリクエストのオリジンで絶対 URL にする（X や Facebook は相対パスを読まない）。そのため `/`・`/new`・`/terms`・`/privacy` も Worker を通す（`run_worker_first`）
- イベントページの `og:image` は `/e/:id/og.png?v=<版>`。版はイベント名と開催日の SHA-256 の先頭 12 桁で、名前や開催日を変えると URL が変わる（X などは画像を URL ごとにキャッシュするため）
- 画像は Images バインディングで描く。背景（`public/ogp-event.png`）に白いカードとロゴを焼き込んであり、イベント名と開催日の文字だけを重ねる。D1 の索引だけを見て、EventRoom は起こさない
- Images の文字描画は指定できるのがフォント（URL）・大きさ・色だけで、折り返し・中央揃え・省略をしない。そのため行分けは Worker で行い（文字幅は文字の種類ごとに広めに見積もる）、1 行ずつ描く。位置を `top` だけ指定すると横方向は中央に置かれる。名前は長いほど小さくし、3 行を超えたら末尾を「…」にする
- フォントは Google Fonts の Zen Kaku Gothic New Bold（TrueType）を URL で渡す
- 無料プランの変換は月 5,000 件まで（同じ画像は月に 1 回だけ数える）。超えると描画が失敗するので、失敗したら共通の画像へリダイレクトする
- `?v=` が今の版と合えば長期キャッシュ（`immutable`、Cache API にも置く）、合わなければ 5 分だけキャッシュする
- ローカル（`pnpm dev`・Vitest）の Images はオフライン版で文字を描けず、共通の画像へのリダイレクトになる。描画を確かめるときは `wrangler dev --remote` かプレビュー環境を使う

## WebSocket メッセージ

| 向き | 種別 | 内容 |
| --- | --- | --- |
| サーバー→ | `snapshot` | 接続直後に送る。イベント・発表枠・表示中の全コメント・いいね数・自分がいいねしたコメント・発表ごとの感想の票数と自分の票 |
| サーバー→ | `comment.added` / `comment.removed` / `like.changed` / `reaction.changed` | 差分。各メッセージに連番 `seq` を付ける |
| サーバー→ | `comment.accepted` | 再送された投稿が登録済みだったとき、送った本人にだけ返す（`seq` なし） |
| サーバー→ | `error` | `rate_limited` / `comments_closed` / `archived` / `invalid_message` / `not_found`。投稿への応答なら `clientId`、いいね・削除への応答なら `commentId`、感想への応答なら `talkId` を付ける |
| サーバー→ | `event.updated` / `talks.updated` | 管理操作の反映 |
| クライアント→ | `comment.post` | `talkId`, `body`, クライアント生成の `clientId`（二重送信防止・自分の投稿の照合） |
| クライアント→ | `comment.delete` / `like.set` | 自分のコメントの削除、いいねの付け外し |
| クライアント→ | `reaction.set` | `talkId` と `kind`（取り消しは `null`）。発表への感想の投票・付け替え・取り消し |

- 全発表分をまとめて配信し、発表の絞り込みはクライアントで行う。発表を切り替えても通信が起きず、一覧シートの件数表示もそのまま出せる
- 再接続時は接続 URL の `?since=` に最後に受け取った `seq` を付け、それ以降の差分だけを受け取る。EventRoom は差分を直近 1000 件だけ `updates` 表に残し、それより古い・不正な値なら `snapshot` を送る。送り直すときは本文を今の `comments` から組み立て、その間に非表示・削除されたものは送らない
- 自分の投稿には `clientId` を付けて返す（`snapshot` 内も）。クライアントは受け付けの知らせがない投稿を再接続後に送り直し、EventRoom は `(author_id, client_id)` の一意制約で二重登録を防ぐ
- WebSocket Hibernation API を使い、発言がない間は DO を休止させて実行時間の課金を止める
- 死活確認はクライアントが `ping` を送り、`setWebSocketAutoResponse` で DO を起こさずに `pong` を返す
- 非表示にしたコメントは参加者には `comment.removed` として配信し、本文を送らない。表示に戻したコメントは `comment.added` として配信し、クライアントは投稿時刻の位置に差し込む
- 投稿者ごと非表示にした人の投稿は非表示のまま登録し、誰にも配信しない。本人には `comment.accepted` だけを返す（送り直しを止めるため）
- モデレーション操作は HTTP の応答で最新のコメント一覧を返す。管理画面のコメント一覧は WebSocket では更新せず、開いたときと「最新にする」で読み込む
- `like.changed` の `likedByMe` は、いいねを付け外した本人の接続にだけ付ける（他の人の状態は変わらないため）。状態が変わらない `like.set`（いいね済みへのいいね等）は何も配信しない
- `reaction.changed` は `talkId` と 4 種類それぞれの票数を送る。自分の票（`mine`）は、投票した本人の接続にだけ付ける。状態が変わらない `reaction.set`（同じ感想への投票、票がないときの取り消し）は何も配信しない。存在しない発表への投票は `not_found` で拒否する
- 感想はいいねと同じく連投上限の対象にしない。受付停止（`comments_open`）の影響も受けない
- 自分のコメントへのいいねは `invalid_message`、他人のコメントの削除は `not_found` で拒否する。自分のコメントの削除は非表示と違い、コメントといいねを実際に消す
- 送り直す差分は 1 件につき必ず 1 通にして `seq` を飛ばさない。その後に非表示・削除されたコメントの差分は `comment.removed` として送る
- `event.updated` / `talks.updated` も `seq` を付けて `updates` 表に残し、送り直すときは送る時点のイベント情報・発表枠を入れる
- 発表枠を削除したときは `talks.updated` だけを送り、クライアントは消えた発表のコメントを取り除く
- アーカイブ済みのイベントにも今と同じく WebSocket で接続する（自分のコメントの削除と、管理者の非表示を反映するため）。`comment.post`・`like.set`・`reaction.set` は `archived` で拒否する。`snapshot` と `event.updated` には `archiveAt` を入れ、アーカイブを解除したときは `event.updated` を配信する。接続中に `archiveAt` を過ぎたときは、クライアントが自分で表示を切り替える
- イベントを削除したときは、全接続をコード `4404` で閉じる。クライアントは再接続せず「このイベントは削除されました」を出す

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
- 参加者 Cookie の有効期限は 1 年。イベントページを開くたびに同じ ID で出し直して延ばすので、イベントの最中には切れない
- Turnstile は用途ごとに action（`join`・`create_event`）を付け、Worker で一致を確かめる
- 管理操作の HTTP は `Origin` ヘッダーを検証して CSRF を防ぐ
- 管理セッション Cookie（`adm`）はイベント ID と管理キー ID を署名したもので、`Path=/api/rooms/{id}` に絞る。有効期限は 30 日で、管理画面を開くたびに延ばす。キーが無効化されていないかは EventRoom が操作のたびに確かめる
- WebSocket 接続時も `Origin` を検証する
- トークンの照合は定数時間比較で行う
- CSP を設定し、外部スクリプトは Turnstile など必要なものに限る

## 料金の目安（無料プラン）

Durable Objects は無料プランでも SQLite バックエンドなら使える。上限は 1 日あたりリクエスト 10 万、SQLite の書き込み 10 万行、読み取り 500 万行、ストレージ 5GB。受信した WebSocket メッセージは 20 件で 1 リクエストと数える。50 人・300 コメント程度の LT 会なら十分に収まる見込み。

参考: [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing)（2026-09 時点）
