# セル範囲をずらして挿入・削除する

[利用ガイドへ戻る](./README.md)

セルや矩形範囲を右クリックし、「挿入…」「削除…」から方向を選びます。同じ操作を `SpreadsheetHandle`、編集セッション、画面なしの `applySpreadsheetCommands` から実行できます。

## どのセルが動くか

`B3:D4`（2行×3列）を選択した場合の例です。

| 操作 | 動作 |
| --- | --- |
| 下方向にシフト | B〜D列の3行目以降を2行下へずらし、B3:D4を空ける |
| 右方向にシフト | 3〜4行目のB列以降を3列右へずらし、B3:D4を空ける |
| 上方向にシフト | B3:D4を削除し、B〜D列の5行目以降を2行上へ詰める |
| 左方向にシフト | B3:D4を削除し、3〜4行目のE列以降を3列左へ詰める |
| 行全体 | 3〜4行目全体を挿入／削除する |
| 列全体 | B〜D列全体を挿入／削除する |

離れた複数範囲のセルシフトには対応していません。行番号・列名の右クリックによる既存の行・列操作は引き続き利用できます。

## 外部コマンド

```ts
const inserted = await api.executeAsync({
  type: "cells.insert", sheetId, range: "B3:D4", shift: "down",
});
if (!inserted.ok) throw new Error(inserted.message);

const deleted = await api.executeAsync({
  type: "cells.delete", sheetId, range: "B3:D4", shift: "up",
});
if (!deleted.ok) throw new Error(deleted.message);
```

| 引数 | 指定 |
| --- | --- |
| `sheetId` | 対象のシートID |
| `range` | `"B3:D4"` または `{ top: 2, left: 1, bottom: 3, right: 3 }`。数値は0始まり・両端を含む |
| `cells.insert.shift` | 必須。`"down"` または `"right"` |
| `cells.delete.shift` | `"up"` または `"left"`。省略時は周囲を動かさず、値・書式などをすべてクリアする従来の動作 |

行・列全体の場合は、`rows.insert` / `columns.insert` / `rows.delete` / `columns.delete` を使います。GUIのダイアログもこれらの公開コマンドを呼びます。

```ts
import { applySpreadsheetCommands } from "@likex/spreadsheet/model";

// 画面なしで空きを作り、同じバッチ内で値を入れる。
const result = applySpreadsheetCommands(workbook, [
  { type: "cells.insert", sheetId, range: "B3:C4", shift: "down" },
  { type: "cells.set", sheetId, values: { B3: "商品A", C3: "100", B4: "商品B", C4: "200" } },
]);
if (!result.ok) throw new Error(result.message);
const nextWorkbook = result.workbook;
```

成功結果の `range` は指定した範囲、`write` は移動や参照更新を含む保存値の変更件数です。`cells.insert` には `placement: { nextRow, nextColumn }` も付き、`B3:D4` なら `{ nextRow: 4, nextColumn: 4 }` です。削除には `placement` を返しません。

## データの扱いと制限

値、書式、罫線、入力規則、コメントを一緒に移動します。別シートを含む数式参照も追従し、削除された参照先は `#REF!` になります。画像・図形はアンカー位置に追従します。

名前付き範囲・結合セル・テーブル・条件付き書式も整合性を検証します。部分移動で長方形の範囲が崩れる場合や、結合セルを分断する場合は、操作全体をエラーにします。数式の範囲参照が長方形では表せなくなる場合も同様です。ブック内に参照を解析できない数式がある場合も、安全に追従できないため操作を拒否します。テーブルの列定義を部分的に変える操作や、ヘッダーだけの削除には対応していません。

挿入で既存データなどがシート外へ押し出される場合は、必要な行数・列数まで自動拡張します。上限は10,000行・1,000列、指定範囲は10,000セルです。上限超過時にデータを切り捨てることはありません。セルシフトでは行高・列幅を移動しません。セルの削除でもシート全体の行数・列数は減りません。

エラー時は変更・履歴を残さず、バッチも全体を取り消します。成功したGUI操作はUndo／Redoの対象です。Delete／Backspaceは従来どおり値のみのクリアです。

## 機能の設定

```tsx
<Spreadsheet onSave={saveWorkbook}
  features={{ insertCells: true, deleteCells: false }} />
```

両方とも既定はONです。`rowColumnOperations: false` はセルシフトと行・列全体の操作をまとめて無効にします。`insertRows` / `deleteRows` / `insertColumns` / `deleteColumns` は行・列全体の選択肢を個別に制御します。読み取り専用や編集許可の確認はほかの変更操作と共通です。

`deleteCells` は上・左へ詰める削除の設定です。`shift` を省略した `cells.delete` や「すべてクリア」は従来の書式・コメント・入力規則などの機能設定で制御します。
