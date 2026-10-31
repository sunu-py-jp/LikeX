# @likex/texteditor

複数カーソルを使えるテキスト編集、Markdownの文章編集、JSON・XML・YAMLの構文ハイライト・整形表示・構文診断を備えたReactエディターです。モード未指定時はファイル名やMIMEタイプから自動判別します。検索・置換・全選択・行操作・コマンドパレット、保存と編集許可の注入、画面なしのモデル操作を提供します。

- [導入と設定](src/docs/getting-started.md)
- [コマンドとショートカット](src/docs/commands.md)
- [表示中のAPIと利用例](src/docs/ref-api.md)
- [Markdownの編集と対応範囲](src/docs/markdown.md)
- [保存・編集許可・ファイル](src/docs/lifecycle.md)

UIは `@likex/texteditor`、画面なしの操作は `@likex/texteditor/model`、CSSは `@likex/texteditor/styles.css`。ソース＋coreのコピー導入にも対応します。MIT。

JSON/XML/YAMLの整形・診断には `jsonc-parser`・`yaml`・`@lezer/xml` を使用します。コピー導入ではXMLパーサーの公開型を参照する `@lezer/common` も直接追加してください。すべての依存とインストール例は[導入と設定](src/docs/getting-started.md#ソースコピーとnextjs)を参照してください。

表示中のAPIは、10種類の機能ON／OFF、編集開始・終了・破棄・再読み込み、未確定入力を含む未保存保護、初期検索と外部検索結果、検索・コマンド・行移動などのパネル開閉に対応します。保存・再読み込みは中止可能なホストコールバックへ接続し、未保存の文書差し替えには明示的な `discardChanges: true` が必要です。純粋なモデルAPI・保存JSONとは分けて制御します。
