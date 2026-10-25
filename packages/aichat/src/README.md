# LikeAIChat ソース

[利用ガイド](docs/README.md)と[導入・ソースコピー](docs/getting-started.md)を参照してください。Coreも隣接フォルダへコピーし、`core.ts` の1行だけを `export * from "../core";` に変更します。`json.ts`・`browser.ts` は内部でこの入口を参照するため、そのまま使います。lucide-react、Coreの実行時依存 `re2js@2.8.6`、CSS、ライセンスと第三者ライセンス通知も保持します。
