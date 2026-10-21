# SPON v2の構造

保存ファイルを作成・解析するときに読む。全フィールドの構造とunionは [spon.schema.json](spon.schema.json)、操作JSONは [commands.schema.json](commands.schema.json) を参照する。Schemaだけではシート内の境界、参照の存在、値と入力規則の整合性、画像の内容まで検証できない。最終判定は `parseWorkbook` と公開コマンドの実行結果を使う。

## 保存ファイルと編集用モデル

`.spon` はUTF-8のJSON。MIMEは `application/json` で、ZIPではない。

| 項目 | 保存用 `SpreadsheetFile` | 編集用 `SpreadsheetWorkbook` |
| --- | --- | --- |
| 形式 | 必須の `format: "likex.spreadsheet"` | ホストからの入力では省略可。正規化後は含む |
| バージョン | 必須の `schemaVersion: 2`。v1は読込互換 | 正規化後は1 |
| セル | `sheets[i].rows[row].cells[columnLabel]` | `sheets[i].cells[address]` |
| 行高 | `rows[row].height` | `rowHeights[row]` |
| 列幅 | `columnWidths[column]` | 同左 |
| 共通書式 | `formatRanges` の矩形配列 | 同左。セルへ全件展開しない |

`parseWorkbook(json)` がファイルを検証・変換して編集モデルを返す。`serializeWorkbook(workbook)` が編集モデルからファイルへ変換する。`JSON.parse` / `JSON.stringify` だけで代用しない。v1の行単位ファイルは構造を検証して読み込み、再保存時はv2にする。生成Schemaは現在の出力v2を表し、読込互換の最終判定はパーサーに従う。形式・バージョン省略、シート直下の `cells` / `rowHeights` を持つ旧ファイル、未知のバージョンは拒否する。バージョン番号だけを書き換える移行は行わない。v1専用ライブラリではv2を開けない。

```json
{
  "format": "likex.spreadsheet",
  "schemaVersion": 2,
  "sheets": [
    {
      "id": "sales",
      "name": "売上",
      "rowCount": 300,
      "columnCount": 26,
      "columnWidths": { "0": 180, "1": 100 },
      "rows": [
        { "cells": { "A": { "value": "商品" }, "B": { "value": "金額" } } },
        { "height": 28, "cells": { "A": { "value": "商品A" }, "B": { "value": "1200" } } },
        {},
        { "cells": { "A": { "value": "合計" }, "B": { "value": "=SUM(B2:B3)" } } }
      ]
    }
  ]
}
```

この例は `sales` というIDを明示している。[commands.md](commands.md)の例はこのIDのブックを前提とする。`create` で生成したファイルや利用者の既存ファイルでは、先にinspectして実際のIDへ置き換える。

`rows[0]` が1行目。列キーは `A`、`B`、…、`Z`、`AA` の大文字表記で、`A1` ではない。途中の空行は `{}`、末尾の空行は省略する。表示上の大きさは `rowCount` / `columnCount` が保持する。未使用セルを空文字で埋める必要はない。ファイルを直に行挿入しても数式や定義の座標は追従しないため、構造変更には公開コマンドを使う。

シリアライザーはシート順、行・列順、フィールド順、2スペースインデント、LFを固定し、BOMや末尾改行を付けない。保存のためにIDや日時を生成しない。同じデータとIDなら同じバイト列になる。

## ルート・シート・セル

| 型・場所 | フィールド |
| --- | --- |
| `SpreadsheetFile` | `format`, `schemaVersion`, `sheets`。任意の `resources`, `namedRanges` |
| `SpreadsheetFileSheet` | `id`, `name`, `rowCount`, `columnCount`, `rows`。任意の `columnWidths`, `formatRanges`, `drawings`, `comments`, `merges`, `conditionalFormats`, `tables` |
| `SpreadsheetFileRow` | 任意の `height`, `cells`。それ以外の行フィールドはない |
| `SpreadsheetCell` | `value: string`、任意の `format`, `validation` |

数値も `"1200"`、真偽値も `"TRUE"` / `"FALSE"`、数式も `"=SUM(B2:B3)"` として保存する。通常、先頭 `=` は数式として解釈する。文字列として扱う値は先頭アポストロフィや `numberFormat: "text"` を意図に合わせて用い、利用者の文字列表記を勝手に数値へ変換しない。計算結果は保存値ではなく `calculateWorkbook(workbook)` から取得する。

`sheet.id` はブック内で一意。シート名は1〜31文字で、大文字・小文字を無視して一意。`[ ] : * ? / \\`、制御文字、先頭・末尾のアポストロフィは使えない。表示名の変更でIDは変わらない。

## 範囲に共通する書式

`sheet.formatRanges` は `{ range: { top, left, bottom, right }, format }[]`。座標は0始まり・両端を含む。`bottom` / `right` は整数または `"end"` で、`"end"` はシートの現在の末尾を指し、シートを拡張しても末尾へ追随する。異なる範囲を重ねず、終端罫線など書式が違う箇所は別の矩形に分ける。範囲をセルへ全件展開しない。

`"end"` の書式patchを、現在の末端まである有限の異なる書式範囲に重ねると、見た目を保つ分割によりその部分が有限範囲として残る場合がある。その部分は後から追加した末端セルへ追随しない。通常の `"end"` 範囲は追随するが、編集後の実際の `formatRanges` の終端を確認し、すべての重なりで追随すると仮定しない。

各 `format` は完全な `SpreadsheetCellFormat`。値・数式・入力規則はセルに保存する。`cell.format` がないときは範囲書式を使い、あるときはその完全な書式で置き換える。`format: {}` は正規化で省略され、範囲書式を継承する。標準書式への完全な上書きは `format: { numberFormat: "general" }` とし、範囲の背景・罫線などを継承しない。公開clear・書式patchによる解除は共通範囲から対象部分を差し引く。色だけを変える例外でも他の配置・罫線を保持するには完全な書式を保存するか `cells.format` を使う。異なるセルの例外を範囲内へ勝手に吸収しない。

XLSX取り込みの標準モードは同じ内容の空セル書式を横run・縦結合でまとめる。行・列全体の書式は `right: "end"` / `bottom: "end"` として保持し、明示的なセル書式を優先する。XLSX出力では全行・全列の書式を行・列属性へ、有限矩形を行ごとのセル書式へ戻す。セルのモデルを全件生成しないが、有限範囲の大きさに応じてXML量とCPU負荷が増える。

例: I1:Y100を1件、同じ背景に右罫線を持つZ1:Z100を1件として保存する。有限範囲と末尾までの指定の詳細は [SPON保存形式](../../../src/docs/native-files.md#同じ書式を範囲で保存する)を参照する。

## 書式・入力規則・条件付き書式

`SpreadsheetCellFormat` の全フィールド:

- 文字: `bold`, `italic`, `underline`, `fontFamily`, `fontSize`, `color`。
- 横位置: `align`（`general` / `left` / `center` / `right` / `fill` / `justify` / `centerContinuous` / `distributed`）。省略・`general` は値の型で配置を決める。`fill` は表示文字列を反復し、右側に続く同じ配置の空白セルにも表示する。`justify` はセル幅で折り返して最終行以外を両端揃え、`distributed` は折り返して最終行を含めて均等割り付けする。値や `wrap` は変更しない。
- 縦位置: `verticalAlign`（`top` / `middle` / `bottom` / `justify` / `distributed`）。SPONの省略値は従来どおり上下中央。縦の `justify` は複数行の間隔を広げ、`distributed` は行の上下にも余白を配る。1行の場合はそれぞれ上詰め・上下中央。XLSXの縦中央 `center` はモデルの `middle` に対応する。
- インデント: `indent` は0〜250の整数、省略は0。横の `left` / `right` / `distributed` に適用し、他の配置でも設定値自体は保持する。表示は1段階をスペース3個分として近似し、Excelの標準フォントの計測結果と一致する保証はない。
- 文字の表示・背景: `wrap`, `shrinkToFit`, `background`。`wrap` / `shrinkToFit` はbooleanで、省略・両方falseは標準の空白セルへのはみ出し表示。折り返しは `{ wrap: true, shrinkToFit: false }`、セル幅に縮小する場合は `{ wrap: false, shrinkToFit: true }`。両方trueなら折り返しを優先し、保存フラグは保持する。縮小で `fontSize` や保存値は書き換えない。
- 表示形式: `numberFormat`（`general`, `text`, `number`, `currency`, `percent`, `date`, `time`, `datetime`）、`decimalPlaces`（0〜10）、`useGrouping`、`negativeFormat`（`minus`, `parentheses`, `red`, `red-parentheses`）。
- `borders`: `top` / `right` / `bottom` / `left` の各辺に `{ style?, width?, color? }`。`style` は `none` / `solid` / `dashed` / `dotted` / `double`、`width` は1 / 2 / 3。空の `borders: {}` は辺を消す指定に使える。

`centerContinuous` は、値を持つセルと、その右に続く同じ横位置の空白セルを使って中央に表示する。範囲の空白セルにも同じ書式を保存し、途中の値・数式・異なる配置・結合などで区切る。数値・真偽値にも適用し、値の移動・複製や結合情報の追加は行わない。XLSXでも空白セル側の配置を保持する。

空白セルにはみ出す文字に重なる内部の縦線は表示上隠し、上下や文字が届かない線は残す。保存した `borders` は変更せず、SPON・XLSXで保持する。

セル文字サイズはCSSピクセル（1〜200）。列幅・行高はともに1〜1,000px。色には `#RRGGBB` を使うと意図が明確になる。Spreadsheetの描画色・セル色の検証契約はSlideの16進色限定契約と同じではない。

標準セルの余白は左右各2px、行間は文字サイズの1.2倍。これらは表示・自動調整の基準で、SPONのセル書式フィールドではない。折り返しやXLSX取り込みで保存行高を自動的に広げず、必要な対象へ `dimensions.autoFit` を実行する。XLSXの行高はptとCSS pxを0.75倍で相互変換する。列幅は、ブラウザー入口とGUI／Handleではブックの標準（Normal）フォントを計測し、端末ピクセルで丸めてからCSS pxへ戻す。`/model` は `columnWidthMeasurement` の注入を受け付け、未指定・未計測ならCalibri 11pt・96dpi相当の最大数字幅7px、倍率1へ近似する。列幅に小数を保持でき、元の標準フォント・端末倍率はSPONに保存しない。XLSX出力はCalibri 11pt基準へ換算し、小数の列幅には量子化誤差が残る。重複する列幅指定はセル・図形とも先の有効な指定を採用する。代替フォントなどによる表示差は残るため、[Excel取り込みの制約](../../../src/docs/excel-import.md#読み込む内容と制約)も確認する。

`SpreadsheetDataValidation` は共通で `allowBlank?`（既定true）と `message?`（255文字以内）を持つ。

| `type` | 固有フィールド |
| --- | --- |
| `list` | `values: string[]`。空でない1〜1,000候補、各1,000文字以内、大文字小文字を無視して一意、合計100,000文字以内 |
| `number` | `integer?`, `min?`, `max?` |
| `textLength` | `min?`, `max?`（0〜100,000） |
| `date` | `min?`, `max?`（有効な `YYYY-MM-DD`）。セル値はISO日付またはExcelの1900日付システムの数値 |
| `checkbox` | 固有フィールドなし。値は `TRUE` / `FALSE` |

入力規則はGUIを使わない編集でも有効。空白禁止のセルは値のみクリアを拒否する。`cells.validation` の `null` で規則を解除できる。

`conditionalFormats` は各ルールに `id` と矩形配列 `ranges` を持つ。`conditionalFormats.set` は配列全体を置き換える。

| `type` | 固有フィールド |
| --- | --- |
| `comparison` | `operator`: `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, `between`, `notBetween`。`value`, `secondValue?`, `format`, `stopIfTrue?` |
| `text` | `operator`: `contains`, `notContains`, `startsWith`, `endsWith`。`value`, `format`, `stopIfTrue?` |
| `dataBar` | `color`, `min?`, `max?` |
| `colorScale` | `colors`（2色または3色）, `min?`, `max?` |

1シート最大100ルール、1ルール最大100範囲。`between` / `notBetween` は上下限を指定する。

## 結合・名前付き範囲・テーブル・コメント

共通の `SpreadsheetMergedRange` は `{ top, left, bottom, right }`。すべて0始まりの整数で両端を含み、シート内に収まる。セルの書き込みでは結合範囲の左上セルへ値を入れる。

| 場所 | 保存構造と制約 |
| --- | --- |
| `sheet.merges` | 矩形の配列。結合内の値とコメントは左上セルに置く。重複や部分的な分断は不可 |
| `workbook.namedRanges` | `{ id, name, sheetId, range }[]`。ブック全体で一意の名前・ID。1つの同一シート矩形を指す |
| `sheet.tables` | `{ id, name, range, columns: [{ id, name }] }[]`。範囲の先頭がヘッダー行。値は通常セルに保存し、列名はヘッダーの値と一致させる |
| `sheet.comments` | A1アドレスから `{ id, text, author? }` へのマップ。コメントは `rows` 内に置かない |

名前付き範囲・テーブルの名前は255文字以内、ブック内で大文字小文字を無視して一意で、互いの名前も重複不可。先頭は文字または `_`、続きは文字・数字・`_`・`.`。セル番地や予約名は不可。テーブルの列名は空欄・改行なしの255文字以内で、テーブル内で大文字小文字を無視して一意。重なるテーブルや結合と交差するテーブルは作らない。

名前付き範囲を使う数式、構造化参照式（例 `=SUM(Sales[金額])`）、フィルター・集計行は未対応。定義を追加すればこれらが使えるとは扱わない。

## 描画と埋め込み画像

`drawings` の共通フィールドは `id`, `type`, `anchor`, `width`, `height` と任意の `flipX`, `flipY`, `rotation`。`anchor` は `{ row, column, offsetX, offsetY }` で、行列は0始まり、オフセットと寸法はpx。保存アンカーには4項目が必要だが、コマンドでは省略したオフセットが0になる。

| `type` | 固有フィールド |
| --- | --- |
| `image` | `resourceId`, `alt` |
| `shape` | `shape`, `fill`, `stroke`, `strokeWidth`、任意の `text`, `fontSize`, `color`, `bold` と下記の文字レイアウト属性 |
| `text` | `text`, `fontSize`, `color`, `background`、任意の `bold` と下記の文字レイアウト属性 |

`shape` は `rectangle`, `roundedRectangle`, `ellipse`, `triangle`, `rightTriangle`, `diamond`, `parallelogram`, `trapezoid`, `rightArrow`, `leftArrow`, `upArrow`, `downArrow`, `leftRightArrow`, `upDownArrow`, `line`, `arrow`に加え、`bentArrow`, `bentUpArrow`, `uturnArrow`, `leftUpArrow`, `leftRightUpArrow`, `quadArrow`, `chevron`, `homePlate`, `pentagon`, `hexagon`, `octagon`, `star5`, `plus`、および`flowChartProcess`, `flowChartDecision`, `flowChartTerminator`, `flowChartInputOutput`, `flowChartPredefinedProcess`, `flowChartDocument`, `flowChartMultidocument`, `flowChartPreparation`, `flowChartManualInput`, `flowChartManualOperation`, `flowChartMerge`, `flowChartDelay`。カギ矢印は`bentArrow`、上向きカギ矢印は`bentUpArrow`。塗りのあるブロック図形で、2端点の接続線とは異なる。Excelの標準プリセットから取り込み、画像化せず再出力する。角丸長方形の丸み以外のOfficeの個別調整値は警告して既定形へ戻す。Slideの `rect` / `roundRect` とは異なる。

`cornerRadiusRatio?: number` は角丸長方形の短辺に対する半径の比率。有限の0〜0.5を受け付け、省略は0.16667、0は角なし。図形の直下へ置く。外形・文字領域・接続点へ反映し、SPON・コピー・Undo/Redo・XLSXで保持する。XLSXの `roundRect` の `adj` は比率×100000で、Office出力時は整数へ丸める。接続先のカスタム形状も値を保持する。

回転は時計回り、有限の値を0以上360未満へ正規化し、0は省略する。反転は正のサイズの枠内で行い、文字は読みやすい向きを保つ。オフセットは0〜10,000px、描画サイズは最大10,000px。画像サイズは正の小数を許可し、図形・テキストは1px以上。描画文字サイズは1〜400px、線幅は0〜100px。形状を変えてもIDは維持し、`type` は更新できない。

画像の実体は `resources.images[resourceId]` に次の形で保存する。

```text
{ name, mimeType, dataUrl, width, height }
```

`mimeType` は `image/png` / `image/jpeg` / `image/webp` / `image/gif`。`dataUrl` はそのMIMEと一致する `data:image/…;base64,…`。外部URL、Blob URL、SVGを入れない。`width` / `height` はエンコードされた画像ヘッダーの実寸と一致させる。JPEGのEXIF回転後の表示寸法とは区別する。画像内容・ヘッダー・Base64もランタイムで検証する。

コマンドの画像挿入は表示サイズを省略すると比率を保って最大320×240pxに収め、拡大しない。片辺だけ指定するともう片辺を比率から計算する。両辺を指定すると指定した枠を保持する。`images.update` は指定した辺だけを変更し、この自動計算を行わない。

### 描画の文字レイアウト

`SpreadsheetDrawingTextStyle` の任意属性は `shape` と `text` に共通で、描画オブジェクトの直下へ保存する。セルの `format` とは別の属性であり、`textStyle` 等のラッパーは付けない。省略した既存SPONも同じ見た目で読み込める。

| 属性 | 値・省略時の表示 |
| --- | --- |
| `fontFamily` | 空でない100文字以内のフォント名。省略時は表示環境の標準フォント |
| `italic`, `underline` | boolean。省略時false |
| `textInsets` | `{ left, top, right, bottom }`。各0〜10,000px、省略時は各0px。Excelから取り込んだ余白は保持 |
| `textWrap` | `wrap` / `none`。省略時`wrap` |
| `textOverflow`, `textVerticalOverflow` | 横／縦の `clip` / `overflow`。省略時`clip` |
| `textAlign` | `left` / `center` / `right`。省略時は図形が中央、テキストボックスが左 |
| `textVerticalAlign` | `top` / `middle` / `bottom`。省略時は図形が中央、テキストボックスが上 |
| `textAutoFit` | `none` / `shrink` / `resize`。省略時は自動調整なし |
| `textFontScale` | 0.01〜1の保存済み縮小率。省略時1。`fontSize` に掛け、`shrink` の実測縮小の上限にも使う |
| `textLineHeight` | 行高の文字サイズに対する倍率（0.1〜10）。省略時1.4 |

`shrink` はブラウザーで枠・余白・文字の小数ピクセル寸法を保って測定し、横幅と行の高さを枠内へ縮小する。その測定値で保存済みの文字サイズや縮小率を上書きしない。ヘッドレス操作は指定した属性を保持する。`resize` は文字領域を縦に拡張し、図形の外形は保存済みの大きさを維持する近似。XLSX取り込みではこの近似を警告し、再出力には自動拡大指定を残す。

XLSXのrun書式は段落・リストの既定書式から属性ごとに継承する。ただし文字ごとに異なる書式や段落ごとに異なる配置は先頭へ統一され、警告される。SPONはこの単一書式を保存するため、再出力で元の混在書式は復元しない。明示した余白・折り返し・配置・はみ出し・自動調整・行間はXLSXでも保持する。フォント自体を埋め込む機能はなく、端末の代替フォントで文字幅が変わる場合がある。

## 上限とID

| 対象 | 上限 |
| --- | --- |
| シート | 100枚、各10,000行 × 1,000列 |
| 格納セル | ブック全体100,000 |
| 範囲書式 | ブック全体100,000矩形。セルへ展開した面積とは別 |
| 1回の範囲操作・コピー | 10,000セル |
| セル文字列・描画文字列 | 各100,000文字 |
| 数式 | 4,096文字、2,048トークン。計算200,000ステップ、参照深度128 |
| 画像 | 1枚5 MiB、ブック合計20 MiB、1辺10,000px、16,000,000画素、1,000リソース |
| 描画・コメント | ブック全体1,000描画 / 10,000コメント。コメント本文10,000文字 |
| 結合・テーブル | ブック全体10,000結合 / 1,000テーブル |
| 名前付き範囲 | ブック全体1,000 |
| ネイティブJSON | 64 × 1,024 × 1,024文字 |
| コマンド配列 | 1,000件 |

上表はSPONと編集用モデルの保持上限で、不正なデータや上限超過はパース・公開コマンドで拒否する。XLSX取り込みでは補助データに限り部分回復し、不正・範囲外・重複・上限超過の結合・図形・画像・コメント・テーブル・名前などを警告付きで省略する。省略済みの結合・描画などは保持件数に含めない。空セルの宣言数では拒否せず、標準の `emptyCellFormatting: "preserve"` は同じ空セルの書式を `formatRanges` に圧縮し、有限範囲も保持する。値・数式のセルは100,000件、範囲書式は別に100,000件まで。書式範囲の保持上限を超える部分は警告して省略する。`"omit"` は空セルの通常書式を省略するため、帳票の空欄の罫線や色も失われる。値・数式・結合範囲・寸法・コメント・入力規則・描画はモードを理由に省略しない。どちらも省略した書式は警告で報告し、SPONやXLSXから復元できない。入力規則は追加セル予算と1シート累計100,000セルの処理予算に収まる規則だけを適用する。SPONのデータを勝手に切り捨ててこの回復をまねしない。[XLSXの部分回復・停止条件](../../../src/docs/excel-import.md#部分的に省略して取り込める条件)を参照する。

XLSXの取り込み用設定は保存モデルに含めない。既定では入力ファイル128 MiB、ZIPの展開後1エントリ・合計640 MiBを検証する。`limits: { inputBytes?, expandedBytes? }` は正の安全な整数のバイト数で、展開上限の省略時は入力上限の5倍。関数・Handle・親の `excelImportOptions` で指定できる。ワークシート以外で取り込みに使う内部データの読み出しは1件16 MiBまでで、未使用パートは16 MiBを超えても順次展開してCRC等を検証し、合計展開量には含める。ワークシートの読取ノード上限は展開上限÷4の切り上げ、保持XMLノード600,000を区別し、空セルの共通書式を順次まとめる。SPONモデルの格納セル数の上限とは別。

`sheets.add` / `sheets.duplicate`、描画・画像挿入、名前付き範囲・テーブル追加、コメント新規作成などのIDはライブラリが生成する。CLIでは適用後のファイルをinspectし、公開APIを直接使う場合はreceiptから取得できる。命名規則から予測しない。既存の更新ではIDを保ち、描画・シートの複製では新しいIDを持つ。保存操作そのものはIDを振り直さない。

### 線の保存構造

`shape: "line"` は任意の `line: { start: { anchor, binding? }, end: { anchor, binding? } }` と `routing?: "straight" | "elbow"`, `startArrow?`, `endArrow?` を持つ。`routing` は2端点を持つ線専用で、省略は直線。正規化ではstraightを省略し、elbowだけを保存する。折れ線の中間点は接続先に合わせて再計算し、保存しない。端点の `anchor` は同じシートのセルアンカー（行列は0始まり、offsetは-10,000〜10,000px）、bindingは `{ targetId, port }`。自由端点は行列寸法・挿入に追従し、接続端点は同シート非線描画の8接続点に追従する。`line` があればrotation/flipX/flipYを併用しない。水平・垂直線も端点はそのまま保存し、共通のwidth/heightキャッシュだけを1px以上にする。現在の経路の全頂点・外接矩形は `getSpreadsheetLineRoute` で取得し、キャッシュから推測しない。

旧 `shape: "line" / "arrow"` の矩形形式は読み込み可能。新規は `lines.insert` の2端点で作り、矢印は `none|triangle|openArrow|diamond|oval|stealth` を両端へ個別に指定する。旧arrowでendArrow省略ならtriangle、他はnone。セルアンカーとワールド座標を取り違えないよう、直接JSONを組み立てるよりコマンドを優先する。SPONは接続と線の文字を保持し、XLSXは標準cxnSp＋8点custGeomで接続を保持するが、線の文字は独立テキストボックスへ分離して警告する。

折れ線のXLSX出力は標準cxnSpのカスタム経路で端点・接続先・矢印を保持する。外部OfficeのbentConnector2〜5は取り込めるが、手動の曲がり角や調整値は自動経路へ変換して警告する。自動経路は接続先2図形のみを回避対象とし、無関係な図形は回避しない。接続先が重なる場合やOffice側の再配線では経路が異なる場合がある。

## XLSXの数値書式の取り込み

公開 `importSpreadsheetXlsx` は `formatCode` を4,096文字までで解析する。上限超過、閉じていない引用符・角括弧、末尾で切れたエスケープは `adjusted` の警告付きで数値書式だけを標準表示へ置き換える。値・数式・フォントなど他の情報は保持する。独自書式の原文はSPONに保存しないため、再出力してもその原文は復元しない。警告を確認して取り込み結果を採用する。


## XLSXの補助データと警告

XLSXは、壊れた図形・コメント・テーブル・テーマ・書式のパートや、参照先が欠落した補助データを省略して残りを取り込める。不正なセル書式は標準書式へ戻し、通常セルの値・数式は保持する。グラフ専用シートは省略し、取り込めるワークシートがない場合は失敗する。省略・補正した定義は再出力で元に戻らない。

`importSpreadsheetXlsx` が返す `warnings` は `code`（`unsupported` / `adjusted` / `omitted`）、`message` と任意の `sheetName`・`count` を持つ。同じ内容はまとめ、異なる詳細を1,000件保持した後は、追加分を `code`・`sheetName` ごとに集約する。警告を確認して結果を採用する。モデルが有効であることと、元Excelを完全に再現できたことを区別する。

必須のブック・ワークシート・共有文字列の欠落や破損、不正な値・実セル座標・共有数式、値・数式を持つ保持セル100,000件超、ZIPの安全上限・整合性エラー・パッケージ外への参照パス、キャンセルは回復せず全体を失敗させる。XMLの読み取り上限は補助パートにも適用し、上限超過を検証せず読み込むことはしない。
