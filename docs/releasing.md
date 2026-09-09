# LikeXの配布と公開

ExplorerとSpreadsheetは独立したパッケージです。各配布設定は `packages/<module>/package.json`、実装の原本は `packages/<module>/src/` です。ビルドは同じパッケージ内の `dist/` に生成します。デモとテスト、`src/` のTypeScriptファイルは配布一覧から除外します。デバッグ用source mapにはソース内容を含みます。コピー用の原本はリポジトリから取得します。

## 配布物を検証する

Node.js 22.13以上とnpmを使います。

```bash
npm ci
npm run check:release
```

Explorerの生成CSSの一致確認と隔離の検証、テスト、Lint、型チェック、両パッケージのビルドとtarball生成、パッケージとソースコピーそれぞれの導入検証、Next.js本番ビルド、デモの本番ビルドを行います。導入検証ではstrictな型解決、SSR、CSSの同一性・隔離、パッケージ内の文書リンクも確認します。検証用プロジェクトへの依存インストールは既定でnpmキャッシュを使います。キャッシュ不足で作業用依存にリンクした場合はレポートで区別されます。独立インストールを必須にする場合はオンライン検証を使います。

```bash
npm run pack:library -- --all
npm run test:package -- --all --next --online
npm run test:copy -- --all --next --online
```

CIでは `npm run check:release -- --online` を実行し、パッケージ・コピー導入とも依存を独立してインストールします。ローカルのnpmキャッシュやworkspaceへのリンクで成功した結果を、CIの導入検証に代用しません。インストールに失敗した場合はCIを失敗させ、ログを成果物に残します。配布スクリプトの回帰テストは `npm run test:scripts` でも実行できます。

`build:library`、`pack:library`、`test:package`、`test:copy` は引数なしなら従来どおりExplorerを扱います。Spreadsheetだけを扱う場合は `-- --module spreadsheet` を指定し、検証オプションの `--next` / `--online` を同じ位置に追加します。`check:release` は常に登録済みの全モジュールを検証します。モジュールのパス・CSS方式・検証用の識別子は `scripts/lib/modules.mjs` に登録しています。

| 成果物 | 内容 |
| --- | --- |
| `packages/<module>/dist/` | ESM・NodeNext対応の型宣言・CSS・source map |
| `packages/<module>/src/README.md` / `src/docs/` | コピー・パッケージ共通の利用ガイド。Markdownを配布物にも同じ配置で同梱 |
| `packages/<module>/THIRD_PARTY_NOTICES.md` | 実際の依存から生成する第三者通知 |
| `artifacts/likex-explorer-0.1.0.tgz` | 現在の名前・バージョンでの配布物 |
| `artifacts/spreadsheet/likex-spreadsheet-0.1.0.tgz` | Spreadsheetの配布物 |
| `artifacts/*-report.json` / `artifacts/spreadsheet/*-report.json` | 各モジュールの導入検証結果 |
| `artifacts/release-check.json` | 全検証の実行結果。成果物はGit管理せず再生成します。 |

ソースコピーは `styles.css` を含む `packages/<module>/src/` の中身を持ち出します。利用側はパッケージの `@likex/<module>/styles.css` またはコピーした `styles.css` を読み込みます。両方とも利用先でTailwindの導入・専用設定は不要です。[Explorerの導入手順](../packages/explorer/README.md) または [Spreadsheetの導入手順](../packages/spreadsheet/README.md) を参照してください。

## 公開前に決めるもの

ルートの `package.json` は常に非公開です。Explorer・Spreadsheetも現在は `private: true` / `UNLICENSED` で、tarballの作成は公開の実行を意味しません。

1. `@likex` scopeの利用権と公開先、パッケージ名を確定します。
2. 権利者がライセンスを選び、ルートとパッケージのLICENSE・manifestを整えます。
3. バージョンと変更内容を確認し、公開対象のパッケージだけprivateガードを解除します。
4. 最終設定で再度配布物を生成・検証します。

第三者のライセンス通知は、LikeX自体のライセンス選択を代行しません。将来のモジュールにも独立したmanifest・バージョン・消費側fixtureを用意し、共通の配布検証へ登録します。

## GitHubから使える形で公開する

検証したtarballをGitHub Releasesに添付します。タグは `explorer-v0.1.0`、`spreadsheet-v0.1.0` のようにモジュール名を含めると区別できます。利用側はダウンロードしたtarball、またはその配布URLをnpmへ渡します。

```bash
npm install ./likex-explorer-0.1.0.tgz
```

URL指定は `npm install https://github.com/OWNER/LikeX/releases/download/explorer-v0.1.0/likex-explorer-0.1.0.tgz` の形です。OWNER等は実際の公開先へ置き換えます。これはURLの形式例で、公開済みのリンクではありません。リポジトリのルートをGit依存としてインストールする方式ではありません。

npmレジストリにも公開する場合は、アカウント・ライセンス・公開内容を確認した後に、同じ検証済みtarballを指定します。

```bash
npm publish artifacts/likex-explorer-0.1.0.tgz --access public
```

このリポジトリのCIは検証と成果物保存だけを行い、自動公開しません。
