# LikeTextEditor

`index.ts` がReact UI、`model-entry.ts` が画面なしの公開入口です。テキスト／Markdownの元文字列を共通モデルで保持します。

- [導入とソースコピー](docs/getting-started.md)
- [モデル・refコマンド](docs/commands.md)
- [表示中のAPIと利用例](docs/ref-api.md)
- [Markdown](docs/markdown.md)
- [保存と編集許可](docs/lifecycle.md)

コピー導入では、このフォルダ全体を `components/texteditor/`、Coreの原本を隣接する `components/core/` に置き、`core.ts` の1行だけを `export * from "../core";` に変更します。`json.ts`・`browser.ts`・`text-search.ts` は変更不要です。外部依存とCSSの取り込みは導入ページを参照してください。
