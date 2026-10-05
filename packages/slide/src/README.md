# LikeSlide ソース

[導入・APIガイド](docs/README.md)を参照してください。ソースをコピーする場合はCoreも隣接フォルダへコピーし、`core.ts` の1行だけを `export * from "../core";` に変更します。更新時はCoreとSlideの `src/` 全体を同じバージョンで差し替え、`core.ts` の接続先を再設定します。
