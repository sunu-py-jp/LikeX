# LikeXの開発と検証

Node.js 22.13以上とnpmを使います。リポジトリのルートで実行してください。

```bash
npm ci
npm run dev
```

デモは `http://127.0.0.1:5173/`（Explorer）、`/spreadsheet`、`/slide`、`/document`、`/board`、`/diagram`、`/calendar`、`/whiteboard`、`/aichat`（AI会話）、`/chat`（人同士の会話）、`/dataview`、`/form` で起動します。通常デモの保存先はブラウザタブ内メモリで、ページ全体を再読み込みすると初期状態へ戻ります。Explorerの `icons` フォルダに全拡張子のアイコン確認用サンプルがあります。サンプル本体は表示確認用のテキストです。

デモの親コンポーネント、初期データ、機能設定、単独ビルドは [playgroundのREADME](../apps/playground/README.md) を参照してください。

`/spreadsheet/ai` と `/slide/ai` は資料一覧・新規作成から始まり、LikeAIChatで本体を操作するデモです。保存済み資料はホストがブラウザーのIndexedDBへ保持し、再読み込み後も一覧から開けます。チャット履歴と未保存の編集は永続化しません。ルートの `.env` にOpenAIまたはAzure OpenAIを設定します（[設定例](../.env.example)）。起動時に両モジュールのCLIランタイムもビルドし、対象スキル・参照資料の読み込みと同梱CLI実行をサーバー側で行います。詳細は [AIデモの設定と動作](../apps/playground/README.md#spreadsheet／slideのaiデモ) を参照してください。

## コマンド

| コマンド | 用途 |
| --- | --- |
| `npm test` | 各パッケージのテスト |
| `npm run lint` / `npm run typecheck` | リポジトリのLint・各workspaceの型チェック |
| `npm run build` | 全モジュールの配布ビルドとデモの本番ビルド |
| `npm run build:styles` / `npm run check:styles` | ExplorerのCSS生成・原本との一致確認 |
| `npm run pack:library` | Explorerのtarballを `artifacts/` に生成 |
| `npm run pack:library -- --all` | 登録済み全モジュールのtarballを生成 |
| `npm run test:package -- --all --next` | 全tarballを別プロジェクトに導入。UIはNext.js、coreはNode.jsで検証 |
| `npm run test:copy -- --all --next` | 全ソースフォルダのコピー導入を検証。UIはNext.jsも確認 |
| `npm run check:release` | 全パッケージのテストから配布・コピー・デモの検証まで実行 |
| `npm run check:release -- --online` | CIと同じく、依存の独立インストールを必須にして全検証を実行 |
| `npm run test:scripts` | CSS生成・配布スクリプトの回帰テスト |
| `npm run benchmark:explorer` | データ処理のベンチマーク |

`build:library`、`pack:library`、`test:package`、`test:copy` は既定でExplorerを対象にします。個別には `-- --module spreadsheet` / `-- --module slide` / `-- --module document` / `-- --module aichat` / `-- --module chat` / `-- --module core`、全体なら `-- --all` を付けます。`test:package` の前には同じ対象の `pack:library` を実行してください。UIのbuild/packは依存するcoreを先に処理します。UIのtest/typecheck、Playgroundのdev/build/typecheckもcoreを先にビルドします。デモ起動中にcoreのソースを変更した場合は、`npm run build --workspace @likex/core` で再ビルドしてください。Documentの成果物は `artifacts/document/`、ほかも `artifacts/<module>/` に生成します（Explorerは従来の `artifacts/`）。

`packages/explorer/src/styles.css` はコピー導入のためGit管理する生成物です。手編集せず、TSXまたは `packages/explorer/styles/input.css` を変更して再生成します。デモ起動中もExplorerのソース変更に合わせて再生成します。Spreadsheetの `src/styles.css` は手書きの独立したCSSで、直接編集します。設計の理由は [モジュール構成](architecture.md#tailwindとデザイン) にあります。

`dist/` と `artifacts/` はGit管理しない生成物です。配布検証の方式・レポート・公開手順は [配布と公開](releasing.md) を参照してください。

AI機能を変更する場合は `@likex/aichat`、人同士の会話を変更する場合は `@likex/chat` のテスト・型チェック・導入fixtureを対象にします。AIの旧 `likex.chat` / version 1からの検証付き移行と、両方を同時に表示した際のCSSの独立性も維持してください。coreを生成する検証は同じ作業ディレクトリで並列実行しません。
