# LikeX Playground

ExplorerとSpreadsheetの操作・見た目を確認するVite + Reactのデモです。各ページに対象のコンポーネントだけを配置します。

| パス | デモ |
| --- | --- |
| `/` | Explorer |
| `/spreadsheet` | Spreadsheet。売上計画と経費の2シートで編集・数式・書式を確認できます。 |

リポジトリのルートで依存関係をインストールした後、次のコマンドで起動します。

```sh
npm run dev --workspace @likex/playground
```

`@likex/explorer` は `packages/explorer/src/index.ts` に直接解決します。ライブラリを先にビルドする必要はありません。`src/explorer-demo.tsx` からExplorerの生成済みCSSを読み込みます。このデモ自体にTailwind/PostCSSの設定はありません。開発用Viteプラグインが起動時とExplorerのソース変更時にCSSを再生成します。

`@likex/spreadsheet` も `packages/spreadsheet/src/index.ts` へ直接解決します。`src/spreadsheet-demo.tsx` が独立したCSSと表示用データを読み込み、親のメモリへ保存します。`src/demo/spreadsheet-workbook.ts` は架空のサンプルで、TSV貼り付け、セル参照、別シート参照の動作確認に使えます。ページの再読み込みで初期状態へ戻ります。

`src/main.tsx` はパスに応じて対象デモだけを遅延読み込みします。デモごとにJSとCSSを分け、SpreadsheetページでExplorerを先読みしません。

```sh
npm run build --workspace @likex/playground
npm run preview --workspace @likex/playground
```

ビルド先はこのディレクトリの `dist/` です。同梱した依存パッケージの一覧と通知を `third-party-inventory.json`、`third-party-notices.txt` として生成します。

`src/explorer-demo.tsx` が親側の保存・再取得・ファイル読み込みを担当します。保存先は同じブラウザータブのメモリのみで、ページ全体を再読み込みすると初期状態に戻ります。Explorerの更新ボタンはメモリに保存済みの一覧を再取得します。認証、API、DB、ストレージは実装していません。

`src/demo/seed.ts` は階層付きの初期データ、`src/demo/icon-samples.ts` はすべての既定アイコンを表示するためのファイル生成です。アイコン用ファイルは表示確認用テキストであり、有効なOffice・フォント・圧縮ファイルではありません。

デモは `icons` フォルダの中アイコン表示から開始します。お気に入り・コピー・新しいファイルの作成・チェックボックスは非表示で、追加できる拡張子は `csv, md, json, xlsx, xls, docx, doc, pptx, ppt` です。
