# 導入と設定

LikeTextEditorは、複数カーソルのあるテキスト編集と、Markdownを文書として編集する画面を提供します。保存先や認証は親アプリが担当します。

```tsx
import { useRef } from "react";
import { LikeTextEditor, type TextEditorHandle } from "@likex/texteditor";
import "@likex/texteditor/styles.css";

export function Notes() {
  const editor = useRef<TextEditorHandle>(null);
  return <LikeTextEditor
    ref={editor}
    mode="markdown"
    initialText={"# アイデア\n\nここから書き始めます。"}
    title="アイデアノート"
    onSave={async document => {
      await saveToYourStorage(document);
      return document;
    }}
    style={{ height: 640 }}
  />;
}
```

`onSave`を省略すると閲覧専用になります。編集する場合は、ローカルで保持するだけでも `onSave={document => document}` を渡します。保存の詳細は[ライフサイクル](lifecycle.md)を参照してください。

## モードと初期値

| prop | 内容 |
| --- | --- |
| `mode` | `"text"` または `"markdown"`。省略時は初期モデルのmode、モデルもなければtext。 |
| `initialDocument` | `createTextEditorModel`またはparse APIで作成したモデル。 |
| `initialText` | 初期本文。initialDocumentがある場合はそちらを優先。 |
| `title` | 表示用の名前。初期モデルを自動作成するときのタイトルにも使用。 |
| `initialWordWrap` | ソース表示の折り返し初期値。 |
| `initialViewMode` | Markdownの初期表示。`"rich"`（既定）または `"source"`。テキストモードは常にソース表示。 |
| `showToolbar` | 検索・置換・コマンド・ファイル操作などの行を表示する。既定は `false`。ショートカットとref APIは非表示でも使用可能。 |
| `headerStyle` | ヘッダーだけに適用する `React.CSSProperties`。背景色・文字色・下線の色などを利用側から指定できる。本文には適用しない。 |
| `renderHeaderActions` | 右上の履歴・閲覧専用表示・保存ボタンを差し替える。`defaultActions` で標準表示を再利用可能。詳しくは[保存・操作領域](lifecycle.md#右上の操作領域)。 |
| `readOnly` | `true`で閲覧専用。検索・コピー・矩形選択は使用可能、入力・置換は無効。 |
| `colorMode` | `"light"`・`"dark"`・`"system"`。 |
| `primaryColor` | アクセント色。 |
| `onSelectionChange` | 現在の選択範囲を受け取る。sourceとrichの座標を区別する。 |
| `onWordWrapChange` | 折り返し設定の変更通知。 |
| `onViewModeChange` | 文章表示／ソース表示の変更通知。 |

初期値はマウント時に一度だけ読みます。別の文書を開く場合は `ref.replace(document)`、またはReactの `key` を変更します。モードの切り替えだけで本文は変換しません。Markdownモードではヘッダーの目のアイコン（文章表示）と `</>`（ソース表示）のトグルで表示を切り替えられます。選択中の表示が強調され、ホバー時の説明と読み上げ用のラベルでも区別できます。文章表示でも、編集が許可されていれば見たまま編集できます。

外からの操作は[表示中のAPIと利用例](ref-api.md)にまとめています。`ref.execute` で本文、`setSearch` で検索条件、`setSelection` でカーソルや範囲、`setViewMode`・`setWordWrap` で表示を指定できます。表示設定は文書の保存データへ含めません。

親に高さを設定してください。内部のスクロールはエディターが持ちます。スタイルは `data-likex-texteditor` 配下と `lxte-` 接頭辞へ限定し、Tailwindの導入は不要です。

下部バーはMarkdownの文章表示では本文全体の行数・文字数だけを表示します。テキスト／Markdownソース表示では、カーソルの行・列と複数カーソルの数も表示します。モード名や操作ヒントは表示しません。

ヘッダーの配色は両モード共通で指定できます。色は利用側が指定する表示設定で、文書には保存しません。ヘッダーにはファイル名を表示し、`Markdown`／`Plain text` の形式ラベルは表示しません。

```tsx
<LikeTextEditor
  initialText="作業メモ"
  headerStyle={{ backgroundColor: "#1f4d3a", color: "#ffffff" }}
/>
```

## ソースコピーとNext.js

`packages/texteditor/src/` 全体を `components/texteditor/`、`packages/core/src/` 全体を `components/core/` へコピーします。`texteditor/core.ts` の1行だけを `export * from "../core";` に変更します。

コピー先へReact / React DOM 19と次の実行時依存を追加します。対応バージョンの正確な一覧は配布元の `package.json` を正とします。

```bash
npm install @codemirror/state @codemirror/view @codemirror/commands @codemirror/search @codemirror/language @codemirror/lang-markdown prosemirror-model prosemirror-state prosemirror-view prosemirror-commands prosemirror-transform prosemirror-schema-list prosemirror-markdown prosemirror-keymap prosemirror-inputrules lucide-react re2js
```

コピー版の入口は `components/texteditor/index`、モデルは `components/texteditor/model-entry`、CSSは `components/texteditor/styles.css` です。内部ファイルへの直接importは不要です。

Next.js App Routerではコールバックやrefを扱う親に `"use client"` を付け、CSSはlayoutなどから読み込みます。画面なしのモデルAPIはサーバーでも利用でき、ReactやDOMの生成を必要としません。ProseMirror公開型を参照するため、TypeScriptではDOM型ライブラリを含めます。
