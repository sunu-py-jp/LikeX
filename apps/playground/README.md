# LikeX Playground

LikeXの操作・見た目を確認するVite + Reactのデモです。通常のページには対象のコンポーネントを配置し、AIデモにはLikeAIChatを組み合わせています。

| パス | デモ |
| --- | --- |
| `/` | Explorer |
| `/thumbnails` | Spreadsheet・Word・スライド・PDFの専用サムネイルを一覧表示。タイトルと先頭の内容だけを描画し、ライト／ダークを確認できます。 |
| `/explorer/search` | 利用側の検索フォーム・処理・結果表示を渡すExplorerデモ。ファイル名の文字列／正規表現検索と、顧客・会議日・本文による議事録検索を切り替えられます。議事録は一括／逐次表示も試せます。 |
| `/explorer/lazy-loading` | フォルダ直下の必要時取得と、未取得を含む全件検索。要求履歴・移動イベント・取得済み件数・最小メタデータの受信・部分キャッシュの差分保存を確認できます。 |
| `/explorer/picker` | ファイル・フォルダを選ぶ埋め込み画面とモーダル。単一／複数選択、遅延取得、未取得の名前検索、確定したIDとパスを確認できます。 |
| `/spreadsheet` | Spreadsheet。売上計画・経費・挿入・関数などのサンプルで編集・数式・書式・挿入を確認できます。 |
| `/spreadsheet/search` | 同じ検索UIをSpreadsheetへ渡すデモ。ホームの検索またはCtrl／Cmd+Fで開き、検索結果からセルに移動できます。 |
| `/spreadsheet/ribbon` | リボンの常時表示・タブのみ・自動非表示・完全非表示を外側のセレクターから切り替えます。`?ribbon=hidden` で完全非表示のまま初期表示します。 |
| `/spreadsheet/ai` | 保存済みブックの一覧と新規作成。開いたブックをSpreadsheet＋LikeAIChatで編集します。 |
| `/slide` | LikeSlide。スライド・図形・テキスト・アニメーションを編集します。 |
| `/slide/ribbon` | LikeSlideのリボン4モードを切り替えます。`?ribbon=hidden` でタブも含めて完全非表示で開きます。 |
| `/slide/ai` | 保存済み資料の一覧と新規作成。開いた資料をLikeSlide＋LikeAIChatで編集します。 |
| `/slide/pdf` | PowerPoint風UIでPDFを閲覧します。3ページのサンプルとローカルPDFの選択、ページ移動・ズームを試せます。 |
| `/document` | LikeDocument。文章・書式・表・画像・図形を編集します。 |
| `/document/ribbon` | LikeDocumentのリボン4モードを切り替えます。`?ribbon=hidden` でタブも含めて完全非表示で開きます。 |

`/like-slide/ai` と `/slides/ai` も `/slide/ai` と同じデモを開きます。

Explorerの詳細表示では各列見出しの右端をドラッグして幅を変えられます。幅変更ハンドルの左右キーは10px、Shift併用は50px、Home / Endは最小 / 最大幅、ダブルクリックはその列の初期幅へ戻します。

リポジトリのルートで依存関係をインストールした後、次のコマンドで起動します。

```sh
npm run dev --workspace @likex/playground
```

## 検索UIを利用側で定義するデモ

`src/explorer-search-demo.tsx` と `src/spreadsheet-search-demo.tsx` は `renderSearch` で入力と詳細条件を描画し、`search.trigger` で入力時／明示送信時を切り替えます。入力時は180ms待って検索し、Enterまたは検索ボタンはすぐに実行します。`onSearchRequest` が渡された現在のデータから一致結果を返し、直近の実行条件と一致件数をデモのサイドバーへ表示します。検索履歴の表示が更新されるのは実行時だけなので、Enter待ちとの違いを確認できます。

Explorerは `inputProps` のIME・Enter・フォーカス契約を引き継ぎ、Spreadsheetは `defaultInput` と置換用の `defaultReplacement` を再利用します。検索ロジックは公開 `createTextSearchMatcher` / `findSpreadsheetCells` を使い、ファイル名やセル値の判定をUIに複製しません。入力方式を「文字列」にすると、正規表現のプレビューは入力をエスケープし、`C++` や `v1.2` を演算子として扱いません。「正規表現」では `^Report` などを直接指定できます。RE2形式を使い、先読み・後読み・後方参照は非対応です。`(` など不正なパターンを入力するとエラーを表示します。Spreadsheetの実行タイミングは検索ダイアログ内からも変更できます。バックエンド・外部API通信・永続保存は不要です。標準デモの検索UIは変更しません。

Explorerの「議事録の本文」は、利用側が持つ架空の会議録を検索する例です。顧客と会議日の開始／終了を `search.params`、本文キーワードを検索語として渡し、`onSearchRequest` が次のような結果を返します。キーワードは必須で、空の場合は通常のファイル一覧へ戻ります。「例を入力」は東雲製作所・2026年9月・「料金改定」を設定します。入力時モードではそのまま検索し、Enterモードでは明示送信を待ちます。

「見つかった順に表示」は既定でONです。async generatorが650msの擬似待機を挟んで1件ずつ追加分をyieldし、検索中の表示を残したまま結果と受信件数が増えることを確認できます。待機はローカルデモ用で、外部通信は行いません。OFFにすると従来の配列を一括で返します。この設定も `search.params.incremental` へ渡すため、Enterモードでは確定するまで実行方式を変更しません。検索の変更・クリア・モード切替では `AbortSignal` により待機を取り消します。

```json
{
  "entryId": "meeting-shinonome-0912",
  "snippet": "料金改定は11月の更新分から適用し、既存契約には経過措置を設ける。",
  "reason": "本文に「料金改定」が含まれます・顧客一致・会議日の条件に一致",
  "metadata": { "customerName": "東雲製作所", "meetingDate": "2026-09-12", "topic": "契約更新の条件確認" }
}
```

`renderSearchResult` はファイル名直下の補足部分へ顧客・会議日・本文抜粋・ヒット理由を描画します。`search.resultDetailsHeight: 192` を指定して本文抜粋が見える高さを確保し、選択・プレビュー・メニュー・仮想スクロールはExplorerに任せます。議事録の会議日とファイルの `updatedAt` は別の情報です。たとえば会議日が9月12日でファイル更新が10月3日の資料を9月の結果に含め、8月の会議録を9月に更新した資料は除外します。取得済みの業務メタデータで絞り込み、ファイルの更新日を会議日へ読み替えません。

サンプル本文・検索処理は `src/demo/meeting-search.ts`、検索フォームと補足表示は `src/demo/meeting-search-ui.tsx` です。このデモは業務フィルターとキーワード検索で、自然言語の自動解釈やLLM接続は行いません。自由文から顧客・期間・意図を解釈したい場合は、利用側の外部検索APIやLLMで処理して同じ検索契約へ結果を返します。ファイル名モードとSpreadsheetデモは従来どおり使えます。

## フォルダ単位で読み込むデモ

`/explorer/lazy-loading` は、`onLoadFolder` を使い必要な直下一覧だけを追加取得します。初期キャッシュは「営業資料」フォルダ1項目だけです。サーバー相当のメモリ上には2,576項目を用意し、「営業資料 → 2026年度 → 東雲製作所」の3階層を開くと最後に320件のファイルが届きます。最初のルート取得・フォルダの移動・ツリー展開を試し、開き直したフォルダでは取得履歴が増えないことを確認できます。空フォルダの取得も試せます。

サイドバーに取得済み件数と未保存状態、`onEvent` の `navigate` 通知を表示します。初回表示ではnavigateは通知されません。「営業資料の配下を読み込む」は `ref.loadFolder(id, { recursive: true })` を呼び、未取得の子孫があるフォルダのコピーやZIP等を行う前に必要な範囲を明示取得する例です。要求は350msの取消し可能な擬似待機を入れています。実通信はありません。

`renderEmptyState` は `/空のフォルダ` とその配下の通常の空フォルダだけを、資料整理の案内と独自ボタンへ差し替えます。`actions.addFiles`・`actions.createFolder` で標準の追加・作成処理を使い、`disabled` をボタンへ反映します。ほかのフォルダや検索結果0件は `defaultContent` を返します。子フォルダを作成して開くと配下にも同じ案内が表示されます。専用の `.lazy-folder-empty-*` クラスで装飾し、Explorer全体のスタイルは変更しません。

検索範囲は「全件（未取得含む）」です。デモ側の `onSearchRequest` がサーバー相当の全件Mapでファイル・フォルダ名を検索し、2hitずつ `{ hits, entries }` をyieldします。大小文字・全体一致・正規表現は標準の検索オプションから指定し、判定には公開 `createTextSearchMatcher` を使います。hitは `entryId` のみ返し、場所はExplorerの標準表示を使います。詳細表示では「場所」列に親フォルダの絶対パスを表示し、抜粋として重複させません。パスは検索対象には含めません。自然言語の解析・LLM接続は行いません。

「例：未取得の開発資料8件」は正規表現 `^00[12]_機能仕様` を設定します。ルート取得後の初回キャッシュ4件から、8hitと必要な祖先の計15メタデータだけを受信し、既知の開発資料フォルダを除く14件が追加されて18件になります。全2,576件のsnapshotはExplorerへ渡しません。祖先はストリーム内で重複排除し、検索中断後のバッチを送らないよう `AbortSignal` に対応します。サイドバーはhit数・受信メタデータ数・キャッシュ数を分け、`search-hydrate.addedCount` でキャッシュ数を更新します。

「例：未取得のフォルダ」は「東雲製作所」を検索します。結果のフォルダを開くと、検索で受け取った祖先だけでは直下の取得完了になっていないため、`onLoadFolder` で残りの320ファイルを取得します。検索メタデータの追加では未保存にならず、保存契約も `scope.kind: "partial"` のままです。

`src/demo/lazy-folder-server.ts` の保存処理は、`scope.kind: "partial"` を確認し、全件Mapに `changes.created` / `updated` / `deleted` だけを適用します。全体の階層を検証してからまとめて確定し、`payload.entries` と同じキャッシュ範囲だけ返します。ファイルの改名・作成・削除後に保存しても、開いていないフォルダの資料は残ります。ローカルFileの本体参照への変換も含みます。取得と保存はメモリ内だけで、再読込すると初期状態に戻ります。

## ファイル・フォルダを選ぶデモ

`/explorer/picker` は `ExplorerPicker` と `ExplorerPickerDialog` を同じ取得処理へ接続します。「ファイルを1つ」「複数のファイル」「フォルダを1つ」「ファイルとフォルダ」で `kind`・`multiple` を切り替え、選択候補の `onSelectionChange` と確定結果の `onConfirm` を別々に表示します。ファイルのダブルクリック／Enterは確定、フォルダは移動です。フォルダを選べる条件では現在のフォルダとルートも選択できます。

初期データはルート直下4項目だけです。`lazy-folder-server.ts` の `onLoadFolder` 用取得と、未取得を含む名前検索を再利用し、350msの取消し可能な待機を挟みます。全件一覧はPickerへ渡しません。モーダルは確定成功で閉じ、開き直すと新しいセッションになります。キャンセルしてもデモ側の確定済み結果は残します。対象はアプリが渡す仮想ファイル一覧で、端末のファイル選択や外部通信・保存は行いません。

## Spreadsheet／SlideのAIデモ

最初に保存済み資料の一覧を表示します。「空白」または「サンプル」から名前を付けて作成すると、編集画面が開きます。一覧では名前の検索、カード／リスト表示の切り替え、保存済み資料の再編集ができます。スライドはカード、スプレッドシートはリストが初期表示です。

Spreadsheetには「基本設計書」のテンプレートもあります。架空の購買発注・承認画面を題材に、表紙・変更履歴、画面レイアウト、画面項目一覧、チェック一覧、処理仕様、処理フロー、参照マスタ、要件資料の8シートを用意します。48項目の画面要件、入力・業務チェック、処理と参照マスタの元データは「要件資料」に置き、設計書側には書式・記入欄・進捗集計の数式を用意します。

作成するとAIパネルが開きます。「要件資料」の内容を必要に応じて編集してから「要件資料から設計書を完成させる」を押すと、AIが必要な範囲を取得し、既存の書式・数式を保持して資料を順次完成させます。開いただけではAIへ送信しません。「記入内容の不足・矛盾を確認する」は編集せずにレビューします。未確定事項は推測で埋めず、要確認として残す指示です。元データはデモの架空の仕様であり、外部システムから自動収集するものではありません。

テンプレート本体と開始用の依頼文は `src/demo/spreadsheet-design-template.ts`、一覧の追加カードとチャットへの受け渡しはプレイグラウンド側で定義しています。再利用するときは、このテンプレートや要件データを利用側で差し替えられます。保存・再表示・AI編集には既存の公開APIを使います。

作成時と本体の「保存」で、資料のネイティブJSONとタイトル・更新日時・ページ／シート数を、このオリジンのブラウザーのIndexedDBへ保存します。ページを再読み込みすると一覧から始まり、保存済み資料を開き直せます。編集途中の自動保存はありません。「一覧」で戻る際に未保存の変更があれば、保存して戻る・保存せず戻る・キャンセルを選べます。AI処理中と保存中は一覧へ戻れません。保存先の容量不足や同じ資料の別タブでの更新を検出した場合は保存に失敗し、編集画面に下書きを残します。ブラウザーのサイトデータを消すと資料も削除されるため、残したい資料はファイルにも書き出してください。

永続化と画面遷移は `src/ai/demo-document-store.ts`、`demo-document-library.tsx`、`demo-document-editor.tsx` と各デモで実装しています。ライブラリ本体には保存先を持たせず、公開モデルのparse/serialize APIと `onSave` で連携します。

AIパネル右上の「新しいチャット」で、資料を維持して空の会話に切り替えます。生成中なら処理を停止します。反映済みの編集は残し、停止後の古い編集要求は適用しません。以前の会話は編集中のメモリに保持しますが、一覧へ戻るか再読み込みすると消えます。資料を開き直すと新しい会話になります。チャット履歴はIndexedDBに保存しません。

AIへの初回送信には、ホストの指示・直近の会話に加えて、形式・タイトル・シート数／スライド数などの概要と選択位置だけを含めます。シート名一覧・セル本文・スライド本文・スキル本文は先に送らず、AIが必要なものをツールで取得します。Spreadsheetのタイトルはコンポーネントと同じホスト設定、Slideのタイトルは現在のデッキから取得します。

AIへ公開するツールは、取得・検索・編集を分けています。コマンドの型は公開TypeScript型から生成した `commands.schema.json` を使い、Responses APIの `strict: true` とサーバー側の入力検証の両方を適用します。文字サイズなどの数値範囲も、公開型の注釈から同じSchemaへ反映します。既存の `run_script` は内部互換経路として残しますが、AIのツール一覧には出しません。実行ロジックは共有スキルCLI・公開モデルAPIを使います。

| ツール | 用途 |
| --- | --- |
| `read_skill` / `read_reference` | 操作手順・型・デザイン参照の取得 |
| `inspect_document` | 概要・一覧・1ページ／1シート・範囲の取得 |
| `search_sheets` / `search_cells` | Spreadsheetのシート名・セルのキーワード検索 |
| `add_svg_image` / `update_svg_image` | 自作SVGを検証し、通常画像として追加／既存画像の図解を改稿 |
| `update_slide_text` / `format_slide_elements` | Slideの既存要素の文章／書式だけを編集 |
| `apply_commands` | 型付きコマンドの原子的な一括編集 |
| `validate_document` | 明示的な検証。通常は編集時と最終検証で足ります |
| `preview_slide` | Slideの編集後の画像とレイアウト診断。対応ブラウザーでのみ公開 |

`inspect_document` の引数例:

```json
{ "query": { "kind": "list" } }
```

```json
{ "query": { "kind": "range", "sheetId": "取得したシートID", "range": "B2:F6", "includeFormat": false } }
```

```json
{ "query": { "kind": "sheet", "sheetId": "取得したシートID", "includeData": true, "includeFormat": false, "offset": 0, "limit": 100 } }
```

```json
{ "query": { "kind": "slide", "slideId": "取得したページID", "includeData": true, "elementId": null } }
```

範囲取得の `selection` は `{ sheetId, range, rows }` です。`rows` は行優先の二次元配列で、単一セルでも `[[{ "value": "商品" }]]`、未格納セルは `null` です。セルは `{ value, format?, validation? }` で矩形の行数・列数を保ちます。1シートの保存セル取得は `{ sheet, cells, offset, limit, total, hasMore }` で、一次元の `cells` に `{ address, value, format?, validation? }` が並びます。書式付き空セルは含み、未格納セルは含みません。数式は元の入力文字列を返します。図形・画像・コメントはこのセル配列には入りません。

このデモのAI向け取得では `includeFormat: false` を基本にし、セルごとに繰り返す `format` を省いて `selection.formatsOmitted: true` を返します。値・数式・入力規則・セル位置は保持します。書式を調べるときだけ小さな範囲に `includeFormat: true` を指定します（省略時は `false`）。書式が存在しないという意味ではなく、値だけの編集でも既存の書式は維持されます。公開モデルAPIと汎用CLIの取得形式や、競合照合に使う取得時点の文書は変更しません。

検索結果は `{ search, text, matches, offset, limit, total, hasMore }` です。`search_sheets` は名前、`search_cells` は指定範囲または全シートのセルを検索します。`lookIn` は `values`（書式付き表示値）／`formulas`（数式・入力値）、`matchCase` は大文字小文字、`exact` は全体一致です。検索の `value` / `matchedText` は既定200文字のプレビューで、省略時は `valueTruncated` / `matchedTextTruncated` と元の文字数を返します。`previewLength` は1〜10,000、ページの `limit` は既定100・最大1,000です。`hasMore` が true なら `offset + limit` で続けます。

Slideのマスター・レイアウト一覧は `inspect_document` の `query.kind: "list"` で取得します。編集・書式変更・検証の応答では、同じカタログを毎回返さず件数とページIDなどの概要を保持します。マスター付き資料を複数ページ作成しても、レイアウト一覧の重複で会話容量を消費しません。

Slideのページ取得は `selection.elements` にテキスト・図形内文字・位置・寸法・書式などをまとめて返し、画像の `src` / `dataUrl` は省きます。元の値とアニメーション定義を保持し、他ページの本文は取得しません。要素ごとの読み取りを繰り返さず、取得済みの変更されていないデータを再利用します。

Slideの `summary.title` / `deck.rename` は資料名、`slide.name` は左の一覧のページ名です。キャンバスに表示される見出しはテキスト要素の `text` なので、資料名やページ名を変えても本文は変わりません。標準のシステム指示では「タイトルを英語にして」など対象を省略した依頼は、現在ページの見出しを取得して `update_slide_text` で変更し、画像で確認します。資料名・ファイル名や一覧の名前が明示された場合はその対象を編集し、見出し候補が複数あって特定できない場合は確認します。

文字だけの変更・翻訳には `update_slide_text` を優先します。引数は `{ slideId, updates: [{ elementId, text }], dryRun, resolvesFailureIds, baseRevision }` で、1ページ内の既存テキスト・図形内文字をまとめて変更します。書式や位置、資料名、ページ名は維持します。ホストで公開コマンドの `element.update` / `patch: { text }` へ変換し、通常の一括編集と同じ検証・失敗修復・画像確認・Undoの経路に通します。画像への文字指定や対象IDの誤りは、バッチ全体を拒否します。

書式変更には `format_slide_elements` を優先します。引数は `{ slideId, elementIds, format, dryRun, resolvesFailureIds, baseRevision }` で、1ページ内の指定要素へ共通の書式を一括適用します。`format` の各項目はstrictツールでは必須nullableで、`null` は変更しない指定、塗りをなくす場合は `"transparent"` を使います。本文・位置・寸法は変えません。

| 対象 | 指定できる書式 |
| --- | --- |
| テキスト | `fontFamily`, `fontSize`, `bold`, `italic`, `textColor`, `align`, `verticalAlign`, `fill`, `opacity` |
| 通常の図形 | `fontSize`, `textColor`, `fill`, `stroke`, `strokeWidth`, `opacity` |
| 線 | `stroke`, `strokeWidth`, `opacity`, `startArrow`, `endArrow` |
| 画像 | `opacity` |

`textColor` は対象に応じて公開モデルの `color` / `textColor` へ変換します。対応していない書式を含む対象がある場合は一部だけ変更せず全件を拒否するため、例えばテキストと図形への `bold` は対象を分けます。専用ツールも通常の編集と同じ失敗修復・画像確認・Undoの経路を利用します。

`apply_commands` は `{ commands, dryRun, resolvesFailureIds, baseRevision }` を受けます。取得用の `sheetId` / `slideId` をルートには指定できません。省略可能なコマンド項目はstrictツール上で必須nullableになり、使わない項目に `null` を指定します。元の型で許される `null` は値として保持します。任意キーの辞書は `[{key,value}]` 形式で受け、ホストで元の公開API形式に変換します。

Spreadsheetの入力例（既存シートの値だけを変更）:

```json
{
  "commands": [{ "type": "cells.set", "sheetId": "取得したシートID", "values": [
    { "key": "B2", "value": "商品" }, { "key": "C2", "value": "売上" },
    { "key": "B3", "value": "商品A" }, { "key": "C3", "value": "1200" }
  ], "onConflict": null }],
  "dryRun": false,
  "resolvesFailureIds": [],
  "baseRevision": "read-2"
}
```

Spreadsheetは複数シートにまたがるセル・書式・行列サイズのバッチを利用できます。通常セルへの矩形データ・格子罫線・ヘッダー色の配置は `cells.writeGrid`、既存範囲の罫線は `cells.borders` を優先します。名前付きの構造化テーブルを依頼された場合に `tables.insert` を使います。通常セル用の旧 `cells.writeTable` は削除し、`cells.writeGrid` に統一しています。新規シートは `sheets.add` の結果からIDを取得してから編集します。

`cells.format` / `cells.validation` / `cells.replace` の `addresses` は単一セルと範囲を混在でき、例えば `["A1", "B2:F6"]` を公開モデルAPIで展開します。範囲文字列を含む場合の展開上限は10,000セルで、重複を除きます。失敗した編集を修復するときも、範囲と同じセル一覧は同じ対象として判定し、セルを省いた修復や別範囲への置換は成功扱いにしません。

Slide AIでは**1回の書き込みにつき1ページ**をAPIで強制します。1つの指示で複数ページを作れますが、ページごとに順番に書き込みます。同じページの要素編集はまとめられ、`slide.add` にもその1ページの全要素を含められます。AIは資料全体の視覚的な方針を決め、内容に合わせて各ページの座標・寸法・書体・配色を自由に設計します。固定構図・デザインプリセットの生成APIはありません。カードの繰り返しに頼らず、数値・図解・余白・大小の対比を使い分けます。例示レイアウトも固定テンプレートとして強制しません。

`add_svg_image` は `slideId`・新規 `elementId`・生の `svg` 文字列・`x/y/width/height`・`name/alt`（不要なら `null`）・`dryRun`・`resolvesFailureIds`・`baseRevision` を受け取ります。SVGは公開モデルの `createSlideSvgSource` で検証・符号化して、通常の `element.add` コマンドで画像要素として挿入します。既存画像の改稿には `update_svg_image { slideId, elementId, svg, dryRun, resolvesFailureIds, baseRevision }` を使い、要素ID・配置・サイズ・書式を保って図解だけを置換します。生SVGは256,000文字までです。パス・基本図形・グループ・グラデーション・クリップなどの静的表現に対応し、外部参照・スクリプト等は拒否します。SVG内部は個別のスライド要素として編集できないため、見出し・重要数値・後で編集するラベルは通常のテキストとして重ねます。`dryRun`・失敗修復・キャンセル・最終プレビューは通常の編集と同じ経路です。

依頼されたページ全体の再設計では `slide.replaceContent` を使い、旧要素IDを1件ずつ列挙せずに内容を原子的に置換します。ページIDと順序・適用済みのマスター／レイアウトを保持し、省略した名前・背景・ノートは維持します。古いアニメーションは消去し、必要なら新しい要素を参照する定義を渡します。ロック中の要素があるページは置換を拒否します。依頼されていないページの作り直しには使いません。利用者の指定したマスターがあるときは実際の `layoutId` でページを追加し、継承した装飾を重複させたり覆い隠したりしません。既存の文章だけなら `update_slide_text`、書式だけなら `format_slide_elements` を使います。線は `line.add` / `line.update` で始点・終点と接続先を指定します。`startArrow` / `endArrow` は各端の形状です。旧 `element.connect` は削除しました。

最終編集後に各ページを画像で確認し、文字切れだけでなく、主張の強弱・余白・光学的な整列・グラフの正確さ・ページ間の単調さを検証します。修正したページは再確認します。LLM接続と進行はプレイグラウンドが担当し、本体はLLMなしで自由配置・SVG検証・描画・保存を提供します。

`slide.delete` / `slide.duplicate` / `slide.move` と `deck.rename` は単独操作、`deck.resize` は既存資料が1ページの場合だけ許可します。逐次編集では `create_document` を公開せず、必要なシート・ページの追加・削除・内容置換を明示的なコマンドで行います。事前のコマンド検査と出力差分検査で強制し、独自プロンプトや `dryRun` でも解除されません。公開SlideモデルAPI・汎用CLIの複数ページバッチは従来どおりです。

`element.update.patch` の入力形式はテキスト・図形・画像で分かれます。取得した要素の種類に合う形式を使い、テキストに画像の `src` や図形の `shape` を混ぜません。strict形式でも使わない項目は `null` にし、変更対象だけに値を指定します。

1バッチは1,000件・512 KiBまでで、1コマンドでも失敗すると全体を取り消します。エラーは `diagnostics` に `code` / `path` / `expected` / `actual`、必要に応じて `failureId` と再試行方法を返します。同じ失敗を変更なく繰り返す操作は抑止します。ID間違いは対象を再取得し、バッチ全体を修正して `resolvesFailureIds` に失敗IDを指定します。 修正済みバッチの再取得だけが不足する場合は `write_recovery_requires_inspection` と必要な `inspect_document` 引数を返します。バッチの対象・操作・項目が不足する `incomplete_write_recovery` と区別し、再取得と全件再送の検証は維持します。無関係な編集の成功や検証では未解決エラーを消しません。

Spreadsheetの新規描画で位置の検証に失敗した場合は、エラーのコマンドに限って不正な `anchor` を修正できます。元の位置が不正で修正後の位置が有効なことを公開モデルで検証し、そのコマンドの位置以外と、同じバッチの他のコマンドは維持させます。既存図形を別の対象へ変更する修復や、失敗したバッチの一部だけの再送は認めません。

両モジュールで、編集が成功しても実際の変更がない場合は `noChange` に `code: "no_change"`（正規化後のpatchが空なら `"empty_patch"`）、`repeatCount`、`stopAfter: 3` と次の行動を返します。1〜2回目は同じ操作を再送せず、必要な別の編集または完了へ進めます。同じ文書状態で同じ編集が3回繰り返されたら `repeated_no_change` でセッションを停止し、反映済みの変更を保持して後続の処理を止めます。比較にはnull正規化済みのコマンドを使い、JSONのキー順を変えても同じ操作として数えます。取得・プレビューは回数をリセットせず、実際の変更でリセットします。別の対象への編集は別に数え、dry-runは対象外です。無変更は修復必須の編集エラーとして登録せず、既存の未解決エラーや画像確認の要件を免除することもありません。

AIの編集は成功したバッチごとに本体の公開APIへ反映します。AI処理中も資料を操作できます。各バッチが1回のUndoになり、ユーザーの編集との間で履歴をまとめません。キャンセル・未解決エラー・回数上限・通信切断でも反映済みの編集は残ります。最終応答は完了通知として扱い、最後に資料全体を再読み込みしません。

取得・検索結果に `readRevision` を返します。AIはその編集の判断に使った取得時点を、全書き込みツールの `baseRevision` に指定します。無関係な取得が後から走っても、以前の取得時点を勝手に更新しません。取得時点の全文はホストだけで保持し、モデルには必要な取得結果と識別子を渡します。

本体APIは変更前のモデルとセッションの構造トークンを照合して、最新モデルへコマンドを適用します。競合したバッチは全件未適用で、差分の場所・期待値・現在値を返します。AIの取得時点を失効させ、再取得してから再検討させます。照合と書き込みの間に非同期処理を挟まず、権限確認後にも照合します。未確定のセル入力や編集不可状態では適用を拒否します。

| 操作 | 本体APIの照合範囲 |
| --- | --- |
| セル値・個別書式・コメント・サイズ、単純な図形／テキスト書式 | 変更対象と操作に必要な依存項目 |
| 行列・セルの挿入削除・移動、シート操作、結合、コピー、構造化テーブルなど | ブック全体 |
| スライド追加削除・並べ替え、図形の配置・接続・削除、アニメーション、マスターなど | デッキ全体 |
| 取得した別の値を元に計算・判断した結果の記入 | ホストが判断材料を含む範囲を指定。このデモでは資料全体 |

値だけ一致しても位置が変わっている可能性があるため、構造変更・Undo・読み込み等ではトークンを更新します。読み込みで同じIDや同じ内容に戻っても古いトークンは使えません。純粋なモデルAPI／ファイルCLIでは過去の操作履歴を観測できないため、セッション管理・排他は利用側が担当します。

このデモのAI更新は、LLMが参照した判断材料の取りこぼしを防ぐため `scope: "document"` を指定します。本体APIの項目単位の照合より広く、別の場所のユーザー編集でも再取得が必要になる場合があります。取得時点は最大16件・48 MiBまで保持し、失効した場合も再取得します。

通信は `capabilities.liveDocument: true` と依頼中固定の `targetId` を使います。サーバーは期限付き `document` イベントで取得／確定を依頼し、ブラウザーが `/api/ai/documents/:id` へ結果を返します。同じイベントは二度実行せず、結果確認が不明なまま切断した場合は再実行を止めます。保存用JSONとOffice形式には、この一時的な取得時点・構造トークンを追加しません。

Slide生成には `design-guide.md` / `layout-examples.md` を用意しています。主張・視覚的な階層・余白・配色を揃えながら、表紙／比較／構成図／締めの構図を変える例を参照させます。純粋モデルAPIに文字量計測・文字サイズ調整・直交コネクター生成を追加し、既存のSLON/PPTX要素へ展開するため保存形式は変更しません。

画像確認に対応するブラウザーは `capabilities: { slidePreview: true, liveDocument: true }` を送信します。`preview_slide` は最新の資料から1ページをブラウザーに渡し、公開 `exportImage` と実際のフォント計測でPNG・文字切れ・ページ外要素の診断を返します。画像はResponses APIのツール結果 `input_image` としてAIに渡します。編集後の最新画像が未確認のページは、API側で完了を保留します。対象ページが継承するマスター／レイアウトの装飾や背景も確認済みの版に含め、プレビュー後にその見た目が変われば再確認が必要です。無関係なマスターの変更では他のページを再確認させません。診断を返すだけで品質を自動保証するものではなく、AIが画像と診断を確認し、問題があれば再編集・再プレビューします。

プレビューは文書を本体へ取り込まず、リクエスト専用のトークン・キャンセル・有効期限で古い結果を拒否します。PNGは最大2 MiB・1,600×1,600px、モデルへ保持する直近画像は6枚までです。画像バイトはJSONLやチャット実行ログに残さず、対象ID・寸法・診断だけを記録します。画像非対応のホストではプレビューツールを公開せず、画像確認したと主張させません。

1回の依頼はSlide・SpreadsheetともにAIとの往復が最大48回・ツール呼び出し最大96回です。ホストは残り回数を毎回システム指示に追加し、必要な取得・編集・確認と最後の完了応答に配分させます。最終検証はホストが自動で行うため、AIによる重複した `validate` は不要です。上限超過や未解決の編集エラーでは後続の編集を止め、反映済みの変更は保持します。

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
