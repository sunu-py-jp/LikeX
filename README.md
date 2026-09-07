# LikeX

身近なアプリケーションのように操作できるReact UIを集めるリポジトリです。最初のモジュールは、Windows Explorer風の **`@likex/explorer`** です。将来のSpreadsheetなども独立したパッケージとして追加します。

それぞれのモジュールをパッケージとして導入でき、同じ原本のソースフォルダをコピーして使うこともできます。共通のLikeX Providerや、他のLikeXモジュールへの実行時依存は持たせません。

## 構成

```text
LikeX/
├── packages/
│   └── explorer/
│       ├── src/               # パッケージ・コピー導入共通の原本
│       │   ├── index.ts       # 公開入口
│       │   ├── props.ts       # コンポーネントの引数
│       │   ├── model/         # 型、検証、データ操作
│       │   ├── state/         # Reactの状態・操作管理
│       │   ├── ui/            # 表示、テーマ、共通コントロール
│       │   ├── styles.css     # 自動生成CSS（コピー導入にも同梱）
│       │   └── README.md      # API・組み込み・運用例
│       ├── tests/            # モジュールのテストと導入検証のfixture
│       ├── dist/             # 生成されるESM・型宣言・CSS
│       ├── package.json
│       └── README.md         # 導入手順
├── apps/
│   └── playground/           # Vite + Reactのメモリ保存デモ
├── scripts/                  # ビルド・配布・導入検証
├── docs/                     # 開発方針・公開手順・レビュー
├── package.json              # 非公開のnpm workspacesルート
└── LICENSE
```

`dist/` と `artifacts/` は生成物です。Spreadsheetの空フォルダは作らず、実装を始める際に `packages/spreadsheet/` を追加します。

## Explorerを使う

[パッケージの導入手順](packages/explorer/README.md) と [コピー導入・APIガイド](packages/explorer/src/README.md) を参照してください。

```tsx
import Explorer, { type ExplorerEntry } from "@likex/explorer";
import "@likex/explorer/styles.css";
```

コピーする場合は `packages/explorer/src/` の中身を利用先の `components/explorer/` に配置し、`@/components/explorer` からimportします。コピーした `styles.css` もアプリの入口でimportします。**React / React DOM 19、必要な実行時依存、表示枠の高さは利用側で用意します。Tailwind CSSの導入や`@source`指定は不要です。** 詳しい設定は上記の導入手順にあります。

保存、認証、DB、Blob / S3接続は親アプリの責務です。Explorerはローカル操作を下書きに保持し、保存ボタンから `onSave` へ最終一覧と差分を渡します。`onSave` を省略すると読み取り専用です。[Cosmos DB・固定Blob・Azure AI Searchの構成例](packages/explorer/src/README.md#azure-reference-sample) は設計サンプルで、バックエンドの実装ではありません。

## 開発と検証

Node.js 22.13以上とnpmを使用します。

```bash
npm ci
npm run dev
```

デモは `http://127.0.0.1:5173/` で起動します。ルートの `icons` フォルダにアイコン確認用の全拡張子サンプルを表示します。これらの本体は表示確認用のテキストです。デモの保存先はタブ内メモリで、ページを再読み込みすると初期状態へ戻ります。

| コマンド | 用途 |
| --- | --- |
| `npm test` | 各パッケージのテスト |
| `npm run lint` / `npm run typecheck` | リポジトリのLint・各workspaceの型チェック |
| `npm run build` | Explorerの配布ビルドとデモの本番ビルド |
| `npm run build:styles` / `npm run check:styles` | CSSの生成・原本との一致確認 |
| `npm run pack:library` | Explorerのtarballを `artifacts/` に生成 |
| `npm run test:package -- --next` | tarballを別プロジェクトに導入してNext.jsで検証 |
| `npm run test:copy -- --next` | ソースフォルダのコピー導入をNext.jsで検証 |
| `npm run check:release` | テストから配布・コピー・デモの検証まで実行 |
| `npm run check:release -- --online` | CIと同じく、依存の独立インストールを必須にして全検証を実行 |
| `npm run test:scripts` | CSS生成・配布スクリプトの回帰テスト |
| `npm run benchmark:explorer` | データ処理のベンチマーク |

## 開発・配布の方針

[モジュールの分け方](docs/ARCHITECTURE.md)、[配布・公開手順](docs/RELEASING.md)、[最新のレビュー結果](docs/RELEASE_REVIEW.md) を参照してください。

GitHubからはモジュールごとに生成したtarballをReleasesへ添付する方式を想定しています。公開リリースとnpmレジストリへの公開はまだ行っていません。ルートとExplorerは現在 `private: true` / `UNLICENSED` です。
