# 外部からセル・行列・画像・図形を操作する

[利用ガイドへ戻る](./README.md)

`Spreadsheet` に `ref` を渡すと、GUIを操作せずに表示中の下書きを変更できます。コマンドはシートIDと位置を明示し、現在選択されているシートやセルに依存しません。変更は内部の履歴・再計算・`onChange` の対象となり、保存は従来どおり `onSave` が担当します。

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

`ref.current` はマウント前・アンマウント後には `null` です。同じインスタンスのhandleは再描画後も同じオブジェクトです。以前取得したhandleでアンマウント後に変更しようとすると `NOT_MOUNTED` を返します。ブック切り替えで `key` を変えた場合、新しいhandleを利用してください。

## コマンド一覧

`SpreadsheetCommand` は `type` で引数が決まるunion型です。`sheets.add` 以外は `sheetId` が必須です。シート名やシートの順番ではなく、ブックにあるIDを指定します。

| `type` | 主な引数 |
| --- | --- |
| `cells.set` | `values: { A1: "値", B1: "=A1*2" }`。数値・数式も文字列 |
| `cells.format` | `addresses: ["A1", "B1"]`, `format: { bold: true, ... }` |
| `rows.insert` / `rows.delete` | `index`, `count?`（既定1） |
| `columns.insert` / `columns.delete` | `index`, `count?`（既定1） |
| `columns.resize` | `column`, `width`（px） |
| `cells.merge` | `range: { top, left, bottom, right }`, `discardContent?` |
| `cells.unmerge` | `range: { top, left, bottom, right }` |
| `images.insert` | `resource`, `anchor`, `width?`, `height?`, `alt?` |
| `shapes.insert` | `shape`, `anchor`, `width?`, `height?`, `fill?`, `stroke?`, `strokeWidth?` |
| `textBoxes.insert` | `anchor`, `text?`, `width?`, `height?`, `fontSize?`, `color?`, `background?`, `bold?` |
| `images.update` / `shapes.update` / `textBoxes.update` | `drawingId`, `patch`。対応する種類のプロパティだけを指定 |
| `drawings.delete` | `drawingId` |
| `comments.set` | `address`, `comment: { text, author? }`。`null` で削除 |
| `sheets.add` | `name?`。生成した `sheetId` は結果から取得 |
| `sheets.rename` / `sheets.delete` | `sheetId`。名前変更では `name` も指定 |

`shape` は `rectangle` / `ellipse` / `line` / `arrow` です。更新ではIDやオブジェクトの種類は変更できません。別の種類のIDを渡した場合も失敗します。画像の `patch.resourceId` は、同じブック内にある既存画像リソースを参照します。

行・列・範囲の数値はすべて0始まり、範囲の末尾は含みます。行・列の挿入は `index` の直前に入り、既存行・列の数と同じ `index` なら末尾への追加です。画像・図形の位置は以下のように指定します。

```ts
const anchor = { row: 4, column: 1, offsetX: 12, offsetY: 8 }; // B5から右12px・下8px
```

`offsetX` / `offsetY` は省略時0です。ブラウザのスクロール位置には依存しません。行列の挿入・削除では既存の数式参照、結合、コメント、描画の位置もモデルのルールに従って調整します。

結合で左上以外の内容が失われる場合、既定では失敗します。利用側で内容の破棄を確認した後、`discardContent: true` を指定してください。外部APIは確認ダイアログを自動では開きません。`cells.set` で結合セルを指定するときは左上のアドレスへ値を入れます。

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

画像の幅・高さを両方省略すると、縦横比を保って最大320×240pxに収め、元画像より拡大しません。サイズを明示したい場合は両方を指定してください。図形とテキストの省略値はGUIで挿入した場合と同じです。

準備中はシートをロックしません。コマンドの対象は実行時点のブックです。通信中に行列が変わった場合も、指定した数値座標を実行時点で解釈します。呼び出し前の画面との一致が必要なら、親で変更通知や `getWorkbook()` を用いて確認してください。

## 一括処理・履歴・保存のルール

- 全コマンドを順番に検証・計算し、最後に選択範囲との整合性も確認してから一度だけ反映します。後のコマンドの座標は、それまでのコマンドを反映した状態が基準です。
- 1件でも失敗した場合は全体を中止します。ブック・画像リソース・履歴に部分的な変更は残らず、`onChange` も発火しません。コマンドが原因の失敗では、0始まりの `commandIndex` が返ります。
- 成功時は1回の `onChange`、1回のUndo単位になります。`undoRedo: false` の場合は履歴を記録しません。
- 空のバッチ、同じ値の設定、変更して元に戻すバッチなど、最終結果が同じなら `changed: false` です。通知や履歴は増やしません。
- 外部操作はシートの切り替えやフォーカス移動を行いません。構造の変更で現在の選択が範囲外になる場合は補正します。
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

未確定入力は勝手に確定・破棄しません。`PENDING_EDIT` の場合は利用者が確定またはキャンセルした後に再度呼び出します。保存中の操作を自動で予約・再実行する仕組みもありません。

`onChange` の同期通知中に追加の変更を呼び出すと `BUSY` です。追加変更が最初から分かっているなら同じバッチに含めます。外部計算後に行う操作は、親で別の処理として実行してください。

## 初期データ作成との使い分け

`createWorkbook` / `setCellValues` / `insertRows` / `addDrawing` などの公開モデル関数は、表示前のブック作成や、表示と独立した加工に引き続き使えます。これらは結果のブックを返すだけで、表示中の下書きを置き換えません。表示中の変更にはhandleを使います。

任意のブック更新関数や内部のstateを外へ公開せず、追加する操作は `SpreadsheetCommand`、共通の実行処理、モデル操作へ分けて実装します。[内部構成と拡張の方針](./architecture.md)も参照してください。
