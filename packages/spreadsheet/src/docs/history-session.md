# 画面なしの編集セッションとUndo／Redo

[利用ガイドへ戻る](./README.md)

複数回の編集を続けながらUndo／Redoを使う場合は、`createSpreadsheetSession` でセッションを作ります。React・DOM・コンポーネントは不要です。GUIと同じコマンド処理と履歴エンジンを使用します。

一度だけJSONへ変更を加える場合は、従来の `applySpreadsheetCommands` で十分です。

## セルを編集し、元に戻す

```ts
import { createWorkbook, createSpreadsheetSession, serializeWorkbook } from "@likex/spreadsheet/model";

const session = createSpreadsheetSession(createWorkbook(), { historyLimit: 50 });
const sheetId = session.getWorkbook().sheets[0].id;

const result = session.batch([
  { type: "cells.set", sheetId, values: { A1: "商品", B1: "金額" } },
  { type: "cells.set", sheetId, values: { A2: "サービス", B2: "1200" } },
]);
if (!result.ok) throw new Error(result.message);

console.log(session.getCell(sheetId, "A2")?.value); // "サービス"
console.log(session.getHistoryState().canUndo); // true

session.undo(); // 上のバッチ全体を戻す
console.log(session.getCell(sheetId, "A2")); // undefined
session.redo(); // 同じ結果に戻す

const json = serializeWorkbook(session.getWorkbook());
// 保存・認証・競合確認は利用側で行います。
```

## API一覧

| API | 動作 |
| --- | --- |
| `createSpreadsheetSession(workbook, options?)` | 検証・コピーしたブックから編集セッションを作る |
| `session.execute(command)` | 1件を実行して `SpreadsheetCommandResult` を返す |
| `session.batch(commands)` | 全件成功した場合だけ一括反映し、1回のUndo単位にする |
| `session.getWorkbook()` | 現在の凍結済みブックを取得する |
| `session.undo()` / `session.redo()` | 履歴を移動。実行できたら `true`、対象履歴がなければ `false` |
| `session.getHistoryState()` | `canUndo` / `canRedo` / `undoCount` / `redoCount` を取得する |
| `session.clearHistory()` | ブックを変えずに履歴だけを消す |
| `session.replaceWorkbook(workbook)` | 新しいブックを検証して置き換え、履歴を消す |
| `session.getCell(...)` / `getRange(...)` / `getImage(...)` など | 現在のブックから対象を取得。[読み取りAPI](./data-access.md)と同じ契約 |

オプションは `features?: SpreadsheetFeatures` と `historyLimit?: number` です。機能設定はGUIと同じ名前・依存関係で解決します。履歴上限は既定50、0〜1,000の整数です。`historyLimit: 0` または `features: { undoRedo: false }` では履歴を記録しません。

同じ値の設定や空のバッチは履歴を増やしません。失敗したバッチはブックと履歴を変えません。Undo後に新しい変更を反映するとRedo履歴を消します。Undo／Redoで復元する画像やコメントのIDは、もとの操作結果のIDを維持します。

履歴はセッションのメモリ上にだけ保持し、ブックJSONへ追加しません。保存JSONだけから過去のUndo履歴を復元することはできません。セッションを作り直すか `replaceWorkbook` を呼ぶと、新しいブックが履歴の起点になります。

## `getHistoryState()` の戻り値

`session.getHistoryState()` と表示中コンポーネントの `SpreadsheetHandle.getHistoryState()` は、同じ `SpreadsheetHistoryState` を同期的に返します。すべて必須フィールドで、`null` / `undefined` はありません。

```ts
type SpreadsheetHistoryState = Readonly<{
  canUndo: boolean;  // 戻せる履歴が1件以上ある
  canRedo: boolean;  // やり直せる履歴が1件以上ある
  undoCount: number; // 戻せる操作単位の件数（0以上の整数）
  redoCount: number; // やり直せる操作単位の件数（0以上の整数）
}>;

// 冒頭の例で、1バッチを実行してUndo→Redoした後。
const history = session.getHistoryState();
// { canUndo: true, canRedo: false, undoCount: 1, redoCount: 0 }

session.undo();
const afterUndo = session.getHistoryState();
// { canUndo: false, canRedo: true, undoCount: 0, redoCount: 1 }
```

件数はセル数やバッチ内のコマンド数ではなく、Undo／Redoの操作単位です。結果は凍結されたスナップショットなので、後で操作しても取得済みの `history` は変わりません。

`canUndo` / `canRedo` は履歴の有無を表します。GUIが読み取り専用、保存中、機能OFFなどの場合は、履歴があっても実行できないことがあります。実際の操作結果は `await api.undo()` / `await api.redo()` の `boolean` で確認してください。

## コピー・貼り付け・移動

コピー用データの作成もGUIなしで行えます。

```ts
import { createWorkbook, createSpreadsheetSession, copySpreadsheetCells } from "@likex/spreadsheet/model";

const session = createSpreadsheetSession(createWorkbook());
const sheetId = session.getWorkbook().sheets[0].id;
const entered = session.execute({ type: "cells.set", sheetId, values: { A1: "10", B1: "=A1*2" } });
if (!entered.ok) throw new Error(entered.message);

const payload = copySpreadsheetCells(session.getWorkbook(), sheetId,
  { top: 0, left: 0, bottom: 0, right: 1 });
const pasted = session.execute({ type: "cells.paste", sheetId,
  target: { row: 2, column: 0 }, payload });
if (!pasted.ok) throw new Error(pasted.message);
// A3: "10"、B3: "=A3*2"

const moved = session.execute({ type: "cells.move", sheetId,
  source: { sheetId, top: 2, left: 0, bottom: 2, right: 1 },
  target: { row: 4, column: 0 } });
if (!moved.ok) throw new Error(moved.message);
// A3:B3からA5:B5へ移動
```

`copySpreadsheetCells` は値・書式・入力規則・コメント・結合情報とコピー元座標を持つ `SpreadsheetPastePayload` を返します。ブックやOSクリップボードは変更しません。`cells.paste` の `mode` には `all` / `values` / `formulas` / `formats` を指定できます。省略時は `all` です。コピー時のコメントには新しいIDを付け、移動では既存IDを維持します。

コピー関数の第4引数 `SpreadsheetCopyOptions` には `features`、`kind`、`partialMerges` を指定できます。`features` はコピー時に使う機能設定、`kind` は `"copy"`（既定）または `"cut"` です。`kind: "cut"` も読み取りだけで、セルは移動しません。保存データの変更は `cells.move` で行います。画面なしの独立したコピー関数には、必要な機能設定を明示して渡してください。

`partialMerges?: "reject" | "skip"` の既定値は `"reject"` です。`"skip"` を指定してコピーすると、範囲に一部しか含まれない結合の中を空セルとして扱い、完全に含まれる結合は通常どおりコピーします。貼り付け側も横断する結合を保護したい場合は、`cells.paste` コマンドに別途 `partialMerges: "skip"` を指定します。切り取り・`cells.move` は部分的な結合を許可しません。

```ts
// 上のsessionで、C列をコピーしてD列へ貼り付けます。
const lastRow = session.getWorkbook().sheets[0].rowCount - 1;
const columnPayload = copySpreadsheetCells(session.getWorkbook(), sheetId,
  { top: 0, left: 2, bottom: lastRow, right: 2 },
  { partialMerges: "skip" });
const columnPaste = session.execute({ type: "cells.paste", sheetId,
  target: { row: 0, column: 3 }, payload: columnPayload, partialMerges: "skip" });
if (!columnPaste.ok) throw new Error(columnPaste.message);
```

`cells.move` はコピー用データではなく、実行時点の移動元を参照します。コピー先へ書いた後に元を削除する2操作に分けず、単一のコマンドとして実行するため、重なる範囲や参照の調整も共通処理に任せられます。移動先は外側の `sheetId`、移動元は `source.sheetId` で指定します。

`cells.paste` / `cells.move` は、移動先の行・列が足りなければ必要な大きさまで末尾を拡張します。行・列の追加と内容の反映は同じUndo単位で、失敗した場合はどちらも反映しません。必要な行列追加の機能設定と上限は、[末尾の自動拡張](./external-operations.md#貼り付け先の行列が足りない場合)を参照してください。

## GUIとの境界

GUIのセル確定、削除、貼り付け、移動、行列・書式・画像などの変更は同じコマンド処理を使います。Undo／Redoの履歴管理もセッションと共通です。GUIは選択や編集中の文字列、ダイアログ、ブラウザのクリップボード入出力を扱います。

表示中のコンポーネントには別のセッションを作らず、`ref` の `execute` / `batch`、`undo` / `redo` を使います。`await api.undo()` / `await api.redo()` は必要な編集許可を待ちます。保存中、読み取り専用、セル・コメント・図形の未確定入力がある場合などは `false` を返し、入力を勝手に捨てません。

リボンのプルダウンや色選択を操作した後も、そのコントロールにフォーカスを残したまま `Ctrl / Cmd + Z` でUndo、`Ctrl / Cmd + Shift + Z` または `Ctrl + Y` でRedoできます。セルの編集中や、数式バー・検索欄などのテキスト入力では、入力欄本来のUndo／Redoを優先します。

GUIのセル操作では、操作開始時の実際の選択を履歴に記録します。Undo／Redoのどちらでも、その操作に記録した選択を復元します。たとえば空白セルを含むA1:C3を選択して書式を変え、その後D8へ移動していても、Undo／RedoではA1:C3を選択します。変更されたセルの差分や、Undo／Redo直前の位置から範囲を作り直しません。

複数範囲は元の順序と各範囲の `anchor` / `focus` による方向、`kind` を保持し、選択全体のアクティブセルも復元します。GUIの履歴を `api.undo()` / `api.redo()` から操作した場合も同じです。

| 履歴の変更内容 | Undo／Redo後の選択 |
| --- | --- |
| GUIのセル値・書式・入力規則・コメントなど | 操作開始時に記録した選択。空白を含む長方形や、元々の複数範囲もそのまま復元 |
| GUIの貼り付け・切り取り後の貼り付け | 実際の転送先範囲を記録して復元。貼り付け前の選択サイズには戻さない |
| GUIの行列の挿入・削除、結合、シート構成の変更 | 記録した選択を復元し、復元先のシート寸法に収まるよう補正 |
| 画像・図形・テキストボックスだけの変更 | 変更したオブジェクト。Undoで挿入を取り消す場合など、そのオブジェクトがなくなるときはアンカーのセル |
| 外部APIコマンドによるセルの変更 | GUIの選択とは別の対象を指定できるため、変更されたセルを含む範囲を選択。複数シートでは表示中のシートを優先し、対象でなければ最初の対象シートへ移動 |
| 外部APIコマンドによる行列・結合・シート構成の変更 | 現在の選択を復元後の有効な範囲へ補正 |

貼り付けによるシートの自動拡張をUndoして、記録した転送範囲がシート外へ出る場合も、有効な範囲へ補正します。補正によって履歴内の元の範囲は書き換えず、Redoで寸法が戻れば元の範囲を復元します。構造操作も同じ補正を行い、復元対象のシートがなくなる場合は先頭シートのA1を選択します。

選択の記録はコンポーネント内の履歴にだけ保持し、保存JSONや公開の画面なしセッションには含めません。コンポーネント外の入力欄などにDOMフォーカスがある場合、そのフォーカスは奪いません。ブック内の選択更新と、キーボード入力先のフォーカス移動は区別します。保存成功・再読み込み・変更の破棄では従来どおり画面状態をリセットします。

画面なしのセッションは `onSave` や `onEditRequest` を呼びません。通信や認証、共同編集のロックは呼び出し側で行います。入力中のUI状態をAPIへ持ち込まず、データ操作と環境依存の処理を分けています。
