# 導入と設定

LikeTextEditorは、複数カーソルのあるテキスト編集、Markdownの文章編集、JSON・XML・YAMLの構文ハイライトを提供します。保存先や認証は親アプリが担当します。

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
| `mode` | `"auto"`・`"text"`・`"markdown"`・`"json"`・`"xml"`・`"yaml"`。省略時はauto。自動判別の優先順位は下記を参照。 |
| `fileName` | 自動判別に使うファイル名。未指定時はtitle propから拡張子を確認する。既存モデルだけを渡す場合は、そのmodeを使う。 |
| `mimeType` | 利用側で取得したMIMEタイプ。対応する具体的な形式なら拡張子より優先する。 |
| `initialDocument` | `createTextEditorModel`またはparse APIで作成したモデル。 |
| `initialText` | 初期本文。initialDocumentがある場合はそちらを優先。 |
| `title` | 表示用の名前。初期モデルを自動作成するときのタイトルにも使用。 |
| `initialWordWrap` | ソース表示の折り返し初期値。 |
| `initialViewMode` | Markdownの初期表示。`"rich"`（既定）または `"source"`。Markdown以外は常にソース表示。 |
| `showToolbar` | 検索・置換・コマンド・ファイル操作などの行を表示する。既定は `false`。ショートカットとref APIは非表示でも使用可能。 |
| `headerStyle` | ヘッダーだけに適用する `React.CSSProperties`。背景色・文字色・下線の色などを利用側から指定できる。本文には適用しない。 |
| `renderHeaderActions` | 右上の履歴・閲覧専用表示・保存ボタンを差し替える。`defaultActions` で標準表示を再利用可能。詳しくは[保存・操作領域](lifecycle.md#右上の操作領域)。 |
| `readOnly` | `true`で閲覧専用。検索・コピー・矩形選択は使用可能、入力・置換は無効。 |
| `colorMode` | `"light"`・`"dark"`・`"system"`。 |
| `primaryColor` | アクセント色。 |
| `onSelectionChange` | 現在の選択範囲を受け取る。sourceとrichの座標を区別する。 |
| `onWordWrapChange` | 折り返し設定の変更通知。 |
| `onViewModeChange` | 文章表示／ソース表示の変更通知。 |
| `features` | editing・history・import・export・search・replace・formatting・save・refreshを個別にON／OFF。 |
| `initialSearchOpen` / `initialSearchQuery` / `initialSearchMode` | 初期検索の開閉・キーワード・local/externalモード。 |
| `externalSearch` | 利用側で取得した検索結果を注入。ソースのUTF-16範囲を指定する。 |
| `onSearchRequest` / `searchParams` | キーワード検索を利用側で実行するコールバックと追加条件。 |
| `renderSearch` | 検索パネルの表示を差し替える。 |
| `onRefresh` | 最新文書を取得する。refのrefreshから実行する。 |
| `onUnsavedChangesChange` / `warnOnUnsavedChanges` | 未確定の入力を含む変更の通知／ブラウザー離脱警告。警告の既定はtrue。 |
| `onPanelsChange` | 検索・行移動・コマンド・リンク・ブロックメニューの開閉通知。 |

初期値はマウント時に一度だけ読みます。別の文書を開く場合は `ref.replace(document)` を使います。未保存変更があれば保存するか、破棄を決めて `{ discardChanges: true }` を指定します。Reactの `key` を変更して作り直す場合は親側で未保存変更を確認してください。モードの切り替えだけで本文は変換しません。Markdownモードではヘッダーの目のアイコン（文章表示）と `</>`（ソース表示）のトグルで表示を切り替えられます。選択中の表示が強調され、ホバー時の説明と読み上げ用のラベルでも区別できます。文章表示でも、編集が許可されていれば見たまま編集できます。

外からの操作は[表示中のAPIと利用例](ref-api.md)にまとめています。`ref.execute` で本文、`setSearch` で検索条件、`setSelection` でカーソルや範囲、`setViewMode`・`setWordWrap` で表示を指定できます。編集開始・破棄・再読み込み、機能フラグ、未保存変更の保護は[保存・編集許可・ファイル](lifecycle.md)にまとめています。表示設定は文書の保存データへ含めません。

親に高さを設定してください。内部のスクロールはエディターが持ちます。スタイルは `data-likex-texteditor` 配下と `lxte-` 接頭辞へ限定し、Tailwindの導入は不要です。

下部バーはMarkdownの文章表示では本文全体の行数・文字数だけを表示します。すべてのソース表示では、カーソルの行・列と複数カーソルの数も表示します。モード名や操作ヒントは表示しません。

ヘッダーの配色は全モード共通で指定できます。色は利用側が指定する表示設定で、文書には保存しません。ヘッダーにはファイル名を表示し、`Markdown`／`Plain text` の形式ラベルは表示しません。

```tsx
<LikeTextEditor
  initialText="作業メモ"
  headerStyle={{ backgroundColor: "#1f4d3a", color: "#ffffff" }}
/>
```

## 自動判別と構文ハイライト

`mode` を省略するか `mode="auto"` を指定すると、次の順で表示形式を選びます。

1. `mode="json"` など、auto以外の明示指定。
2. `mimeType` が示す対応形式。パラメーターと大文字小文字を正規化し、`application/problem+json` や `application/atom+xml` も認識する。
3. `fileName` の拡張子。fileNameを省略した場合は `title` propを使う。
4. 既存モデルのmode。判別材料もモデルもない場合は `text`。

| 表示形式 | 対応拡張子 | 代表的なMIMEタイプ |
| --- | --- | --- |
| テキスト | `.txt`・`.text`・`.log` | 汎用MIMEだけでは形式を確定せず、他の情報がなければtext |
| Markdown | `.md`・`.markdown`・`.mdown`・`.mkd`・`.mkdn` | `text/markdown`・`text/x-markdown` |
| JSON | `.json` | `application/json`・`text/json`・`+json`サフィックス |
| XML | `.xml`・`.xsd`・`.xsl`・`.xslt`・`.svg`・`.xhtml` | `application/xml`・`text/xml`・`+xml`サフィックス |
| YAML | `.yaml`・`.yml` | `application/yaml`・`application/x-yaml`・`text/yaml`・`text/x-yaml` |

SVGやXHTMLもXMLソースとして表示し、画像・HTMLとして実行や描画はしません。

`text/plain` や `application/octet-stream` のような汎用MIMEは拡張子の判定を妨げません。本文の内容を推測してモードを切り替える処理はありません。JSONのような文字列でも、ファイル名やMIMEなどの情報がなければテキストとして表示します。従来どおり必ずテキスト表示にしたい場合は `mode="text"` を指定してください。

```tsx
// mode省略 → .jsonからJSON表示
<LikeTextEditor
  fileName="settings.json"
  initialText={'{\n  "enabled": true,\n  "retries": 3\n}'}
  onSave={document => document}
/>

// 拡張子のないデータでも、メタデータで判定
<LikeTextEditor
  title="アプリケーション設定"
  mimeType="application/yaml"
  initialText={"enabled: true\nretries: 3\n"}
  readOnly
/>

// 明示指定はファイル名・MIMEより優先
<LikeTextEditor mode="text" fileName="settings.json" initialText={source} />
```

JSONはキー・文字列・数値・真偽値、XMLはタグ・属性・文字列・コメント、YAMLはキー・値・数値・コメントなどを色分けします。Light／Darkの両方に対応し、CodeMirrorの言語パーサーを使います。色分けは閲覧専用でも有効で、本文の整形・データの実行・XML外部参照の読み込みは行いません。途中まで入力した文書や構文が不完全な文書も、元のテキストを保持して編集できます。構文ハイライトはJSON Schemaなどによる意味検証ではありません。

JSON・XML・YAMLでも検索・置換、複数カーソル、矩形選択、行操作、履歴と公開ref APIを共通で使えます。モードを切り替えても本文は変換しません。Markdownだけは既定で文章表示になり、目／ソースのトグルで切り替えます。

既存の `initialDocument` だけを渡す場合は、そのmodeを尊重してモデルtitleから再判別しません。モデルを新規作成・本文読み込みするときは、fileName未指定ならtitleも判別に使います。

保存モデルのmodeは判別後の5種類のいずれかで、`auto`・fileName・mimeTypeは保存しません。表示側のmode propやメタデータを変えても、モデルのmodeは自動で書き換えません。保存するmodeを変更する場合は `document.update` を使います。自動判別を画面なしで使う場合は、公開APIの `resolveTextEditorMode`、または `createTextEditorModel` / `importTextEditorText` を利用できます。

## ソースコピーとNext.js

`packages/texteditor/src/` 全体を `components/texteditor/`、`packages/core/src/` 全体を `components/core/` へコピーします。`texteditor/core.ts` の1行だけを `export * from "../core";` に変更します。

コピー先へReact / React DOM 19と次の実行時依存を追加します。対応バージョンの正確な一覧は配布元の `package.json` を正とします。

```bash
npm install @codemirror/state @codemirror/view @codemirror/commands @codemirror/search @codemirror/language @codemirror/lang-markdown @codemirror/lang-json @codemirror/lang-xml @codemirror/lang-yaml @lezer/highlight prosemirror-model prosemirror-state prosemirror-view prosemirror-commands prosemirror-transform prosemirror-schema-list prosemirror-markdown prosemirror-keymap prosemirror-inputrules lucide-react re2js
```

コピー版の入口は `components/texteditor/index`、モデルは `components/texteditor/model-entry`、CSSは `components/texteditor/styles.css` です。内部ファイルへの直接importは不要です。

Next.js App Routerではコールバックやrefを扱う親に `"use client"` を付け、CSSはlayoutなどから読み込みます。画面なしのモデルAPIはサーバーでも利用でき、ReactやDOMの生成を必要としません。ProseMirror公開型を参照するため、TypeScriptではDOM型ライブラリを含めます。
