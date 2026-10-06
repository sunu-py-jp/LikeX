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
| `shape.insert` / `shape.update` | Officeプリセット図形を追加・更新 |
| `canvas.insert` / `canvas.update` | 描画キャンバスの追加・寸法変更 |
| `canvas.shape.insert` / `canvas.shape.update` / `canvas.shape.delete` | キャンバス内の図形を追加・変更・削除 |
| `canvas.connector.insert` / `canvas.connector.update` / `canvas.connector.delete` | キャンバス内の接続線を追加・変更・削除 |
| `pageBreak.insert` | 明示的な改ページ |
| `block.delete` | IDでブロックを削除 |
| `document.update` / `document.replace` | タイトル・用紙を変更、または文書全体を置換 |
| `transaction.apply` | ProseMirrorのJSON Stepを一括適用 |

`transaction.apply` はProseMirrorを組み込む場合の低水準入口です。通常の操作には専用コマンドを使ってください。Stepの適用後も文書スキーマと保存可能な内容を検証します。

## 取得と位置

`getDocumentText(document)` は本文の文字列、`getBlocks(document)` はブロック一覧、`getBlock(document, id)` は指定ブロック、`getImages(document)` は画像ブロック、`getShapes(document)` / `getShape(document, id)` は図形ブロックを返します。図形内のテキストも `getDocumentText` に含みます。ブロック情報には `id`、`node`、`from`、`to`、`contentFrom`、`contentTo` があります。

`getDocumentPage(document, pageNumber = 1)` は `DocumentPageInfo`（`{ pageNumber, from, to }`）を返します。明示的な `page_break` を表・リスト内も含めて文書順に数え、`from` / `to` は改ページノード自体を除くProseMirror位置です。連続・末尾の改ページによる空白ページも含みます。存在しないページは `undefined`、1以上の安全な整数でない番号は例外です。フォント計測による自動改ページやWordの印刷ページ数は計算しません。

位置は現在の文書に対するProseMirrorの位置です。最初の段落の先頭は `1` で、ブロックの開閉境界も数えます。編集後に続けて操作する場合は、新しい位置を取得するか、直前の編集を反映した値を使います。

`await collectDocumentImages(document, { signal? })` は、同一バイト列の画像をSHA-256でまとめた `images` と、本文・表・リスト内の全画像ブロックの `placements` を返します。画像の表示サイズが違っても本体が同じなら共通の `imageId` になります。ブロックID・ProseMirror位置は保持し、描画に依存するページ番号は生成しません。[画像の収集と重複判定](image-analysis.md)にホスト解析とキャッシュの例があります。

## キーワードで探す

```ts
import { searchDocument } from "@likex/document/model";

const result = searchDocument(document,
  { keywords: ["企画", "予算"], operator: "and", matchCase: false },
  { matchBy: "page", limit: 1000 });
for (const hit of result.matches) {
  console.log(hit.pageNumber, hit.blockId, hit.text);
  // hit.matches[0].from / to は画面の select に使えるProseMirror位置。
  // hit.matches[0].textFrom / textTo はhit.text内のUTF-16文字位置。
}
console.log(result.truncated);
```

`searchDocument` はReact・DOM・描画を使わず、検証済みモデルの本文を検索します。DCONは `parseDocument`、DOCXは `importDocumentDocx` でモデルへ変換してから渡します。複数ファイルをまとめる処理や検索結果の保存は利用側で行います。

`KeywordSearchQuery` の `keywords` は複数の文字列、`operator` は `and`（既定）/ `or`、`matchCase` は大文字小文字の区別（既定false）です。正規表現ではなく文字列をそのまま検索します。空配列は一致なし、空文字キーワードはエラーです。キーワードは64個以内、各4,096文字以内、合計16,384文字以内です。

既定の `matchBy: "page"` は、明示改ページで区切る同じページ内に全キーワードがあればAND成立とします。別々の段落や図形に分かれていても一致し、そのページ内でキーワードを含む場所を返します。`matchBy: "block"` は段落・見出し・個々の図形内で判定します。どちらも単独のキーワードを段落・図形の境界でつなげず、改ページをまたいだ一致も作りません。表・リスト内の本文を含み、段落内は書式の境界をつなぎ、改行は `\n` として検索します。

`DocumentSearchResult` は `{ matches, truncated }` です。各 `DocumentSearchMatch` は次の情報を持ちます。

| フィールド | 内容 |
| --- | --- |
| `pageNumber` / `blockId` | 1始まりの明示改ページ番号と保存済みブロックID |
| `kind` | `paragraph` / `heading` / `shape` / `canvas-shape` |
| `canvasShapeId` | 描画キャンバス内の図形ID。該当する場合のみ |
| `from` / `to` | 段落・見出しの本文範囲、または図形・キャンバスのノード選択範囲。ProseMirror位置 |
| `text` | その場所の検索対象文字列 |
| `matches` | `{ keyword, textFrom, textTo, from, to }` の一致位置一覧 |

内側の `matches` にある `textFrom` / `textTo` は `text.slice(textFrom, textTo)` に使うUTF-16位置です。`from` / `to` は段落・見出しでは一致文字そのもののProseMirror位置、図形・キャンバスでは親ノード全体の選択範囲です。キャンバス内図形は `blockId` と `canvasShapeId` で区別します。文字列の位置をProseMirror位置として流用しないでください。範囲の終端はいずれも含みません。

`limit` は返す場所の数で、既定1,000・最大10,000です。AND／ORの合否はページ全体を調べてから判定し、場所数が上限を超えた場合は `truncated: true` で知らせます。1つの文字列の一致位置が10,000件、返す一致位置の総数が100,000件を超えると例外になります。無効なモデル・検索条件・オプションも例外になり、入力モデルは変更しません。

文書タイトル・画像の代替テキスト・画像内の文字は検索対象に含めず、OCRは行いません。図形とキャンバス内図形の保存済みテキストは含めます。ページ番号はWordのフォント計測による自動改ページとは異なります。

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

`initialPageNumber` はマウント時だけ読み取り、`goToPage(pageNumber)` は表示中の明示改ページ区切りのページへ移動します。移動は選択位置とスクロールを更新し、フォーカスを奪わず、読み取り専用でも使えます。文書・履歴・未保存状態・編集許可は変更しません。無効な番号や存在しないページは通知して `false`、移動を受け付けた場合は `true` を返します。通常表示は連続した本文で、厳密なWordの印刷ページへの移動ではありません。

`save` / `discard` は保存状態を操作します。`importNative` / `exportNative` はDCON、`importDocx` / `exportDocx` はDOCX入出力です。純粋なDOCX APIとrefの戻り値は異なるため、[DOCX入出力](docx.md)も確認してください。

読み込みと同時に移動する場合は `DocumentImportOptions` の `pageNumber` を渡します。

```ts
await ref.current?.importNative(dconFile, { pageNumber: 2 });
await ref.current?.importDocx(docxFile, { pageNumber: 2 });
```

変換後の文書に指定ページがあることを適用前に確認します。番号やページが不正なら旧文書・選択・履歴を維持し、画面に通知します。成功時は文書と選択を一括で適用するため `onChange` から新しい選択を読めます。読み込みの編集許可・機能設定・キャンセルは既存と同じで、読み取り専用では文書を置き換えません。閲覧用途はホストで `parseDocument` / `importDocumentDocx` を実行し、そのモデルと `initialPageNumber` を渡します。表示中のページだけを変える場合は `goToPage` を使ってください。ページ番号は保存形式・純粋な入出力オプションには追加しません。

## Officeプリセット図形

```ts
const result = executeDocumentCommands(document, {
  type: "shape.insert", at: 0, preset: "bentArrow", text: "確認から承認へ",
  width: 260, height: 140, fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2,
});
const shape = getShapes(result.document)[0];
const edited = executeDocumentCommands(result.document, {
  type: "shape.update", id: shape.id, text: "差し戻し", preset: "uturnArrow",
});
```

`preset` は `OfficeShapePreset` の39種。`@likex/core/office-shapes` の `OFFICE_SHAPE_PRESETS` からラベル付き一覧を取得できます。寸法と線幅はpx、回転は度、文字サイズはpt。塗りと線を消す場合は `fill: null` / `stroke: null`。`shape.update` は指定した属性だけを変更します。幅だけの変更で高さは変えません。挿入結果の `selection` は新しい図形を選択し、図形の削除は `block.delete` を使います。

## 描画キャンバスと自動直交コネクタ

```ts
import { getCanvases, getCanvas, getDocumentCanvasConnectorRoute } from "@likex/document/model";

const inserted = executeDocumentCommands(document, {
  type: "canvas.insert", at: 0, width: 600, height: 360,
  shapes: [
    { id: "entry", preset: "roundRect", text: "受注登録", x: 30, y: 40, width: 150, height: 80 },
    { id: "approval", preset: "diamond", text: "承認", x: 360, y: 200, width: 150, height: 90 },
  ],
  connectors: [{
    id: "approve-route", routing: "elbow",
    start: { x: 0, y: 0, binding: { targetId: "entry", port: "right" } },
    end: { x: 0, y: 0, binding: { targetId: "approval", port: "left" } },
    endArrow: "triangle",
  }],
});
const canvas = getCanvases(inserted.document)[0];
const moved = executeDocumentCommands(inserted.document, {
  type: "canvas.shape.update", canvasId: canvas.id, id: "approval", patch: { x: 390, y: 120 },
});
const current = getCanvas(moved.document, canvas.id)!;
const route = getDocumentCanvasConnectorRoute(current.node.attrs, current.node.attrs.connectors![0]);
// route.points: 自動計算した折れ線の頂点、route.bounds: 経路の矩形
```

`getCanvases` / `getCanvas` はキャンバスのID・現在位置・保存属性を返します。図形・接続線のIDは同じキャンバス内で一意です。内部図形の座標・寸法はpxで、通常のインライン図形と同じ39種類と書式を利用します。`canvas.shape.insert` の `shape.id`、`canvas.connector.insert` の `connector.id` は省略すると生成します。

更新は `canvasId`、内部要素の `id`、変更する属性だけを含む `patch` で指定します。`canvas.update` はブロックの `id` と幅・高さを受け取ります。`block.delete` はキャンバス全体を削除します。1キャンバスにつき図形・接続線はそれぞれ最大500個、幅・高さは1〜16,384 pxです。一括コマンドは全体を検証してから返し、失敗時に入力を変更しません。

端点は `{ x, y, binding?: { targetId, port } }`。`binding` があれば現在の接続先から座標を解決します。接続点は `top` / `topRight` / `right` / `bottomRight` / `bottom` / `bottomLeft` / `left` / `topLeft`。未接続の端点は指定座標を使います。`routing` は既定の `elbow` または `straight`。矢印は `startArrow` / `endArrow` に `none` / `triangle` / `openArrow` / `diamond` / `oval` / `stealth` を指定します。既定は始点なし・終点三角です。

図形の移動や寸法変更後は接続された端点を更新します。図形削除時は最後の端点位置を保持して接続を解除します。`getDocumentCanvasTarget(shape)` は共通コネクタ用の位置・輪郭情報を返します。接続先は同じキャンバスに限り、他の図形の回避や別キャンバスをまたぐ線は扱いません。
