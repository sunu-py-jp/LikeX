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

コピー関数の第4引数には `{ features, kind }` を指定できます。`features` はコピー時に使う機能設定、`kind` は `"copy"`（既定）または `"cut"` です。`kind: "cut"` も読み取りだけで、セルは移動しません。保存データの変更は `cells.move` で行います。画面なしの独立したコピー関数には、必要な機能設定を明示して渡してください。

`cells.move` はコピー用データではなく、実行時点の移動元を参照します。コピー先へ書いた後に元を削除する2操作に分けず、単一のコマンドとして実行するため、重なる範囲や参照の調整も共通処理に任せられます。移動先は外側の `sheetId`、移動元は `source.sheetId` で指定します。

## GUIとの境界

GUIのセル確定、削除、貼り付け、移動、行列・書式・画像などの変更は同じコマンド処理を使います。Undo／Redoの履歴管理もセッションと共通です。GUIは選択や編集中の文字列、ダイアログ、ブラウザのクリップボード入出力を扱います。

表示中のコンポーネントには別のセッションを作らず、`ref` の `execute` / `batch`、`undo` / `redo` を使います。`await api.undo()` / `await api.redo()` は必要な編集許可を待ちます。保存中、読み取り専用、セル・コメント・図形の未確定入力がある場合などは `false` を返し、入力を勝手に捨てません。

GUIのUndo／Redoは、現在の複数の選択範囲とアクティブセルを維持します。選択中の画像・図形・テキストボックスも、同じIDが復元後に存在すれば選択を保ちます。行列が小さくなった場合は各範囲を補正し、対象オブジェクトがなくなればセルへ戻ります。表示中のシートがなくなる場合は先頭シートのA1です。過去の選択状態を履歴から復元する機能ではなく、保存成功・再読み込み・変更の破棄では従来どおり画面状態をリセットします。

画面なしのセッションは `onSave` や `onEditRequest` を呼びません。通信や認証、共同編集のロックは呼び出し側で行います。入力中のUI状態をAPIへ持ち込まず、データ操作と環境依存の処理を分けています。
