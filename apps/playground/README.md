# LikeX Explorer Playground

Explorerの操作と見た目を確認するVite + Reactのデモです。アプリ画面にはExplorerだけを配置します。

リポジトリのルートで依存関係をインストールした後、次のコマンドで起動します。

```sh
npm run dev --workspace @likex/playground
```

`@likex/explorer` は `packages/explorer/src/index.ts` に直接解決します。ライブラリを先にビルドする必要はありません。`src/styles.css` からExplorerの生成済みCSSを読み込みます。このデモ自体にTailwind/PostCSSの設定はありません。開発用Viteプラグインが起動時とExplorerのソース変更時にCSSを再生成します。

```sh
npm run build --workspace @likex/playground
npm run preview --workspace @likex/playground
```

ビルド先はこのディレクトリの `dist/` です。同梱した依存パッケージの一覧と通知を `third-party-inventory.json`、`third-party-notices.txt` として生成します。

`src/explorer-demo.tsx` が親側の保存・再取得・ファイル読み込みを担当します。保存先は同じブラウザータブのメモリのみで、ページ全体を再読み込みすると初期状態に戻ります。Explorerの更新ボタンはメモリに保存済みの一覧を再取得します。認証、API、DB、ストレージは実装していません。

`src/demo/seed.ts` は階層付きの初期データ、`src/demo/icon-samples.ts` はすべての既定アイコンを表示するためのファイル生成です。アイコン用ファイルは表示確認用テキストであり、有効なOffice・フォント・圧縮ファイルではありません。

デモは `icons` フォルダの中アイコン表示から開始します。お気に入り・コピー・新しいファイルの作成・チェックボックスは非表示で、追加できる拡張子は `csv, md, json, xlsx, xls, docx, doc, pptx, ppt` です。
