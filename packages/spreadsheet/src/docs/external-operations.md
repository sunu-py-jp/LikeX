# 外部からセル・行列・画像・図形を操作する

[利用ガイドへ戻る](./README.md)

`Spreadsheet` に `ref` を渡すと、GUIを操作せずに表示中の下書きを変更できます。コマンドはシートIDと位置を明示し、現在選択されているシートやセルに依存しません。変更は内部の履歴・再計算・`onChange` の対象となり、保存は従来どおり `onSave` が担当します。

コンポーネント自体を表示しない場合は、[画面なしでJSONを編集する](./headless.md)の `applySpreadsheetCommands` を使います。同じコマンド形式で、Node.jsやAIエージェントの処理から保存JSONを編集できます。

## 最小例

```tsx
"use client";

import { useRef, useState } from "react";
import Spreadsheet, { createWorkbook, type SpreadsheetHandle } from "@likex/spreadsheet";
import "@likex/spreadsheet/styles.css";

export default function Report() {
  const spreadsheetRef = useRef<SpreadsheetHandle>(null);
  const [initial] = useState(createWorkbook);
  const [message, setMessage] = useState("");

  const fill = () => {
    const api = spreadsheetRef.current;
    if (!api) return;
    const sheetId = api.getWorkbook().sheets[0].id;
    const result = api.execute({
      type: "cells.set", sheetId,
      values: { A1: "商品", B1: "金額", A2: "サービス", B2: "1200", B3: "=SUM(B2,300)" },
    });
    setMessage(result.ok ? "入力しました" : result.message);
  };

  return <>
    <button onClick={fill}>サンプルを入力</button>
    <p role="status">{message}</p>
    <Spreadsheet ref={spreadsheetRef} initialWorkbook={initial}
      onSave={async workbook => {
        const response = await fetch("/api/workbooks/report", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(workbook),
        });
        if (!response.ok) throw new Error("保存に失敗しました");
      }}
      style={{ height: 560 }} />
  </>;
}
```

保存APIのURLは利用側で実装する例です。Next.jsではこの親をClient Componentにし、CSSは `app/layout.tsx` で読み込めます。コピー導入ではimportをコピー先の入口へ変更します。

## Handleと結果

| API | 戻り値・動作 |
| --- | --- |
| `execute(command)` | 1件のコマンドを同期実行し、`SpreadsheetCommandResult` を返す |
| `batch(commands)` | 配列の順番でまとめて同期実行。同じ結果型を返す |
| `getWorkbook()` | 現在の下書きの `SpreadsheetWorkbookSnapshot`。深い読み取り専用のスナップショット |
| `getCell(sheetId, address)` / `getRange(sheetId, range)` など | セルやIDで対象を取得。[読み取りAPI](./data-access.md)を参照 |
| `undo()` / `redo()` | 編集許可を待って履歴を移動。`boolean` または `Promise<boolean>` を返す |
| `getHistoryState()` | `canUndo` / `canRedo` / `undoCount` / `redoCount` |
| `getZoom()` / `setZoom(percent)` | 現在の表示倍率を取得／変更。保存データ・履歴・未保存状態は変えません。[表示倍率](./zoom.md) |
| `executeAsync(command)` / `batchAsync(commands)` | 外部の編集許可を待てる操作。結果をPromiseで返す |

`execute` / `batch` はPromiseを返しません。成功直後の `getWorkbook()` には、Reactの再描画を待たず変更が反映されています。スナップショットは凍結されており、直接書き換えずコマンドを使います。入力中でまだ確定していない文字列は含まれません。

`onEditRequest` を設定した場合は、許可を取得済みでなければ同期操作は `EDIT_REQUIRED` です。通常は `await api.executeAsync(command)` / `batchAsync(commands)` を使います。保存・更新・編集セッションのHandle APIは[保存・編集許可・イベント](./lifecycle.md)を参照してください。

```ts
const result = api.execute({ type: "shapes.insert", sheetId,
  shape: "rectangle", anchor: { row: 4, column: 1 }, width: 160, height: 80 });

if (result.ok) {
  console.log(result.changed); // 実際にブックが変わったか
  const drawingId = result.results[0].drawingId;
  if (drawingId) api.execute({ type: "shapes.update", sheetId, drawingId,
    patch: { width: 240, fill: "#d9eadf" } });
} else {
  console.log(result.code, result.message, result.commandIndex);
}
```

成功時の `results` はコマンド順の `SpreadsheetCommandReceipt[]` です。各要素に `type` / `sheetId` と、対象に応じた `drawingId` / `resourceId` / `commentId` が入ります。`execute` も1要素の配列です。新規IDはライブラリが生成し、既存オブジェクトやコメントの更新ではIDを維持します。

画像などの挿入・更新、セル設定・貼り付け・オートフィル、行列の挿入では、結果に `placement` が付きます。`nextRow` / `nextColumn` で対象の直後へ内容を続けて配置できます。空のセル設定・貼り付けでは省略します。[配置位置と次の行・列](./drawing-placement.md)にコマンドごとの返却内容と、画像の配置IDから再計算するヘルパーをまとめています。

`ref.current` はマウント前・アンマウント後には `null` です。同じインスタンスのhandleは再描画後も同じオブジェクトです。以前取得したhandleでアンマウント後に変更しようとすると `NOT_MOUNTED` を返します。ブック切り替えで `key` を変えた場合、新しいhandleを利用してください。

## コマンド一覧

`SpreadsheetCommand` は `type` で引数が決まるunion型です。`sheets.add` 以外は `sheetId` が必須です。シート名やシートの順番ではなく、ブックにあるIDを指定します。

| `type` | 主な引数 |
| --- | --- |
| `cells.set` | `values: { A1: "値", B1: "=A1*2" }`、`onConflict?`。数値・数式も文字列 |
| `cells.clear` / `cells.delete` | `range`。値だけのクリア／セル情報の削除。周囲のセル位置は移動しません。[書き込みとクリア](./cell-writing.md) |
| `namedRanges.add` / `update` / `clear` / `delete` | 定義の追加・変更・対象セルのクリア・定義削除。[名前付き範囲](./named-ranges.md) |
| `tables.insert` / `cells.writeTable` / `tables.delete` | 構造化テーブルと罫線付きの表。[表の書き込み](./tables.md) |
| `cells.format` | `addresses: ["A1", "B1"]`, `format: { bold: true, ... }` |
| `rows.insert` / `rows.delete` | `index`, `count?`（既定1） |
| `columns.insert` / `columns.delete` | `index`, `count?`（既定1） |
| `rows.resize` | `row`, `height`（px） |
| `dimensions.resize` | `rowHeights`, `columnWidths`。0始まりのインデックスをキーにした寸法マップ。一括変更用 |
| `cells.replace` / `cells.fill` / `cells.paste` | [編集操作](./editing-tools.md)の型と例を参照 |
| `cells.move` | `source: { sheetId, top, left, bottom, right }`, `target: { row, column }`。外側の `sheetId` は移動先。値・参照・コメント・結合を一括で移動 |
| `cells.validation` | `addresses`, `validation`。[入力規則](./input-validation.md)を設定／解除 |
| `conditionalFormats.set` | `rules`。[条件付き書式](./formatting.md)をシート単位で置換 |
| `sheets.duplicate` | `sheetId`, `name?`。元シートの直後へ複製し、新しいIDを返す |
| `columns.resize` | `column`, `width`（px） |
| `cells.merge` | `range: { top, left, bottom, right }`, `discardContent?` |
| `cells.unmerge` | `range: { top, left, bottom, right }` |
| `images.insert` | `resource`, `anchor`, `width?`, `height?`, `alt?` |
| `shapes.insert` | `shape`, `anchor`, `width?`, `height?`, `fill?`, `stroke?`, `strokeWidth?`, `text?`, `fontSize?`, `color?`, `bold?` |
| `textBoxes.insert` | `anchor`, `text?`, `width?`, `height?`, `fontSize?`, `color?`, `background?`, `bold?` |
| `images.update` / `shapes.update` / `textBoxes.update` | `drawingId`, `patch`。対応する種類のプロパティだけを指定 |
| `drawings.paste` | `payload`, `anchor?`。画像・図形・テキストボックスを新しいIDで複製 |
| `drawings.delete` | `drawingId` |
| `comments.set` | `address`, `comment: { text, author? }`。`null` で削除 |
| `sheets.add` | `name?`。生成した `sheetId` は結果から取得 |
| `sheets.rename` / `sheets.delete` | `sheetId`。名前変更では `name` も指定 |
| `sheets.move` | `sheetId`, `index`。移動後の0始まりの位置（`0` 〜 `sheets.length - 1`） |

`shape` は `rectangle` / `ellipse` / `line` / `arrow` です。更新ではIDやオブジェクトの種類は変更できません。別の種類のIDを渡した場合も失敗します。画像の `patch.resourceId` は、同じブック内にある既存画像リソースを参照します。

`sheets.move` はシートIDや数式の参照、選択中のシート・セルを維持して順番だけを変えます。同じ位置への移動は変更・編集要求・履歴を発生させません。

行・列・範囲の数値はすべて0始まり、範囲の末尾は含みます。行・列の挿入は `index` の直前に入り、既存行・列の数と同じ `index` なら末尾への追加です。画像・図形の位置は以下のように指定します。

```ts
const anchor = { row: 4, column: 1, offsetX: 12, offsetY: 8 }; // B5から右12px・下8px
```

`offsetX` / `offsetY` は省略時0です。ブラウザのスクロール位置には依存しません。行列の挿入・削除では既存の数式参照、結合、コメント、描画の位置もモデルのルールに従って調整します。

結合で左上以外の内容が失われる場合、既定では失敗します。利用側で内容の破棄を確認した後、`discardContent: true` を指定してください。外部APIは確認ダイアログを自動では開きません。`cells.set` で結合セルを指定するときは左上のアドレスへ値を入れます。

## 貼り付け先の行・列が足りない場合

`cells.paste` と `cells.move` は、貼り付け先の行数・列数が足りない場合、必要な大きさまでシートの末尾を自動で広げます。結合を含むコピーも同じです。追加する行・列は空で、既存セルの座標をずらしません。行の高さ・列の幅は通常の既定値です。

```ts
import { createWorkbook, applySpreadsheetCommands } from "@likex/spreadsheet/model";

const workbook = createWorkbook(); // 300行×26列
const sheetId = workbook.sheets[0].id;
const result = applySpreadsheetCommands(workbook, [{
  type: "cells.paste", sheetId,
  target: { row: 299, column: 25 }, // Z300
  payload: {
    values: [["見出し", ""], ["10", "20"]],
    merges: [{ top: 0, left: 0, bottom: 0, right: 1 }],
  },
}]);
if (!result.ok) throw new Error(result.message);
const sheet = result.workbook.sheets[0];
console.log(sheet.rowCount, sheet.columnCount); // 301, 27
// Z300:AA300を結合し、Z301とAA301へ明細を配置します。
```

不足する行の追加には `features.insertRows`、列の追加には `features.insertColumns` が必要です。追加が不要な貼り付けには、この機能設定を要求しません。`features.rowColumnOperations: false` も行列追加を無効にします。最大10,000行・1,000列、一度の貼り付け・移動は10,000セルまでという上限は維持します。コピー範囲はコピー元シート内に収まっている必要があります。

拡張と内容の反映は1つの変更です。入力規則・結合・機能設定などの検証に失敗した場合は、行・列の追加も残しません。`cells.move` が `onConflict: "skip"` で移動全体を見送った場合も、シートを広げず移動元を維持します。GUI・編集セッションでは、成功した拡張と貼り付けを一度のUndoで戻せます。拡張後の寸法は `getWorkbook()` / `getSheet()` で取得できます。

## 画像の準備と一括挿入

`prepareSpreadsheetImage(fileOrBlob, options?)` はブラウザ上で画像を検証し、JSONに保存できる `SpreadsheetImageResource` を返す非同期関数です。`File` の名前を引き継ぎ、通常の `Blob` は既定の名前が `image` になります。`options.name` で指定でき、`options.signal` で準備を中止できます。

```ts
import { prepareSpreadsheetImage } from "@likex/spreadsheet";

const api = spreadsheetRef.current;
if (!api) return;
const sheetId = api.getWorkbook().sheets[0].id;

// 認証、通信、レスポンスの確認は親側で実装します。
const response = await fetch("/api/report-image");
if (!response.ok) throw new Error("画像を取得できませんでした");
const resource = await prepareSpreadsheetImage(await response.blob(), { name: "report.png" });

const result = api.batch([
  { type: "cells.set", sheetId, values: { A1: "月次レポート" } },
  { type: "rows.insert", sheetId, index: 4, count: 2 },
  { type: "images.insert", sheetId, resource, anchor: { row: 4, column: 1 }, width: 240, height: 160 },
  { type: "shapes.insert", sheetId, shape: "rectangle", anchor: { row: 8, column: 1 }, width: 160, height: 80 },
]);
if (!result.ok) console.error(result.message);
```

準備処理はブックを変更せず、URLの取得もしません。PNG・JPEG・WebP・GIFに対応し、サイズ・寸法・ファイル内容を検証します。既存の[画像の上限](./insertions-and-json.md)は外部操作にも適用されます。`File`・`Blob`・一時URLは保存JSONに残りません。すでにJSONの画像リソースを持っている場合は、準備関数を呼ばずコマンドへ渡せます。挿入時にもモデルが検証します。

`images.insert` の表示サイズは次の規則です。JPEGのEXIFが指定する表示方向を考慮した比率を使います。

| サイズの指定 | 動作 |
| --- | --- |
| `width` / `height` を両方省略 | 縦横比を保って最大320×240pxに収め、元画像より拡大しません。 |
| どちらか一辺だけ指定 | 指定した辺に合わせて、もう一辺を同比率で計算します。 |
| 両辺を指定 | 指定した表示枠を保持します。画像自体は `object-fit: contain` で比率を保って収め、比率が違う枠には余白ができます。 |

画像の表示サイズには正の小数ピクセルも使えます。`images.update` の寸法patch、低レベルのモデル関数、読み込んだJSONには、この挿入時の自動計算を適用しません。例えば `images.update` に `patch: { width: 240 }` を渡した場合は、幅だけを変更して既存の高さを維持します。GUIの画像リサイズでは現在の表示枠の比率を保ちますが、外部APIは明示された寸法を尊重します。図形とテキストの省略値はGUIで挿入した場合と同じです。

準備中はシートをロックしません。コマンドの対象は実行時点のブックです。通信中に行列が変わった場合も、指定した数値座標を実行時点で解釈します。呼び出し前の画面との一致が必要なら、親で変更通知や `getWorkbook()` を用いて確認してください。

## 図形・画像・テキストボックスの複製

`copySpreadsheetDrawing(workbook, sheetId, drawingId, options?)` は、描画オブジェクト1つを `SpreadsheetDrawingPastePayload` として取得します。ブックとOSクリップボードは変更しません。返すデータは読み取り専用の `drawing` と、画像の場合に必要な `resource` を含むJSON形式です。元の画像が削除された後や、別のブックへの貼り付けにも使えます。

```ts
import {
  createWorkbook, createSpreadsheetSession, copySpreadsheetDrawing,
} from "@likex/spreadsheet/model";

const session = createSpreadsheetSession(createWorkbook());
const sheetId = session.getWorkbook().sheets[0].id;
const inserted = session.execute({ type: "shapes.insert", sheetId,
  shape: "rectangle", anchor: { row: 1, column: 1 }, text: "確認中" });
if (!inserted.ok) throw new Error(inserted.message);
const drawingId = inserted.results[0].drawingId;
if (!drawingId) throw new Error("図形のIDを取得できませんでした");

const payload = copySpreadsheetDrawing(session.getWorkbook(), sheetId, drawingId);
const pasted = session.execute({ type: "drawings.paste", sheetId, payload,
  anchor: { row: 4, column: 1, offsetX: 0, offsetY: 0 } });
if (!pasted.ok) throw new Error(pasted.message);
console.log(pasted.results[0].drawingId); // 複製した新しいID
console.log(pasted.results[0].placement); // 配置位置・次の行と列
```

表示中のコンポーネントでは `session.execute` の代わりに `await api.executeAsync` を使います。`drawings.paste` は通常のコマンドなので、編集許可・入力検証・履歴・変更通知を通ります。OSクリップボードを読む権限は不要です。

| 項目 | 契約 |
| --- | --- |
| コピーの `options` | `SpreadsheetDrawingCopyOptions`。`{ features?: SpreadsheetFeatures }` を渡せます。`copy` と対象の `images` / `shapes` / `textBoxes` を確認します。 |
| `payload` | `SpreadsheetDrawingPastePayload`。`drawing` は必須、画像では `resource` も必須です。コピー関数が検証して取得します。 |
| 貼り付け先 | `sheetId` と任意の `anchor`。位置を指定した場合、`offsetX` / `offsetY` の省略値は0です。 |
| 位置の省略 | コピー元の行・列を保ち、元の `offsetX` / `offsetY` に16pxずつ加えます。オフセットの上限は10,000pxです。 |
| 形状・内容 | 幅・高さ、塗り・線・文字、画像の内容を保持します。 |
| ID | `drawingId` は毎回新規です。画像リソースは同じID・内容のものが貼り付け先にある場合に共有し、ない場合は新しい `resourceId` を付けます。 |
| 結果 | `drawingId` と `placement` を返し、画像では `resourceId` も返します。 |
| 機能設定 | 貼り付けは `paste` と対象の `images` / `shapes` / `textBoxes` が必要です。`mode` や切り取り指定はありません。 |

`copySpreadsheetDrawing`、`SpreadsheetDrawingPastePayload`、`SpreadsheetDrawingCopyOptions` は `@likex/spreadsheet` と `@likex/spreadsheet/model` から公開しています。画面なしのコピー関数には、必要な機能設定を呼び出し側で渡してください。

## 一括処理・履歴・保存のルール

- 全コマンドを順番に検証・計算し、最後に選択範囲との整合性も確認してから一度だけ反映します。後のコマンドの座標は、それまでのコマンドを反映した状態が基準です。
- 1件でも失敗した場合は全体を中止します。ブック・画像リソース・履歴に部分的な変更は残らず、`onChange` も発火しません。コマンドが原因の失敗では、0始まりの `commandIndex` が返ります。
- 成功時は1回の `onChange`、1回のUndo単位になります。`undoRedo: false` の場合は履歴を記録しません。
- 空のバッチ、同じ値の設定、変更して元に戻すバッチなど、最終結果が同じなら `changed: false` です。通知や履歴は増やしません。
- `execute` / `batch` とその非同期版はシートの切り替えやフォーカス移動を行いません。構造の変更で現在の選択が範囲外になる場合は補正します。`undo` / `redo` はGUIと同じく履歴で変更された場所へ選択を移しますが、コンポーネント外のDOMフォーカスは奪いません。[履歴操作後の選択](./history-session.md#guiとの境界)を参照してください。
- 自動保存はしません。保存ボタンの操作で既存の `onSave` にブック全体が渡ります。実際の変更があれば保存ボタンが有効になります。
- 1回のバッチは1,000コマンドまでです。大量のセル値には1セルずつコマンドを作らず、`cells.set.values` にまとめて指定してください。ブック自体の上限も適用されます。

## 実行できない場合

外部APIの失敗は戻り値で通知し、コンポーネント内にエラー表示を自動追加しません。親が必要なUIを表示できます。

| `code` | 状態 |
| --- | --- |
| `NOT_MOUNTED` | 対象インスタンスが表示されていない |
| `READ_ONLY` | `readOnly: true`、または `onSave` が未指定 |
| `SAVING` | 保存処理中 |
| `REFRESHING` | 再読み込み中 |
| `EDIT_REQUIRED` | 同期操作の前に編集許可の取得が必要 |
| `EDIT_PENDING` | 編集許可を確認中 |
| `EDIT_DENIED` / `EDIT_CANCELLED` | 編集を許可されなかった、または要求を取り消した |
| `STALE_TARGET` | 待機中に操作対象が変わり、再操作が必要 |
| `PENDING_EDIT` | セル・コメント・図形などに未確定の入力がある |
| `BUSY` | 別の変更処理・通知などの実行中に再入した |
| `FEATURE_DISABLED` | 対応する `features` がOFF |
| `INVALID_COMMAND` | コマンドの種類や引数の形式が不正 |
| `INVALID_TARGET` | シート・セル・オブジェクトが存在しない、または種類が不一致 |
| `VALIDATION_FAILED` | 値・範囲・上限・結合・選択などの検証に失敗した |
| `WRITE_CONFLICT` | 既存の非空の値と競合した。`conflicts`に番地一覧。[上書き方針](./cell-writing.md) |

未確定入力は勝手に確定・破棄しません。`PENDING_EDIT` の場合は利用者が確定またはキャンセルした後に再度呼び出します。保存中の操作を自動で予約・再実行する仕組みもありません。

`onChange` の同期通知中に追加の変更を呼び出すと `BUSY` です。追加変更が最初から分かっているなら同じバッチに含めます。外部計算後に行う操作は、親で別の処理として実行してください。

## 初期データ作成との使い分け

`@likex/spreadsheet/model` の `applySpreadsheetCommands` と、`createWorkbook` / `setCellValues` / `insertRows` / `addDrawing` などの公開モデル関数は、表示前のブック作成や、表示と独立した加工に使えます。これらは結果のブックを返すだけで、表示中の下書きを置き換えません。表示中の変更にはhandleを使います。JSONの読み込みから出力までの具体例は[画面なしでJSONを編集する](./headless.md)にまとめています。

任意のブック更新関数や内部のstateを外へ公開せず、追加する操作は `SpreadsheetCommand`、共通の実行処理、モデル操作へ分けて実装します。[内部構成と拡張の方針](./architecture.md)も参照してください。
