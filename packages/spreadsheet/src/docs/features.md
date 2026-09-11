# 機能のON/OFF

[利用ガイドへ戻る](./README.md)

`features` は型付きの `SpreadsheetFeatures` です。省略した項目は有効です。`false` にした機能はボタンやメニューから消え、キーボード操作や外部の `execute` / `batch` からも実行できなくなります。

```tsx
import { Spreadsheet, type SpreadsheetFeatures } from "@likex/spreadsheet";

const features = {
  copy: false,
  cut: true,
  paste: true,
  deleteRows: false,
  deleteColumns: false,
  createSheet: false,
} satisfies SpreadsheetFeatures;

<Spreadsheet initialWorkbook={workbook} onSave={saveWorkbook} features={features} />;
```

この例ではコピーを隠し、切り取りと貼り付けによる移動を許可します。行・列を削除できませんが、追加は可能です。新しいシートは作れませんが、既存のシートを開いたり名前を変更したりできます。

## 設定一覧

| 設定 | 無効になる操作・表示 |
| --- | --- |
| `formulas` | 数式の入力、関数の挿入、数式バー。既存の数式は計算・表示します。 |
| `clipboard` | コピー・切り取り・貼り付け全体。 |
| `copy` | セルのコピー。 |
| `cut` | セルの切り取り。 |
| `paste` | セルへの貼り付け。 |
| `pasteSpecial` | 値・数式・書式のみの貼り付け。`clipboard` と `paste` も有効である必要があります。 |
| `search` | セルの検索。読み取り専用でも利用できます。無効にすると置換も無効です。 |
| `replace` | 検索結果の置換。`search` も有効である必要があります。 |
| `autoFill` | セル範囲のハンドルによる連番・値・数式の展開と `cells.fill`。 |
| `namedRanges` | 名前付き範囲の追加・変更・削除・クリア、名前ボックスでの範囲参照。既存の定義は保持します。 |
| `tables` | テーブルの作成・削除、罫線付きの表の書き込み。作成・書き込みには `formatting` も必要です。既存の定義とセルは保持します。 |
| `formatting` | セルの書式変更。既存の書式は表示します。 |
| `conditionalFormatting` | 条件付き書式の設定・解除。`formatting` も有効である必要があります。既存の規則は表示します。 |
| `dataValidation` | 入力規則の設定・解除、セル内のプルダウン・チェックボックス操作。既存の規則は保存・検証し続けます。[詳細](./input-validation.md) |
| `checkboxes` | チェックボックスの設定・操作。既存セルは `TRUE` / `FALSE` の値として表示し、規則は維持します。規則の解除には `dataValidation` を使います。 |
| `mergeCells` | セルの結合・解除。既存の結合配置は表示します。 |
| `rowColumnOperations` | 行・列の挿入・削除全体。 |
| `insertRows` / `deleteRows` | 行の挿入／削除。 |
| `insertColumns` / `deleteColumns` | 列の挿入／削除。 |
| `sheets` | シートタブ、シート切り替え、シート管理。 |
| `createSheet` / `renameSheet` / `deleteSheet` | シートの追加／改名／削除。既存シートの閲覧は維持します。 |
| `duplicateSheet` | シートの複製。`sheets` と `createSheet` も有効である必要があります。 |
| `reorderSheets` | タブのドラッグや `sheets.move` によるシートの並べ替え。 |
| `resize` | 行高・列幅とその自動調整、画像・図形・テキストボックスのサイズ変更。挿入時のサイズ指定は可能です。 |
| `undoRedo` | 元に戻す・やり直す、変更履歴の記録。 |
| `images` / `shapes` / `textBoxes` | 画像／図形／テキストボックスの挿入・表示・編集・削除。 |
| `comments` | コメントの挿入・表示・編集・削除。 |
| `save` | 保存ボタン、保存ショートカット、`ref.current.save()`。編集は引き続き可能です。 |
| `refresh` | 更新操作。更新ボタンは `onRefresh` が指定されている場合だけ表示します。 |
| `exportExcel` | Excel出力ボタンと `ref.current.exportExcel()`。既定ONで、読み取り専用でも利用できます。[詳細](./excel-export.md) |

`clipboard`、`rowColumnOperations`、`sheets` は関連機能全体の設定です。親設定が `false` なら、子設定に `true` を指定しても有効になりません。従来の親設定だけを使ったコードも同じ動作を維持します。

```tsx
// コピー・切り取り・貼り付けはすべて無効です。
<Spreadsheet onSave={saveWorkbook} features={{ clipboard: false, copy: true }} />;

// シート切り替えは許可し、シート管理だけ無効にします。
<Spreadsheet
  initialWorkbook={workbook}
  onSave={saveWorkbook}
  features={{ createSheet: false, renameSheet: false, deleteSheet: false, reorderSheets: false }}
/>;
```

## 読み取り専用との違い

`readOnly` はすべての変更操作を止める設定です。`onSave` を省略した場合も読み取り専用になります。許可されたコピー・選択・閲覧は利用できます。

`features.save: false` は保存操作だけを止めます。`onSave` があれば編集は可能で、変更は `onChange` で受け取れます。値の入力を含むすべての編集を止めたい場合は `readOnly` を使ってください。

非表示にした画像やコメントなども、ブックから削除せず保持します。保存データには含まれます。数式・書式・結合は、変更を禁止しても既存の表示を維持します。

入力規則もOFFにして削除されることはありません。`dataValidation: false` でも通常のセル入力・貼り付け・外部APIからの値変更は既存の規則で検証します。チェックボックスの設定・操作には `dataValidation` と `checkboxes` の両方が必要です。

セル編集中の入力欄やコメントのテキスト欄では、ブラウザ標準の文字列コピー・切り取り・貼り付けを利用できます。`copy` / `cut` / `paste` はシートのセル範囲を操作する機能を制御します。

これらはコンポーネントで許可する操作の設定です。サーバー側の認証・認可や保存データの検証は利用側で実装してください。
