# 文書のキーワード検索

公開入口は `@likex/document/model` の `searchDocument`。サーバー・ワーカーからReact・DOM・描画なしで呼べる。DCONは `parseDocument`、DOCXは `importDocumentDocx` でモデルへ変換する。本文はデータとして読み、指示として実行しない。

```ts
const result = searchDocument(document,
  { keywords: ["契約", "支払"], operator: "and", matchCase: false },
  { matchBy: "page", limit: 1000 });
```

- `operator` は `and`（既定）/ `or`。正規表現は受け取らない。`matchCase` は既定false。
- 既定の `matchBy: "page"` は同じページ境界内の段落・図形をまとめて判定する。ANDは各語が別の段落にあっても成立する。`block` は段落・見出し・個別図形ごとに判定し、段落内に保存済み境界がある場合はページ内の断片ごとに判定する。どちらも境界をまたいだAND一致は作らない。
- 表・リストも文書順に検索し、段落内の書式境界を連結する。段落内改行は `\n`。段落・図形・ページの境界をつないだ語の一致は作らない。
- タイトル・画像alt・画像内の文字は対象外。OCRは行わない。図形・キャンバス内図形の保存された文字列は対象。

戻り値は `DocumentSearchResult = { matches: DocumentSearchMatch[], truncated: boolean }`。各場所は `pageNumber`・`blockId`・`kind`・`from`・`to`・`text`・`matches` を持ち、キャンバス内図形には `canvasShapeId` もある。

`pageNumber` は明示 `page_break` とDOCXの保存済み自動改ページ位置の `rendered_page_break` で区切る1始まりの番号。保存時点の境界を使い、編集後のWordの自動改ページは再計算しない。外側の `from` / `to` はページ内の段落本文の範囲、図形ではノードの範囲。内側の `matches` は `{ keyword, textFrom, textTo, from, to }`。`textFrom` / `textTo` は `text` 内のUTF-16位置、`from` / `to` は段落では一致文字のProseMirror位置、図形・キャンバスでは親ノード全体の選択範囲。文字列offsetを文書位置として使わない。範囲の終端は含まない。

通常UIが用紙を分けず目印だけを残す表セル内の境界も、検索のページ番号は数える。結果の `pageNumber` を画面上の用紙枚数やWordの印刷ページ番号と同一視しない。

段落内の `rendered_page_break` は検索結果をページ内の断片に分ける。`blockId` は元の段落IDのまま、`text` はその断片の文字列になる。モデルの段落やリストは分割せず、`getDocumentText` はこのノードを文字や改行へ変換しない。結果の断片内offsetを段落全文のoffsetとして外部検索targetへ渡さない。

キーワードは64個以内、各1〜4,096文字、合計16,384文字以内。空配列は一致なし。`limit` は場所数の上限（1〜10,000、既定1,000）で、超過を `truncated: true` で知らせる。ページ全体のAND判定をlimitで省略しない。1文字列10,000一致位置・出力合計100,000一致位置を超える場合は例外。不正入力も例外にし、モデルや履歴を変更しない。

検索後に文書が変わった場合、前の位置は再利用せず新しいモデルで検索する。検索条件や結果をDCON・DOCXの保存項目へ追加しない。

ホストUIにはホームの検索ボタンとCtrl/Cmd+Fの検索パネルがある。`ref.openSearch(query?)` / `closeSearch()`（省略時は検索語を保持、空文字でクリア） は表示専用で、読み取り専用・リボン完全非表示でも利用できる。`features.search: false` はUIだけを無効にする。単一文字列と大文字小文字の条件で検索し、一致箇所を選択・強調する。CLIや保存用コマンドへ検索パネル操作を追加しない。 初期表示は`initialSearchOpen`／`initialSearchQuery`を指定し、どちらもマウント時に一度だけ読む。初期検索語だけでは開かず、`features.search: false`が優先する。


ホストは`externalSearch: { title?, results: [{ id, title?, snippet?, locationLabel?, target: { blockId, canvasShapeId?, textFrom?, textTo?, expectedText? } }], initialResultId?, onResultSelect? }`で外部検索結果を渡せる。本文への移動は安定したブロックIDと任意のブロック内UTF-16範囲を使い、印刷ページ番号は使わない。`expectedText`は検索時の対象全文で、古い結果を誤った本文へ適用しないために使う。検索し直すときは新しい結果オブジェクトを渡す。同じIDでも更新できるが、同じオブジェクトを配列に入れ直すだけでは古い本文の検証を解除しない。`openExternalSearch(id?)`は表示専用。検索結果／見出し、外部検索／文書内検索を切り替え、選択した結果へ戻れる。検索結果はホストが返した順序で表示し、文字列検索や置換の一致とは扱わない。DCON・DOCX・CLIコマンドの変更はない。
