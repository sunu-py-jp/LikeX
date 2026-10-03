# DCONの構造

標準拡張子は `.dcon`、UTF-8のJSON。`DocumentModel` が保存構造で、`format: "likex.document"` と `version: 1` が必須。専用のparse／serialize APIを使う。

```json
{
  "format": "likex.document",
  "version": 1,
  "id": "document-1",
  "title": "企画書",
  "page": {
    "width": 210,
    "height": 297,
    "margins": { "top": 20, "right": 20, "bottom": 20, "left": 20 }
  },
  "content": {
    "type": "doc",
    "content": [
      { "type": "heading", "attrs": { "id": "heading-1", "level": 1, "align": "left" }, "content": [{ "type": "text", "text": "企画書" }] },
      { "type": "paragraph", "attrs": { "id": "body-1", "align": "left" }, "content": [{ "type": "text", "text": "本文" }] }
    ]
  }
}
```

本文の順序は `content` 配列で保持する。段落・見出し・リスト・表・画像・図形・改ページを含み、ブロックのIDは `attrs.id` にある。新規ブロックにIDを省略した場合は正規化で割り当てられる。既存のIDと文書構造は編集コマンドで維持する。

上の見出しは `from: 0`、文字範囲は `contentFrom: 1` から `contentTo: 4`。段落は `from: 5`、本文範囲は `6` から `8`。この位置は例だけに対応するため、実ファイルではinspectし直す。

用紙・余白はmm、文字の `text_style.attrs.fontSize` はpt、画像の幅・高さはpx。文字書式は `marks`、段落の揃えは `attrs.align`。画像はPNG／JPEGの埋め込みdata URLで、外部URLを自動取得しない。

全ノード・書式・属性は [DCON JSON Schema](dcon.schema.json) を参照する。JSON Schemaは位置の有効性・文書スキーマの親子関係・画像の実体を保証しないため、最後にCLIの `validate` か `parseDocument` で確認する。選択・履歴・未保存状態・UI設定はファイルに保存しない。

図形は `{ "type": "shape", "attrs": { "preset": "bentArrow", "text": "承認", "width": 240, "height": 140 } }`。`content` を持たず、安定IDを `attrs.id` に保持する。`fill` / `stroke` はRGBまたはnull、`strokeWidth` はpx、`rotation` は度、`flipH` / `flipV` はboolean、`color` は文字色、`fontSize` はpt。未指定属性は既定値を補う。既存version 1への追加ノードで、図形非対応の旧版へ渡す場合は利用側の更新が必要。


描画キャンバスは `{ "type": "drawing_canvas", "attrs": { "id": "canvas-1", "width": 600, "height": 360, "shapes": [], "connectors": [] } }`。本文中のatomブロックで `content` は持たない。`shapes` は通常図形の属性にキャンバス内の `id` / `x` / `y` を加えた配列。`connectors` は `id`、`start` / `end` の `{x,y,binding?}`、`routing`、線色・幅・矢印を保存する。`binding` は同じキャンバス内の図形IDと接続点を参照する。折れ線の頂点自体は保存せず、現在の図形の位置から共通ルーターで再計算する。既存のインライン `shape` は従来通り使える。version 1への追加であり、キャンバス非対応の旧版には利用側の更新が必要。
