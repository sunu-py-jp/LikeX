# TextEditorの保存構造

CLIで扱う文書JSONの例。`text`がテキスト／Markdownの元文字列で、`mode`は編集時の表示方法を示す。IDと意図のある改行・空白を保持する。

```json
{
  "format": "likex.texteditor",
  "version": 1,
  "id": "notes",
  "title": "作業メモ",
  "mode": "markdown",
  "text": "旧版: 作業メモ\nTODO: 確認する\n"
}
```

`texteditor.schema.json`は保存モデル、`commands.schema.json`は編集コマンドのJSON配列を表す。どちらもTypeScriptから生成した構造の定義で、位置・文字数・正規表現の意味検証は `parseTextEditorModel` / `executeTextEditorCommands` を正とする。形式名やversionだけを変えて別形式のデータを読み込ませない。

本文は最大10,000,000 UTF-16単位で、NUL文字は拒否する。タイトルは1,000文字、JSONはUTF-8で64 MiBまで。`text.*` の `from` / `to` / `offset` は本文上の0始まりのUTF-16位置で、`to`は含まない。上の例の `作業メモ` は `[4, 8)`。

生の `.txt` / `.md` はこのJSONとは別で、本文だけを含む。`importTextEditorText`でモデル化し、`exportTextEditorText`で元の本文を取り出す。バイト入力は `decodeTextEditorBytes`（元ファイル40,000,000バイトまで）。CLIは生の本文ファイルへJSONのparseを適用しない。

カーソルや検索語、折り返し、スクロールは保存モデルに含めない。Markdownの文章表示の位置はProseMirror座標であり、本文上のUTF-16位置へ直接流用しない。

`markdown.format`・`markdown.toggleTask` の結果も `text` にMarkdown文字列として保存する。これらは `mode` にかかわらず本文をMarkdownとして解釈し、`mode` 自体は変更しない。独立した書式オブジェクトやチェック状態の配列は保存しない。`getTextEditorMarkdownBlocks` の `position`・`from`・`to` はその時点の解析結果であり、永続IDではない。本文の変更後は解析し直す。
