# 文書コマンド

`commands.json` はコマンド配列。`executeDocumentCommands(document, commands)` を使い、結果の `document` を `serializeDocument` で保存する。CLIは同じAPIを呼び、書き込み前に文書全体を検証する。

下の例は [DCONの例](schema-guide.md) の文書をそれぞれ初期値として使う。実際のブロックIDと位置は `inspect` で取得する。

## 文字と書式

`text.insert` は `from` に挿入し、`to` を指定するとその範囲を置き換える。`text.delete` は `from` から `to` までを削除。`mark.set` は `strong`、`em`、`underline`、`strike`、`text_style`、`link` を設定し、`enabled: false` で解除する。

```json
[
  { "type": "text.insert", "from": 6, "text": "新しい" },
  { "type": "mark.set", "from": 1, "to": 4, "mark": "strong", "enabled": true },
  { "type": "mark.set", "from": 6, "to": 11, "mark": "text_style", "attrs": { "fontSize": 14, "color": "#2563EB" } }
]
```

## 段落・見出し・リスト

`paragraph.set` は選択範囲の段落・見出しレベル・揃えを変更する。`list.set.kind` は `bullet`、`ordered`、`none`。リスト構造を変更すると後続の位置が変わるので、続けて編集する場合は変更後の位置を取得する。

```json
[
  { "type": "paragraph.set", "from": 1, "to": 4, "nodeType": "heading", "level": 2, "align": "center" },
  { "type": "list.set", "from": 6, "to": 8, "kind": "bullet" }
]
```

## 表・画像・改ページ

`table.insert` は `at`、`rows`、`columns` と `header` で作る。セルの本文は作成後のブロック位置から編集する。画像の `image.insert` は `at` とPNG／JPEGの `src`、必要なら `alt`・`width`・`height` を指定する。作成した画像のIDをinspectで取得し、`image.update` に `id` と変更属性を渡す。`pageBreak.insert` は指定位置に明示的な改ページを挿入する。

画像を複製する場合は `getImage(document, id)` の `to` を挿入位置とし、画像の `src`・`alt`・`width`・`height` を `image.insert` に渡す。新しいIDは実行後に取得する。`image.update` に幅だけ渡すと現在の縦横比を維持するため、GUIの縮小・拡大と同様に現在の幅へ0.8または1.25を掛けられる。表全体・画像の削除は `block.delete` を使う。表の行列変更・複製の専用コマンドはない。

```json
[
  { "type": "table.insert", "at": 9, "rows": 3, "columns": 2, "header": true }
]
```

## 文書・ブロック

`document.update` はタイトルと用紙設定を変更する。`document.replace` は検証済み文書全体へ置き換える。`block.delete` はIDで対象を指定する。

```json
[
  { "type": "document.update", "title": "企画書・改訂版", "page": { "margins": { "left": 25, "right": 25 } } },
  { "type": "block.delete", "id": "heading-1" }
]
```

## 戻り値と低水準の操作

公開APIの戻り値は `{ document, selection? }`。CLIのapply応答は文書全体や各コマンドのreceiptを返さず、保存状態・件数・概要を返す。新規IDと現在位置は適用後のinspectで取得する。例外や `ok: false` のときは結果を保存しない。

`transaction.apply` はProseMirrorのJSON Step配列と任意の `selection` を受け取る。JSON SchemaがJSONとしての構造を許容しても、実行可能なStepと文書ノードはランタイムで検証する。全引数は [commands JSON Schema](commands.schema.json) にある。

## 図形

`shape.insert` は現在位置の `at` とOfficeプリセット名を指定する。カギ矢印 `bentArrow`、上向きカギ矢印 `bentUpArrow`、Uターン矢印 `uturnArrow`、基本図形・方向矢印・フローチャートを含む39種類。全列挙はcommands JSON Schemaの `preset`、ラベルは `@likex/core/office-shapes` の `OFFICE_SHAPE_PRESETS` を使う。図形は本文中のブロックで、自由なページ座標配置ではない。

```json
[
  { "type": "shape.insert", "at": 0, "preset": "bentArrow", "text": "審査から承認", "width": 260, "height": 140, "fill": "#dbeafe", "stroke": "#2563eb", "strokeWidth": 2 }
]
```

新しいIDは適用後のinspectまたは `getShapes` で取得する。`shape.update` は `id` で指定した図形の属性だけを変更する。幅・高さ・線幅はpx、回転は度、`fontSize` はpt。塗りつぶしと線の非表示は `fill: null` / `stroke: null`、反転は `flipH` / `flipV`。`getShape(document,id)` は図形と現在位置を返す。複製は取得したattrsからidを除いて `shape.insert`、削除は `block.delete`。

DOCXではWord 2010の編集可能なDrawingMLプリセットへ変換する。浮動配置はインライン化、調整値・複雑な書式は標準化、自由図形・グループは省略の警告が出るため、import/exportの `warnings` を確認する。
