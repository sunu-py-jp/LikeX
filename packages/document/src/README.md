# LikeDocument ソース

[利用ガイド](docs/README.md)と[導入・ソースコピー](docs/getting-started.md)を参照してください。同じバージョンのDocumentとCoreのソース全体を隣接フォルダへコピーし、`document/core.ts` の1行だけを `export * from "../core";` に変更します。`json.ts`・`ooxml.ts`・`browser.ts`・`model/core-*.ts` は内部で `core.ts` を参照するため、そのまま使います。ProseMirror・lucide-reactとCoreの実行時依存 `re2js@2.8.6`、CSS、第三者ライセンス通知も保持します。

`thumbnail.ts` は編集エンジンを起動しない表示専用入口です。[軽量サムネイル](docs/thumbnail.md)を参照してください。
