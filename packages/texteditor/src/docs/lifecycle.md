# 保存・編集許可・ファイル

LikeTextEditorは本文と編集履歴を保持し、保存・認証・ファイル取得は親アプリのコールバックへ渡します。

Undo／Redoは上部右側の保存ボタンの左にまとめて表示します。閲覧専用、または `features.history: false` の場合は履歴ボタンを表示しません。履歴がない場合や処理中は対応するボタンを無効にします。

検索・置換・コマンド一覧・折り返し・ファイルを開く・ダウンロードが並ぶ操作行は、標準では表示しません。`showToolbar={true}` で表示できます。非表示でもキーボードショートカットとref APIは利用でき、Markdownの目のアイコン（文章表示）と `</>`（ソース表示）のトグルはヘッダーに残ります。

Markdownの書式ツールバーは、閲覧専用（`readOnly`、または `onSave` 未指定）と `features.editing: false` の場合に非表示にします。保存中・編集許可の確認中は、表示したまま無効にします。

| 設定 | 挙動 |
| --- | --- |
| `onSave(document)` | 保存を実行する。戻り値は保存後のモデル、またはvoid。省略時は閲覧専用。 |
| `onBeforeSave(document)` | 保存前の確認。falseで中止。 |
| `onEditRequest({ model }, context)` | 編集許可を問い合わせる。指定時は許可を得てから編集。 |
| `readOnly` | GUIとref経由の変更を禁止。検索・選択・エクスポートは利用可能。 |
| `onChange` / `onDirtyChange` | 下書きの変更／未保存状態の通知。 |
| `onEvent` | 変更・保存・編集モードの通知。 |
| `features` | `editing`・`history`・`import`・`export` の機能を個別に制御。 |

`execute`、`replace`、`save`、`undo`、`redo` は画面操作と同じ許可・処理中の確認を通ります。`onEditRequest` は `context.signal` を受け取り、`cancelPending()` やアンマウントによる中止を通信へ伝えられます。

`onSave`には文書だけを渡します。保存中に `cancelPending()` を呼ぶと、遅れて返った結果を画面へ適用しませんが、ホストが始めた通信そのものは停止しません。保存通信の中止が必要なら親アプリで管理します。保存がvoidを返した場合は、渡した文書を保存済みとして扱います。

純粋なモデルAPIはUIの編集許可やログイン状態を参照しません。サーバーで使う場合の認証・排他・保存先の検証は呼び出し側の責務です。

## 右上の操作領域

`headerStyle` はテキスト・Markdown共通のヘッダーに適用します。たとえば `headerStyle={{ backgroundColor: "#1f4d3a", color: "#ffffff" }}` で背景色と文字色を指定でき、`borderBottomColor` などのCSSプロパティも指定できます。本文のスタイルは変わりません。ヘッダーの形式ラベル（`Markdown`／`Plain text`）は表示せず、文書のタイトルとモードはそのまま保持します。配色は利用側が指定する表示設定で、保存データには含めません。

`renderHeaderActions` で、右上のUndo／Redo・閲覧専用表示・保存ボタンの領域を差し替えられます。未指定なら標準表示、`null` を返すとこの領域を非表示にします。ファイル名とMarkdownの文章表示／ソース表示トグルは差し替えの対象に含まれません。

標準の操作にボタンを追加する場合は `defaultActions` を一緒に返します。

```tsx
<LikeTextEditor
  initialText="作業メモ"
  onSave={saveDocument}
  renderHeaderActions={({ defaultActions, runCommand }) => <>
    <button type="button" onClick={() => void runCommand("find")}>検索</button>
    {defaultActions}
  </>}
/>
```

保存ボタンだけを独自の見た目にする例です。

```tsx
<LikeTextEditor
  initialText="作業メモ"
  onSave={saveDocument}
  renderHeaderActions={({ canSave, busy, save }) =>
    <button type="button" disabled={!canSave} onClick={() => void save()}>
      {busy ? "処理中…" : "変更を保存"}
    </button>
  }
/>
```

引数の `TextEditorHeaderActionsContext` は `@likex/texteditor` から型をimportできます。

| 引数 | 内容 |
| --- | --- |
| `defaultActions` | 標準のUndo／Redo・閲覧専用表示・保存ボタン。追加表示するときにそのまま返せる。 |
| `readOnly` / `dirty` / `busy` | 閲覧専用、未保存の変更、処理中を表すboolean。 |
| `canSave` / `canUndo` / `canRedo` | 各操作を実行できる状態。独自ボタンの `disabled` に使用する。 |
| `save()` / `undo()` / `redo()` | 標準ボタンと同じ操作。`Promise<boolean>` を返す。 |
| `runCommand(action)` | 検索などの表示中コンポーネント操作。`Promise<boolean>` を返す。 |

独自ボタンでも `canSave`・`canUndo`・`canRedo` を表示状態に反映してください。これらの値だけに処理の可否を任せるのではなく、実行時も標準操作と同じ編集許可・機能設定・処理中の確認を通ります。変更は共通の履歴へ入り、保存も `onBeforeSave` / `onSave` を通ります。ヘッダーや操作行の表示設定は保存データを変更しません。

## 本文とJSON

`TextEditorModel` は `format: "likex.texteditor"` / `version: 1` と、`id`・`title`・`mode`・`text`を保存します。選択位置、検索文字列、スクロール、折り返しなどは本文と分けた表示状態です。

```ts
import {
  importTextEditorText, exportTextEditorText,
  parseTextEditorModel, serializeTextEditorModel, decodeTextEditorBytes,
} from "@likex/texteditor/model";

const decodedSource = decodeTextEditorBytes(await file.arrayBuffer());
const document = importTextEditorText(decodedSource, { title: "メモ", mode: "markdown" });
const markdown = exportTextEditorText(document); // .mdへ書き込む元文字列
const snapshot = serializeTextEditorModel(document); // メタデータ込みのJSON
const restored = parseTextEditorModel(snapshot);
```

`.txt`／`.md`は本文だけ、JSONはモード・ID・タイトルも含みます。`importTextEditorText` はデコード済みの文字列を受け取ります。バイト列から読む場合は `decodeTextEditorBytes(Uint8Array | ArrayBuffer)` を使います。UTF-8・UTF-16LE/BEのBOMを優先し、BOMがない場合は厳密なUTF-8、失敗時はShift_JISとして読みます。BOMは本文に含めず、不正な文字列を黙って置換文字に変換しません。BOM付きの壊れたデータは別の文字コードで読み直さずエラーにします。

入力ファイルは `TEXT_EDITOR_LIMITS.fileBytes`（40,000,000バイト）、デコード結果は本文10,000,000 UTF-16単位の上限を確認します。ファイル取得やネットワーク通信は呼び出し側が行います。`exportTextEditorText` はソースをそのまま返し、改行や空白を勝手に変更しません。画面での入力やMarkdownの文章編集ではエディター側の改行・記法へ正規化される場合があります。

コマンドの一括置換や外部更新もUndo／Redoの対象です。`getDocument()` / `getText()` で現在の下書きを取得でき、外部検索は `find()` で元本文の位置を取得できます。保存用JSONは専用のparse/serialize APIを使い、形式名だけを書き換えた別データを渡さないでください。
