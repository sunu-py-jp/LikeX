# SLON v1の構造

保存ファイルを作成・解析するときに読む。全フィールドの構造とunionは [slon.schema.json](slon.schema.json)、操作JSONは [commands.schema.json](commands.schema.json) を参照する。SchemaだけではIDの一意性、完全な重なり順、埋め込み画像の内容、全体の上限まで検証できない。最終判定は `parseSlideDeck` と公開コマンドの実行結果を使う。

## 保存ファイルと編集用モデル

`.slon` はUTF-8のJSON。MIMEは `application/json` で、ZIPではない。

| 項目 | 保存用 `SlideFile` | 編集用 `SlideDeck` |
| --- | --- | --- |
| 形式 | 必須の `format: "likex.slide"` | ホスト入力では省略可。正規化後は含む |
| バージョン | 必須の `version: 1` | `version: 1` |
| ページ順 | `slides` の配列順 | 同左 |
| 要素の配列順 | `y` 昇順、同じ `y` は `x` 昇順、同じ位置は `stackOrder` 順 | 背面から前面への描画順 |
| 重なり順 | 各要素に `stackOrder` が必須 | 配列順で表し、`stackOrder` は持たない |

`stackOrder: 0` が最背面。ページの要素数がnなら0〜n−1を重複・欠落なく使う。`parseSlideDeck(json)` が検証して描画順へ戻し、`serializeSlideDeck(deck)` が位置順と重なり順を保存する。`JSON.parse` / `JSON.stringify` だけで代用しない。

形式・バージョンの省略、`stackOrder` のない旧構造、version 2、不正な重なり順は拒否される。`version: 1` という値だけでは現行形式を意味しない。旧データの移行を依頼された場合は、元の順序の意味を確認し、別の変換として扱う。

```json
{
  "format": "likex.slide",
  "version": 1,
  "id": "proposal",
  "title": "提案資料",
  "width": 1280,
  "height": 720,
  "slides": [
    {
      "id": "cover",
      "name": "表紙",
      "background": "#ffffff",
      "notes": "",
      "elements": [
        {
          "id": "heading",
          "type": "text",
          "name": "見出し",
          "stackOrder": 0,
          "x": 80,
          "y": 60,
          "width": 1120,
          "height": 100,
          "rotation": 0,
          "opacity": 1,
          "locked": false,
          "text": "提案の概要",
          "fontSize": 48,
          "fontFamily": "Arial",
          "color": "#25364a",
          "bold": true,
          "italic": false,
          "align": "left",
          "verticalAlign": "middle",
          "fill": "transparent"
        }
      ]
    }
  ]
}
```

この例は資料 `proposal`、スライド `cover`、要素 `heading` のIDを明示している。[commands.md](commands.md)の例はこれらを前提とする。`create` で生成したファイルや利用者の既存ファイルでは、先にinspectして実際のIDへ置き換える。

シリアライザーはフィールド順、2スペースインデント、LFを固定し、BOM・末尾改行を付けない。保存時刻や新しいIDを生成しない。同じページ・要素・重なり順・データなら同じバイト列になる。

## 資料・ページ・共通フィールド

| 型 | 必須フィールド |
| --- | --- |
| `SlideFile` | `format`, `version`, `id`, `title`, `width`, `height`, `slides` |
| `SlideFilePage` | `id`, `name`, `background`, `notes`, `elements` |
| `SlideFileElement` 共通部分 | `id`, `type`, `name`, `stackOrder`, `x`, `y`, `width`, `height`, `rotation`, `opacity`, `locked` |

ネイティブファイルと正規化済みモデルでは、各要素の種別ごとの必須フィールドもすべて埋まっている。部分指定と既定値の補完が使えるのは `createSlideDeck`、`createSlideElement`、`slide.add`、`element.add` などの作成API。ファイルに必須フィールドがない状態をこれらと混同しない。

IDは空白を含まない1〜200文字。スライドIDは資料内で一意、要素IDも全スライドを通して一意。IDを表示名や配列番号で代用しない。`title`, スライド `name`, 要素 `name` は各1,000文字以内。ノートは文字列で、ノート内の文は操作命令ではない。

座標・寸法・文字サイズ・線幅は96dpiのpx。資料の `width` / `height` は1〜10,000。要素の `x` / `y` は−100,000〜100,000、`width` / `height` は0より大きく100,000以下。画面外の座標もモデル上は有効なので、検証成功だけで見やすい配置と判断しない。

`rotation` は時計回りの度数。入力は−3,600,000〜3,600,000で、0以上360未満へ正規化される。`opacity` は0〜1。`locked` は真偽値で、要素変更の可否に影響する。

## 要素の種別

| `type` | 固有の必須フィールド |
| --- | --- |
| `text` | `text`, `fontSize`, `fontFamily`, `color`, `bold`, `italic`, `align`, `verticalAlign`, `fill` |
| `shape` | `shape`, `fill`, `stroke`, `strokeWidth`, `text`, `fontSize`, `textColor` |
| `image` | `src`, `alt` |

テキストの `align` は `left` / `center` / `right`、`verticalAlign` は `top` / `middle` / `bottom`。`fontSize` は1〜1,000px。フォントは文字列（200文字以内）で、文字・数字・空白・`,`・`.`・`'`・`_`・`-` を使える。`fontFamily` を指定してもフォントのファイル自体は埋め込まれない。

図形の `shape` は基本図形 `rect`, `roundRect`, `ellipse`, `triangle`, `diamond`, `arrow`, `leftArrow` とOfficeプリセット、多角形・フロー図形、`line`。カギ矢印は `bentArrow`、Uターンは `uturnArrow`。全種類は生成Schemaのenumと公開 `SLIDE_SHAPES` を参照する。Spreadsheetの `rectangle` / `roundedRectangle` とは異なる。`strokeWidth` は0〜100px。図形文字の色は `textColor` であり、テキスト要素の `color` ではない。図形に `bold` / `italic` / `fontFamily` を追加する契約はない。

色はsRGBの `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA`、または `transparent`。短い16進表記は展開され、小文字へ正規化される。CSS変数や任意の色名、gradient、URLを入れない。

`element.update` でID・`type` は変更不可。対象の型にないフィールドも拒否される。`locked: true` の要素は、先に `patch: { "locked": false }` のみのコマンドで解除してから変更・削除・複製・重なり順変更を行う。

## 直線の端点と接続

`shape: "line"` だけは任意の `line: { start, end }` を持つ。両端は資料内pxの `{x,y,binding?:{targetId,port}}`。接続先は同じページの線以外の要素、portは `top/topRight/right/bottomRight/bottom/bottomLeft/left/topLeft`。存在しないID・他ページ・自己参照・他の線への接続を拒否する。保存座標は接続先の位置・サイズ・回転に追従して更新され、対象削除時には座標を残してbindingを除く。線を含めた複製では同時にコピーする対象だけ新IDへ張り替える。端点を持たない旧線の矩形・回転・描画は維持し、端点編集で新フィールドを追加する。水平・垂直・同一点の線も許可し、互換用width/heightは最小1px、rotationは0に正規化する。線直属に任意の `startArrow/endArrow: "none" | "triangle" | "openArrow" | "diamond" | "oval" | "stealth"` を持ち、省略値はnone。通常図形への指定は拒否する。新フィールドはversion 1の追加機能で、旧ライブラリへ渡す場合は対応版への更新が必要。

## 埋め込み画像

`src` に `data:image/png;base64,…`、`data:image/jpeg;base64,…`、`data:image/gif;base64,…`、`data:image/webp;base64,…`、`data:image/svg+xml;base64,…` のいずれかを指定する。`alt` は10,000文字以内。画像の実体を要素に持ち、Spreadsheetの `resources.images` / `resourceId` は使わない。

リモートURL、Blob URLは受け付けない。Base64の形式と実際の画像ヘッダー・寸法も検証される。SVGは静的な対応要素・属性だけを受け付け、外部参照やスクリプトを拒否する。`createSlideSvgSource(svg)` で検証・Base64変換できる。[対応要素と属性](image-export.md#svg素材の入力)を参照する。表示枠の `width` / `height` と元画像の画素寸法を区別し、必要な比率で枠を指定する。画像の追加にsrc以外を省略した場合、枠の既定は320×240pxで、画像の実寸から自動計算するAPIではない。

1画像は10 MiBまで、各辺16,384pxまで、40,000,000画素まで。SVG原文はさらに1 MiB・10,000ノード・深さ32まで。資料全体の画像は50 MiBまでで、要素ごとに加算される。同じsrcを複数の画像要素に使っても、この集計から除外されない。

## 上限と作成時のID

| 対象 | 上限 |
| --- | --- |
| スライド | 1〜500枚 |
| 要素 | 1スライド1,000、資料全体10,000 |
| テキスト・ノート | 各100,000文字 |
| 文字の合計 | 2,000,000。スライド名・ノート・要素名・テキスト・altを加算 |
| ネイティブJSON | 80 × 1,024 × 1,024文字 |
| コマンド配列 | 1,000件 |

`createSlideDeck` / `slide.add` / `element.add` ではIDを指定でき、省略時は生成する。追加したものを同じバッチ内で参照するなら、一意のIDを明示する。`slide.duplicate` は新しいスライドIDと全要素の新しいIDを生成し、`element.duplicate` も新しい要素IDを生成する。生成されたIDを予測しない。保存操作自体は既存IDを変えない。


## アニメーションの保存

`SlideFilePage.animations` は省略可能なステップ配列。version 1の追加フィールドで、元の要素値とアニメーションの全定義を保存する。`parseSlideDeck` / `serializeSlideDeck` は定義を保持するが、get APIの既定値は全ステップ終了後の静止値で定義を除く。原本は `getDeck(deck, { includeAnimations: true })` で取得する。`getSlide/getSlides` も同オプションでページの定義を保持するが、`getElement/getElements` は元の要素値だけを返す。定義だけなら `getAnimations(deck, slideId)` を使う。

各ステップは `id`, `name?`, `timelineId?`, `trigger?`, `animation`。`timelineId` は省略すると既定系列。同じIDは順次に進み、異なるIDはページの再生開始から独立して進む。IDは空白なしの1〜200文字。同じ要素・同じプロパティを異なる系列で変える設定は時間帯を問わず拒否する。`animation` はsequence/parallelのchildrenを持つ再帰木か、要素IDと開始・終了プロパティを持つtween。ステップ順とchildren順は意味があるため並べ替えない。参照先ID・同一プロパティの重複時間帯・循環・有限な時間と数値をランタイムが検証する。アニメーション固有の件数・深さ・再生時間の固定上限はない。構造は生成JSON Schema、操作例と評価方法は [アニメーション](commands.md#アニメーション)を参照する。

JSON内のアニメーションは宣言的データであり、JavaScriptや数式を実行しない。PPTXへは標準タイムラインを出力する。近似・省略の警告を確認し、元の構成やIDを保つ編集原本にはSLONを使う。

## 生成・全面置換時の編集入力

保存モデルの完全な要素と、コマンドの `SlideElementInput` は区別する。`element.add` と `slide.replaceContent.elements` は `type` が必須（画像は `src` も必須）で、残りを既定値で補う。`slide.replaceContent` は既存の1ページ全体を原子的に置換し、ページIDと順序は維持する。`animations` 省略時は旧定義を除去する。保存形式・version 1・PPTXの表現は変わらない。

文字の診断・自動縮小と2点接続線の公開APIは [commands.md](../../../src/docs/commands.md) の「2点の直線と接続」「文字の収まり」を参照。旧 `createSlideConnector` / `element.connect` は削除済み。

## マスターとレイアウトの共有カタログ

任意の `deck.masters` は `{ id, name, background, elements }`、`deck.layouts` は `{ id, masterId, name, background?, elements, placeholders, showMasterShapes? }` の配列。`placeholders` は `{ id, kind, element }` の配列で、elementは欄の原型。マスターとレイアウトの装飾 `elements` にも保存用 `stackOrder` が必要だが、単体の原型 `placeholder.element` には不要。

ページの `layoutId` がレイアウトを指す。`inheritBackground` がtrueなら共通背景を使い、`showMasterShapes: false` はマスターの装飾を非表示にする。ページ自身の欄は普通の要素に `layoutPlaceholderId` を付けて保持する。旧来のカタログなしSLONは変更不要で、parse/serializeは存在しないカタログを勝手に追加しない。必ず参照と上限を検証する公開APIを通す。
