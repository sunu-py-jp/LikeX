# LikeX Spreadsheet

このディレクトリは、React / TypeScriptスプレッドシートをコピー導入する単位です。`index.ts` が公開入口、`styles.css` が配布用のCSSです。共通契約・ヘルパーは `@likex/core` を使います。コピー導入では `packages/core/src/` 全体を `components/core/`、このフォルダ全体を `components/spreadsheet/` に置き、`spreadsheet/core.ts` の1行だけを `export * from "../core";` に変更します。`ooxml.ts`・`json.ts`・`model/core-*.ts` は内部で `core.ts` を参照するため、そのまま使います。Coreの実行時依存 `re2js@2.8.6` もインストールしてください。

[利用ガイド](./docs/README.md) に導入手順、公開API、保存と制約をまとめています。

画面を表示せずに保存JSONを加工する場合は `model-entry.ts` を使います。ソースコピーの型チェックには、画面なしの場合もTypeScriptの `lib: ["ES2022", "DOM", "DOM.Iterable"]` が必要です。モデルの実行時にはReactやDOMを使いません。[モデルAPIの利用例](./docs/headless.md)に、セル設定・行挿入・AIの操作JSONの扱いをまとめています。
