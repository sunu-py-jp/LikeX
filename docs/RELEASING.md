# LikeXの配布と公開

Explorerの配布設定は `packages/explorer/package.json`、実装の原本は `packages/explorer/src/` です。ビルドは同じパッケージ内の `dist/` に生成します。デモとテストはtarballに含めません。

## 配布物を検証する

Node.js 22.13以上とnpmを使います。

```bash
npm ci
npm run check:release
```

生成CSSの一致確認と隔離の検証、テスト、Lint、型チェック、Explorerのビルドとtarball生成、パッケージとソースコピーそれぞれの導入検証、Next.js本番ビルド、デモの本番ビルドを行います。検証用プロジェクトへの依存インストールは既定でnpmキャッシュを使います。キャッシュ不足で作業用依存にリンクした場合はレポートで区別されます。独立インストールを必須にする場合はオンライン検証を使います。

```bash
npm run pack:library
npm run test:package -- --next --online
npm run test:copy -- --next --online
```

| 成果物 | 内容 |
| --- | --- |
| `packages/explorer/dist/` | ESM・型宣言・CSS・source map |
| `packages/explorer/src/README.md` | コピー・パッケージ共通のガイド。配布物にも同梱 |
| `packages/explorer/THIRD_PARTY_NOTICES.md` | 実際の依存から生成する第三者通知 |
| `artifacts/likex-explorer-0.1.0.tgz` | 現在の名前・バージョンでの配布物 |
| `artifacts/*-report.json` / `release-check.json` | 検証結果。Git管理せず再生成します。 |

ソースコピーは生成済みの `styles.css` を含む `packages/explorer/src/` の中身を持ち出します。利用側はパッケージの `@likex/explorer/styles.css` またはコピーした `styles.css` を読み込みます。Tailwindの導入・専用設定は不要です。いずれも [Explorerの導入手順](../packages/explorer/README.md) を参照してください。

## 公開前に決めるもの

ルートの `package.json` は常に非公開です。Explorerも現在は `private: true` / `UNLICENSED` で、tarballの作成は公開の実行を意味しません。

1. `@likex` scopeの利用権と公開先、パッケージ名を確定します。
2. 権利者がライセンスを選び、ルートとパッケージのLICENSE・manifestを整えます。
3. バージョンと変更内容を確認し、公開対象のパッケージだけprivateガードを解除します。
4. 最終設定で再度配布物を生成・検証します。

第三者のライセンス通知は、LikeX自体のライセンス選択を代行しません。将来Spreadsheetを追加する場合も、独立したmanifest・バージョン・検証を用意します。現在の配布スクリプトはExplorerを対象としています。

## GitHubから使える形で公開する

検証したtarballをGitHub Releasesに添付します。タグは `explorer-v0.1.0` のようにモジュール名を含めると、将来のモジュールと区別できます。利用側はダウンロードしたtarball、またはその配布URLをnpmへ渡します。

```bash
npm install ./likex-explorer-0.1.0.tgz
```

URL指定は `npm install https://github.com/OWNER/LikeX/releases/download/explorer-v0.1.0/likex-explorer-0.1.0.tgz` の形です。OWNER等は実際の公開先へ置き換えます。これはURLの形式例で、公開済みのリンクではありません。リポジトリのルートをGit依存としてインストールする方式ではありません。

npmレジストリにも公開する場合は、アカウント・ライセンス・公開内容を確認した後に、同じ検証済みtarballを指定します。

```bash
npm publish artifacts/likex-explorer-0.1.0.tgz --access public
```

このリポジトリのCIは検証と成果物保存だけを行い、自動公開しません。
