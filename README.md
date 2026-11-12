# tsuranari

参加者の都合を集めて、全員が集まれる日時を探す日程調整アプリ。集計を参加者ごとに絞り込める。

仕様と運用手順は [docs/README.md](docs/README.md) にある。

```sh
bun install
bunx wrangler d1 migrations apply tsuranari --local
bun run dev
```

| コマンド         | 内容                                                |
| ---------------- | --------------------------------------------------- |
| `bun run dev`    | Vite の開発サーバー (Worker と D1 もローカルで動く) |
| `bun run check`  | Biome と型検査                                      |
| `bun run test`   | workerd 上でのテスト                                |
| `bun run deploy` | ビルドして Cloudflare にデプロイ                    |
