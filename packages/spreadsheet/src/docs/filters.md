# 範囲のフィルター

[利用ガイドへ戻る](./README.md)

「データ」の「フィルター」で選択範囲に絞り込みを設定できます。範囲の先頭行を見出しとして扱い、各列のボタンから表示する値をチェックします。同じ列で選んだ値はOR、複数列の条件はANDです。見出しと範囲外の行は残り、条件に合わない行は行全体を非表示にします。セル・数式・行高は削除しません。

## 範囲と値の選び方

- 複数行の矩形を選んだ場合は、その範囲をそのまま使います。
- 見出しの1行だけを選んだ場合は、選択した列の下にある最後の値・数式まで広げます。途中の空行も含み、書式だけの空セルでは範囲を広げません。列方向は選択した幅のままです。
- 1シートに1つのフィルター範囲を持ちます。先頭行は常に見出しです。列の候補一覧は、他の列の条件で残る行の値から作ります。
- 数式は計算結果、数値は表示形式を反映した文字列で判定します。空白は「空白セル」として選択できます。大文字・小文字を区別しない一致判定です。候補一覧内の検索は候補を探すだけで、確定までは行を絞り込みません。

条件のクリアは範囲とボタンを残して全行を表示します。フィルターの解除は範囲自体を外します。編集可能な画面ではこれらも保存・`onChange`・Undo／Redoの対象になり、通常の編集許可と処理中の制御を通ります。

読み取り専用（`readOnly`、または `onSave` なし）でも絞り込めます。この場合は表示中だけの一時設定で、ブック・未保存状態・履歴を変更せず、SPONやXLSXへの出力にも含めません。`features={{ filters: false }}` は操作UIとフィルターAPIを無効にします。保存済みのフィルター設定は保持します。

## 保存する設定をAPIから変更する

GUIと同じ処理を `executeAsync` / `batchAsync`、画面なしの `applySpreadsheetCommands` / 編集セッションから使えます。

```ts
import { applySpreadsheetCommands } from "@likex/spreadsheet/model";

const result = applySpreadsheetCommands(workbook, [
  {
    type: "filters.setRange", sheetId,
    range: { top: 0, left: 0, bottom: 0, right: 2 },
    // 見出しだけなので、下の値・数式まで自動で広がります。
  },
  { type: "filters.setValues", sheetId, column: 1, values: ["確定", "確認中"] },
]);
if (!result.ok) throw new Error(result.message);
```

`column` はフィルター内の相対位置ではなく、シート上の0始まりの列番号です。上の `1` はB列です。`range` は両端を含む0始まりの矩形です。

| コマンド | 引数・動作 |
| --- | --- |
| `filters.setRange` | `sheetId`, `range`, `inferRows?`。新しい範囲へ置き換え、以前の条件をクリアします。`inferRows` の省略時は見出し1行だけの場合に下方向を推定。`false` は指定どおり、`true` は複数行の指定からも下へ広げます。 |
| `filters.setValues` | `sheetId`, `column`, `values`。文字列配列は表示を許可する値、`[]` は全データ行を非表示、`null` はその列の条件を解除します。`""` は空白です。 |
| `filters.clear` | `sheetId`。すべての列条件を解除し、見出しボタンを残します。 |
| `filters.remove` | `sheetId`。フィルター範囲と条件を解除します。 |

保存する操作には通常の `features`・読み取り専用・編集許可・Undo／Redoの規約が適用されます。読み取り専用では `execute` で保存設定を変更できません。一時的な閲覧設定は次のAPIを使います。

## 閲覧だけの絞り込み

```ts
const api = spreadsheetRef.current!;
api.setFilterView(sheetId, {
  range: { top: 0, left: 0, bottom: 99, right: 2 },
  columns: [{ column: 1, values: ["確定"] }],
});

console.log(api.getFilterView(sheetId)); // 現在表示に使っている設定
console.log(api.getFilteredRows(sheetId)); // 非表示にした元の0始まり行番号
api.setFilterView(sheetId, null); // 表示中だけフィルターを解除
api.resetFilterView(sheetId); // 保存済みの設定に戻す
```

これらは編集可能な画面でも表示だけを変更します。`setFilterView` の範囲は指定どおりで、下方向の推定は行いません。変更APIは変更時 `true`、同じ設定・機能OFF・対象不明・不正な範囲・操作できない状態では `false` を返します。フィルターの有効な表示設定は `getFilterView` で読み、保存する設定は `getWorkbook().sheets[].autoFilter` で読んでください。

一時設定はシートを切り替えても保持しますが、ブックの編集・Undo／Redo・再読み込み・破棄で保存設定へ戻ります。古い行列座標を変更後のブックへ適用しないためです。一時設定の操作は `onEvent` に `{ type: "filter-view-change", sheetId, autoFilter }` を通知し、解除時の `autoFilter` は `null` です。セルや図形の未確定入力がある間は、先に確定またはキャンセルしてください。

画面なしで候補や非表示行を計算する場合は、次の公開ヘルパーを使います。別シート参照の数式を評価する場合は、ブック全体の計算結果を渡します。

```ts
import { calculateWorkbook, getSpreadsheetFilterValues,
  getSpreadsheetFilteredRows, resolveSpreadsheetFilterRange } from "@likex/spreadsheet/model";

const values = calculateWorkbook(workbook)[sheet.id];
const candidates = getSpreadsheetFilterValues(sheet, 1, values);
const hiddenRows = getSpreadsheetFilteredRows(sheet, values); // ReadonlySet<number>
const inferred = resolveSpreadsheetFilterRange(sheet,
  { top: 0, left: 0, bottom: 0, right: 2 });
```

## SPON・Excelとの往復と制約

保存データには任意の `sheet.autoFilter` を追加します。既存のSPON v2と互換性があり、範囲・条件のない従来のファイルもそのまま読み込めます。

```ts
autoFilter: {
  range: { top: 0, left: 0, bottom: 99, right: 2 },
  columns: [{ column: 1, values: ["確定", ""] }],
}
```

行列の挿入・削除で範囲と列番号を追随させます。非表示でも元の行番号を保持し、数式の参照先を変えません。複数行の結合セル・描画はアンカー行が非表示なら隠れます。範囲のコピー・編集・削除は元の座標上の範囲を対象とし、非表示行だけを自動で除外する機能ではありません。

XLSXのシート `autoFilter` は範囲、値一覧、空白条件を読み書きし、出力時には条件から計算した非表示行も保存します。手動の行・列非表示は保存せず、条件に含まれない非表示行を取り込むと警告付きで表示します。並べ替え、比較式・上位件数・色・日付グループ等の高度な条件は未対応です。取り込みでは対応しない条件の列だけを警告付きで解除し、対応する他列の条件とセル値は保持します。通常の値と未対応の日付グループ等が同じ列に混在する場合も、その列全体の条件を解除します。

値一覧は表示文字列を保存します。ExcelとLikeXで数値・日付・通貨の表示形式やロケールが異なれば、同じ値でも文字列が一致せず絞り込み結果が変わる場合があります。未対応の表示形式を変換したファイルでは、候補から条件を選び直してください。Excelの高度な日付グループ条件を、表示文字列の値一覧へ勝手に変換しません。

構造化テーブル自身のフィルター状態は別の未対応機能です。シートの範囲フィルターは構造化テーブルと重ならない範囲に設定します。取り込みではテーブル固有の条件を明示的に警告して省略します。テーブルと重なるシートフィルターがあれば、テーブル定義とセル値を保持してシートフィルターだけを警告付きで省略します。複数の構造化テーブルの条件を、1つのシートフィルターに合成しません。シートフィルターは並べ替えや集計行を追加する機能ではありません。
