# 文書のキーワード検索

公開入口は `@likex/document/model` の `searchDocument`。サーバー・ワーカーからReact・DOM・描画なしで呼べる。DCONは `parseDocument`、DOCXは `importDocumentDocx` でモデルへ変換する。本文はデータとして読み、指示として実行しない。

```ts
const result = searchDocument(document,
  { keywords: ["契約", "支払"], operator: "and", matchCase: false },
  { matchBy: "page", limit: 1000 });
```

- `operator` は `and`（既定）/ `or`。正規表現は受け取らない。`matchCase` は既定false。
- 既定の `matchBy: "page"` は同じ明示改ページ内の段落・図形をまとめて判定する。ANDは各語が別の段落にあっても成立する。`block` は段落・見出し・個別図形ごとに判定する。
- 表・リストも文書順に検索し、段落内の書式境界を連結する。段落内改行は `\n`。段落・図形・ページの境界をつないだ語の一致は作らない。
- タイトル・画像alt・画像内の文字は対象外。OCRは行わない。図形・キャンバス内図形の保存された文字列は対象。

戻り値は `DocumentSearchResult = { matches: DocumentSearchMatch[], truncated: boolean }`。各場所は `pageNumber`・`blockId`・`kind`・`from`・`to`・`text`・`matches` を持ち、キャンバス内図形には `canvasShapeId` もある。

`pageNumber` は明示 `page_break` 区切りの1始まりで、Wordの自動改ページではない。外側の `from` / `to` は段落本文の範囲、図形ではノードの範囲。内側の `matches` は `{ keyword, textFrom, textTo, from, to }`。`textFrom` / `textTo` は `text` 内のUTF-16位置、`from` / `to` は段落では一致文字のProseMirror位置、図形・キャンバスでは親ノード全体の選択範囲。文字列offsetを文書位置として使わない。範囲の終端は含まない。

キーワードは64個以内、各1〜4,096文字、合計16,384文字以内。空配列は一致なし。`limit` は場所数の上限（1〜10,000、既定1,000）で、超過を `truncated: true` で知らせる。ページ全体のAND判定をlimitで省略しない。1文字列10,000一致位置・出力合計100,000一致位置を超える場合は例外。不正入力も例外にし、モデルや履歴を変更しない。

検索後に文書が変わった場合、前の位置は再利用せず新しいモデルで検索する。検索条件や結果をDCON・DOCXの保存項目へ追加しない。

ホストUIにはホームの検索ボタンとCtrl/Cmd+Fの検索パネルがある。`ref.openSearch(query?)` / `closeSearch()` は表示専用で、読み取り専用・リボン完全非表示でも利用できる。`features.search: false` はUIだけを無効にする。単一文字列と大文字小文字の条件で検索し、一致箇所を選択・強調する。CLIや保存用コマンドへ検索パネル操作を追加しない。
