# Markdownの編集

本文領域は左寄せ固定です。ビューの幅を広げても中央へ移動せず、左の余白を基準に配置します。読みやすさのため、本文領域の最大幅は820pxです（左右の内側余白を含みます）。

Markdownモードは、見出しやリストを文書の見た目のまま編集する文章表示と、元のMarkdownを直接扱うソース表示を持ちます。段落で `/` を入力するとブロックメニューを開き、選択した文字には書式ツールバーを使えます。

「/ でブロックを追加」の案内は、編集可能な空の段落にカーソルを置いたとき、その行に薄く表示します。書式ツールバーには常時表示しません。案内は表示だけの情報で、入力した本文や保存するMarkdownには入りません。文字を入力したり、別の場所へフォーカスを移したりすると消えます。

閲覧専用（`readOnly`、または `onSave` 未指定）、`features.editing: false`、`features.formatting: false` の場合、ブロック・太字・リンクなどの書式ツールバーは非表示です。保存中や編集許可の確認中は、位置が変わらないよう表示したまま無効にします。目のアイコンと `</>` の表示切り替えは引き続き使えます。

`features.formatting: false` では書式コマンド・ブロックメニュー・入力による自動書式・チェック状態の変更も無効にします。すでにある書式は表示し、通常の本文入力は `editing` の設定に従います。

「ブロックを追加」メニューでは↑／↓で候補を選び、Enterで追加、Escapeで閉じます。候補の移動では本文のカーソルやスクロール位置を変えず、見切れた候補はメニュー内だけをスクロールして表示します。

| 種類 | 書式コマンド |
| --- | --- |
| 本文／見出し1〜3 | `markdown.paragraph` / `markdown.heading1` / `markdown.heading2` / `markdown.heading3` |
| 箇条書き／番号付きリスト | `markdown.bulletList` / `markdown.orderedList` |
| チェックリスト | `markdown.taskList` |
| 引用／コードブロック／区切り線 | `markdown.quote` / `markdown.codeBlock` / `markdown.divider` |
| 太字／斜体／インラインコード | `markdown.bold` / `markdown.italic` / `markdown.code` |
| リンク | `markdown.link` |

見出し・リスト・引用などはMarkdown記法を入力しても作成できます。チェックリストは `- [ ]` / `- [x]` を読み書きし、チェックをクリックして完了状態を変更できます。Tab / Shift+Tabはリストの入れ子を調整します。保存・Undo・Redoはテキストモードと共通です。

## 画面なしの書式変更

```ts
import { createTextEditorModel, executeTextEditorCommands } from "@likex/texteditor/model";

// from/toはMarkdownソース位置ではなく、解析後のProseMirror位置。
// 単純な段落 "Hello" の文字部分は1〜6です。
const document = createTextEditorModel({ mode: "markdown", text: "Hello" });
const next = executeTextEditorCommands(document, {
  type: "markdown.format",
  selection: { from: 1, to: 6 },
  action: "markdown.bold",
});
console.log(next.text); // **Hello**
```

同じコマンドを表示中の `editor.current.execute(...)` へ渡せば、編集許可の確認・Undo／Redo・未保存判定まで画面操作と同じ経路を通ります。表示中のカーソル位置を使う場合は `runCommand("markdown.bold")` などを使い、位置を明示して自動編集する場合は `execute` を使います。

```ts
await editor.current?.execute({
  type: "markdown.format",
  selection: { from: 1, to: 6 },
  action: "markdown.link",
  options: { href: "https://example.com", title: "説明" },
});
```

リンク解除は `options: { href: "" }` です。`runCommand("markdown.link")` は画面のリンク入力欄を開き、`execute` は指定したURLを直接適用します。`http(s)`・メール・電話・相対URLを扱い、実行可能なURLは拒否します。

`parseMarkdownDocument` / `serializeMarkdownDocument` と `markdownSchema` で解析結果を扱えます。文字列だけを編集する `applyMarkdownCommand(source, selection, action, options?)` は `{ text, selection, changed }` を返します。保存モデルを扱う場合は `markdown.format` にまとめることで、本文の差し戻しやコマンド列への組み込みを同じAPIで行えます。

`markdown.format`・`markdown.toggleTask` は、文書の `mode` にかかわらず本文をMarkdownとして解釈する明示的な操作です。操作後もモデルの `mode` は変更しません。たとえばモデルの `mode` が `text` で、表示側だけ `mode="markdown"` を指定している場合にも使えます。モード自体を変更する場合は `document.update` を別に指定します。

対応外の記法が含まれる場合はソース編集を使い、文章表示の編集で内容を失わないようにします。書式操作で本文が変わらなければ元のソースを保持します。太字などの空範囲への操作は、後から入力する文字に適用する一時的な状態になり得るため、画面なしの処理では文字の範囲を明示してください。

## ブロックの位置とチェック状態

`getTextEditorMarkdownBlocks(modelOrSource)` は、見出し・段落・リストなどを文書順の配列で返します。モデルの `mode` にかかわらず本文をMarkdownとして読み、モデルを変更しません。リストや引用の中の段落も含め、親ブロックの後に子ブロックを並べます。

| プロパティ | 内容 |
| --- | --- |
| `type` | `paragraph`、`heading`、`bullet_list`、`list_item` などのノード種別。 |
| `position` | ブロック直前の文章表示の位置。チェック項目の操作に使用。 |
| `from` / `to` | ブロック内容の範囲。子を持たないノードではノード全体。 |
| `text` | ブロックに含まれる文字。親ブロックには子の文字も含む。 |
| `level` | 見出しのレベル。見出し以外は省略。 |
| `checked` | チェック項目の状態。通常のリスト項目は省略。 |

```ts
import {
  createTextEditorModel, getTextEditorMarkdownBlocks, executeTextEditorCommands,
} from "@likex/texteditor/model";

let document = createTextEditorModel({ mode: "markdown", text: "確認事項\n\n- [ ] 資料を送る" });
const paragraph = getTextEditorMarkdownBlocks(document)
  .find(block => block.type === "paragraph" && block.text === "確認事項");
if (paragraph) {
  document = executeTextEditorCommands(document, {
    type: "markdown.format",
    selection: { from: paragraph.from, to: paragraph.to },
    action: "markdown.heading2",
  });
}

// 文書が変わったので位置を取得し直す。
const task = getTextEditorMarkdownBlocks(document).find(block => block.checked === false);
if (task) {
  document = executeTextEditorCommands(document, {
    type: "markdown.toggleTask", position: task.position,
  });
}
```

返却される配列と要素は読み取り専用です。これらの位置を `text.replaceRange` へ直接渡さないでください。書式変更・本文の変更後は位置が変わる可能性があるため、対象の文書から再取得します。`markdown.toggleTask` はチェック項目以外の位置を拒否します。文字列だけのチェック状態変更には `applyMarkdownTaskCommand(source, position)` を使え、`{ text, changed }` を返します。

## 元の記法と対応範囲

CommonMarkを基本とします。ソースを開いたり表示を切り替えたりするだけでは再シリアライズしません。文章表示で実際に変更したときはMarkdownを再生成するため、見出し・リストの区切り記号や空白が標準化されることがあります。原本の書式記法を厳密に残す編集はソース表示で行います。

GFMテーブル、取り消し線、任意のHTMLなど、文章編集で保持できない構文がある場合は通知し、ソース編集に案内します。`getMarkdownCompatibilityWarnings(source)` から同じ判定を取得できます。リンク・画像のURLには安全なスキームだけを許可し、HTMLをそのまま実行する表示は行いません。外部画像の取得はブラウザーによるため、ホストのCSPやネットワーク方針にも従います。

Notionのデータベースやnoteへの投稿・公開、外部ストレージへの画像アップロード、共同編集は含みません。保存・配信は親アプリの処理に接続します。
