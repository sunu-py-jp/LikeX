# 自由配置の操作例

座標・寸法・書式を指定して、通常の編集可能な要素を配置する。以下は小さなAPI使用例であり、ページ構図や推奨デザインを固定するものではない。数値・色・内容は資料に合わせて決める。資料内の単位はpx、要素の矩形は `x, y, width, height`。

## 文字と図の役割を分ける

強調する見出しや数値は `text`、単純な図は `shape`、独自の曲線・イラストはSVG画像を使える。全体を一枚の画像にせず、後で変更する意味のある情報を通常要素として残す。

```json
[
  { "type": "element.add", "slideId": "proposal", "element": {
    "id": "proposal-claim", "type": "text", "text": "判断に使えるデータへ。",
    "x": 72, "y": 110, "width": 800, "height": 160,
    "fontSize": 64, "bold": true, "color": "#16212b"
  } },
  { "type": "element.add", "slideId": "proposal", "element": {
    "id": "proposal-annotation", "type": "text", "text": "構想案｜効果は導入検証で確認",
    "x": 76, "y": 300, "width": 560, "height": 48,
    "fontSize": 20, "color": "#51606e"
  } }
]
```

既存の `proposal` ページがある場合の例。対象IDは取得結果から使い、新しい要素IDは資料内で一意にする。AIホストのツールでは公開されたstrict schemaに従い、nativeコマンドの省略値をそのまま転記しない。

## ノードの接続を保持する

```json
[
  { "type": "line.add", "slideId": "proposal", "id": "source-to-decision",
    "start": { "x": 0, "y": 0, "binding": { "targetId": "source", "port": "right" } },
    "end": { "x": 0, "y": 0, "binding": { "targetId": "decision", "port": "left" } },
    "stroke": "#23695f", "strokeWidth": 2, "endArrow": "triangle"
  }
]
```

`source` と `decision` は同じページにある非線要素のID。端点は対象の移動・サイズ変更・回転に追従するが、第三の箱を自動で避けない。線は最前面へ追加される。`element.order` で前後関係を調整し、背景の下に隠したり本文を横切ったりしないようプレビューで確認する。

## ページ単位で置き換える

全面改稿は `slide.replaceContent { slideId, elements }` で一括適用できる。`elements` の配列順が背面から前面への順序になる。描きたい各要素の座標・寸法・書式を渡し、ページ種別やプリセットは指定しない。背景・ノートを省略すると保持し、アニメーションを省略すると古い定義を除去する。新しいページは `slide.add` で追加してから内容を置く。

部分修正なら `element.update` で対象のみ変更する。処理が成功しても、最後の編集後の画像で構成・文字・図を確認してから完成とする。
