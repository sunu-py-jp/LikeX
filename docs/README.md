# ドキュメント

[APIリファレンスを開く](APIDocs/index.html) — 各UIモジュールとCoreの機能別API、利用例、画面例。HTMLをローカルで開くか静的サーバーへ配置できます。

このディレクトリはLikeXリポジトリを開発・配布する人向けです。コンポーネントを組み込む場合は [Explorerの導入手順](../packages/explorer/README.md) と [利用ガイド](../packages/explorer/src/docs/README.md) を参照してください。

Spreadsheetの導入・操作・数式・制約は [Spreadsheetのガイド](../packages/spreadsheet/README.md)、スライド編集とPowerPoint入出力は [LikeSlideのガイド](../packages/slide/README.md)、文章編集とWord入出力は [LikeDocumentのガイド](../packages/document/README.md) を参照してください。

AIとの会話は [LikeAIChat](../packages/aichat/README.md)、人同士のDM・グループ・スペースは [LikeChat](../packages/chat/README.md) を使います。旧AI向けLikeChatの利用コードとJSONは[移行手順](../packages/aichat/src/docs/native-files.md#旧likechatからの移行)を参照してください。

| ドキュメント | 内容 |
| --- | --- |
| [開発と検証](development.md) | ローカル起動、開発コマンド、デモの前提 |
| [モジュール構成](architecture.md) | フォルダの責務、独立した配布単位、CSSの生成方針 |
| [共通基盤](core.md) | ホスト処理の共通契約、coreの単一ソース、コピー導入の維持 |
| [LLM向けスキル](skills.md) | スキーマ参照、画面なしの操作CLI、生成・配布・検証 |
| [配布と公開](releasing.md) | 配布物の検証、成果物、公開前の確認と手順 |
| [ライセンス](licensing.md) | MITでの利用、通知の保持、配布物の検査と開発依存の扱い |
| [レビュー記録](release-review.md) | 構成・CSS配布の見直しと、その時点での検証結果 |
| [追加モジュールとチャット分離の検証](new-modules-review.md) | 初期実装と分離の範囲、導入テスト、残る実機確認 |

利用者向けの詳細は各モジュールの `src/docs/` にまとめ、コピー導入とパッケージ配布で同じ文書を使用します。`APIDocs/` のHTMLも各モジュールのMarkdownから生成し、本文を二重管理しません。更新・再生成の手順は [APIドキュメントの保守](APIDocs/README.md) を参照してください。
