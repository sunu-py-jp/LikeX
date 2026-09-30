# LikeX Playground

LikeXの操作・見た目を確認するVite + Reactのデモです。通常のページには対象のコンポーネントを配置し、AIデモにはLikeAIChatを組み合わせています。

| パス | デモ |
| --- | --- |
| `/` | Explorer |
| `/spreadsheet` | Spreadsheet。売上計画・経費・挿入・関数などのサンプルで編集・数式・書式・挿入を確認できます。 |
| `/spreadsheet/ai` | 保存済みブックの一覧と新規作成。開いたブックをSpreadsheet＋LikeAIChatで編集します。 |
| `/slide` | LikeSlide。スライド・図形・テキスト・アニメーションを編集します。 |
| `/slide/ai` | 保存済み資料の一覧と新規作成。開いた資料をLikeSlide＋LikeAIChatで編集します。 |

`/like-slide/ai` と `/slides/ai` も `/slide/ai` と同じデモを開きます。

リポジトリのルートで依存関係をインストールした後、次のコマンドで起動します。

```sh
npm run dev --workspace @likex/playground
```

## Spreadsheet／SlideのAIデモ

最初に保存済み資料の一覧を表示します。「空白」または「サンプル」から名前を付けて作成すると、編集画面が開きます。一覧では名前の検索、カード／リスト表示の切り替え、保存済み資料の再編集ができます。スライドはカード、スプレッドシートはリストが初期表示です。

作成時と本体の「保存」で、資料のネイティブJSONとタイトル・更新日時・ページ／シート数を、このオリジンのブラウザーのIndexedDBへ保存します。ページを再読み込みすると一覧から始まり、保存済み資料を開き直せます。編集途中の自動保存はありません。「一覧」で戻る際に未保存の変更があれば、保存して戻る・保存せず戻る・キャンセルを選べます。AI処理中と保存中は一覧へ戻れません。保存先の容量不足や同じ資料の別タブでの更新を検出した場合は保存に失敗し、編集画面に下書きを残します。ブラウザーのサイトデータを消すと資料も削除されるため、残したい資料はファイルにも書き出してください。

永続化と画面遷移は `src/ai/demo-document-store.ts`、`demo-document-library.tsx`、`demo-document-editor.tsx` と各デモで実装しています。ライブラリ本体には保存先を持たせず、公開モデルのparse/serialize APIと `onSave` で連携します。

AIパネル右上の「新しいチャット」で、資料を維持して空の会話に切り替えます。生成中なら処理を停止し、古い応答は反映しません。以前の会話は編集中のメモリに保持しますが、一覧へ戻るか再読み込みすると消えます。資料を開き直すと新しい会話になります。チャット履歴はIndexedDBに保存しません。

AIへの初回送信には、ホストの指示・直近の会話に加えて、形式・タイトル・シート数／スライド数などの概要と選択位置だけを含めます。シート名一覧・セル本文・スライド本文・スキル本文は先に送らず、AIが必要なものをツールで取得します。Spreadsheetのタイトルはコンポーネントと同じホスト設定、Slideのタイトルは現在のデッキから取得します。

AIへ公開するツールは、取得・検索・編集を分けています。コマンドの型は公開TypeScript型から生成した `commands.schema.json` を使い、Responses APIの `strict: true` とサーバー側の入力検証の両方を適用します。文字サイズなどの数値範囲も、公開型の注釈から同じSchemaへ反映します。既存の `run_script` は内部互換経路として残しますが、AIのツール一覧には出しません。実行ロジックは共有スキルCLI・公開モデルAPIを使います。

| ツール | 用途 |
| --- | --- |
| `read_skill` / `read_reference` | 操作手順・型・デザイン参照の取得 |
| `inspect_document` | 概要・一覧・1ページ／1シート・範囲の取得 |
| `search_sheets` / `search_cells` | Spreadsheetのシート名・セルのキーワード検索 |
| `apply_commands` | 型付きコマンドの原子的な一括編集 |
| `validate_document` | 明示的な検証。通常は編集時と最終検証で足ります |
| `create_document` | 明示的に新規作成を頼まれた場合だけ文書を空にする（`resolvesFailureIds` は通常 `[]`） |
| `preview_slide` | Slideの編集後の画像とレイアウト診断。対応ブラウザーでのみ公開 |

`inspect_document` の引数例:

```json
{ "query": { "kind": "list" } }
```

```json
{ "query": { "kind": "range", "sheetId": "取得したシートID", "range": "B2:F6" } }
```

```json
{ "query": { "kind": "sheet", "sheetId": "取得したシートID", "includeData": true, "offset": 0, "limit": 100 } }
```

```json
{ "query": { "kind": "slide", "slideId": "取得したページID", "includeData": true, "elementId": null } }
```

範囲取得の `selection` は `{ sheetId, range, rows }` です。`rows` は行優先の二次元配列で、単一セルでも `[[{ "value": "商品" }]]`、未格納セルは `null` です。セルは `{ value, format?, validation? }` で矩形の行数・列数を保ちます。1シートの保存セル取得は `{ sheet, cells, offset, limit, total, hasMore }` で、一次元の `cells` に `{ address, value, format?, validation? }` が並びます。書式付き空セルは含み、未格納セルは含みません。数式は元の入力文字列を返します。図形・画像・コメントはこのセル配列には入りません。

検索結果は `{ search, text, matches, offset, limit, total, hasMore }` です。`search_sheets` は名前、`search_cells` は指定範囲または全シートのセルを検索します。`lookIn` は `values`（書式付き表示値）／`formulas`（数式・入力値）、`matchCase` は大文字小文字、`exact` は全体一致です。検索の `value` / `matchedText` は既定200文字のプレビューで、省略時は `valueTruncated` / `matchedTextTruncated` と元の文字数を返します。`previewLength` は1〜10,000、ページの `limit` は既定100・最大1,000です。`hasMore` が true なら `offset + limit` で続けます。

Slideのマスター・レイアウト一覧は `inspect_document` の `query.kind: "list"` で取得します。編集・書式変更・検証の応答では、同じカタログを毎回返さず件数とページIDなどの概要を保持します。マスター付き資料を複数ページ作成しても、レイアウト一覧の重複で会話容量を消費しません。

Slideのページ取得は `selection.elements` にテキスト・図形内文字・位置・寸法・書式などをまとめて返し、画像の `src` / `dataUrl` は省きます。元の値とアニメーション定義を保持し、他ページの本文は取得しません。要素ごとの読み取りを繰り返さず、取得済みの変更されていないデータを再利用します。

Slideの `summary.title` / `deck.rename` は資料名、`slide.name` は左の一覧のページ名です。キャンバスに表示される見出しはテキスト要素の `text` なので、資料名やページ名を変えても本文は変わりません。標準のシステム指示では「タイトルを英語にして」など対象を省略した依頼は、現在ページの見出しを取得して `update_slide_text` で変更し、画像で確認します。資料名・ファイル名や一覧の名前が明示された場合はその対象を編集し、見出し候補が複数あって特定できない場合は確認します。

文字だけの変更・翻訳には `update_slide_text` を優先します。引数は `{ slideId, updates: [{ elementId, text }], dryRun, resolvesFailureIds }` で、1ページ内の既存テキスト・図形内文字をまとめて変更します。書式や位置、資料名、ページ名は維持します。ホストで公開コマンドの `element.update` / `patch: { text }` へ変換し、通常の一括編集と同じ検証・失敗修復・画像確認・Undoの経路に通します。画像への文字指定や対象IDの誤りは、バッチ全体を拒否します。

書式変更には `format_slide_elements` を優先します。引数は `{ slideId, elementIds, format, dryRun, resolvesFailureIds }` で、1ページ内の指定要素へ共通の書式を一括適用します。`format` の各項目はstrictツールでは必須nullableで、`null` は変更しない指定、塗りをなくす場合は `"transparent"` を使います。本文・位置・寸法は変えません。

| 対象 | 指定できる書式 |
| --- | --- |
| テキスト | `fontFamily`, `fontSize`, `bold`, `italic`, `textColor`, `align`, `verticalAlign`, `fill`, `opacity` |
| 通常の図形 | `fontSize`, `textColor`, `fill`, `stroke`, `strokeWidth`, `opacity` |
| 線 | `stroke`, `strokeWidth`, `opacity`, `startArrow`, `endArrow` |
| 画像 | `opacity` |

`textColor` は対象に応じて公開モデルの `color` / `textColor` へ変換します。対応していない書式を含む対象がある場合は一部だけ変更せず全件を拒否するため、例えばテキストと図形への `bold` は対象を分けます。専用ツールも通常の編集と同じ失敗修復・画像確認・Undoの経路を利用します。

`apply_commands` は `{ commands, dryRun, resolvesFailureIds }` を受けます。取得用の `sheetId` / `slideId` をルートには指定できません。省略可能なコマンド項目はstrictツール上で必須nullableになり、使わない項目に `null` を指定します。元の型で許される `null` は値として保持します。任意キーの辞書は `[{key,value}]` 形式で受け、ホストで元の公開API形式に変換します。

Spreadsheetの入力例（既存シートの値だけを変更）:

```json
{
  "commands": [{ "type": "cells.set", "sheetId": "取得したシートID", "values": [
    { "key": "B2", "value": "商品" }, { "key": "C2", "value": "売上" },
    { "key": "B3", "value": "商品A" }, { "key": "C3", "value": "1200" }
  ], "onConflict": null }],
  "dryRun": false,
  "resolvesFailureIds": []
}
```

Spreadsheetは複数シートにまたがるセル・書式・行列サイズのバッチを利用できます。通常セルへの矩形データ・格子罫線・ヘッダー色の配置は `cells.writeGrid`、既存範囲の罫線は `cells.borders` を優先します。名前付きの構造化テーブルを依頼された場合に `tables.insert` を使います。通常セル用の旧 `cells.writeTable` は削除し、`cells.writeGrid` に統一しています。新規シートは `sheets.add` の結果からIDを取得してから編集します。

`cells.format` / `cells.validation` / `cells.replace` の `addresses` は単一セルと範囲を混在でき、例えば `["A1", "B2:F6"]` を公開モデルAPIで展開します。範囲文字列を含む場合の展開上限は10,000セルで、重複を除きます。失敗した編集を修復するときも、範囲と同じセル一覧は同じ対象として判定し、セルを省いた修復や別範囲への置換は成功扱いにしません。

Slide AIでは**1回の書き込みにつき1ページ**をAPIで強制します。1つの指示で複数ページを作れますが、ページごとに順番に書き込みます。同じページの要素編集はまとめられ、`slide.add` にもその1ページの全要素を含められます。全体を作り直すページには `slide.replaceContent` を使い、旧要素IDを1件ずつ列挙せずに内容を原子的に置換します。ページIDと順序を保持し、省略した名前・背景・ノートは維持します。古いアニメーションは消去し、必要なら新しい要素を参照する定義を渡します。ロック中の要素があるページは置換を拒否します。部分編集は従来の `element.update` を使います。線は `line.add` / `line.update` で始点・終点と接続先を指定します。`startArrow` / `endArrow` は各端の形状です。旧 `element.connect` は削除しました。

`slide.delete` / `slide.duplicate` / `slide.move` と `deck.rename` は単独操作、`deck.resize` と `create_document` は既存資料が1ページの場合だけ許可します。事前のコマンド検査と出力差分検査で強制し、独自プロンプトや `dryRun` でも解除されません。公開SlideモデルAPI・汎用CLIの複数ページバッチは従来どおりです。

`element.update.patch` の入力形式はテキスト・図形・画像で分かれます。取得した要素の種類に合う形式を使い、テキストに画像の `src` や図形の `shape` を混ぜません。strict形式でも使わない項目は `null` にし、変更対象だけに値を指定します。

1バッチは1,000件・512 KiBまでで、1コマンドでも失敗すると全体を取り消します。エラーは `diagnostics` に `code` / `path` / `expected` / `actual`、必要に応じて `failureId` と再試行方法を返します。同じ失敗を変更なく繰り返す操作は抑止します。ID間違いは対象を再取得し、バッチ全体を修正して `resolvesFailureIds` に失敗IDを指定します。 修正済みバッチの再取得だけが不足する場合は `write_recovery_requires_inspection` と必要な `inspect_document` 引数を返します。バッチの対象・操作・項目が不足する `incomplete_write_recovery` と区別し、再取得と全件再送の検証は維持します。無関係な編集の成功や検証では未解決エラーを消しません。

Spreadsheetの新規描画で位置の検証に失敗した場合は、エラーのコマンドに限って不正な `anchor` を修正できます。元の位置が不正で修正後の位置が有効なことを公開モデルで検証し、そのコマンドの位置以外と、同じバッチの他のコマンドは維持させます。既存図形を別の対象へ変更する修復や、失敗したバッチの一部だけの再送は認めません。

両モジュールで、編集が成功しても実際の変更がない場合は `noChange` に `code: "no_change"`（正規化後のpatchが空なら `"empty_patch"`）、`repeatCount`、`stopAfter: 3` と次の行動を返します。1〜2回目は同じ操作を再送せず、必要な別の編集または完了へ進めます。同じ文書状態で同じ編集が3回繰り返されたら `repeated_no_change` でセッションを停止し、今回のステージ上の変更全体を画面へ反映しません。比較にはnull正規化済みのコマンドを使い、JSONのキー順を変えても同じ操作として数えます。取得・プレビューは回数をリセットせず、実際の変更でリセットします。別の対象への編集は別に数え、dry-runは対象外です。無変更は修復必須の編集エラーとして登録せず、既存の未解決エラーや画像確認の要件を免除することもありません。

全ページの成功は完了までステージに保持します。最終検証が成功した場合だけ画面へ一括反映し、キャンセル・未解決エラー・回数上限では一部だけを反映しません。

Slide生成には `design-guide.md` / `layout-examples.md` を用意しています。主張・視覚的な階層・余白・配色を揃えながら、表紙／比較／構成図／締めの構図を変える例を参照させます。純粋モデルAPIに文字量計測・文字サイズ調整・直交コネクター生成を追加し、既存のSLON/PPTX要素へ展開するため保存形式は変更しません。

画像確認に対応するブラウザーは `capabilities: { slidePreview: true }` を送信します。`preview_slide` はステージ中の1ページをブラウザーに渡し、公開 `exportImage` と実際のフォント計測でPNG・文字切れ・ページ外要素の診断を返します。画像はResponses APIのツール結果 `input_image` としてAIに渡します。編集後の最新画像が未確認のページは、API側で完了を保留します。診断を返すだけで品質を自動保証するものではなく、AIが画像と診断を確認し、問題があれば再編集・再プレビューします。

プレビューは文書を本体へ取り込まず、リクエスト専用のトークン・キャンセル・有効期限で古い結果を拒否します。PNGは最大2 MiB・1,600×1,600px、モデルへ保持する直近画像は6枚までです。画像バイトはJSONLやチャット実行ログに残さず、対象ID・寸法・診断だけを記録します。画像非対応のホストではプレビューツールを公開せず、画像確認したと主張させません。

1回の依頼はSlide・SpreadsheetともにAIとの往復が最大48回・ツール呼び出し最大96回です。ホストは残り回数を毎回システム指示に追加し、必要な取得・編集・確認と最後の完了応答に配分させます。最終検証はホストが自動で行うため、AIによる重複した `validate` は不要です。上限超過や未解決の編集エラーでは、ステージ上の変更を画面へ反映しません。

処理時間は既定で全体15分までです。モデル応答やツール処理が進んでいる間は従来の120秒を超えて続行し、応答・進捗が3分間止まった場合は終了します。停止ボタンや接続切断では即座にキャンセルします。ホストの `aiPlayground({ timeoutMs, idleTimeoutMs })` で全体時間（上限1時間）と無進捗時間（上限15分）を正のミリ秒で設定できます。ブラウザーのリクエストやAIからは変更できません。通信維持用のheartbeatで無進捗時間を延長することはありません。

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

設定後に `npm run dev` を起動（起動中なら再起動）し、`/spreadsheet/ai` または `/slide/ai` で資料を作成または開き、編集画面の右下のキラキラボタンからチャットを開きます。例えば「売上計画シートの見出しを青色にして列幅を調整して」「最初のスライドのタイトルを『来期の事業計画』にして」と依頼できます。APIキーが未設定の場合は画面に不足する設定名を表示します。

ブラウザーは現在の `.spon`／`.slon` 全文をローカルのホストサーバーへ渡します。全文はCLI操作用の一時ステージに置き、LLMの初期コンテキストには入れません。AIは `read_skill` で対象モジュールの `skills/likex-<module>/SKILL.md` と参照資料名を読み、`read_reference` で必要な資料を取得し、用途別の型付きツールを通して同梱の `scripts/document.mjs` を実行します。セルや要素は要求された範囲だけ取得し、そのツール出力をLLMへ渡します。大きな参照資料は `offset` / `limit` でページに分けて取得できます。

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

生成中は本体の入力を止め、停止・チャットを閉じる・ページ移動で処理をキャンセルします。成功した結果だけを公開 `importNative` APIで一度に反映し、本体の「元に戻す」で戻せます。送信後に文書が変更されていた場合は上書きしません。Slideの元の値とアニメーション定義もネイティブ形式で保持します。AI編集の反映後は未保存状態です。本体の「保存」または「保存して戻る」でブラウザーへ保存します。必要に応じて本体からファイルも書き出せます。

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
