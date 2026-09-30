# LeacTion!

LT や勉強会の発表に、リアルタイムで質問やコメントを送れる Web サービスです。

- 参加者はログイン不要。URL を開いてすぐコメントできます
- コメントは発表ごとに分かれ、いいねで反応できます
- 主催者もアカウント不要。イベント作成時に発行される管理用 URL で管理します

[tegehoge/leaction](https://github.com/tegehoge/leaction) を Cloudflare Workers / Durable Objects 上に作り直したものです。

## 開発

```sh
pnpm install
pnpm db:migrate   # ローカル D1 にテーブルを作る
pnpm dev
```

仕様は [`docs/`](docs/) を参照してください。

- [要件](docs/requirements.md)
- [アーキテクチャ](docs/architecture.md)
- [画面設計](docs/ui.md)

## ライセンス

MIT
