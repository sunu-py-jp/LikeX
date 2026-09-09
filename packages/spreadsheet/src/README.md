# LikeX Spreadsheet

このディレクトリは、React / TypeScriptスプレッドシートをコピー導入する単位です。`index.ts` が公開入口、`styles.css` が配布用のCSSです。共通契約・ヘルパーは `@likex/core` を使います。コピー導入では `packages/core/src/` を `components/core/`、このフォルダを `components/spreadsheet/` に置き、`spreadsheet/core.ts` の1行を `export * from "../core";` に変更します。

[利用ガイド](./docs/README.md) に導入手順、公開API、保存と制約をまとめています。
