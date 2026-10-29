# 表示中のAPIと利用例

`LikeTextEditor` の `ref` に `TextEditorHandle` を渡すと、本文の編集・検索・選択・表示設定・ファイル操作を外から実行できます。画面なしで保存データを編集する場合は `@likex/texteditor/model` を使います。

| 目的 | 使うAPI | 画面の履歴・編集許可 |
| --- | --- | --- |
| サーバーやスクリプトで本文を加工 | `executeTextEditorCommands(model, commands)` | 呼び出し側で管理する。入力モデルは変更しない。 |
| 表示中の本文を加工 | `ref.execute(commands)` | 画面と共通。成功した一括操作はまとめてUndoできる。 |
| 表示中のカーソルを使った操作 | `ref.runCommand(action)` | 検索・選択は閲覧専用でも可能。書式や入力は編集可否に従う。 |
| 検索欄・表示切り替えなどの設定 | `ref.setSearch(...)` / `setViewMode(...)` など | 表示状態を変更する。本文の履歴や保存データには含めない。 |

## 接続と状態の取得

```tsx
import { useRef } from "react";
import { LikeTextEditor, type TextEditorHandle } from "@likex/texteditor";
import "@likex/texteditor/styles.css";

export function Editor() {
  const editor = useRef<TextEditorHandle>(null);
  return <LikeTextEditor
    ref={editor}
    mode="markdown"
    initialText={"# メモ\n\n確認すること"}
    onSave={async document => {
      await saveDocument(document);
    }}
    style={{ height: 600 }}
  />;
}
```

各例の `editor` は上記のrefです。初期値はマウント時だけ読み込み、後から本文を変更するときは `execute`、別の文書を渡すときは `replace` を使います。

```ts
const api = editor.current;
if (!api) return;

const source = api.getText();
const document = api.getDocument();
const state = api.getState();
// state.mode: "text" | "markdown"
// state.viewMode: "source" | "rich"
// state.wordWrap / readOnly / editable / busy / dirty
// state.canSave / canUndo / canRedo / features
```

`getState()` は呼び出した時点の状態です。`canSave` などは独自UIの表示に使えますが、操作の実行時にも最新の状態で可否を確認します。変更通知には `onChange`・`onDirtyChange`・`onEvent`、表示の通知には `onSelectionChange`・`onWordWrapChange`・`onViewModeChange` を使います。

## 本文の挿入・置換・書式

```ts
await editor.current?.execute([
  { type: "text.insert", offset: 0, text: "作業メモ\n" },
  { type: "text.replaceAll", query: "TODO", replacement: "確認事項" },
]);
await editor.current?.undo();
await editor.current?.redo();
await editor.current?.save();
```

位置は0始まりのUTF-16単位です。複数箇所へ同じ元本文を基準に入力する場合は `text.replaceRanges` を使います。Markdownの位置を明示する書式変更には `markdown.format`、チェック状態には `markdown.toggleTask` を使えます。詳しくは[モデルコマンド](commands.md#モデルコマンド)と[Markdown](markdown.md)を参照してください。

表示中の選択を使う場合は、書式ツールバーと同じ操作を呼び出します。

```ts
await editor.current?.setViewMode("rich");
editor.current?.setSelection({
  coordinateSpace: "rich",
  ranges: [{ anchor: 1, head: 3 }],
  mainIndex: 0,
});
await editor.current?.runCommand("markdown.bold");
```

`runCommand` の戻り値は操作の受付・実行可否で、非同期の保存完了を表しません。保存対象の変更を呼び出し側で待ち、結果を取得する自動処理には `execute` を使います。`execute` は成功時にモデル、編集不可・キャンセル・失敗時は `null` を返します。

## 検索条件を指定して開く

```ts
await editor.current?.setSearch({
  query: "TODO",
  replacement: "DONE",
  caseSensitive: true,
  wholeWord: true,
  regex: false,
}, { open: true, replace: true });

await editor.current?.runCommand("findNext");
await editor.current?.runCommand("findPrevious");
await editor.current?.runCommand("replaceNext");
// すべて置換する場合:
await editor.current?.runCommand("replaceAll");

const search = editor.current?.getSearch();
// query / replacement / caseSensitive / wholeWord / regex / open / valid
editor.current?.closeSearch();
```

検索はソース上で行います。Markdownの文章表示から `setSearch` を呼ぶとソース表示へ切り替えます。表示設定を省略すると検索パネルを開き、置換欄は折りたたみます。`{ open: false }` ならパネルを開かずに条件を設定できます。指定を省略した `replacement` は空文字、各検索オプションは `false` に戻します。以前の検索条件への部分更新ではありません。

`setSearch` に不正な入力や正規表現を渡すと `false` を返し、前の検索条件を保持します。`getSearch()` は文章表示では `null` を返し、文章表示からソース表示を作り直すと検索状態は初期化されます。利用者が検索欄に入力した無効な正規表現は `valid: false` で確認できます。

`selectSearchMatches` は現在の検索条件に一致する箇所をすべて選択し、`selectAllOccurrences` は現在選択している文字列と同じ箇所をすべて選択します。どちらもソース表示で利用できます。閲覧専用でも検索・選択は使えますが、置換は実行しません。

画面を操作せず一致範囲だけ取得する場合は `find` です。

```ts
const matches = editor.current?.find({ query: "確認", caseSensitive: false });
// [{ from: 0, to: 2 }, ...]。画面の検索欄や選択は変えない。
```

`find` とモデルの `text.replaceAll` はRE2形式の正規表現です。画面の検索パネルと `setSearch` はJavaScript形式です。モデル側の置換文字列は `$1` などを展開せず、そのまま挿入します。検索パネル経由の置換は画面と同じ解釈を使うため、両者を使い分けてください。

## カーソル・複数選択・行操作

```ts
await editor.current?.setViewMode("source");
await editor.current?.goToLine(20, 1); // 行・列は1始まり
editor.current?.setSelection({
  coordinateSpace: "source",
  ranges: [{ anchor: 0, head: 2 }, { anchor: 4, head: 6 }],
  mainIndex: 0,
});
editor.current?.focus();
const selection = editor.current?.getSelection();
```

`source` は本文上の位置、`rich` は解析後のProseMirror位置です。現在と異なる座標系の選択は受け付けません。`rich` では1つの範囲、`source` では複数範囲を指定できます。`anchor` と `head` が同じならカーソル、逆順なら後方への選択です。選択・移動・フォーカスは本文のUndo履歴へ入りません。

```ts
await editor.current?.runCommand("selectAll");
await editor.current?.runCommand("selectLine");
await editor.current?.runCommand("addCursorBelow");
await editor.current?.runCommand("copyLineDown");
await editor.current?.runCommand("indent");
await editor.current?.runCommand("simplifySelection");
```

公開アクションの一覧は `TEXT_EDITOR_ACTIONS`、IDの型は `TextEditorAction` です。[コマンド一覧](commands.md#表示中の操作)にショートカットとの対応を掲載しています。OSのクリップボードを外部APIが自動で読み書きする機能はありません。必要な場合は親アプリで取得した文字列を `execute` へ渡します。

## 表示形式と折り返し

```ts
await editor.current?.setViewMode("source");
editor.current?.setWordWrap(false);
await editor.current?.setViewMode("rich"); // Markdownモードのみ
```

`setViewMode` は本文のテキスト／Markdownモードを変えず、Markdownの文章表示とソース表示を切り替えます。切り替え先のエディターが準備できた後に結果を返します。テキストモードで `rich` を指定すると `false` です。`setWordWrap` はソース表示の折り返し設定を変更し、文章表示の段落レイアウトには影響しません。

初期表示は `initialViewMode`、折り返しの初期値は `initialWordWrap` で指定できます。表示切り替えは `onViewModeChange`、折り返しは `onWordWrapChange` へ通知します。本文のテキスト／Markdownモードは `mode` prop、または `mode` prop未指定時の `document.update` で管理します。

## ファイルの読み込み・出力

```ts
// fileは利用側で取得したFileまたはBlob。取得元は任意。
await editor.current?.importFile(file, { title: "作業メモ.md", mode: "markdown" });

const exported = editor.current?.exportFile();
if (exported) {
  // exported.blobとexported.fileNameをアップロードや添付に使う。
  await uploadFile(exported.blob, exported.fileName);
}

// ブラウザーのダウンロードを開始する場合。
editor.current?.download();
```

読み込みは画面の「ファイルを開く」と同じ検証・文字コード判定・編集許可を通り、1回のUndoで戻せます。`title` 未指定時は `File.name` があれば使い、それもなければ現在のタイトルを保ちます。`mode` 未指定時は現在のモデルのモードを保ちます。`mode` propが指定されている場合は、画面のモードにはpropを優先します。

文字コードはUTF-8、BOM付きUTF-16LE/BE、BOMなしのUTF-8からShift_JISへのフォールバックに対応します。キャンセルやアンマウント後の結果は反映しません。取得処理そのものは利用側が担当します。

`exportFile()` はUTF-8の本文Blobとファイル名を返し、ダウンロードや保存は開始しません。閲覧専用でも出力でき、`features.export: false` の場合は `null` です。メタデータ込みの保存には `getDocument()` と `serializeTextEditorModel`、復元には `parseTextEditorModel` と `replace` を使います。

## メソッド一覧

| メソッド | 戻り値 | 用途 |
| --- | --- | --- |
| `getDocument()` / `getText()` | モデル / 文字列 | 現在の下書きを取得。 |
| `getState()` | `TextEditorViewState` | 編集・保存・表示の状態を取得。 |
| `execute(commands)` | `Promise<TextEditorModel \| null>` | モデルコマンドを共通の履歴へ適用。 |
| `replace(document)` | `Promise<TextEditorModel \| null>` | 文書を読み込みとして置き換える。 |
| `find(options)` | 範囲配列 | ソースの一致箇所だけ取得。 |
| `runCommand(action)` | `Promise<boolean>` | 画面の選択・検索・書式・行操作を実行。 |
| `focus()` | `void` | 現在の本文にフォーカス。 |
| `getSelection()` / `setSelection(selection)` | 選択またはnull / boolean | 現在の座標系で選択を取得・設定。 |
| `goToLine(line, column?)` | `Promise<boolean>` | ソースの指定行・列へ移動。 |
| `setViewMode(mode)` | `Promise<boolean>` | source/richを切り替え。 |
| `setWordWrap(enabled)` | `boolean` | ソースの折り返しを設定。 |
| `setSearch(query, display?)` | `Promise<boolean>` | ソースの検索条件・パネルを設定。 |
| `getSearch()` / `closeSearch()` | 検索状態またはnull / boolean | 条件を取得・パネルを閉じる。 |
| `importFile(file, options?)` | `Promise<TextEditorModel \| null>` | Blob/Fileを読み込み。 |
| `exportFile()` / `download()` | `{ blob, fileName } \| null` / boolean | 本文ファイルを作成・ダウンロード。 |
| `save()` / `undo()` / `redo()` | `Promise<boolean>` | 保存・履歴操作。 |
| `cancelPending()` | `void` | 処理中の古い結果の適用を中止。 |

型はすべてUIの公開入口 `@likex/texteditor` からimportできます。本文編集の拒否や中止は戻り値で確認し、通知は `onEvent` や画面の通知欄へつなぎます。モデルAPIは不正入力を例外として返すため、画面なしの利用では呼び出し側で扱ってください。
