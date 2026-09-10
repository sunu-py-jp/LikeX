# ドキュメント

[APIリファレンスを開く](APIDocs/index.html) — Explorer・Spreadsheet・Coreの機能別API、利用例、画面例。HTMLをローカルで開くか静的サーバーへ配置できます。

このディレクトリはLikeXリポジトリを開発・配布する人向けです。コンポーネントを組み込む場合は [Explorerの導入手順](../packages/explorer/README.md) と [利用ガイド](../packages/explorer/src/docs/README.md) を参照してください。

Spreadsheetの導入・操作・数式・制約は [Spreadsheetのガイド](../packages/spreadsheet/README.md) を参照してください。

| ドキュメント | 内容 |
| --- | --- |
| [開発と検証](development.md) | ローカル起動、開発コマンド、デモの前提 |
| [モジュール構成](architecture.md) | フォルダの責務、独立した配布単位、CSSの生成方針 |
| [共通基盤](core.md) | ホスト処理の共通契約、coreの単一ソース、コピー導入の維持 |
| [配布と公開](releasing.md) | 配布物の検証、成果物、公開前の確認と手順 |
| [レビュー記録](release-review.md) | 構成・CSS配布の見直しと、その時点での検証結果 |

利用者向けの詳細は各モジュールの `src/docs/` にまとめ、コピー導入とパッケージ配布で同じ文書を使用します。`APIDocs/` のHTMLも各モジュールのMarkdownから生成し、本文を二重管理しません。更新・再生成の手順は [APIドキュメントの保守](APIDocs/README.md) を参照してください。
