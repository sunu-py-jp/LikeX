# LikeXのモジュール構成

npm workspacesで開発環境を共有し、UIの配布単位は `@likex/explorer` と `@likex/spreadsheet` に分けます。リポジトリの名前はLikeX、npmの名前は小文字のscope付きにします。scopeの取得・公開先の設定は公開時に確認します。

## 責務

| 場所 | 責務 |
| --- | --- |
| `packages/<module>/src` | コピーだけでも持ち出せるモジュールの原本。公開入口、型、UI、状態管理、データ処理、利用ガイドを含みます。 |
| `packages/<module>/tests` | モジュールの振る舞いと公開型を検証します。利用先へは配布しません。 |
| `packages/<module>/package.json` | 配布する名前・公開入口・依存・バージョン・ライセンスを宣言します。 |
| `apps/playground` | サンプルデータとデモの保存先を持つ利用者側の例です。ライブラリには含めません。 |
| `scripts` | ビルド・型生成・配布物検査・導入検証をまとめます。 |
| `docs` | リポジトリ全体の方針、公開手順、レビュー記録を置きます。 |

各モジュールの `model` はReactの表示状態に依存しないデータ・検証・操作を担当し、`state` はReactの状態と親へのコールバックをつなぎ、`ui` は表示を担当します。公開入口の `index.ts` から利用し、内部ファイルのパスを利用側の契約にしません。Spreadsheetの数式はモデル内の限定した構文解析器で評価し、JavaScriptとして実行しません。

## パッケージとコピーで原本を共用する

配布用にもう一つ実装を持ちません。`src/` から `dist/` のESMと型宣言を生成し、`src/README.md` と `src/docs/` の利用ガイドを同じ配置で配布物へ同梱します。READMEは導入と詳細への入口、`docs/` は責務ごとの詳細です。

コピー導入では `src/` 全体を利用先へ配置します。他のLikeXモジュール、リポジトリのパスエイリアス、必須の共通Providerには依存させません。Reactなどの外部依存は明示します。更新時は取得元バージョンと利用側での変更差分を管理します。

共通化はビルド・検証・設計ルールから行います。将来、複数モジュールのUIに似た処理が増えても、コピー単位の独立性を失う共通ランタイムを先に作ることはしません。

## Tailwindとデザイン

Explorerの開発ではTailwind CSS v4を使い、TSXの専用クラスとテーマ設定から生成したCSSを同梱します。Spreadsheetは専用の `lxs-` クラスに限定したCSSを同梱します。利用側は各パッケージの `styles.css`、コピー導入ではコピーした `styles.css` を読み込みます。どちらも利用側へのTailwind導入や専用PostCSS設定は不要です。

`packages/explorer/styles/input.css` とTSXが原本で、`src/styles.css` は自動生成します。コピー導入のため生成済みCSSをGit管理しますが、手編集しません。配布時は同じ内容を `dist/styles.css` へ配置します。`check:styles` が原本との不一致を検出し、配布ビルドとplaygroundのソース編集時にも再生成します。

専用の `lxe:` クラスと内部CSS変数を使い、基礎CSS・テーマ・ユーティリティをExplorer本体とPortalの範囲へ限定します。全体へのPreflightやテーマ変数の上書きを避けます。通常のDOMなので、利用先の高い詳細度や!importantを持つCSSまで完全に遮断するものではありません。

`theme`、`colorMode`、`style` による動的カスタマイズには再生成は不要です。コピー後に内部クラスを変更した場合のみ、CSSの再生成が必要です。

Next.jsへの対応は、独立した利用先の本番ビルドで検証します。Next.jsはこのリポジトリの検証用依存であり、各モジュールの実行時依存ではありません。

## フォルダ構成

```text
LikeX/
├── packages/explorer/
│   ├── src/
│   │   ├── index.ts       # 公開入口
│   │   ├── props.ts       # コンポーネントの引数
│   │   ├── model/         # 型、検証、データ操作
│   │   ├── state/         # Reactの状態・操作管理
│   │   ├── ui/            # 表示、テーマ、共通コントロール
│   │   ├── styles.css     # 自動生成CSS（コピー導入にも同梱）
│   │   ├── docs/          # API・組み込み・運用例
│   │   └── README.md      # コピー導入と利用ガイドの入口
│   ├── styles/input.css   # 維持するCSS生成入力
│   ├── tests/             # モジュールのテストと導入検証fixture
│   ├── dist/              # 生成されるESM・型宣言・CSS
│   ├── package.json
│   └── README.md          # パッケージ導入と利用ガイドの入口
├── packages/spreadsheet/  # 同じ責務分担の独立モジュール（Reactのみ依存）
├── apps/playground/       # Vite + Reactのメモリ保存デモ
├── scripts/               # ビルド・配布・導入検証
├── docs/                  # 開発方針・公開手順・レビュー
├── package.json           # 非公開のnpm workspacesルート
└── LICENSE
```

デモは認証や永続ストレージを内蔵しません。旧API等を削除した経緯は [レビュー記録](release-review.md) にあります。Spreadsheetの保存・検索サービスやExcelファイル変換等は、利用側で必要に応じて接続します。
