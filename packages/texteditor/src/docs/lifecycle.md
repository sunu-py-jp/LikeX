# 保存・編集許可・ファイル

LikeTextEditorは本文と編集履歴を保持し、保存・認証・ファイル取得は親アプリのコールバックへ渡します。

Undo／Redoは上部右側の保存ボタンの左にまとめて表示します。閲覧専用、または `features.history: false` の場合は履歴ボタンを表示しません。履歴がない場合や処理中は対応するボタンを無効にします。

検索・置換・コマンド一覧・折り返し・ファイルを開く・ダウンロードが並ぶ操作行は、標準では表示しません。`showToolbar={true}` で表示できます。非表示でもキーボードショートカットとref APIは利用でき、Markdownの目のアイコン（文章表示）と `</>`（ソース表示）のトグルはヘッダーに残ります。

Markdownの書式ツールバーは、閲覧専用（`readOnly`、または `onSave` 未指定）、`features.editing: false`、`features.formatting: false` の場合に非表示にします。保存中・編集許可の確認中は、表示したまま無効にします。

| 設定 | 挙動 |
| --- | --- |
| `onSave(document, context)` | 保存を実行する。戻り値は保存後のモデル、またはvoid。省略時は閲覧専用。 |
| `onBeforeSave(document, context)` | 保存前の確認。falseで中止。 |
| `onRefresh(context)` | 最新のモデルを取得する。成功時に保存済みの基準も更新する。閲覧専用でも利用可能。 |
| `onEditRequest({ model }, context)` | 編集許可を問い合わせる。指定時は許可を得てから編集。 |
| `readOnly` | GUIとref経由の変更を禁止。許可された検索・選択・エクスポート・再読み込みは利用可能。 |
| `onChange` / `onDirtyChange` | 確定した下書きの変更／保存済みモデルとの差分の通知。 |
| `onUnsavedChangesChange` | 保存済みモデルとの差分に、編集許可待ちなどで未確定の入力も含めた通知。 |
| `warnOnUnsavedChanges` | 未保存変更があるときのブラウザー離脱警告。既定は `true`。 |
| `onEvent` | 変更・保存・再読み込み・編集モードの通知。 |
| `features` | 下記の機能を個別に制御。未指定の機能は有効。 |

`execute`、`replace`、`save`、`undo`、`redo` は画面操作と同じ許可・処理中の確認を通ります。`context` は `requestId` と `signal` を持ち、`onEditRequest`、`onBeforeSave`、`onSave`、`onRefresh` に渡します。保存前の確認と保存には同じcontextを渡します。ホストの通信へ `signal` を渡すと、`cancelPending()` やアンマウントによる中止を伝えられます。中止を無視するホストから遅れて返った結果も画面へ反映しません。通信先で完了した処理を取り消す機能ではありません。

`onSave` がvoidを返した場合は渡した文書を保存済みとして扱い、モデルを返した場合は検証して反映します。既存の1引数の保存コールバックもそのまま利用できます。

## 機能のON／OFF

| `features` のキー | 制御する機能 |
| --- | --- |
| `editing` | 本文・メタデータの変更、編集開始、履歴での変更。 |
| `history` | Undo／Redo。 |
| `import` | `importFile`、`replace`、`document.replace`。 |
| `export` | `exportFile`、ダウンロード。 |
| `search` | 検索パネル、検索移動、`find`、検索に基づく置換。 |
| `replace` | 置換欄、次を置換、すべて置換、`text.replaceAll`。 |
| `formatting` | Markdownの書式・ブロック操作・チェック状態の変更、`markdown.*` コマンド。 |
| `save` | 保存ボタン、保存ショートカット、`save()`。 |
| `refresh` | `refresh()` による再読み込み。 |

たとえば `features={{ replace: false, formatting: false }}` で検索と通常の入力を残して置換・書式操作を無効にできます。`showToolbar` は表示だけの設定で、機能を禁止しません。機能フラグは標準UI、ショートカット、表示中のref API、履歴の再適用で確認します。`replace: false` は文字列検索による置換の制御で、明示した範囲への通常入力や `text.replaceRange` を禁止する設定ではありません。

純粋なモデルAPIはUIの機能フラグや編集許可を参照しません。サーバーで使う場合の認証・排他・保存先の検証は呼び出し側の責務です。

## 編集の開始・終了と再読み込み

```ts
const api = editor.current;
if (!api) return;

const allowed = await api.requestEdit(); // onEditRequestを通して編集を開始
const mode = api.getEditState(); // "view" | "requesting" | "edit"
api.cancelEditRequest(); // 許可待ちだけを中止。保存処理は中止しない

if (allowed && !api.getState().hasUnsavedChanges) api.endEdit();
// 変更を残す場合はsave、消す場合はdiscardを明示する。
await api.save();
```

通常の入力でも必要なタイミングで編集許可を要求するため、`requestEdit()` の事前呼び出しは必須ではありません。`endEdit()` は未保存変更・未確定の入力・処理中の状態があれば `false` を返します。`discard()` は最後の保存または再読み込みの状態へ戻し、Undo／Redo履歴と未確定の入力を消して編集を終了します。編集中の表示状態は `onEvent` の `edit-mode` からも取得できます。

```tsx
<LikeTextEditor
  initialDocument={document}
  onSave={async (draft, { signal }) => saveDocument(draft, { signal })}
  onRefresh={async ({ signal }) => loadDocument({ signal })}
/>
```

```ts
await editor.current?.refresh(); // 未保存変更があればfalse。本文は維持
// 利用側が変更の破棄を決めた場合だけ:
await editor.current?.refresh({ discardChanges: true });
```

再読み込みは成功して検証できたモデルだけを適用し、保存済みの基準と履歴をリセットします。失敗時は下書き・保存済みの基準・履歴を保持します。`onRefresh` の変更や中止後の古い結果は適用しません。ホスト側の `onRefresh` が同じ処理の間に変わらないよう、必要に応じて `useCallback` で参照を保ってください。

`onEvent` の `save` / `refresh` は `start`・`success`・`cancelled`・`error` のphaseを通知します。`change` のsourceは `command`・`import`・`undo`・`redo`・`save`・`discard`・`refresh` です。閲覧専用は書き込みを許可しませんが、`onRefresh` を指定した最新文書の取得は利用できます。

## 未保存変更の保護

`getState().dirty` と `onDirtyChange` は保存済みモデルとの比較です。`hasUnsavedChanges` / `onUnsavedChangesChange` は、モデルへ反映する前の入力も含みます。たとえば非同期の編集許可を待つ間は `pendingInput: true`、モデルがまだ変わっていなくても `hasUnsavedChanges: true` になります。保存は未確定の入力が解決するまで開始しません。

未保存変更がある場合、`replace`・`importFile`・`document.replace` を含む `execute`・`refresh` は既定で拒否します。保存するか、利用側で破棄を決めてから `discardChanges: true` を渡します。編集許可や機能フラグを迂回する指定ではありません。

```ts
await editor.current?.replace(nextDocument, { discardChanges: true });
await editor.current?.importFile(file, { mode: "markdown", discardChanges: true });
await editor.current?.execute(
  { type: "document.replace", document: nextDocument },
  { discardChanges: true },
);
```

これは従来の差し替えより保護を強める変更です。未保存の文書へ無条件に読み込んでいた利用側は、保存・破棄の選択後に上記オプションを指定してください。通常の本文編集コマンドを毎回確認する仕様ではありません。`replace` / `importFile` は従来どおりUndo対象で、保存済みの基準を更新する操作は保存または再読み込みです。

ブラウザーを閉じる際の警告は既定で有効です。`warnOnUnsavedChanges={false}` で無効にできます。警告文はブラウザー側が決めます。SPA内の画面移動や、このビューを包む独自ウィンドウの閉じる処理は `onUnsavedChangesChange` を使って親アプリで確認してください。Reactの `key` で文書ごと作り直す場合も、親で未保存変更を確認します。

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
