# LikeTextEditor

`index.ts` がReact UI、`model-entry.ts` が画面なしの公開入口です。テキスト／Markdown／JSON／XML／YAMLの元文字列を共通モデルで保持します。モード未指定時はファイル名やMIMEタイプから自動判別します。JSON・XML・YAMLは任意の整形表示と構文診断、画面なしの整形コマンドにも対応します。

- [導入とソースコピー](docs/getting-started.md)
- [モデル・refコマンド](docs/commands.md)
- [表示中のAPIと利用例](docs/ref-api.md)
- [Markdown](docs/markdown.md)
- [保存と編集許可](docs/lifecycle.md)

コピー導入では、このフォルダ全体を `components/texteditor/`、Coreの原本を隣接する `components/core/` に置き、`core.ts` の1行だけを `export * from "../core";` に変更します。`json.ts`・`browser.ts`・`text-search.ts` は変更不要です。外部依存とCSSの取り込みは導入ページを参照してください。XMLパーサーの公開型にも依存するため、コピー先には `@lezer/xml` と `@lezer/common` の両方を追加します。

表示中のAPIは、10種類の機能ON／OFF、編集開始・終了・破棄・再読み込み、未確定入力を含む未保存保護、初期検索と外部検索結果、検索・コマンド・行移動などのパネル開閉に対応します。保存・再読み込みは中止可能なホストコールバックへ接続し、未保存の文書差し替えには明示的な `discardChanges: true` が必要です。純粋なモデルAPI・保存JSONとは分けて制御します。
