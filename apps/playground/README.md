# LikeX Playground

LikeXの操作・見た目を確認するVite + Reactのデモです。通常のページには対象のコンポーネントを配置し、AIデモにはLikeAIChatを組み合わせています。

| パス | デモ |
| --- | --- |
| `/` | Explorer |
| `/spreadsheet` | Spreadsheet。売上計画・経費・挿入・関数などのサンプルで編集・数式・書式・挿入を確認できます。 |
| `/spreadsheet/ai` | Spreadsheet＋LikeAIChat。自然言語でセル・数式・書式などを編集します。 |
| `/slide` | LikeSlide。スライド・図形・テキスト・アニメーションを編集します。 |
| `/slide/ai` | LikeSlide＋LikeAIChat。自然言語でスライド・要素などを編集します。 |

`/like-slide/ai` と `/slides/ai` も `/slide/ai` と同じデモを開きます。

リポジトリのルートで依存関係をインストールした後、次のコマンドで起動します。

```sh
npm run dev --workspace @likex/playground
```

## Spreadsheet／SlideのAIデモ

AIへの初回送信には、ホストの指示・直近の会話に加えて、形式・タイトル・シート数／スライド数などの概要と選択位置だけを含めます。シート名一覧・セル本文・スライド本文・スキル本文は先に送らず、AIが必要なものをツールで取得します。Spreadsheetのタイトルはコンポーネントと同じホスト設定、Slideのタイトルは現在のデッキから取得します。

SpreadsheetのAIは、全シート一覧、シート名のキーワード検索、1シートの保存セル一覧、セルのキーワード検索、単一セル・範囲の取得を行えます。いずれも共有スキルCLIの `run_script` 読み取り操作です。まず一覧・検索で実際のIDを確認して、必要なシートや範囲を指定します。

| 取得内容 | `run_script` の引数例 |
| --- | --- |
| 文書の概要だけ | `{ "operation": "inspect", "overview": true }` |
| シート一覧 | `{ "operation": "inspect" }` |
| シート名の検索 | `{ "operation": "inspect", "search": "sheets", "text": "売上" }` |
| 1シートの情報だけ | `{ "operation": "inspect", "sheetId": "実際のシートID" }` |
| 1シートの保存セル | `{ "operation": "inspect", "sheetId": "実際のシートID", "includeData": true, "offset": 0, "limit": 100 }` |
| 特定範囲のセル | `{ "operation": "inspect", "sheetId": "実際のシートID", "range": "B2:F6" }` |
| 範囲内のキーワード検索 | `{ "operation": "inspect", "search": "cells", "text": "売上", "sheetId": "実際のシートID", "range": "B2:F6", "limit": 100 }` |

`range` を指定した範囲取得の `selection` は `{ sheetId, range, rows }` です。`rows` は行優先の二次元配列で、単一セルでも `[[{ "value": "商品" }]]`、未格納セルなら `[[null]]` です。各保存セルは `{ value, format?, validation? }`、未格納の位置は `null` になり、矩形の行数・列数を保ちます。範囲取得の旧 `selection.cells` は `selection.rows` へ変更したため、取得結果を読む側も変更してください。旧キーとの二重出力はありません。以下の保存セル一覧の一次元 `cells`、検索の `matches`、公開モデルAPI `getRange` の配列、SPON保存形式は変更していません。

保存セル一覧の `selection` は `{ sheet, cells, offset, limit, total, hasMore }` です。`cells` は `{ address, value, format?, validation? }` の配列で、物理的な行・列順に返します。数式は元の入力文字列のままです。未格納の空欄は含まず、書式・入力規則を持つ空セルは含みます。図形・画像・コメントなどはこのセル配列に含みません。ページの `limit` は既定100、最大1,000です。検索と保存セル一覧は `hasMore` が true なら `offset + limit` で次のページを読みます。`overview: true` は他の取得指定と併用できません。

セル検索で `sheetId` を省略すると全シート、`search: "sheets"` はシート名が対象です。
`matchCase` は大文字小文字、`exact` は全体一致、セル検索の `lookIn` は `values`（書式適用済みの表示値）／`formulas`（数式・入力値）を指定します。
検索結果の `selection` は `{ search, text, matches, offset, limit, total, hasMore }` です。
セル検索の `value` / `matchedText` は既定で先頭200文字のプレビューです。省略時は `valueTruncated` / `matchedTextTruncated` と元の文字数 `valueLength` / `matchedTextLength` を返します。`previewLength`（1〜10,000）で調整できます。
検索はブックを変更せず、入力と結果は編集操作と同じチャット履歴・実行ログに記録されます。

リポジトリのルートに `.env` を作り、OpenAIまたはAzure OpenAIの設定を記入します。[`.env.example`](../../.env.example) に両方の例があります。APIキーはサーバー側だけで読み、`VITE_` 接頭辞は付けません。`.env` はGit管理対象外です。

OpenAIを使う場合:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4.1
```

Azure OpenAIを使う場合（deploymentはAzureで作成したデプロイ名）:

```dotenv
AI_PROVIDER=azure
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your-responses-deployment
```

OpenAI・Azure OpenAIともResponses APIのfunction callingに対応するモデルを指定します。OpenAIは `/v1/responses`、Azureは既定で `/openai/v1/responses` へ接続します。Azureのバージョン指定付きAPIを使う場合だけ `AZURE_OPENAI_API_VERSION` を設定し、Responsesに対応するバージョンを指定してください。この場合は `/openai/responses?api-version=...` へ接続します。

`AI_REASONING_EFFORT` は省略するとモデル既定のままです。指定可能な設定値は `none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max` で、選択したモデルが対応する値を使います。接続処理は `reasoning.effort` に渡し、ツールを呼び出した後もResponsesの推論項目・応答項目を保持して次のリクエストへ引き継ぎます。

設定後に `npm run dev` を起動（起動中なら再起動）し、`/spreadsheet/ai` または `/slide/ai` の右下のキラキラボタンからチャットを開きます。例えば「売上計画シートの見出しを青色にして列幅を調整して」「最初のスライドのタイトルを『来期の事業計画』にして」と依頼できます。APIキーが未設定の場合は画面に不足する設定名を表示します。

ブラウザーは現在の `.spon`／`.slon` 全文をローカルのホストサーバーへ渡します。全文はCLI操作用の一時ステージに置き、LLMの初期コンテキストには入れません。AIは `read_skill` で対象モジュールの `skills/likex-<module>/SKILL.md` と参照資料名を読み、`read_reference` で必要な資料を取得し、`run_script` で同梱の `scripts/document.mjs` を実行します。セルや要素は要求された範囲だけ取得し、そのツール出力をLLMへ渡します。大きな参照資料は `offset` / `limit` でページに分けて取得できます。

`inspect`・`apply`・`validate`・`create` の引数はサーバーが構築し、任意のシェルやスクリプトは実行しません。編集は一時ステージに蓄積し、最後に検証した文書をブラウザーへ返します。ステージは実行終了時に削除します。実行経過と実際に呼ばれたツールはチャット履歴で確認できます。

システムプロンプトとプロバイダー接続はLikeAIChatの外側にあります。既定の指示は [`build/ai/prompts.ts`](./build/ai/prompts.ts) の `defaultAIInstructions` です。ホストのVite設定で `aiPlayground` の `instructions` に文字列、またはモジュールを受け取る関数を渡して変更できます。たとえば既定の操作・検証手順を残したまま業務向けの指示を追加します。

```ts
import { aiPlayground } from "./build/ai-playground.ts";
import { defaultAIInstructions } from "./build/ai/prompts.ts";

// vite.config.ts の plugins 配列へ設定する。
aiPlayground({
  instructions: module => [
    defaultAIInstructions(module),
    "回答は日本語で、変更したシートやスライドと確認結果を簡潔に伝えてください。",
  ].join("\n"),
});
```

この `instructions` はホストサーバーの設定からResponses APIへ渡し、ブラウザーの送信内容からは受け取りません。LikeAIChatは `onSend` と表示・会話状態を担当し、固定のシステムプロンプトやAPI接続を持ちません。

実行ごとにリポジトリ直下の `.likex-ai/runs/<実行ID>.jsonl` へ履歴を保存します。最初の文書概要の確認、AIが要求したスキル・参照資料の読み込み、ツールと実際のJSONコマンド、出力またはエラー、最後の検証、開始・終了時刻と状態を記録します。実行ID・モジュール・モデルも各行に含まれます。`completed` はサーバーで結果を検証できた状態で、画面への反映結果はチャットの通知で確認します。失敗は `error`、停止は `cancelled` です。ログを書き込めない場合は処理を止め、変更を反映しません。

ログはGit管理対象外で、チャットから `GET /api/ai/runs/<実行ID>` を使ってJSONLをダウンロードできます。この取得APIもローカル接続とオリジンを検証し、ファイルの直接配信は拒否します。APIキー・環境変数・認証ヘッダーや開始時の文書全体は記録しませんが、ツールが参照したセル・要素や操作コマンドの値は含まれます。入力コマンドはJSONLに512 KiBまで省略せず保持します。画面に送る入力は64 KiBまでで、それを超える場合はプレビューと省略情報を表示し、全文はJSONLから確認します。大きなツール出力はJSONで保存時128 KiB・画面送信時40 KiBを上限にプレビューへ変換し、元のサイズと省略の情報を付けます。入力全体が544 KiBを超える不正な呼び出しも同様に記録します。自動削除は行わないため、不要になった実行のJSONLファイルは削除できます。

生成中は本体の入力を止め、停止・チャットを閉じる・ページ移動で処理をキャンセルします。成功した結果だけを公開 `importNative` APIで一度に反映し、本体の「元に戻す」で戻せます。送信後に文書が変更されていた場合は上書きしません。Slideの元の値とアニメーション定義もネイティブ形式で保持します。保存先はタブ内メモリのままで、必要なら本体からファイルを書き出してください。

AIへ最初に送る内容はホストの指示、直近の会話（最大20件・JSONで60,000文字以内）、文書概要、選択位置です。必要に応じてAIが取得したスキル・参照資料・セルや要素の情報を追加します。画面には過去の会話も保持します。接続キーは会話やCLIへ渡しません。このAPIはローカル開発・プレビュー用で、ループバック接続と同一オリジンに限定しています。外部公開用の認証・利用量管理は含みません。

`dev`・`preview`・`test` の前処理はSpreadsheet／SlideとcoreのCLIランタイムを順番にビルドします。モデルのソースを変更した場合は、AI処理を停止して `npm run build:ai-runtime --workspace @likex/playground` を実行してからデモを再起動してください。画面はソース、CLIは生成された `/model` を使うため、両者を揃える必要があります。`vite build` の静的ファイルだけではAI APIは動かず、`npm run preview` のViteサーバーが必要です。

`@likex/explorer` は `packages/explorer/src/index.ts` に直接解決します。ライブラリを先にビルドする必要はありません。`src/explorer-demo.tsx` からExplorerの生成済みCSSを読み込みます。このデモ自体にTailwind/PostCSSの設定はありません。開発用Viteプラグインが起動時とExplorerのソース変更時にCSSを再生成します。

`@likex/spreadsheet` も `packages/spreadsheet/src/index.ts` へ直接解決します。`src/spreadsheet-demo.tsx` が独立したCSSと表示用データを読み込み、親のメモリへ保存します。`src/demo/spreadsheet-workbook.ts` は架空のサンプルで、TSV貼り付け、セル参照、別シート参照の動作確認に使えます。ページの再読み込みで初期状態へ戻ります。

`src/main.tsx` はパスに応じて対象デモだけを遅延読み込みします。デモごとにJSとCSSを分け、SpreadsheetページでExplorerを先読みしません。

```sh
npm run build --workspace @likex/playground
npm run preview --workspace @likex/playground
```

ビルド先はこのディレクトリの `dist/` です。同梱した依存パッケージの一覧と通知を `third-party-inventory.json`、`third-party-notices.txt` として生成します。

`src/explorer-demo.tsx` が親側の保存・再取得・ファイル読み込みを担当します。保存先は同じブラウザータブのメモリのみで、ページ全体を再読み込みすると初期状態に戻ります。Explorerの更新ボタンはメモリに保存済みの一覧を再取得します。認証、API、DB、ストレージは実装していません。

`src/demo/seed.ts` は階層付きの初期データ、`src/demo/icon-samples.ts` はすべての既定アイコンを表示するためのファイル生成です。アイコン用ファイルは表示確認用テキストであり、有効なOffice・フォント・圧縮ファイルではありません。

デモは `icons` フォルダの中アイコン表示から開始します。お気に入り・コピー・新しいファイルの作成・チェックボックスは非表示で、追加できる拡張子は `csv, md, txt, json, xlsx, xls, docx, doc, pptx, ppt` です。`txt` は以下の右クリックデモの生成結果も、通常のアップロード検証を通すために許可しています。

初期表示はURLの `initialPath`・`selectedFile`・`selectedFileMode` をコンポーネントの同名propsへ渡して確認できます。例えば `/?selectedFile=erp-spec` は「ERPリニューアル」を開いて「要件定義メモ.md」を選択し、`/?selectedFile=erp-spec&selectedFileMode=preview` はそのプレビューも開きます。`selectedFile` はファイル名ではなくデータのIDです。明示的にフォルダも指定する場合は `/?initialPath=/プロジェクト/ERPリニューアル&selectedFile=erp-spec` とします。「＋」の新規タブは引き続き `defaultPath` の `icons` から開きます。

## 利用側が追加する右クリックメニュー

Explorerではファイルの右クリックに「AIに指示」を追加しています。ダイアログへ指示を入力して実行すると、約1.5秒のモック処理の後、元のファイルと同じフォルダへ `元の名前-AI指示結果.txt` を追加します。同名があれば連番を付けます。処理中の表示、キャンセル、Escape、背景のクリックに対応し、別ウィンドウから実行した場合もそのExplorer内にダイアログを表示します。AIサービスへの送信や元ファイルの本文解析は行いません。生成したファイルは保存するまで下書きです。

Spreadsheetでは集計する範囲を選択してから、結果を入れるセルを右クリックし「選択範囲のSUMを挿入」を選びます。例えば `A1:A3` を選択して `A4` を右クリックすると、`A4` へ `=SUM(A1:A3)` を設定します。離れた範囲にも対応し、重複選択を二重加算しません。結果を入れるセルが選択内なら、そのセル（結合セルの場合は結合範囲全体）を除外します。集計対象が残らない場合はエラーを表示します。このデモの集計は10,000セル以内です。

どちらも `getContextMenuItems` が処理結果を返し、コンポーネントが編集許可・確認・変更処理を担当します。デモ内で操作APIを直接呼んで確認を迂回することはありません。

既定の実行モードは `block` です。URLに次のクエリを付けると、コンポーネントへ渡すモードだけを切り替えられます。

| URL例 | 完了時の扱い |
| --- | --- |
| `/?menuMode=block` | 処理中は変更を禁止し、完了したら反映 |
| `/?menuMode=confirm` | 完了時に反映内容を確認 |
| `/?menuMode=reject-if-changed` | 処理中にデータが変わった場合は反映しない |

Spreadsheetも `/spreadsheet?menuMode=confirm` のように指定できます。AI指示ダイアログ自体はモーダルですが、`confirm` と `reject-if-changed` では別タブ・別ウィンドウなどからの変更を許容します。

```sh
npm run test --workspace @likex/playground
```

デモのSUM式について、対象セルの除外・結合セル・離れた範囲・重複範囲・計算上限を実際の数式エンジンで検証します。
