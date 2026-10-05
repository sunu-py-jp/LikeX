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

位置は現在の文書に対するProseMirrorの位置です。最初の段落の先頭は `1` で、ブロックの開閉境界も数えます。編集後に続けて操作する場合は、新しい位置を取得するか、直前の編集を反映した値を使います。

`await collectDocumentImages(document, { signal? })` は、同一バイト列の画像をSHA-256でまとめた `images` と、本文・表・リスト内の全画像ブロックの `placements` を返します。画像の表示サイズが違っても本体が同じなら共通の `imageId` になります。ブロックID・ProseMirror位置は保持し、描画に依存するページ番号は生成しません。[画像の収集と重複判定](image-analysis.md)にホスト解析とキャッシュの例があります。

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
