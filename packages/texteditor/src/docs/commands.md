# コマンドとショートカット

保存対象の変更はモデルコマンド、画面の選択・検索パネル・カーソル操作はrefの `runCommand` で扱います。読み取り専用の画面でも、機能フラグで許可された検索と選択は利用できます。

## モデルコマンド

```ts
import {
  createTextEditorModel, executeTextEditorCommands,
  findTextEditorMatches, serializeTextEditorModel,
} from "@likex/texteditor/model";

const initial = createTextEditorModel({ id: "notes", text: "TODO: 検討\nTODO: 確認" });
const updated = executeTextEditorCommands(initial, [
  { type: "text.replaceAll", query: "TODO", replacement: "NEXT", caseSensitive: true },
  { type: "document.update", title: "作業メモ" },
]);
const matches = findTextEditorMatches(updated, { query: "NEXT" });
const json = serializeTextEditorModel(updated);
```

| type | 指定するデータ | 動作 |
| --- | --- | --- |
| `text.set` | `text` | 本文全体を置換。 |
| `text.insert` | `offset`, `text` | 指定位置へ挿入。 |
| `text.replaceRange` | `from`, `to`, `text` | 範囲を置換。空文字なら削除。 |
| `text.replaceRanges` | `edits: { from, to, text }[]` | 同じ本文を基準に、重ならない複数範囲をまとめて置換。 |
| `text.replaceAll` | `query`, `replacement`, `caseSensitive?`, `wholeWord?`, `regex?` | 一致したすべての箇所を置換。 |
| `markdown.format` | `selection`, `action`, `options?` | 指定した文章表示の範囲へ見出し・リスト・太字・リンクなどを適用。 |
| `markdown.toggleTask` | `position` | 指定したチェックリスト項目の完了状態を反転。 |
| `document.update` | `title?`, `mode?` | メタデータを変更。modeはtext／markdown／json／xml／yaml。modeだけの変更では本文を変換しない。 |
| `document.replace` | `document` | 別の検証済みモデルに置き換える。 |

位置は0始まりのUTF-16単位、`to`は範囲に含めません。`"A😀B"` の絵文字は `[1, 3)` です。一括コマンドは前のコマンド適用後の本文を順番に参照し、失敗時は入力モデルを変更しません。成功結果も入力とは別の凍結モデルです。

`text.replaceRanges` の `edits` は例外で、各範囲をそのコマンドの実行前の同じ本文に対して指定します。先頭の置換で文字数が増減しても、後続範囲を補正する必要はありません。重なる範囲はエラーとして、全体を適用しません。

```ts
const updated = executeTextEditorCommands(
  createTextEditorModel({ text: "東京、大阪、名古屋" }),
  { type: "text.replaceRanges", edits: [
    { from: 0, to: 2, text: "東京都" },
    { from: 3, to: 5, text: "大阪府" },
  ] },
);
// 東京都、大阪府、名古屋
```

`markdown.*` の位置はソースの文字位置とは異なります。[Markdownの編集](markdown.md)で文章表示の位置取得と書式変更を説明しています。これらのコマンドも `executeTextEditorCommands`、表示中の `ref.execute`、CLIの `apply` で共通に使えます。表示中のAPIでは `markdown.*` にformatting、`text.replaceAll` にsearchとreplace、`document.replace` にimportの機能フラグを確認し、どの変更にもeditingが必要です。UIなしのモデルAPI・CLIは呼び出し側が権限を管理します。

`findTextEditorMatches(documentOrText, options, maxMatches = 10000)` は `{ from, to }[]` を返します。上限を超えると切り捨てず例外にします。一括置換は一致一覧を全件メモリに置かず処理します。`wholeWord`はUnicodeの文字・結合文字・数字・アンダースコアを単語として判定します。

モデル検索の正規表現はRE2形式で、先読み・後読み・後方参照は扱いません。置換文字列の `$1` や `$&` もそのまま文字として入れます。ソース画面の検索パネルはCodeMirrorの検索機能を使い、正規表現はJavaScript形式です。正規表現の構文と置換文字の解釈はモデルAPIと同一ではありません。

## 表示中の操作

検索は編集領域の右上に重なる小さなパネルで表示します。通常は検索1行で、左の矢印または「置換」コマンドから置換欄を展開します。入力欄内の大文字小文字（Aa）・単語単位・正規表現（.*）はオン／オフを表示するボタンです。Enterで次、Shift+Enterで前、Alt+Enterで検索結果をすべて選択、Escapeで閉じて本文へ戻れます。読み取り専用、または `features.replace: false` では置換欄を使えません。`features.search: false` では検索自体が無効です。

一致件数と現在位置を表示し、件数集計は10,000件を超える場合に上限超過を示します。この集計上限は検索移動や置換対象を途中で切り捨てる制限ではありません。正規表現が不正な場合は入力欄の近くに表示します。

```ts
await editor.current?.runCommand("selectAll");
await editor.current?.runCommand("find");
await editor.current?.goToLine(20, 1); // 行・列は1始まり
await editor.current?.execute({ type: "text.insert", offset: 0, text: "見出し\n" });
```

共通の `openSearch`、外部結果の `openExternalSearch`、パネル状態の `getOpenPanels` / `closePanel` / `closePanels` も利用できます。検索語・表示形式・折り返しを外から設定したり、ファイルを渡したりする場合は、[表示中のAPIと利用例](ref-api.md)を参照してください。

| 操作 | `runCommand` | 主なショートカット |
| --- | --- | --- |
| 全選択／行選択 | `selectAll` / `selectLine` | Mod+A / Mod+L |
| 次の同じ文字を追加選択／すべて選択 | `selectNextOccurrence` / `selectAllOccurrences` | Mod+D / Mod+Shift+L |
| 複数カーソル | `addCursorAbove` / `addCursorBelow` | Alt+クリック、Mod+Alt+↑／↓ |
| 矩形選択 | —（refの `setSelection` で各行の範囲を指定可） | 開始位置をクリック → Alt+Shift+終点クリック、Alt+Shift+ドラッグ |
| 複数選択を解除 | `simplifySelection` | Escape |
| 検索／置換 | `find` / `replace` | Mod+F / Mod+H |
| 次／前の検索結果 | `findNext` / `findPrevious` | F3 / Shift+F3 |
| 次を置換／すべて置換 | `replaceNext` / `replaceAll` | 検索パネルの各ボタン |
| 検索条件の一致箇所をすべて選択 | `selectSearchMatches` | 検索パネル内でAlt+Enter |
| 検索パネルを閉じる | `closeSearch` | 検索パネル内でEscape |
| 指定行へ移動 | `goToLine` | Ctrl+G |
| 行を移動／複製 | `moveLineUp` / `moveLineDown` / `copyLineUp` / `copyLineDown` | Alt+↑／↓、Alt+Shift+↑／↓ |
| 行を削除 | `deleteLine` | Mod+Shift+K |
| インデント／解除 | `indent` / `outdent` | Tab / Shift+Tab |
| 折り返し | `toggleWordWrap` | Alt+Z |
| Undo／Redo | `undo` / `redo` | Mod+Z / Mod+Shift+Z |
| コマンド一覧 | `commandPalette` | Mod+Shift+P |

ModはWindows/LinuxではCtrl、macOSではCommandです。標準のコピー・切り取り・貼り付け、単語単位の移動や選択にも対応します。`selectParentSyntax` / `cursorMatchingBracket` もソース側のコマンドとして公開しています。利用可能なコマンド一覧は `TEXT_EDITOR_ACTIONS` から取得できます。

テキスト・JSON・XML・YAMLとMarkdownのソース表示では、開始位置をクリックしてからAlt+Shiftを押しながら終点をクリックすると、その間の各行を矩形選択します。同じ列を指定すると各行にカーソルが並び、一度の入力がすべての選択箇所に反映されます。続けてAlt+Shift+クリックすると元の開始位置を保って範囲を調整できます。通常の選択操作や本文の変更で開始位置はリセットされます。

Alt+Shift+ドラッグはドラッグ開始位置から矩形選択します。列はタブ幅と文字のまとまりを考慮した論理列で、折り返し後の表示行ではなく元のテキスト行が対象です。短い行や空行では行末にカーソルを置き、空白を自動挿入しません。閲覧専用でも矩形選択とコピーは使えますが、入力・置換はできません。

Markdown文章表示でソース専用の操作を実行すると、ソース表示へ切り替えて実行します。全選択やMarkdown書式操作は文章表示のまま実行できます。

`getSelection()` / `setSelection()` の `coordinateSpace` は `source` または `rich` です。sourceはUTF-16の文字位置、richはProseMirror文書位置で、互換の座標ではありません。現在と異なる座標系の選択を渡すと適用されません。複数範囲は `ranges`、主選択は `mainIndex` で指定します。フォーカスや選択の変更は本文の履歴を増やしません。

## 公開モデルAPI

画面なしの入口は `@likex/texteditor/model` です。UIの入口にもモデルAPIを再公開しているため、表示中コンポーネントと併用する場合も内部ファイルへのimportは不要です。

| API | 用途 |
| --- | --- |
| `createTextEditorModel(input?)` | ID・タイトル・モード・本文から検証済みモデルを作成。 |
| `normalizeTextEditorModel(input)` | オブジェクトを検証し、読み取り専用のモデルを取得。 |
| `parseTextEditorModel(json)` / `serializeTextEditorModel(model)` | メタデータ込みのJSONを読み書き。 |
| `importTextEditorText(text, options?)` / `exportTextEditorText(model)` | 生の本文とモデルの受け渡し。読み込み時はmode／fileName／mimeTypeで形式を指定・判定。 |
| `resolveTextEditorMode(options?)` | mode／fileName／mimeType／fallbackModeから具体的な5種類のモードを決定。DOM不要。 |
| `decodeTextEditorBytes(bytes)` | ファイルのバイト列を文字コード判定してデコード。 |
| `executeTextEditorCommands(model, commands)` | 保存対象の変更を、入力を変えずに一括適用。 |
| `findTextEditorMatches(modelOrText, options, maxMatches?)` | UTF-16の検索範囲を取得。 |
| `getTextEditorMarkdownBlocks(modelOrSource)` | 文章表示のブロック・位置・チェック状態を取得。 |
| `applyMarkdownCommand(source, selection, action, options?)` | Markdown文字列へ書式操作を適用。 |
| `applyMarkdownTaskCommand(source, position)` | Markdown文字列のチェック項目を反転。 |
| `parseMarkdownDocument(source)` / `serializeMarkdownDocument(document)` | ProseMirrorのMarkdown文書を読み書き。 |
| `markdownSchema` / `markdownTaskCommand(position)` | 公開スキーマと、ProseMirrorを直接扱うチェック操作。 |
| `getMarkdownCompatibilityWarnings(source)` | 文章表示で編集できない構文を確認。 |
| `TEXT_EDITOR_LIMITS` | 本文・ファイル・JSON・コマンド数などの検証上限。 |

本文のUTF-16位置とMarkdownの文章表示の位置は別です。[Markdownの編集](markdown.md#ブロックの位置とチェック状態)にはブロックから位置を取得する例、[保存・ファイル](lifecycle.md#本文とjson)にはJSONと本文ファイルの往復例を掲載しています。

## サイズ

`TEXT_EDITOR_LIMITS` は本文10,000,000 UTF-16単位、元ファイル40,000,000バイト、1バッチ1,000コマンド、検索結果既定10,000件、タイトル1,000文字、JSON64 MiBです。変更結果の本文も同じ上限で検証し、NUL文字を含む本文は拒否します。画面の快適さは文書構造と端末性能にも依存するため、この値は保証サイズではありません。

### JSON・XML・YAMLのモデル作成

```ts
import { createTextEditorModel, resolveTextEditorMode } from "@likex/texteditor/model";

const mode = resolveTextEditorMode({ fileName: "settings.yml" }); // "yaml"
const document = createTextEditorModel({
  title: "settings.json",
  text: '{"enabled":true}',
}); // document.mode === "json"

const yaml = createTextEditorModel({
  title: "設定", mimeType: "application/yaml", text: "enabled: true\n",
});
```

作成・本文読み込みのmodeは `"auto"` または省略で自動判別します。保存モデルと `document.update` は具体的なmodeだけを扱います。`resolveTextEditorMode` の結果をcommandへ渡すと、判別結果を保存できます。本文の空白・改行・キーの順序は維持し、JSON/XML/YAMLのオブジェクトへ変換しません。
