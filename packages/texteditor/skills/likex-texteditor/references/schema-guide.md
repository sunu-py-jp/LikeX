# TextEditorの保存構造

CLIで扱う文書JSONの例。`text`がテキスト／Markdown／JSON／XML／YAMLの元文字列で、`mode`は編集時の表示方法を示す。IDと意図のある改行・空白を保持する。

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

生の `.txt` / `.md` / `.json` / `.xml` / `.yaml` はこの保存JSONとは別で、本文だけを含む。特にJSONモードの本文は `format: "likex.texteditor"` を持つ保存JSONではない。`importTextEditorText`でモデル化し、`exportTextEditorText`で元の本文を取り出す。バイト入力は `decodeTextEditorBytes`（元ファイル40,000,000バイトまで）。CLIは生の本文ファイルへJSONのparseを適用しない。

カーソルや検索語、折り返し、スクロールは保存モデルに含めない。Markdownの文章表示の位置はProseMirror座標であり、本文上のUTF-16位置へ直接流用しない。

`markdown.format`・`markdown.toggleTask` の結果も `text` にMarkdown文字列として保存する。これらは `mode` にかかわらず本文をMarkdownとして解釈し、`mode` 自体は変更しない。独立した書式オブジェクトやチェック状態の配列は保存しない。`getTextEditorMarkdownBlocks` の `position`・`from`・`to` はその時点の解析結果であり、永続IDではない。本文の変更後は解析し直す。

`mode` は `text` / `markdown` / `json` / `xml` / `yaml` の具体的な値を保存する。作成・本文読み込みAPIの `mode: "auto"` や省略時は、fileName／mimeType／titleで判別してからモデル化する。auto・判別用fileName・mimeTypeは保存JSONへ追加しない。本文の空白・改行・JSONのキー順序を維持し、XML外部参照やYAMLタグを実行しない。version 1の既存text／markdown文書は継続して読める。新モードの文書を読む利用側は対応版のライブラリを使う。


`formatting`・`initialViewMode`・構文診断は表示設定で、保存JSONに追加しない。`source` と `formatted` はどちらも文字列上のUTF-16位置だが、整形で空白・改行が変わるため相互に流用しない。診断のline/columnは1始まり。pure APIは渡した文字列のfrom/to、refのgetDiagnosticsは表示中の文字列のfrom/toを返す。整形表示中の診断は元本文の位置とは異なる。

`text.format` の成功結果は `text` の新しい文字列として保存する。JSONは数値や文字列の記法とキー順序、XMLは混在テキストや `xml:space`、YAMLはコメント・アンカー・タグを保持する。単に整形表示へ切り替えた段階では保存本文を変更せず、整形表示で編集したときに表示文字列への編集結果を確定する。構文が不正な本文もモデルとして保持できるが、`text.format` は構文エラーを例外として返す。CLIの `validate` は保存モデルの検証であり、本文の構文診断は `validateTextEditorSource` を使う。
