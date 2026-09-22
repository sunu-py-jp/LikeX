# 画面なしでJSONを編集する

[利用ガイドへ戻る](./README.md)

`@likex/spreadsheet/model` は、保存したブックをコンポーネントなしで編集する入口です。Reactの描画、DOM、`ref`、CSSの読み込みは不要です。Node.jsの処理やNext.jsのサーバー側から、セル設定・行列の挿入・書式・コメント・図形などを操作し、結果をJSONへ戻せます。

AIエージェントが生成した操作を適用する場合も、画面を準備する必要はありません。保存・認証・同時更新の扱いは、呼び出す側で実装します。

履歴を使って編集を続ける場合は[編集セッションとUndo／Redo](./history-session.md)、データを調べる場合は[セル・範囲・画像の取得](./data-access.md)を参照してください。

内容に合わせた行高・列幅の計算は [`dimensions.autoFit` と公開ヘルパー](./formatting.md#内容に合わせて自動調整するapi)、`/model` のXLSX入出力と画像変換の注入は[Excel出力](./excel-export.md)・[Excel取り込み](./excel-import.md)を参照してください。

## セルに値を入れる

```ts
import {
  createWorkbook,
  applySpreadsheetCommands,
  serializeWorkbook,
} from "@likex/spreadsheet/model";

const workbook = createWorkbook();
const sheetId = workbook.sheets[0].id;

const result = applySpreadsheetCommands(workbook, [
  {
    type: "cells.set",
    sheetId,
    values: { A1: "商品", B1: "金額", A2: "サービス", B2: "1200" },
  },
]);

if (!result.ok) throw new Error(result.message);

const updatedJson = serializeWorkbook(result.workbook);
// updatedJsonの保存先は呼び出し側で決めます。
```

`sheetId` はシート名ではなく、保存データにあるIDです。`cells.set` の値は数値や数式も文字列で指定します。例えば `"1200"`、`"=SUM(B2:B3)"` です。後述する行列挿入の `values` は、数値・真偽値・`null` も受け取れます。

既存JSONを使う場合は、`createWorkbook()` の代わりに `parseWorkbook(savedJson)` で読み込みます。`parseWorkbook` はブックの構造・値・上限を検証し、読み込めない場合は例外を投げます。

## 行を挿入し、その行の値をまとめて設定する

`rows.insert.values` に行ごとの配列を渡すと、行の挿入と値の設定を1コマンドで実行できます。外側の配列1つが1行に対応し、内側の値はA列から左→右に入ります。

```ts
import {
  parseWorkbook,
  applySpreadsheetCommands,
  serializeWorkbook,
  type SpreadsheetCommand,
} from "@likex/spreadsheet/model";

export function insertProducts(savedJson: string, sheetId: string): string {
  const workbook = parseWorkbook(savedJson);
  const commands = [
    {
      // 位置は0始まり。3行目の直前に2行挿入します。
      type: "rows.insert",
      sheetId,
      index: 2,
      values: [
        ["商品A", 100, 2, "=B3*C3"], // A3:D3
        ["商品B", 200, 3, "=B4*C4"], // A4:D4
      ],
    },
  ] satisfies readonly SpreadsheetCommand[];

  const result = applySpreadsheetCommands(workbook, commands);
  if (!result.ok) throw new Error(result.message);
  return serializeWorkbook(result.workbook);
}
```

`count` を省略すると `values.length` が挿入数になります。上の例は2行です。挿入した行のうち一部のセルだけを書きたい場合などは、従来どおり `rows.insert` と `cells.set` を同じコマンド配列にまとめる方法も使えます。後のコマンドは、前のコマンドを反映した状態を対象にします。

既存の数式参照、結合セル、コメント、描画の位置は行列操作のルールに従って調整します。`values` 内の数式は挿入後の位置に対して書きます。値の検証に失敗した場合、行の挿入だけが残ることはありません。

## 列を挿入して値を入れる

`columns.insert.values` は**列ごとの配列**です。外側の配列1つが1列に対応し、内側の値は1行目から上→下に入ります。

```ts
import { createWorkbook, applySpreadsheetCommands } from "@likex/spreadsheet/model";

const workbook = createWorkbook();
const sheetId = workbook.sheets[0].id;
const result = applySpreadsheetCommands(workbook, [{
  type: "columns.insert",
  sheetId,
  index: 1, // 既存のB列の直前へ2列を挿入
  values: [
    ["単価", 100, 200], // B1:B3
    ["数量", 2, 3],     // C1:C3
  ],
}]);
if (!result.ok) throw new Error(result.message);
```

行・列ともに `index` は0始まりです。現在の `rowCount` / `columnCount` と同じ値を指定すると末尾に追加します。`values` なしなら従来どおり空の行・列を挿入でき、`count` の既定値は1です。`values` と `count` を両方指定する場合、`count` は `values.length` と一致させます。

各値の入力型は `SpreadsheetInsertValue`（`string | number | boolean | null`）です。有限の数値は文字列、真偽値は `"TRUE"` / `"FALSE"`、`null` は空文字に変換します。文字列はそのまま扱い、`=` で始まる場合は数式になります。保存JSONのセルの `value` は従来どおり文字列です。

外側が空の `values: []`、疎配列、`undefined`・`NaN`・`Infinity`・オブジェクトなどの不正な値は拒否します。内側の配列は空でも長さが異なっていても構いません。行挿入では列数、列挿入では行数を自動で広げないため、内側の配列がシートの反対軸に収まるようにしてください。詳しい契約は[行・列を値と一緒に挿入する](./external-operations.md#行列を値と一緒に挿入する)にまとめています。

## APIと結果

```ts
applySpreadsheetCommands(workbook, commands, options?)
```

| 引数 | 型・動作 |
| --- | --- |
| `workbook` | `SpreadsheetWorkbookSnapshot`。読み取り専用のブックも渡せます。処理前に検証・正規化します。 |
| `commands` | `readonly SpreadsheetCommand[]`。1件から一括処理まで同じ形式です。 |
| `options` | `SpreadsheetApplyCommandsOptions`。`features?: SpreadsheetFeatures` を指定できます。省略した機能は有効です。 |
| 戻り値 | `SpreadsheetApplyCommandsResult`。同期関数で、Promiseは返しません。 |

| 結果 | 内容 |
| --- | --- |
| `ok: true` | `workbook` に変更後のブック、`changed` に実変更の有無、`results` にコマンド順の実行結果が入ります。 |
| `ok: false` | `code`、`message`、該当する場合は0始まりの `commandIndex` が入ります。部分的な変更後ブックは返しません。 |

`results` は `SpreadsheetCommandReceipt[]` です。各要素に `type` / `sheetId` が入り、画像・図形・コメントなどの操作では対象の `drawingId` / `resourceId` / `commentId` も取得できます。新規IDはライブラリが生成します。新しいシートへの後続処理では、`sheets.add` の結果から `sheetId` を取得し、次の呼び出しで指定します。

- 元のブックとコマンドは変更しません。結果のブックを使って後続処理を行います。
- 1件でも失敗すると全体が失敗します。行挿入が成功しても、その後のセル設定が不正なら、行挿入だけを反映した結果にはなりません。
- 空の配列、同じ値の設定、変更して元に戻す操作など、最終的な内容が同じ場合は `changed: false` です。正規化したコピーを返す場合があるため、オブジェクトの参照一致で変更を判定しないでください。
- 1回の呼び出しは最大1,000コマンドです。多数のセル設定は `cells.set.values` にまとめます。ブックの行列・画像・JSONサイズなどの上限も適用されます。
- Undo履歴、選択状態、編集許可、保存イベントは扱いません。JSONの加工だけを行います。

コマンドの引数と対応操作は、[外部コマンド一覧](./external-operations.md#コマンド一覧)と共通です。画像はJSONの `SpreadsheetImageResource` を用意すれば挿入できます。ブラウザ用の `prepareSpreadsheetImage(File / Blob)` は、この入口には含まれません。

挿入やセル設定の結果には、次に続けて配置するための `placement.nextRow` / `nextColumn` が入ります。行列挿入では `index + 実際の挿入数` です。`values` の例で `count` を省略した場合も配列の件数を使うため、上の行挿入は `nextRow: 4`、列挿入は `nextColumn: 3` になります。対象コマンド、画像の下に表を作る例、IDから位置を再計算するヘルパーは[配置位置と次の行・列](./drawing-placement.md)を参照してください。

## 機能を制限する

```ts
const result = applySpreadsheetCommands(workbook, commands, {
  features: {
    deleteRows: false,
    deleteColumns: false,
    deleteSheet: false,
  },
});

if (!result.ok) {
  // 例: 削除コマンドを含めた場合は FEATURE_DISABLED
  console.error(result.code, result.message, result.commandIndex);
}
```

コンポーネントと同じ機能設定を利用できます。例えば `rowColumnOperations: false` は行列の挿入・削除をまとめて禁止します。セルの入力規則など、既存データに設定された検証も適用されます。

主な失敗コードは `FEATURE_DISABLED`、`INVALID_COMMAND`、`INVALID_TARGET`、`VALIDATION_FAILED` です。画面を持たないため、マウント・保存中・未確定入力など、コンポーネントの状態は確認しません。

## AIが返した操作JSONを使う

AIにはブックJSON全体を作り直させる代わりに、対象シートIDとコマンドの形式を渡せます。例えば次の応答を受け取ります。

```json
[
  {
    "type": "rows.insert",
    "sheetId": "sales",
    "index": 2,
    "values": [["追加商品", 1200, "=B3*1.1"]]
  }
]
```

`sales` は説明用のIDです。実際には読み込んだブックに存在するIDを指定します。

```ts
import {
  parseWorkbook,
  applySpreadsheetCommands,
  serializeWorkbook,
} from "@likex/spreadsheet/model";

export function applyAgentResponse(savedJson: string, commandJson: string): string {
  const workbook = parseWorkbook(savedJson);
  const commands = JSON.parse(commandJson);

  const result = applySpreadsheetCommands(workbook, commands, {
    features: { deleteRows: false, deleteColumns: false, deleteSheet: false },
  });
  if (!result.ok) {
    const location = result.commandIndex === undefined ? "" : ` (${result.commandIndex + 1}件目)`;
    throw new Error(`${result.message}${location}`);
  }
  return serializeWorkbook(result.workbook);
}
```

これはJSONを加工する部分だけのサンプルです。`JSON.parse` はJSONの構文だけを確認します。コマンドの種類・引数・対象・値の検証は `applySpreadsheetCommands` が実行時に行います。TypeScriptでコードを書く場合は `SpreadsheetCommand` 型を使い、JavaScriptコードの文字列を `eval` するような実装は不要です。

認証と対象ブックへの権限確認、AIへ渡す情報の選別、操作内容を利用者に確認するかの判断は、呼び出し側で行います。機能設定は認証・認可の代わりにはなりません。

AIの応答待ちに別の利用者が行を挿入すると、同じセル番地が別の内容を指すことがあります。AIへ渡した時点のブックのバージョンを保持し、保存時に一致を確認する構成にしてください。異なる場合は上書きせず、再読み込みや操作の再生成を行います。このライブラリはDBのバージョン比較やロック、保存を実装しません。

## モデル関数を直接呼ぶ場合

小さな処理では、個別のモデル関数も利用できます。

```ts
import {
  createWorkbook, setCellValue, insertRows, setCellValues, calculateWorkbook,
} from "@likex/spreadsheet/model";

let workbook = createWorkbook();
const sheetId = workbook.sheets[0].id;
workbook = setCellValue(workbook, sheetId, "A1", "金額");
workbook = insertRows(workbook, sheetId, 1, 2);
workbook = setCellValues(workbook, sheetId, { A2: "100", A3: "200", A4: "=SUM(A2:A3)" });

const calculated = calculateWorkbook(workbook);
console.log(calculated[sheetId].A4); // 300
```

こちらは変更後のブックを返す低レベルのAPIです。`insertRows(workbook, sheetId, index, count?)` / `insertColumns(workbook, sheetId, index, count?)` に `values` 引数はありません。値もまとめて渡す場合は `rows.insert` / `columns.insert` コマンドを使います。

モデル関数は `features` や複数操作をまとめた結果型を持たず、不正な入力では例外を投げます。複数の操作をまとめて検証したい場合や、AIの操作JSONを扱う場合は `applySpreadsheetCommands` が使いやすい入口です。

数式は文字列としてJSONに保存します。計算結果が必要なら `calculateWorkbook` を使います。対応する関数と数式の範囲は[数式ガイド](./functions.md)を参照してください。

## 表示中の操作との使い分け

| 用途 | 入口 |
| --- | --- |
| バックエンド処理、AIエージェント、表示前のブック作成 | `@likex/spreadsheet/model` の `applySpreadsheetCommands` または個別モデル関数 |
| 表示中の下書きの変更、Undo、`onChange`、編集許可との連携 | `@likex/spreadsheet` のコンポーネントと `ref.execute` / `ref.batch` など |

行列を値と一緒に挿入するコマンド形式は、`applySpreadsheetCommands`、編集セッション、表示中コンポーネントの `ref` で共通です。GUI・編集セッションでは挿入と値設定を一度のUndoで戻せます。`applySpreadsheetCommands` 自体は履歴を持たず、原子的に変更したブックだけを返します。

モデル側でJSONを変更しても、すでに表示しているコンポーネントの下書きは置き換わりません。外部で保存した内容を画面へ取り込む場合は、親側の再読み込み処理やブックの切り替えへ接続します。

パッケージのモデル入口はReact・DOMを実行時に読み込みません。ただし同じパッケージにUIも含むため、パッケージ全体のReact / React DOMのpeer dependency宣言は残ります。モデル入口の利用にCSSのimportやClient Componentの指定は必要ありません。

コピー導入では、[通常のコピー手順](./README.md#コピー導入)で配置したSpreadsheetの `model-entry.ts` をimportします。

```ts
import { applySpreadsheetCommands } from "./components/spreadsheet/model-entry";
```

`model/` だけを抜き出すのではなく、SpreadsheetとCoreのコピー単位を維持してください。内部の `commands/` などを直接importする必要はありません。
