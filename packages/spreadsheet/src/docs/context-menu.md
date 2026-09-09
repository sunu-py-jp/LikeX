# 条件付きの右クリックメニュー

[利用ガイドへ戻る](./README.md)

`getContextMenuItems(context)` でセルやシートタブのメニューを追加できます。条件に合わなければ `[]` を返します。シートタブには既定で「削除」があり、追加項目はその上に表示します。削除は `getContextMenuItems` を指定しなくても利用でき、最後の1シートでは無効、読み取り専用や `features.deleteSheet: false` では非表示です。

メニュー生成は同期処理です。AI通信などの時間がかかる処理は、項目を選んだ後の `onSelect` で実行します。

```tsx
import Spreadsheet, { type SpreadsheetContextMenuProvider } from "@likex/spreadsheet";

const getContextMenuItems: SpreadsheetContextMenuProvider = context => {
  if (context.target.kind !== "cell" || context.readOnly || !context.features.formulas) return [];
  return [{
    id: "generate-formula",
    label: "AIで数式を作成",
    async onSelect(context, { signal, requestId }) {
      if (context.target.kind !== "cell") return;
      const response = await fetch("/api/formulas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({ requestId, target: context.target,
          selection: context.selection, workbook: context.workbook }),
      });
      if (!response.ok) throw new Error("数式を生成できませんでした");
      const { formula } = await response.json();
      if (typeof formula !== "string" || !formula.startsWith("="))
        throw new Error("数式の応答を確認してください");
      return {
        description: `${context.target.address} に ${formula} を設定します。`,
        change: [{ type: "cells.set", sheetId: context.target.sheetId,
          values: { [context.target.address]: formula } }],
      };
    },
  }];
};

<Spreadsheet
  initialWorkbook={workbook}
  onSave={saveWorkbook}
  getContextMenuItems={getContextMenuItems}
  contextMenuExecutionMode="block"
/>;
```

これは連携例です。認証・外部API・生成内容の業務上の検証は利用側が担当します。コンポーネントは返されたコマンドを既存の機能設定・入力検証・編集許可に通し、まとめて一度のUndoで戻せる下書き変更として反映します。保存は別途 `onSave` で行います。

## 渡される情報

`SpreadsheetContextMenuContext` は読み取り専用の型です。

| 項目 | 内容 |
| --- | --- |
| `target` | セルでは `{ kind: "cell", sheetId, row, column, address }`、シートタブでは `{ kind: "sheet", sheetId, name, index }`。行・列・シート位置は0始まり、`address` は `B3` など。利用前に `target.kind` で判別します。 |
| `selection` | 既存の選択状態。`ranges` に離れた選択範囲も含みます。 |
| `workbook` | メニューを開いた時点の、確定済みのローカル下書き全体。 |
| `features` | 既定値・親スイッチを解決した各機能のON/OFF。 |
| `readOnly` | 読み取り専用かどうか。 |

右クリックでは選択範囲を変更しません。たとえばA1:A3を選択したままB3を右クリックすると、`selection` はA1:A3、`target.address` はB3です。複数範囲のSUMを組み立てる場合、反映先が参照範囲に含まれないよう利用側で除外し、循環参照を避けてください。

非アクティブなシートタブを右クリックしても、表示中のシートと選択範囲は維持します。「削除」とカスタム項目の `target.sheetId` は右クリックしたシートを指します。シートの並び順はタブのドラッグ＆ドロップで変更できます。

セルやテキストを編集中は独自メニューを開かず、ブラウザの通常のテキスト操作を維持します。入力を確定してから実行してください。

## 処理中の変更と反映

共通型 `ContextMenuExecutionMode` は `@likex/core` と `@likex/spreadsheet` からimportできます。

| モード | 処理中 | 結果の反映 |
| --- | --- | --- |
| `block`（既定） | データ変更を禁止。閲覧・選択・スクロールは可能。 | 処理終了後に反映。 |
| `confirm` | データ変更を許可。 | 変更の有無にかかわらず、説明付きの確認後に反映。 |
| `reject-if-changed` | データ変更を許可。 | 処理中にブックが変更されたら反映せず、再実行を案内。 |

`onSelect` は `SpreadsheetContextMenuChange`（`readonly SpreadsheetCommand[]`）を `change` に入れて返します。任意の `description` は確認ダイアログに表示されます。外部の画面を開くだけなど、下書きを変更しない処理では何も返さなくても構いません。その場合は結果反映の確認を行いません。

親の入力ダイアログがキャンセルされた場合は `throw new DOMException("キャンセル", "AbortError")` とすると、成功・失敗とは区別して `cancelled` と通知します。

`onSelect` から開く入力ダイアログの見た目、余白、フォーカス管理は利用側が担当します。Coreはダイアログを描画しません。結果反映の確認ダイアログはSpreadsheet側が表示します。上記の実行モードはカスタム項目に適用され、既定の「削除」は通常のシート操作として実行します。

`onSelect` の中で `ref.current.execute` 等を呼んで書き込まず、変更予定を返してください。これにより確認前の書き込みを防げます。処理は同じコンポーネントで一つずつ実行し、進行表示の「キャンセル」で中止できます。`signal` を無視して遅れて返された結果も適用しません。

反映直前と非同期の編集許可取得後に、処理と対象が有効か再確認します。セルが対象の場合は、行・列の追加削除、セル結合、シート構成の変更、再読み込み等が挟まると、座標が同じでも別の対象になり得るため反映を中止します。現状は安全側に判定し、別シートの構成変更やUndo/Redoでも再実行を求めます。シートタブが対象の場合はIDで存在を確認するため、並べ替えや名前変更後も同じシートへ反映でき、削除済みなら中止します。`reject-if-changed` はどちらの対象でもブックの変更を検出します。

結果を実際に反映している間は全モードで他の変更を止めます。`block` および反映中は、GUIだけでなく外部操作API・保存・再読み込み・破棄も制御します。別ユーザーのDB更新までは禁止しないため、利用側のロック・保存時の競合検証も引き続き必要です。

## イベントと操作

`onEvent` から `type: "context-menu"` のイベントを受け取れます。`status` は `start`・`confirmation-required`・`success`・`cancelled`・`error`。`requestId`、`itemId`、`label`、エラー時の `message` を含みます。反映した場合は通常の変更イベント（`source: "ui"`）も発生します。

メニューは矢印キー・Home/Endで項目を移動し、Enter/Spaceで選択、Escape・Tab・外側クリックで閉じます。セルやシートタブ上のShift+F10またはContext Menuキーでも開けます。反映の確認は表示領域の中央に表示し、Escapeや背景クリックでキャンセルできます。

公開型は `SpreadsheetContextMenuContext`、`SpreadsheetContextMenuItem`、`SpreadsheetContextMenuProvider`、`SpreadsheetContextMenuChange` です。Coreがメニュー定義と非同期実行の方針、Spreadsheetがセル／シート対象・コマンド・表示を担当します。
