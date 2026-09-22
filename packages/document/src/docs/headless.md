# モデルAPI・コマンド・履歴

`@likex/document/model` はNode.js・サーバー・ワーカーから文書を操作できます。React・DOMの生成・CSS・エディターのマウントは不要です。ProseMirrorの型を参照するためTypeScriptの `lib` には `ES2022` と `DOM` を含めますが、実行時のブラウザーは必要ありません。

## 文書を作成・編集する

```ts
import { createDocument, executeDocumentCommands, getDocumentText,
  getBlocks, serializeDocument } from "@likex/document/model";

const original = createDocument({ title: "企画書" });
const result = executeDocumentCommands(original, [
  { type: "text.insert", from: 1, text: "新しい企画" },
  { type: "mark.set", from: 1, to: 6, mark: "strong", enabled: true },
]);
const blocks = getBlocks(result.document);
const text = getDocumentText(result.document);
const json = serializeDocument(result.document);
```

`executeDocumentCommands` は1操作または配列を受け取り、`{ document, selection? }` を返します。不正な操作は例外になり、入力文書や途中までの結果を保存しません。純粋なAPIはホストの保存先・認証・機能設定に依存しません。

| コマンド | 操作 |
| --- | --- |
| `text.insert` / `text.delete` | 現在の文書位置に文字を挿入・削除 |
| `mark.set` | 文字範囲の書式・リンクを設定または解除 |
| `paragraph.set` | 段落・見出し・揃えを変更 |
| `list.set` | 箇条書き・番号付きリスト・通常段落を切り替え |
| `table.insert` | 行数・列数を指定して表を挿入 |
| `image.insert` / `image.update` | 埋め込み画像を追加・更新 |
| `pageBreak.insert` | 明示的な改ページ |
| `block.delete` | IDでブロックを削除 |
| `document.update` / `document.replace` | タイトル・用紙を変更、または文書全体を置換 |
| `transaction.apply` | ProseMirrorのJSON Stepを一括適用 |

`transaction.apply` はProseMirrorを組み込む場合の低水準入口です。通常の操作には専用コマンドを使ってください。Stepの適用後も文書スキーマと保存可能な内容を検証します。

## 取得と位置

`getDocumentText(document)` は本文の文字列、`getBlocks(document)` はブロック一覧、`getBlock(document, id)` は指定ブロック、`getImages(document)` は画像ブロックを返します。ブロック情報には `id`、`node`、`from`、`to`、`contentFrom`、`contentTo` があります。

位置は現在の文書に対するProseMirrorの位置です。最初の段落の先頭は `1` で、ブロックの開閉境界も数えます。編集後に続けて操作する場合は、新しい位置を取得するか、直前の編集を反映した値を使います。

## ローカルの履歴

```ts
import { createDocumentSession } from "@likex/document/model";

const session = createDocumentSession();
session.execute({ type: "text.insert", from: 1, text: "下書き" });
session.undo();
session.redo();
session.markSaved();
const { document, dirty, canUndo } = session.getSnapshot();
```

セッションは選択・Undo／Redo・未保存判定を管理します。`select` で選択を更新しても文書内容は変わりません。`markSaved` は保存基準を更新し、`discard` は保存基準へ戻します。外部への保存・認証は呼び出し側が担当します。

## 表示中の文書を操作する

`DocumentHandle` の `getDocument` / `getSelection` で状態を取得し、`select` / `execute` / `undo` / `redo` で操作します。`execute` は非同期で、表示中の編集許可・機能設定・履歴を通ります。適用できない場合は `null` を返すことがあります。

`save` / `discard` は保存状態を操作します。`importNative` / `exportNative` はDCON、`importDocx` / `exportDocx` はDOCX入出力です。純粋なDOCX APIとrefの戻り値は異なるため、[DOCX入出力](docx.md)も確認してください。
