# LikeDiagram ソース

[利用ガイド](docs/README.md)を参照してください。コピー導入では、この `src` の内容と `packages/core/src` を隣り合うフォルダに置きます。`core.ts` の1行だけを `export * from "../core";` に変更します。`json.ts`・`browser.ts` は内部でこの入口を参照するため、そのまま使います。CSSとLICENSE・第三者通知も含めてください。
