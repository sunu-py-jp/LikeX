# SPON v1の構造

保存ファイルを作成・解析するときに読む。全フィールドの構造とunionは [spon.schema.json](spon.schema.json)、操作JSONは [commands.schema.json](commands.schema.json) を参照する。Schemaだけではシート内の境界、参照の存在、値と入力規則の整合性、画像の内容まで検証できない。最終判定は `parseWorkbook` と公開コマンドの実行結果を使う。

## 保存ファイルと編集用モデル

`.spon` はUTF-8のJSON。MIMEは `application/json` で、ZIPではない。

| 項目 | 保存用 `SpreadsheetFile` | 編集用 `SpreadsheetWorkbook` |
| --- | --- | --- |
| 形式 | 必須の `format: "likex.spreadsheet"` | ホストからの入力では省略可。正規化後は含む |
| バージョン | 必須の `schemaVersion: 1` | 正規化後は1 |
| セル | `sheets[i].rows[row].cells[columnLabel]` | `sheets[i].cells[address]` |
| 行高 | `rows[row].height` | `rowHeights[row]` |
| 列幅 | `columnWidths[column]` | 同左 |

`parseWorkbook(json)` がファイルを検証・変換して編集モデルを返す。`serializeWorkbook(workbook)` が編集モデルからファイルへ変換する。`JSON.parse` / `JSON.stringify` だけで代用しない。形式・バージョン省略、シート直下の `cells` / `rowHeights` を持つ旧ファイル、version 2は現行パーサーで拒否される。旧データの移行を依頼された場合は、元の構造を特定して別の変換として扱う。

```json
{
  "format": "likex.spreadsheet",
  "schemaVersion": 1,
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
| `SpreadsheetFileSheet` | `id`, `name`, `rowCount`, `columnCount`, `rows`。任意の `columnWidths`, `drawings`, `comments`, `merges`, `conditionalFormats`, `tables` |
| `SpreadsheetFileRow` | 任意の `height`, `cells`。それ以外の行フィールドはない |
| `SpreadsheetCell` | `value: string`、任意の `format`, `validation` |

数値も `"1200"`、真偽値も `"TRUE"` / `"FALSE"`、数式も `"=SUM(B2:B3)"` として保存する。通常、先頭 `=` は数式として解釈する。文字列として扱う値は先頭アポストロフィや `numberFormat: "text"` を意図に合わせて用い、利用者の文字列表記を勝手に数値へ変換しない。計算結果は保存値ではなく `calculateWorkbook(workbook)` から取得する。

`sheet.id` はブック内で一意。シート名は1〜31文字で、大文字・小文字を無視して一意。`[ ] : * ? / \\`、制御文字、先頭・末尾のアポストロフィは使えない。表示名の変更でIDは変わらない。

## 書式・入力規則・条件付き書式

`SpreadsheetCellFormat` の全フィールド:

- 文字: `bold`, `italic`, `underline`, `fontFamily`, `fontSize`, `color`。
- 配置: `align`（`left` / `center` / `right`）、`verticalAlign`（`top` / `middle` / `bottom`）、`wrap`, `background`。
- 表示形式: `numberFormat`（`general`, `text`, `number`, `currency`, `percent`, `date`, `time`, `datetime`）、`decimalPlaces`（0〜10）、`useGrouping`、`negativeFormat`（`minus`, `parentheses`, `red`, `red-parentheses`）。
- `borders`: `top` / `right` / `bottom` / `left` の各辺に `{ style?, width?, color? }`。`style` は `none` / `solid` / `dashed` / `dotted` / `double`、`width` は1 / 2 / 3。空の `borders: {}` は辺を消す指定に使える。

セル文字サイズはCSSピクセル（1〜200）。列幅24〜1,000px、行高16〜1,000px。色には `#RRGGBB` を使うと意図が明確になる。Spreadsheetの描画色・セル色の検証契約はSlideの16進色限定契約と同じではない。

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
| `shape` | `shape`, `fill`, `stroke`, `strokeWidth`、任意の `text`, `fontSize`, `color`, `bold` |
| `text` | `text`, `fontSize`, `color`, `background`、任意の `bold` |

`shape` は `rectangle`, `roundedRectangle`, `ellipse`, `triangle`, `rightTriangle`, `diamond`, `parallelogram`, `trapezoid`, `rightArrow`, `leftArrow`, `upArrow`, `downArrow`, `leftRightArrow`, `upDownArrow`, `line`, `arrow`。Slideの `rect` / `roundRect` とは異なる。

回転は時計回り、有限の値を0以上360未満へ正規化し、0は省略する。反転は正のサイズの枠内で行い、文字は読みやすい向きを保つ。オフセットは0〜10,000px、描画サイズは最大10,000px。画像サイズは正の小数を許可し、図形・テキストは1px以上。描画文字サイズは1〜400px、線幅は0〜100px。形状を変えてもIDは維持し、`type` は更新できない。

画像の実体は `resources.images[resourceId]` に次の形で保存する。

```text
{ name, mimeType, dataUrl, width, height }
```

`mimeType` は `image/png` / `image/jpeg` / `image/webp` / `image/gif`。`dataUrl` はそのMIMEと一致する `data:image/…;base64,…`。外部URL、Blob URL、SVGを入れない。`width` / `height` はエンコードされた画像ヘッダーの実寸と一致させる。JPEGのEXIF回転後の表示寸法とは区別する。画像内容・ヘッダー・Base64もランタイムで検証する。

コマンドの画像挿入は表示サイズを省略すると比率を保って最大320×240pxに収め、拡大しない。片辺だけ指定するともう片辺を比率から計算する。両辺を指定すると指定した枠を保持する。`images.update` は指定した辺だけを変更し、この自動計算を行わない。

## 上限とID

| 対象 | 上限 |
| --- | --- |
| シート | 100枚、各10,000行 × 1,000列 |
| 格納セル | ブック全体100,000 |
| 1回の範囲操作・コピー | 10,000セル |
| セル文字列・描画文字列 | 各100,000文字 |
| 数式 | 4,096文字、2,048トークン。計算200,000ステップ、参照深度128 |
| 画像 | 1枚5 MiB、ブック合計20 MiB、1辺10,000px、16,000,000画素、1,000リソース |
| 描画・コメント | ブック全体1,000描画 / 10,000コメント。コメント本文10,000文字 |
| 結合・テーブル | 各ブック全体1,000 |
| 名前付き範囲 | ブック全体1,000 |
| ネイティブJSON | 64 × 1,024 × 1,024文字 |
| コマンド配列 | 1,000件 |

`sheets.add` / `sheets.duplicate`、描画・画像挿入、名前付き範囲・テーブル追加、コメント新規作成などのIDはライブラリが生成する。CLIでは適用後のファイルをinspectし、公開APIを直接使う場合はreceiptから取得できる。命名規則から予測しない。既存の更新ではIDを保ち、描画・シートの複製では新しいIDを持つ。保存操作そのものはIDを振り直さない。
