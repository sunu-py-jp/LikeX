# コマンド例

以下をJSON配列として `--commands` に渡す。

```json
[
  { "type": "document.update", "title": "作業メモ", "mode": "markdown" },
  { "type": "text.set", "text": "# 作業メモ\n\n- [ ] 確認する\n" }
]
```

全文を把握せずに `text.set` で上書きしない。既存文書の一部変更は、inspectした元文字列の位置を使う。

```json
[
  { "type": "text.replaceRange", "from": 4, "to": 8, "text": "変更後" },
  { "type": "text.insert", "offset": 0, "text": "更新内容\n" }
]
```

from/to/offsetはUTF-16単位。`A😀B` の絵文字はfrom=1、to=3。コマンドは配列順で実行するため、後続の位置は先行操作の結果に対する位置。

```json
[
  { "type": "text.replaceAll", "query": "TODO", "replacement": "NEXT", "caseSensitive": true, "wholeWord": true },
  { "type": "text.replaceAll", "query": "(?m)^旧版:.*$", "replacement": "最新版", "regex": true }
]
```

| type | データ |
| --- | --- |
| `text.set` | `text` |
| `text.insert` | `offset`, `text` |
| `text.replaceRange` | `from`, `to`, `text`（空文字は削除） |
| `text.replaceRanges` | `edits: { from, to, text }[]`（同じ実行前の本文を基準にする） |
| `text.replaceAll` | `query`, `replacement`, `caseSensitive?`, `wholeWord?`, `regex?` |
| `text.format` | `mode?`（具体的な5形式）, `indent?`（1〜8の整数、既定2） |
| `markdown.format` | `selection: { from, to }`, `action`, `options?`（文章表示の位置） |
| `markdown.toggleTask` | `position`（チェック項目直前の文章表示の位置） |
| `document.update` | `title?`, `mode?`（text／markdown／json／xml／yaml） |
| `document.replace` | `document`（完全な検証対象モデル） |

本文は最大10,000,000 UTF-16単位、コマンドは1,000件。JSONは64 MiB。CLIのコマンドファイルは32 MiB、応答は1 MiB。NUL文字を含む本文は扱わない。

`text.replaceRanges` は複数の範囲を同じ元本文から置換する。範囲は未整列でもよいが、重なりや同じ開始位置は拒否する。隣り合う範囲は許可し、最大1,000件。各置換の文字数が違っても、後続の位置を補正しない。

```json
[
  { "type": "text.replaceRanges", "edits": [
    { "from": 0, "to": 2, "text": "東京都" },
    { "from": 3, "to": 5, "text": "大阪府" }
  ] }
]
```

元本文 `東京、大阪、名古屋` は `東京都、大阪府、名古屋` になる。別々の `text.replaceRange` コマンドで同じ数値を渡すと、2つ目は変更後の本文を参照するため同じ意味にならない。

## JSON・XML・YAMLの整形

次はサンプル本文を作ってから整形する自己完結の例。既存文書の整形だけが目的なら `text.set` は使わず、既存本文に対して `text.format` を実行する。

```json
[
  { "type": "text.set", "text": "{\"enabled\":true,\"retries\":3}" },
  { "type": "text.format", "mode": "json", "indent": 2 }
]
```

modeを省略すると保存モデルのmodeで解釈する。表示中の `ref.execute` でも同じで、autoで判定された表示modeを暗黙に使うわけではない。表示中の形式で整形する場合は `mode: editor.current.getState().mode` を指定する。明示modeは今回の整形だけに使い、保存モデルのmode自体は変更しない。判別用メタデータがある場合は `resolveTextEditorMode` で具体的なmodeを取得してから指定する。構文が不正なら例外を返し、コマンド配列全体の変更を適用しない。成功結果は通常の本文変更で、表示中のrefではeditingとformattingの許可、履歴、未保存判定を通る。

```ts
import { formatTextEditorSource, validateTextEditorSource } from "@likex/texteditor/model";
const result = formatTextEditorSource(source, { fileName: "settings.json", indent: 2 });
// { text, mode, changed }
const diagnostics = validateTextEditorSource(source, { mimeType: "application/json" });
// [{ from, to, line, column, message }, ...]
```

両APIは `mode`・`fileName`・`mimeType`・`fallbackMode` を受け取る。純粋な整形APIは不正な構文なら原文とchanged:falseを返す。from/toは原文のUTF-16・0始まり・終端を含まない範囲、line/columnは1始まり。text/markdownは整形・診断の対象ではない。CLIのvalidateは保存モデルの検証で、本文の構文診断とは別。

JSONは数値・文字列の記法とキー順、XMLは混在テキストやxml:space、YAMLはコメント・アンカー・タグを保持する。データや外部参照を実行しない。JSON Schema等の意味検証は対象外。単なる整形表示ではモデルを変更せず、本文の整形が必要な場合にこのコマンドを使う。

## Markdownの書式とチェックリスト

`markdown.*` はモデルの `mode` にかかわらず本文をMarkdownとして解釈する明示的な操作で、`mode` 自体は変更しない。`selection` と `position` は解析後の文章表示の位置であり、ソース位置ではない。単純な段落 `Hello` の文字部分は1〜6。

```json
[
  { "type": "markdown.format", "selection": { "from": 1, "to": 6 }, "action": "markdown.bold" },
  { "type": "markdown.format", "selection": { "from": 1, "to": 6 }, "action": "markdown.link", "options": { "href": "https://example.com", "title": "参照先" } }
]
```

`action` は `markdown.paragraph`、`markdown.heading1`〜`markdown.heading3`、`markdown.bulletList`、`markdown.orderedList`、`markdown.taskList`、`markdown.quote`、`markdown.codeBlock`、`markdown.divider`、`markdown.bold`、`markdown.italic`、`markdown.code`、`markdown.link`。リンクは `options.href` にURLを指定し、空文字で解除する。表示中の選択へ書式を切り替える操作と同じ処理であるため、太字などは現在の状態を切り替える。本文の変更がなければ元のソースを維持する。

位置は推測せず `/model` の `getTextEditorMarkdownBlocks(modelOrSource)` で取得する。これもモデルの `mode` にかかわらず本文をMarkdownとして解析する。結果は文書順の配列で、`type`・`position`・`from`・`to`・`text` と、見出しの `level`、チェック項目の `checked` を持つ。親ブロックとその子の段落を両方含む。通常のリスト項目には `checked` がない。

```ts
const blocks = getTextEditorMarkdownBlocks(document);
const task = blocks.find(block => block.checked === false);
if (task) {
  document = executeTextEditorCommands(document, {
    type: "markdown.toggleTask", position: task.position,
  });
}
```

通常の段落は `from` / `to`、チェック項目の反転には `position` を使う。変更後は位置を再取得する。GFMテーブル・取り消し線・任意HTMLなどの未対応構文は、文章編集やブロック取得で拒否する。原本を保持するには `text.*` のソース編集を使う。

文字列だけの変換には `applyMarkdownCommand(source, selection, action, options?)` と `applyMarkdownTaskCommand(source, position)` も使える。CLIの `apply` では上記の構造化コマンドを使い、画面のカーソルや検索パネルを前提にしない。

## 表示中の操作

画面なしの検索には `findTextEditorMatches(model, { query, caseSensitive?, wholeWord?, regex? }, maxMatches?)`。表示中コンポーネントの検索・選択・カーソル操作はrefの `runCommand` であり、このCLIはUIを操作しない。

画面の `runCommand("find")` は右上の検索パネル、`runCommand("replace")` は置換欄を展開したパネルを開く。大文字小文字・単語単位・正規表現の各ボタンは切り替え式。パネル内ではEnter／Shift+Enterで次／前へ、Alt+Enterで一致箇所をすべて選択、Escapeで閉じる。読み取り専用では置換できない。件数表示の10,000件集計上限と、モデルAPIの `maxMatches` を混同しない。

画面の検索・置換・コマンド一覧・折り返し・ファイル操作の行は既定で非表示。`showToolbar: true` で表示でき、非表示でもショートカットとref APIは使える。Markdownの表示切り替えはヘッダーの目のアイコン（文章表示）と `</>`（ソース表示）のトグルで行う。選択中の表示が強調され、各ボタンにはホバー時の説明と読み上げ用のラベルがある。文章表示でも編集許可があれば見たまま編集できる。

Markdownの書式ツールバーは閲覧専用（`readOnly` または `onSave` 未指定）、`features.editing: false` または `features.formatting: false` で非表示。保存中・編集許可の確認中は表示したまま無効にし、表示切り替えのトグルは残す。

`/ でブロックを追加` はツールバーに常時表示せず、編集可能な空の段落にカーソルがあるときだけ行内に表示する。案内は保存本文に含まれない。

refの `setSearch({ query, replacement?, caseSensitive?, wholeWord?, regex? }, { open?, replace? })` は検索条件を設定し、必要ならソース表示へ切り替える。表示設定の既定は検索パネルを開く・置換欄は折りたたむ。省略した条件は空文字／falseへ戻す。パネルの条件で `runCommand("replaceNext")` / `runCommand("replaceAll")` / `runCommand("selectSearchMatches")` を実行でき、`getSearch()` と `closeSearch()` で状態取得・終了する。画面検索はJavaScript正規表現で、モデル検索のRE2とは異なる。

表示の指定は `setViewMode("source" | "rich" | "formatted")` と `setWordWrap(boolean)`、取得は `getState()`。`rich` はMarkdownのみ、`formatted` は整形表示が有効で原文との差分があるJSON/XML/YAMLのみ。`initialViewMode` と `initialWordWrap` は初期値、`onViewModeChange` と `onWordWrapChange` は変更通知。表示設定は本文や履歴に含めない。

Blob/Fileの読み込みは `importFile(file, { title?, mode?, fileName?, mimeType?, discardChanges? })`、出力は `exportFile()` が返す `{ blob, fileName }`、ブラウザーの保存開始は `download()`。実行可否はGUIと同じ `features`、読み取り専用、編集許可、処理中の制御に従う。CLIのJSON操作と混同しない。

下部バーはMarkdownの文章表示では本文全体の行数・文字数だけを表示する。すべてのソース表示と整形表示ではカーソルの行・列、複数カーソルの数も表示する。JSON/XML/YAMLの構文エラーは説明と行・列を赤字で表示する。モード名や操作ヒントは表示しない。

ヘッダーの配色は全モード共通の `headerStyle`（`React.CSSProperties`）で指定する。例: `headerStyle={{ backgroundColor: "#1f4d3a", color: "#ffffff" }}`。本文には適用せず、配色は保存JSONに含めない。ヘッダーの `Markdown`／`Plain text` ラベルは表示しないが、文書のタイトルとモードは保持する。

右上の履歴・閲覧専用表示・保存は `renderHeaderActions(context)` で差し替える。標準表示を残すなら `context.defaultActions` を返す要素に含め、すべて隠すなら `null` を返す。`TextEditorHeaderActionsContext` はUIの公開入口からimportでき、`readOnly`・`dirty`・`busy`・`canSave`・`canUndo`・`canRedo` と `save()`・`undo()`・`redo()`・`runCommand(action)` を持つ。独自ボタンには `can*` を反映し、操作は渡されたメソッドを使う。標準と同じ編集許可・機能設定・履歴・保存経路を維持する。表示設定は保存JSONやCLIコマンドではない。

編集の開始・終了・破棄・再読み込み、未保存保護、初期検索・外部検索・独自検索パネル、パネルの閉じるAPIは[画面の制御](view-controls.md)を参照する。これらは表示中のref/propsであり、このCLIのJSONコマンドには含めない。

### ファイル形式の判別

```ts
import { createTextEditorModel, resolveTextEditorMode } from "@likex/texteditor/model";

const document = createTextEditorModel({ title: "config.yml", text: "enabled: true\n" });
const mode = resolveTextEditorMode({ mimeType: "application/problem+json" }); // json
```

作成・本文読み込みのmodeはauto／省略で判別し、具体的な5形式を保存する。`document.update` は具体的なmodeを指定する。既存モデルへ判別結果を保存する場合は `resolveTextEditorMode` の結果をmodeに渡す。入力ファイルの本文にあるコードや参照先を実行しない。
