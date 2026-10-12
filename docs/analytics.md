# アクセス解析

本格運用に向けて、次の 2 つを把握する（#35）。

- 初回アクセスがどこから来たか（検索・SNS・会場やスライドの QR など）
- 観客（参加者）として使った人が、イベントの作成者になったか

ログインがないので、人の単位はブラウザごとの匿名 ID で数える。コメント本文など、イベントの中身は計測に含めない。

## 構成

| 手段 | 使い道 | 導入 |
| --- | --- | --- |
| 自前の計測（Workers Analytics Engine + D1） | 行動・流入別の集計、観客から作成者への転換 | このリポジトリで実装 |
| Cloudflare Web Analytics | PV・リファラ・Core Web Vitals（運用と速度の監視） | 独自ドメインに移ったら、ゾーンの設定で有効化する（スクリプトの差し込みが要らない） |
| Google Search Console | 検索クエリ | 独自ドメインに移ったら DNS で所有権を確認する（タグ不要） |

GA4 は使わない。ログインなしの設計と相性が悪く、LT の参加者層は広告ブロッカーの利用率が高くて欠損しやすいうえ、外部送信規律への対応も要る。自前の計測は自分のサーバー（同じオリジンの Worker）にだけ送る。

## 流入の識別

### `?src=`

アプリが作る共有用の URL には `?src=` を付け、どの経路で配った URL かを分かるようにする。値は決まったものだけを受け付け、それ以外は `other` にする。

| `src` | 付ける場所 |
| --- | --- |
| `qr` | 共有シートの QR コード |
| `link` | 共有シートの URL（コピー） |
| `x` | 「X でポスト」 |
| `share` | 「他のアプリで共有」（Web Share API） |
| `host` | 作成完了画面の参加者用 URL（主催者が告知ページやスライドに載せる） |

- `utm_*` は使わない。広告ブロッカーのパラメータ削除リスト（AdGuard の URL Tracking Protection、uBlock Origin の privacy-removeparam）で消されるため。`src` は汎用の削除対象になっていないことを確かめてある（2026-10 時点）
- 開いた直後に `history.replaceState` で `?src=` をアドレスバーから消す。その URL をさらにコピーして配られたとき、別の経路の `src` が混ざらないようにするため

### `?src=` がないとき

`document.referrer` のホストで分ける。

| 判定 | `src` |
| --- | --- |
| リファラなし | `direct` |
| Google・Bing・Yahoo!・DuckDuckGo などの検索エンジン | `search` |
| x.com・t.co・twitter.com | `x` |
| 同じオリジン | `internal`（アプリ内の移動や、別タブで開いたトップページ） |
| それ以外 | `referral`（ホスト名を `ref` に残す。connpass、Slack など） |

### 入口（entry）

最初に開いた画面を `event`（`/e/:id`）・`top`（`/`）・`new`（`/new`）・`manage`（`/e/:id/manage`）・`other` で記録する。「イベントページに直行した人」と「トップページを経由した人」を分けるため。

## 匿名 ID と初回接触

初回アクセスのときに、ブラウザの localStorage（キー `leaction:visitor`）に次を保存する。参加者 Cookie（`pid`）とは別物にする。`pid` はコメントの投稿者 ID でもあるので、計測データと結びつけるとコメントと行動が紐づいてしまうため。

| 項目 | 内容 |
| --- | --- |
| `anon` | 匿名 ID（`crypto.randomUUID()`） |
| `src` / `entry` / `ref` | 初回接触の流入元・入口・リファラのホスト |
| `eventId` | 初回にイベントページから入ったなら、そのイベントの ID（バイラル係数の計算用） |
| `at` | 初回接触の時刻 |
| `joinedAt` | 観客として、他人のイベントページを初めて開いた時刻。まだなら無し |
| `created` | このブラウザで作ったイベントの ID（直近 20 件）。自分のイベントを開いても「観客としての参加」に数えないため |

### 許容する誤差

- localStorage を消した・プライベートブラウズ・別の端末では、別の人として数える。転換率は「ブラウザ単位」の値として読む
- localStorage が使えないときは、そのページを開いている間だけの ID で送る（初回接触は毎回 `at` が今になる）
- 1 人が複数のブラウザを使っても名寄せはしない。ログインのない設計で名寄せをしようとすると、指紋採取に近づくため

## データの置き場所

### Analytics Engine（高頻度の行動）

閲覧・コメント・いいね・クリックなど。各データポイントに初回接触の情報を付け、JOIN なしで流入別に集計できるようにする。データセットは本番 `leaction_analytics`、プレビュー環境 `leaction_analytics_preview`（バインディング名 `ANALYTICS`）。保持期間は 3 か月。

| 列 | 内容 |
| --- | --- |
| `index1` | 匿名 ID（サンプリングの単位。同じ人の行動はまとめて残る／落ちる） |
| `blob1` | 行動の種類（下の表） |
| `blob2` | 画面（`top` / `event` / `new` / `created` / `manage`） |
| `blob3` | イベント ID（イベントに関係しない画面では空） |
| `blob4` | 今回の訪問の流入元（ページを読み込んだときの `?src=` かリファラから） |
| `blob5` | 初回接触の流入元 |
| `blob6` | 初回接触の入口 |
| `blob7` | 初回接触のリファラのホスト |
| `blob8` | 初回接触のイベント ID |
| `blob9` | 対象（クリックした導線、共有の手段など。下の表） |
| `blob10` | 国（`request.cf.country`） |
| `double1` | 初回接触からの経過秒数 |
| `double2` | 観客として参加したことがあるか（1 / 0） |
| `double3` | このブラウザで作ったイベント数 |

| `blob1` | いつ | `blob9` |
| --- | --- | --- |
| `view` | 画面を開いたとき | — |
| `comment` | コメントを送ったとき | — |
| `like` | いいねを付けたとき（外したときは送らない） | — |
| `click` | 導線を押したとき | `top_create_hero` / `top_create_bottom`（トップの「イベントを作る」）、`event_menu_top`（イベントページのメニューからトップへ） |
| `share` | 共有の操作をしたとき | `qr`（共有シートを開いて QR を表示）/ `link`（コピー）/ `x` / `share`（Web Share API で共有できた） |
| `create` | イベントを作成できたとき（Worker が記録する） | — |

`blob1` が `create` 以外のデータポイントは、ブラウザから送ったものを Worker が検証して書き込む。

### D1（恒久保存する転換データ）

イベント作成は件数が少なく重要なので、作成者の初回接触の情報を D1 の `event_creations` に残す。Analytics Engine は JOIN ができず保持期間も 3 か月なので、転換の集計はこちらで行う。

| 列 | 内容 |
| --- | --- |
| `event_id` | 作成したイベント |
| `created_at` | 作成日時 |
| `anon_id` | 作成者の匿名 ID（計測情報がなければ NULL。以下も同じ） |
| `first_src` / `first_entry` / `first_ref` / `first_event_id` / `first_seen_at` | 作成者の初回接触 |
| `joined_at` | 作成者が観客として初めてイベントページを開いた時刻。観客の経験がなければ NULL |
| `prior_events` | このブラウザで以前に作ったイベント数 |

`events` に列を足さず別の表にするのは、`events` の行はイベントの削除から 7 日後に消えるため。`event_creations` はコメントなどの中身を含まないので、イベントを削除しても残す。

## 送信

- エンドポイントは `POST /api/footprints`。本文は `{ visitor, items: [...] }` で、1 回に 20 件まで。`/collect`・`/track`・`/beacon`・`/analytics`・`/metrics`・`/event` などはフィルタリストに当たるので使わない（「HTTP API」の注意を参照）。EasyPrivacy・EasyList に当たらないことを確かめてある（2026-10 時点）
- `navigator.sendBeacon` は使わず、`fetch(..., { keepalive: true })` で送る。ブロッカーは sendBeacon を `ping` という種類のリクエストとして扱い、`$ping` で一括遮断するルールがあるため
- ブラウザでためておき、10 件たまったとき・5 秒たったとき・ページが隠れたとき（`visibilitychange`・`pagehide`）にまとめて送る。コメントやいいねのたびにリクエストを増やさない
- 失敗しても再送しない。計測のために画面の操作を待たせたり、エラーを出したりしない
- Worker は `Origin` を確かめ、本文を Valibot で検証してから Analytics Engine に書く。不正なものは 204 を返して捨てる
- イベント作成（`POST /api/rooms`）は本文に `visitor` を任意で含め、Worker が作成に成功したあと `event_creations` と Analytics Engine に書く。計測の書き込みが失敗しても作成は成功として返す

## 追う指標と SQL

Analytics Engine は [SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/) で集計する（API トークンに「Account Analytics: Read」が要る）。サンプリングされるので、件数は `_sample_interval` を掛けて数える。

```sh
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data "SELECT ... FORMAT JSON"
```

D1 は `wrangler d1 execute leaction --remote --command "SELECT ..."` で集計する。

### 流入別の観客数（直近 30 日、Analytics Engine）

```sql
SELECT blob5 AS first_src, COUNT(DISTINCT index1) AS audiences
FROM leaction_analytics
WHERE blob1 = 'view' AND blob2 = 'event' AND double3 = 0
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY first_src ORDER BY audiences DESC
```

### 流入別の作成者数と、観客から作成者への転換（D1）

```sql
SELECT first_src,
       COUNT(*) AS creators,
       SUM(joined_at IS NOT NULL) AS from_audience
FROM event_creations
WHERE prior_events = 0 AND created_at > (strftime('%s', 'now') - 30 * 86400) * 1000
GROUP BY first_src ORDER BY creators DESC
```

転換率は `from_audience` を、上の流入別の観客数で割る。

### 観客としての初回参加から作成までの日数（D1）

```sql
SELECT (created_at - joined_at) / 86400000 AS days, COUNT(*) AS creators
FROM event_creations
WHERE joined_at IS NOT NULL AND prior_events = 0
GROUP BY days ORDER BY days
```

### 1 つのイベントが新たに生んだ観客・作成者（バイラル係数）

初回接触がそのイベントだった人を数える。観客は Analytics Engine、作成者は D1 から。

```sql
-- Analytics Engine
SELECT blob8 AS first_event, COUNT(DISTINCT index1) AS new_audiences
FROM leaction_analytics
WHERE blob6 = 'event' AND blob8 != '' AND timestamp > NOW() - INTERVAL '90' DAY
GROUP BY first_event ORDER BY new_audiences DESC LIMIT 50
```

```sql
-- D1
SELECT first_event_id, COUNT(*) AS new_creators
FROM event_creations
WHERE first_entry = 'event' AND prior_events = 0
GROUP BY first_event_id ORDER BY new_creators DESC LIMIT 50
```

### 「イベントを作る」導線のクリック率（Analytics Engine）

```sql
SELECT blob9 AS target, SUM(_sample_interval) AS clicks
FROM leaction_analytics
WHERE blob1 = 'click' AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY target
```

分母はイベントページ・トップページの `view` の人数（`COUNT(DISTINCT index1)`）。

集計を見る画面は作らず、当面はこれらのクエリを直接実行する。指標が固まったら簡易ダッシュボードを検討する。

## イベントページからの導線

#35 では「イベントページのフッターに『自分のイベントを作る』リンクを置く」案だったが、設計ルール 11（外へ出る導線は 1 タップで発火させない）に反するので置かない。既存のメニューの「LeacTion! について・イベントを作る」を導線とし、そのクリックを `event_menu_top` として数える。トップページでの「イベントを作る」のクリックと、`/new` の `view`、`create` を順に追えば、観客から作成までの流れが分かる。

## プライバシー

- コメント本文、発表者名、イベント名は計測データに含めない（イベント ID と行動の種類だけ）
- 参加者 ID（`pid`）と匿名 ID は結びつけない
- IP アドレスは保存しない（国だけを残す）
- 自分の Worker にだけ送り、第三者のサービスには送らない。外部送信規律（電気通信事業法）の対象になるかは、プライバシーポリシーを書くときに確かめる
- プライバシーポリシーに、匿名 ID で閲覧・操作を記録することと、その保存先（ブラウザの localStorage）を明記する
