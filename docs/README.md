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

| 項目                   | 内容                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| イベント名             | 必須、100 文字以内                                                                               |
| 作成者名               | 必須、50 文字以内                                                                                |
| 候補開始日、候補終了日 | 終了日は開始日以降。期間は両端を含めて 100 日以内                                                |
| 時間単位               | 1 日、半日 (午前 / 午後)、1 時間 (0-24、8-18、8-21)、30 分 (8-18)、授業 (1-6 限、1-6 限と放課後) |
| 休日の扱い             | 土日を除外する / 含める                                                                          |
| 回答方式               | × 都合がつかない枠をチェックする / ○ 都合がつく枠をチェックする                                  |
| 参加者へのメモ         | 任意、1000 文字以内                                                                              |

授業の時限は筑波大学の時間割に合わせている。作成すると `/e/<id>` に移動する。この URL を知っている人は誰でも回答、編集、削除ができる。ログインはない。

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

`https://tsuranari.nukanoto.net/mcp` で Streamable HTTP の MCP サーバーを公開している。認証はない。Web 画面と同じく、イベント ID を知っていれば誰でも読み書きできる。状態を持たない実装で、リクエストごとにサーバーを作る。

登録例:

```sh
claude mcp add --transport http tsuranari https://tsuranari.nukanoto.net/mcp
```

claude.ai では Settings の Connectors に同じ URL を追加する。

| ツール            | 内容                                                        |
| ----------------- | ----------------------------------------------------------- |
| `create_event`    | イベント作成。回答方式は省略すると ×、土日は省略すると除外  |
| `get_event`       | イベント、全回答、ベスト候補。`with` で集計する参加者を絞る |
| `update_event`    | 指定した項目だけ変更する                                    |
| `add_response`    | 回答追加                                                    |
| `update_response` | 回答変更。指定しなかった項目は残す                          |
| `delete_response` | 回答削除                                                    |

リクエスト数を減らすため、どのツールも変更後のイベント全体を返す。返り値には REST の内容に加えて次が入る。

- `url`: 人に共有する URL
- `marksMean`: そのイベントで `marks` が「参加できない枠」と「参加できる枠」のどちらを表すか
- `selected`: 集計に含めた参加者の名前
- `best`: 選んだ参加者のうち参加できる人が多い枠の上位 10 件。人数が同じなら日時の早い順。誰も参加できない枠は含めない

イベントは ID でも URL でも指定できる。回答は ID でも名前でも指定できる。

回答の枠は `available` (参加できる枠) か `unavailable` (参加できない枠) のどちらか一方で渡す。サーバーがイベントの回答方式に合わせて `marks` に変換するので、LLM は × と ○ の違いを気にしなくてよい。どちらも省略した `add_response` は、全枠に参加できる回答になる。

イベントの変更には次の制約がある。

- 回答が 1 件でもあると、時間単位と回答方式は変更できない。既存の印の意味が変わるため。
- 期間を変えると、範囲外になった印は消える。

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
