# テーブルとセル範囲へのデータ配置

[利用ガイドへ戻る](./README.md)

ヘッダーと明細データをセル範囲へ配置できます。`tables.insert` は名前・列・範囲を持つテーブル、`cells.writeGrid` は通常のセルへデータ・格子罫線・ヘッダー色を書き込みます。`cells.writeGrid` は上・左の階層見出しを自動結合でき、独立した表オブジェクトは作りません。

| 用途 | コマンド | JSONに残るもの |
| --- | --- | --- |
| テーブルとして取得・管理したい | `tables.insert` | セルと、シートの `tables` にID・名前・列・範囲 |
| 通常の表・階層見出し・マトリクスを配置する | `cells.writeGrid` | 通常のセルの値・書式・結合。テーブル定義や見出しツリーは作らない |

## 通常のセルへデータ・格子罫線・ヘッダー色を配置する

```ts
const result = session.execute({
  type: "cells.writeGrid", sheetId,
  target: { row: 1, column: 1 }, // B2
  headers: ["商品", "数量", "単価", "金額"],
  data: { type: "rows", values: [
    ["商品A", "2", "1200", "=C3*D3"],
    ["商品B", "3", "800", "=C4*D4"],
  ] },
  headerStyle: { background: "#17365d", color: "#ffffff" },
  border: { style: "solid", width: 1, color: "#94a3b8" },
  onConflict: "error",
});
```

`session` と `sheetId` の準備は次の例を参照してください。B2:E4に通常のセルを作り、すべての境界へ格子罫線を設定します。セルの値・数式は後から個別に編集でき、XLSXでも通常セルとして保存されます。既存セルの罫線だけを変える場合は `cells.borders` を使います。

## 画面なしでテーブルを作る

```ts
import { createWorkbook, createSpreadsheetSession } from "@likex/spreadsheet/model";

const session = createSpreadsheetSession(createWorkbook());
const sheetId = session.getWorkbook().sheets[0].id;
const result = session.execute({
  type: "tables.insert", sheetId, name: "Sales",
  target: { row: 1, column: 1 }, // B2
  headers: ["商品", "金額"],
  data: { type: "rows", values: [["商品A", "1200"], ["商品B", "2400"]] },
  rowNumbers: { header: "No.", start: 1 },
  headerStyle: { background: "#217346", color: "#ffffff" },
  onConflict: "error",
});
if (!result.ok) throw new Error(result.message);

const receipt = result.results[0];
console.log(receipt.tableId, receipt.range); // テーブルIDとB2:D4の範囲
if (receipt.type === "tables.insert") {
  console.log(receipt.placement); // { nextRow: 4, nextColumn: 4 }
}
const table = session.getTableByName("Sales");
console.log(table?.columns.map(column => column.name)); // ["No.", "商品", "金額"]
```

同じコマンドを `applySpreadsheetCommands`、または表示中の `await ref.current.executeAsync(command)` へ渡せます。GUIでは編集許可・入力規則・Undo/Redo・変更通知を通ります。

## 書き込みに使う引数

`cells.writeGrid` は `SpreadsheetCellGridWriteOptions` を使います。構造化テーブルを作る `tables.insert` は `SpreadsheetTableWriteOptions` に `name` を加えた指定で、従来どおり1行の `headers: readonly string[]` が必須です。階層見出し・左見出し・張り出し配置は `cells.writeGrid` 専用です。

| 引数 | 型・既定値 |
| --- | --- |
| `sheetId` | 対象シートのID |
| `target` | `{ row, column }`。見出し・張り出しを含む全体の左上を0始まりで指定 |
| `headers?` | 上見出し。文字列または `{ label, children?, style? }` の配列。`children` は同じ形式の配列 |
| `rowHeaders?` | 左見出し。`headers` と同じ階層形式 |
| `data` | `SpreadsheetTableData`。下記の明細データ |
| `headerStyle?` | `{ background?: string, color?: string }`。省略すると既存の色を維持 |
| `rowHeaderStyle?` | 左見出しの基本色。未指定の属性は `headerStyle` を引き継ぐ |
| `headerLayout?` / `rowHeaderLayout?` | `"merged"`（既定）または `"protruding"`。上・左の配置を個別指定 |
| `corner?` | `{ label?: string \| null, merge?: boolean, style?: { background?, color? }, border?: { style?, width?, color? } }`。上・左の見出しがある場合の交差領域。空ラベルは値なし・結合なし・罫線なしが既定。ラベルがあれば結合・`headerStyle`・共通の `border` を適用し、個別指定で上書き可能 |
| `border?` | `cells.writeGrid` の格子罫線。`false` または `{ style?, width?, color? }`。通常の既定は実線・1px・`#d1d5db`。`rowGrouping` 指定時の既定は `false` |
| `rowGrouping?` | `cells.writeGrid` の連続行のグループ化。`{ byColumns, keyDisplay?, separator?, headerSeparator?, verticalBorder?, outerBorder? }`。下記参照 |
| `insert?` | `"none"`（既定）/ `"rows"` / `"columns"` / `"both"`。見出し等を含む表全体の行数・列数を指定位置に挿入してから書き込む。`tables.insert` でも利用可能 |
| `rowNumbers?` | `false` または `{ header?: string, start?: number }`。指定時は左端に連番列を追加。見出しの既定は `No.`、開始値は1。`headers` が必要で、`rowHeaders` と併用不可 |
| `onConflict?` | `"error"` / `"overwrite"` / `"skip"`。既定は `overwrite` |

通常は本文・見出しに1pxのグレー（`#d1d5db`）の実線罫線を設定します。`cells.writeGrid` では `border` で変更でき、`false` なら書き込み対象のセルの罫線を消します。`rowGrouping` 指定時は下記のグループ境界の罫線が既定になります。空ラベルのコーナーと張り出し配置の空き領域には、通常の既定罫線を設定しません。その他の既存書式・入力規則・コメントは保持します。明細の値・数値・数式は文字列です。連番は通常の整数値を入れるもので、後の行挿入で自動採番する機能ではありません。

## 連続する行をグループ化する

`cells.writeGrid.rowGrouping`（`SpreadsheetGridRowGrouping`）は、指定した列の値が同じ連続行をまとめ、境界にだけ横罫線を付けます。担当者別の記録、案件別の作業一覧、カテゴリ別の明細などに使えます。内容・区分・期限といった列に特別な意味は持たせません。

```ts
const result = session.execute({
  type: "cells.writeGrid", sheetId,
  target: { row: 3, column: 0 }, // A4: ヘッダーを含む左上
  headers: ["担当者", "内容", "区分", "期限"],
  data: { type: "rows", values: [
    ["Aさん", "設計方針を確定する", "決定", ""],
    ["Aさん", "実装を開始する", "TODO", "11/10"],
    ["Bさん", "テスト項目を整理する", "TODO", "11/15"],
    ["Bさん", "検証期間を確保する", "決定", ""],
    ["Aさん", "日程を調整する", "TODO", "11/16"],
  ] },
  rowGrouping: { byColumns: [0] },
});
```

```text
担当者    内容                       区分       期限
─────────────────────────────────────────────────
Aさん     設計方針を確定する           決定
          実装を開始する               TODO       11/10
─────────────────────────────────────────────────
Bさん     テスト項目を整理する         TODO       11/15
          検証期間を確保する           決定
─────────────────────────────────────────────────
Aさん     日程を調整する               TODO       11/16
```

| `rowGrouping` の項目 | 既定値・意味 |
| --- | --- |
| `byColumns` | 必須。入力 `data` の0始まり列番号の配列。生成する連番列と左見出しは含まない。重複・範囲外・空配列は不可 |
| `keyDisplay` | `"first"`。グループ先頭以外の判定列には空文字を書き込む。`"all"` なら全行の値を書き込む |
| `separator` | グループ間の横罫線。実線・1px・`#d1d5db`。`false` で無効 |
| `headerSeparator` | 上見出しと本文の境界の横罫線。実線・1px・`#d1d5db`。`false` で無効。`separator` と独立 |
| `verticalBorder` | 内部の縦罫線。通常はなし。明示すると線種・太さ・色を指定できる |
| `outerBorder` | 表の外枠。通常はなし。末尾グループの下端にも線を付けない。明示すると指定の外枠を付ける |

罫線の項目はそれぞれ `false` または `{ style?, width?, color? }` です。省略した罫線属性は実線・1px・`#d1d5db` を使います。`border` を明示すると全セルの格子罫線を指定でき、その上からグループ境界・見出し境界の設定を適用します。`verticalBorder` / `outerBorder` の明示値は対応する辺を上書きし、`false` はその辺を消します。コーナーに個別指定した `corner.border` を優先します。空ラベルのコーナー自身は、`corner.border` を省略した場合は罫線なしを維持します。これらは保存する罫線の指定で、画面のシートグリッド線の表示設定とは別です。

判定は省略前の入力文字列の完全一致で行い、複数列の場合は全列の一致が必要です。大文字・小文字、前後の空白も区別します。数式は計算結果でなく入力式で比較します。空文字も値として比較し、前行の値を補完しません。A→B→Aは3グループで、並べ替えはしません。判定列以外は、値が連続していても毎行書き込みます。

本文のセルを自動結合せず、保存するのは通常のセル値・書式・罫線だけです。`keyDisplay: "first"` は表示専用の非表示機能ではなく、後続のキーセルを実際に空欄にします。各行のキー値を検索・集計に使う場合は `"all"` を指定してください。保存後のセル編集や並べ替えではグループ境界を自動再計算しません。SPONとXLSXで書き込んだ値・罫線を保持します。

上・左の階層見出しとも組み合わせられます。ただし、左見出しの結合がグループ境界をまたぐ場合は全幅の区切り線を表示できないため、区切り線を有効にした書き込みは失敗します。結合の構成を変更するか `separator: false` を指定してください。張り出し配置の空き領域は引き続き変更しません。`onConflict: "skip"` でも、判定列の値が競合する場合はグループと結果の不一致を防ぐため全体を拒否します。

## 行・列を挿入してから配置する

`cells.writeGrid` と `tables.insert` の `insert`（`SpreadsheetGridInsertMode`）で、既存データを移動させる空間を確保できます。

| `insert` | 動作 |
| --- | --- |
| `"none"` / 省略 | 現在のセルへ書き込む。既存値は `onConflict` に従う |
| `"rows"` | `target.row` に表全体の高さ分の行を挿入し、既存の行を下へ移動 |
| `"columns"` | `target.column` に表全体の幅分の列を挿入し、既存の列を右へ移動 |
| `"both"` | 上記の行・列挿入を両方行う |

挿入数は、階層見出し・左見出し・連番列・コーナー・張り出しの空き領域を含む外接矩形から計算します。挿入後も `target` が表全体の左上です。ヘッダーなしなら、その位置から本文が始まります。シートの不足分だけを末尾に追加する機能ではなく、指定位置でシート全体の行・列を挿入します。

```ts
await ref.current.executeAsync({
  type: "cells.writeGrid", sheetId,
  target: { row: 3, column: 0 }, // A4
  insert: "rows",
  headers: ["担当者", "内容", "区分"],
  data: { type: "rows", values: [
    ["Aさん", "設計を確定", "決定"],
    ["Aさん", "実装を開始", "TODO"],
    ["Bさん", "テストを準備", "TODO"],
  ] },
  rowGrouping: { byColumns: [0] },
});
// 4行を挿入。A4:C7へ配置し、元の4行目以降は8行目以降へ移動。
```

既存の数式参照・名前付き範囲・結合・書式・行高列幅・画像図形・フィルター・テーブルの位置は、通常の行列挿入と同じ経路で更新します。新しく渡した数式は挿入後の座標で指定します。構造化テーブル内部への列挿入など、既存の行列挿入が受け付けない位置は引き続き拒否します。

挿入軸では末尾（`rowCount` / `columnCount` と同じ位置）も指定できます。挿入しない軸の幅・高さは現在のシート内に収めます。行列の上限、入力規則、書き込みの競合などで失敗した場合は、挿入も書き込みも反映しません。表示中のコンポーネントでは全体を1回でUndoできます。`insertRows` / `insertColumns` の機能許可がそれぞれ追加で必要です。

```ts
// 二次元配列
const rows = { type: "rows", values: [["商品A", "1200"]] } as const;
// CSV / TSVは明細だけを指定します。ヘッダーはheadersへ別途渡します。
const csv = { type: "csv", text: '商品A,1200\n"商品B,セット",2400' } as const;
const tsv = { type: "tsv", text: "商品A\t1200\n商品B\t2400" } as const;
```

CSV/TSVは引用符内の区切り文字・改行、二重の引用符に対応します。各行の列数は同じにし、上見出しがある場合はその末端見出しの数と一致させます。左見出しがある場合はその末端数と明細の行数を一致させます。本文の順番は見出しツリーの末端を定義順に並べた順です。上見出しがあれば `data: { type: "rows", values: [] }` でヘッダーだけを配置できます。

`headers` と `rowHeaders` は省略できますが、指定する配列と `children` は空にできません。両見出しを省略した場合は本文だけを配置します。見出しの `label` は重複可能で、`001` や `=項目` も文字列として表示します。本文の値は既存のセル入力規則に従い、`=` で始まる値は文字列書式などで指定しなければ数式になります。

## 階層見出しとマトリクス

次の共通準備と各例を組み合わせて実行できます。例ごとに新しいブックを作るため、複数の例を続けて実行しても書き込み先は競合しません。戻り値の `workbook` をSpreadsheetの初期ブックとして渡すと表示できます。

```ts
import {
  createWorkbook,
  createSpreadsheetSession,
  type SpreadsheetCellGridWriteOptions,
} from "@likex/spreadsheet/model";

function makeGrid(options: Omit<SpreadsheetCellGridWriteOptions, "sheetId" | "target">) {
  const session = createSpreadsheetSession(createWorkbook());
  const sheetId = session.getWorkbook().sheets[0].id;
  const result = session.execute({
    type: "cells.writeGrid",
    sheetId,
    target: { row: 1, column: 1 }, // 見出しも含めB2から配置
    headerStyle: { background: "#217346", color: "#ffffff" },
    rowHeaderStyle: { background: "#e2f0d9", color: "#222222" },
    border: { style: "solid", width: 1, color: "#999999" },
    onConflict: "error",
    ...options,
  });
  if (!result.ok) throw new Error(result.message);
  const receipt = result.results[0];
  if (receipt.type !== "cells.writeGrid") throw new Error("Unexpected receipt");
  return { workbook: session.getWorkbook(), sheetId, layout: receipt.layout };
}
```

### 1. 上見出しだけの通常の表

```ts
const topOnly = makeGrid({
  headers: ["商品名", "数量"],
  data: { type: "rows", values: [["商品A", "10"], ["商品B", "20"]] },
});
```

### 2. 左見出しだけの表

```ts
const leftOnly = makeGrid({
  rowHeaders: ["商品名", "価格", "在庫"],
  data: { type: "rows", values: [["商品A"], ["1200"], ["50"]] },
});
```

### 3. 上・左に見出しがあるマトリクス

```ts
const matrix = makeGrid({
  headers: ["4月", "5月"],
  rowHeaders: ["商品A", "商品B"],
  corner: { label: "商品 / 月" },
  data: { type: "rows", values: [["100", "120"], ["200", "250"]] },
});
```

#### コーナーの空欄・罫線・色を指定する

コーナーは上見出しと左見出しの交差領域です。`corner` の省略、`label` の省略・`null`・空文字・空白文字だけの文字列は、いずれも値なしとして扱います。この場合、セルは結合せず、コーナー側の罫線はなしになり、`headerStyle` の色は自動適用しません。必要な罫線や色だけを `corner.border` / `corner.style` で指定できます。罫線や色の指定だけで結合されることはありません。

ラベルに文字があれば、複数セルの交差領域を結合し、`headerStyle` と共通の `border` を既定値として使います。`corner.style` / `corner.border` は指定した属性だけを上書きします。たとえば `corner.border: { color: "#217346" }` は、線種と太さを共通の `border` から補います。空ラベルでも `corner.border: {}` を明示すると共通の罫線を付けられます。

`corner.merge` で結合の有無も上書きできます。空ラベルでも `merge: true` なら結合し、ラベルありでも `merge: false` なら結合しません。結合しない場合、ラベルの値は交差領域の左上セルだけに入れ、ほかのセルの値は空にします。`layout.cornerRange` は結合の有無によらず交差領域全体を返します。

```ts
// 既定：2行×2列のコーナーは空欄・結合なし。罫線と自動の見出し色を付けない
const blankCorner = makeGrid({
  headers: [{ label: "売上", children: ["4月", "5月"] }],
  rowHeaders: [{ label: "商品", children: ["商品A", "商品B"] }],
  data: { type: "rows", values: [["100", "120"], ["200", "250"]] },
});

// 空欄・結合なしのまま、罫線を明示する。labelを省略、""、空白だけにしても同じ
const borderedBlankCorner = makeGrid({
  headers: [{ label: "売上", children: ["4月", "5月"] }],
  rowHeaders: [{ label: "商品", children: ["商品A", "商品B"] }],
  corner: { label: null, border: { color: "#217346" } },
  data: { type: "rows", values: [["100", "120"], ["200", "250"]] },
});

// ラベルあり：見出しの既定設定を使い、コーナーの色・線だけを上書きする
const styledCorner = makeGrid({
  headers: [{ label: "売上", children: ["4月", "5月"] }],
  rowHeaders: [{ label: "商品", children: ["商品A", "商品B"] }],
  corner: {
    label: "商品 / 月",
    style: { background: "#eeeeee", color: "#333333" },
    border: { style: "dashed", color: "#64748b" },
  },
  data: { type: "rows", values: [["100", "120"], ["200", "250"]] },
});

// 空欄のコーナーを結合したい場合だけ明示する。罫線と見出し色は付けない
const mergedBlankCorner = makeGrid({
  headers: [{ label: "売上", children: ["4月", "5月"] }],
  rowHeaders: [{ label: "商品", children: ["商品A", "商品B"] }],
  corner: { merge: true },
  data: { type: "rows", values: [["100", "120"], ["200", "250"]] },
});

// ラベルありでも結合しない。値は交差領域の左上セルだけに入る
const unmergedLabelCorner = makeGrid({
  headers: [{ label: "売上", children: ["4月", "5月"] }],
  rowHeaders: [{ label: "商品", children: ["商品A", "商品B"] }],
  corner: { label: "商品 / 月", merge: false },
  data: { type: "rows", values: [["100", "120"], ["200", "250"]] },
});
```

空欄のコーナーも書き込み対象で、既存の値のクリアには `onConflict` が適用されます。結合しない指定でも既存の結合を自動解除せず、書き込み先に不整合な結合があればエラーにします。罫線以外の未指定の既存書式は保持します。隣接する見出しが持つ罫線は消さないため、コーナーの右辺・下辺に隣接セル側の線が見える場合があります。張り出し配置による空き領域は、これと異なり値・書式・罫線を一切変更しません。

### 4. グループがある見出しと単独の見出しを混在させる

```ts
const mixed = makeGrid({
  headers: [
    { label: "2025年", children: ["売上", "利益"] },
    "備考",
  ],
  rowHeaders: [
    { label: "東日本", children: ["東京支店", "横浜支店"] },
    "大阪支店",
  ],
  corner: { label: "拠点別実績", style: { background: "#eeeeee", color: "#333333" } },
  data: { type: "rows", values: [
    ["1200", "240", "重点拠点"],
    ["860", "150", ""],
    ["1320", "270", ""],
  ] },
});
```

親の「2025年」は横結合、「東日本」は縦結合になります。既定の `"merged"` では、浅い「備考」は残りの見出し行を縦結合し、「大阪支店」は残りの見出し列を横結合します。この例の左上の交差領域はラベルがあるため、上見出しの深さ×左見出しの深さで結合します。

### 5. 通常のテーブルの右にマトリクスをつなげる

```ts
const combined = makeGrid({
  headers: [
    "コード", "商品名", "区分",
    { label: "売上", children: ["4月", "5月"] },
  ],
  data: { type: "rows", values: [
    ["A001", "商品A", "食品", "100", "120"],
    ["A002", "商品B", "雑貨", "200", "250"],
  ] },
});
```

コード・商品名・区分は通常の本文列として `data` に含めます。左見出しではないため、`rowHeaders` は指定しません。左右の本文を1つの配列にまとめ、5列の行として渡します。

### 6. 親グループだけ上・左へ張り出させる

```ts
const protruding = makeGrid({
  headers: ["商品名", { label: "売上", children: ["4月", "5月"] }],
  rowHeaders: ["東京", { label: "西日本", children: ["大阪", "福岡"] }],
  headerLayout: "protruding",
  rowHeaderLayout: "protruding",
  corner: { label: "拠点別実績" },
  data: { type: "rows", values: [
    ["商品A", "100", "120"],
    ["商品B", "200", "250"],
    ["商品C", "80", "90"],
  ] },
});
```

上の `"protruding"` は最上位の各見出しツリーを本文に近い下端へ、左側は右端へ寄せます。「商品名」の上と「東京」の左は空き領域になります。空き領域には値・書式・罫線を書き込まず、元の内容を保持します。各ツリーの内部は `"merged"` と同様に浅い末端を結合して長方形に整えます。`target` は空き領域も含む全体の左上で、指定位置より上や左には書き込みません。

### 7. 上・左とも3階層にする

```ts
const threeLevels = makeGrid({
  headers: [
    { label: "2026年", children: [
      { label: "第1四半期", children: ["売上", "利益"] },
      { label: "第2四半期", children: ["売上", "利益"] },
    ] },
  ],
  rowHeaders: [
    { label: "東日本", children: [
      { label: "東京支店", children: ["担当A", "担当B"] },
      { label: "横浜支店", children: ["担当C"] },
    ] },
  ],
  corner: { label: "担当別営業実績" },
  data: { type: "rows", values: [
    ["1000", "200", "1200", "240"],
    ["800", "160", "900", "180"],
    ["700", "140", "850", "170"],
  ] },
});
```

本文は末端見出しに対応する3行×4列です。この例の左上の交差領域はラベルがあるため、3行×3列で結合します。各見出しの `style` はその見出しだけに適用し、子見出しへは継承しません。各見出しで未指定の色は `headerStyle` または `rowHeaderStyle` から補います。

見出しツリー自体は保存せず、セル・書式・結合に変換します。そのためSPONとXLSXでは表示された構造を保持しますが、再読込後に元の `children` を復元するAPIはありません。既存の階層を別の構造へ置き換える場合は、必要な結合解除や値のクリアもコマンドで明示してください。

## 既存の値と結果

既存の非空の値を別の値へ変える場合を競合とします。同じ値や空セルは競合しません。`error` は全体を中止し、`skip` は競合セルの値・書式を残します。結合する見出し範囲内の競合を一部だけスキップすると配置が崩れるため、この場合は `skip` でも全体を中止します。構造化テーブルのヘッダーも同様に、列定義との不一致を防ぐため `WRITE_CONFLICT` で全体を中止します。詳しくは[書き込み時の競合](./cell-writing.md#既存の値を上書きするか)を参照してください。

生成する結合範囲と完全一致する既存結合は再利用できます。部分的に重なるなど互換性のない結合は、`overwrite` でも自動解除しません。新しい結合によって隠れるセルにコメントがある場合も中止し、コメントを黙って削除しません。検証に失敗すると、値・書式・結合の一部だけが変更されることはありません。

成功結果の `results[i]` に `range`、`placement`、`write` が入ります。`tables.insert` には生成した `tableId` も入ります。`write.changedCount` は値が変わったセル数で、罫線やテーブル定義だけの変更は数えません。ブック全体の変更判定は `result.changed` を使います。

`cells.writeGrid` の結果には `layout` も入ります。範囲はすべてシート上の絶対座標 `{ top, left, bottom, right }`（0始まり、両端を含む）です。`range` は張り出しで空いた領域も含む外接矩形で、`headerRanges` / `rowHeaderRanges` は各見出しの矩形です。

```ts
if (result.ok) {
  const receipt = result.results[0];
  if (receipt.type === "cells.writeGrid") {
    console.log(receipt.layout.dataRange);       // 本文。明細がない場合はundefined
    console.log(receipt.layout.headerRanges);    // 上見出しの範囲配列
    console.log(receipt.layout.rowHeaderRanges); // 左見出しの範囲配列
    console.log(receipt.layout.cornerRange);     // 結合の有無によらず交差領域。片側だけならundefined
    console.log(receipt.layout.merges);          // 今回の配置で使う結合範囲
  }
}
```

`getTable(workbook, tableId)` / `getTableByName(workbook, name)` は定義に `sheetId` とA1表記の `address` を添えた `SpreadsheetTableInfo` を返し、見つからなければ `undefined` です。`getTables(workbook, sheetId?)` は配列を返し、該当しなければ `[]` です。値は定義に複製せず、`getRange(workbook, table.sheetId, table.range)` で取得します。

## 定義を削除する

```ts
const table = session.getTableByName("Sales");
if (table) {
  const result = session.execute({ type: "tables.delete", sheetId: table.sheetId, tableId: table.id });
  if (!result.ok) throw new Error(result.message);
}
```

既定は定義だけの削除で、セルは残ります。`clear: "values"` は定義を外して値をクリアし、`clear: "all"` は書式・罫線・コメント・入力規則なども取り除きます。周囲のセルの位置は詰めません。結果には削除対象の `tableId` と `range` が入ります。

## GUI・機能設定・制限

「挿入」の「テーブル」は選択範囲の先頭行をヘッダーにし、残りを明細として登録します。名前を指定するダイアログが開きます。通常セルの罫線は「ホーム」の「罫線」で設定します。空のヘッダーは「列1」などで補います。離れた複数範囲や結合セルには作成できません。

`tables.insert` は `features.tables` と `features.formatting`、`cells.writeGrid` は `features.formatting` が必要です。`cells.writeGrid` が結合を生成する場合は `features.mergeCells` も必要です。`insert` で行・列を挿入する場合は、それぞれ `features.insertRows` / `features.insertColumns` も必要です。`features.tables` は階層見出し・マトリクスの配置には不要です。既定はONで、読み取り専用では作成・削除できません。`features.tables: false` でも既存の定義とセルは保持します。表示中のHandleでは編集許可・変更通知・Undo/Redoを通り、1コマンド全体を1回でUndoできます。

テーブル名はブック全体で一意で、名前付き範囲と重複できません。構造化テーブルの列名は空欄・改行なしの255文字以内で、大文字・小文字の違いだけでは重複できません。見出し・連番を含めて1操作10,000セルまでです。`cells.writeGrid` では張り出しの空き領域を含む外接矩形で数え、上・左それぞれの見出しツリーは合計10,000ノードまでです。`insert` で挿入しない軸がシートをはみ出す場合は、その軸を先に追加します。既存のテーブルに重なる新しいテーブルは作れません。

範囲の手前への行・列挿入では位置を移動し、内部への行挿入では範囲を広げます。テーブル内部の列の挿入・一部列の削除は、先にテーブル定義を外してください。ヘッダー行だけの削除も拒否します。ヘッダーを空欄にする変更など、定義が不整合になる操作は拒否します。XLSX出力ではExcelのテーブルとして保持します。構造化テーブルごとのフィルター状態・集計行・構造化参照の数式（`=SUM(Sales[金額])`）は未対応です。シートの[範囲フィルター](./filters.md)はテーブルと重ならない範囲へ別途設定できます。

## 既存APIとの互換性

`cells.writeTable` は削除しました。通常セルへの配置は `cells.writeGrid` に移行してください。引数はそのまま移行でき、`border` で格子罫線を指定できます。機能制御は `formatting`（数式を含む場合は `formulas` も）に統一しています。SPONの保存形式・バージョンは変わらず、保存済みデータの変換は不要です。
