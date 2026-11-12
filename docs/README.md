# tsuranari 仕様

## 構成

Cloudflare Workers 1 本で動き、https://tsuranari.nukanoto.net で公開する。ドメインは `wrangler.jsonc` の `routes` で Workers の Custom Domain として割り当てる。DNS レコードと証明書は Cloudflare が自動で作る。

- `src/events.ts`: イベントと回答の検証と D1 への読み書き。REST と MCP の両方がここを呼ぶ。
- `src/index.ts`: 画面用の REST API (Hono) と、`/mcp` の振り分け。
- `src/mcp.ts`: LLM 向けの MCP サーバー。
- `src/client/`: 画面 (Solid)。Workers Static Assets で配信し、`/api/*` と `/mcp` 以外のパスは `index.html` を返す。
- `src/shared.ts`: Worker と画面が共有する定義 (時間単位、型、集計)。
- スキーマは `migrations/` にある。

## イベント作成 (`/`)

| 項目                   | 内容                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| イベント名             | 必須、100 文字以内                                                                                               |
| 作成者名               | 必須、50 文字以内                                                                                                |
| 候補開始日、候補終了日 | 終了日は開始日以降。期間は両端を含めて 100 日以内                                                                |
| 時間単位               | 1 日、半日 (午前 / 午後)、1 時間 (0-24、8-18、8-21)、30 分 (8-18)、授業 (1-6 限。昼休みと放課後をそれぞれ足せる) |
| 休日の扱い             | 土日を除外する / 含める                                                                                          |
| 回答方式               | × 都合がつかない枠をチェックする / ○ 都合がつく枠をチェックする                                                  |
| 参加者へのメモ         | 任意、1000 文字以内                                                                                              |

授業の時限は筑波大学の時間割に合わせている。昼休みは 2 限と 3 限の間 (11:25 から 12:15) に入る。作成すると `/e/<id>` に移動する。この URL を知っている人は誰でも回答、編集、削除ができる。ログインはない。

## 回答

名前 (50 文字以内、同じイベント内で重複不可) と任意のコメント (200 文字以内) を付けて、枠にマークを付ける。マウスではドラッグでまとめて塗れる。最初に押した枠の状態で、塗るか消すかが決まる。タッチ操作ではタップで 1 枠ずつ切り替える。日付の見出しを押すと、その日の全枠を切り替える。

参加者一覧の「編集」で既存の回答をフォームに読み込み、上書きできる。「削除」で回答を消す。

## 集計と個人フィルタ

集計表の各セルには、選んでいる参加者のうち参加できる人数を表示する。参加できる割合が高いほど緑が濃くなる。選んだ全員が参加できるセルは枠線で強調する。セルを押すと、参加できる人と参加できない人の名前を表示する。

個人フィルタで、集計に含める参加者を選ぶ。

- 参加者ごとのチェックボックス、「全員選択」「全員解除」、その人だけを選ぶ「この人だけ」
- 「全員が参加できる枠だけ表示」で、それ以外のセルを隠す

選択は URL の hash に入る。

- hash がないときは全員を選ぶ。あとから回答した人も自動で集計に入る。
- 一部だけを選ぶと `#with=<回答 ID>,<回答 ID>` になる。この URL を共有すると、同じ絞り込みで開ける。あとから回答した人は含まれない。
- 全員を選び直すと hash は消える。

## REST API

画面が使う API。LLM からは MCP を使う。

| メソッド | パス                             | 内容                                     |
| -------- | -------------------------------- | ---------------------------------------- |
| POST     | `/api/events`                    | イベント作成。`201 {id}`                 |
| GET      | `/api/events/:id`                | イベント、候補日、枠のラベル、全回答     |
| POST     | `/api/events/:id/responses`      | 回答追加。`201 {id}`、名前の重複は `409` |
| PUT      | `/api/events/:id/responses/:rid` | 回答更新。名前の重複は `409`             |
| DELETE   | `/api/events/:id/responses/:rid` | 回答削除。`204`                          |

枠は `YYYY-MM-DD#<時間帯の番号>` という文字列で表す。回答の `marks` には、チェックした枠をこの形式で入れる。○ 方式ではマークした枠が「参加できる」、× 方式ではマークしていない枠が「参加できる」になる。候補にない枠は `400` で拒否する。

## MCP サーバー

LLM 向けに `/mcp` で MCP サーバーを公開している。仕様は [mcp.md](mcp.md) にある。

## 開発

```sh
bun install
bunx wrangler d1 migrations apply tsuranari --local
bun run dev
```

`bun run test` は `@cloudflare/vitest-plugin` を使い、workerd とローカルの D1 で API を実際に呼ぶ。テストファイルごとにストレージが分かれ、`test/setup.ts` がマイグレーションを当てる。

## デプロイ

main に push すると GitHub Actions (`.github/workflows/ci.yml`) が check と test を実行し、通れば D1 のマイグレーションを本番に当ててデプロイする。リポジトリの secrets に次の 2 つが必要になる。

- `CLOUDFLARE_API_TOKEN`: アカウントの Workers Scripts と D1、ゾーン `nukanoto.net` の Workers Routes と DNS に Edit 権限を持つトークン
- `CLOUDFLARE_ACCOUNT_ID`
- `D1_DATABASE_ID`: D1 データベース `tsuranari` の ID

D1 の ID はリポジトリに置かない。`wrangler.jsonc` には `database_id` を書かず、CI がデプロイの直前に secret から書き込む。ローカルの開発とテストは ID なしで動く。

手元からデプロイするときは、`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を環境変数に入れる。さらに `wrangler.jsonc` の `d1_databases[0]` に `database_id` を一時的に書いてから(コミットしない)、次を実行する。

```sh
bunx wrangler d1 migrations apply tsuranari --remote
bun run deploy
```

スキーマを変えるときは `migrations/` に連番の SQL を追加する。既存のファイルは書き換えない。
