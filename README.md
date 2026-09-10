# LikeX

身近なアプリケーションのように操作できるReact UIを集めるリポジトリです。

各モジュールはパッケージとして導入でき、ソースフォルダをコピーして使うこともできます。ExplorerとSpreadsheetは小さな共通基盤 `@likex/core` を使います。共通Providerは不要です。

| モジュール | 用途 | ガイド |
| --- | --- | --- |
| `@likex/core` | 保存・編集許可・通知・機能設定の共通型とヘルパー | [共通基盤](packages/core/README.md) |
| `@likex/explorer` | ファイル・フォルダの表示と編集 | [Explorer](packages/explorer/README.md) |
| `@likex/spreadsheet` | Excel風のセル編集・基本数式・複数シート | [Spreadsheet](packages/spreadsheet/README.md) |

[機能別APIリファレンス](docs/APIDocs/index.html) · [ドキュメントの開き方](docs/APIDocs/README.md)

## Explorerを使う

```tsx
import Explorer from "@likex/explorer";
import "@likex/explorer/styles.css";

<Explorer initialEntries={[]} style={{ height: 640 }} />
```

[パッケージの導入手順](packages/explorer/README.md) · [コピー導入・API・運用ガイド](packages/explorer/src/docs/README.md)

React / React DOMと表示枠の高さは利用側で用意します。生成済みCSSを同梱しているため、利用先へのTailwind CSSの導入は不要です。コピー導入ではUIの `src/` と `packages/core/src/` を隣接フォルダへ置き、UI側の `core.ts` 1行をローカルへの相対importに変更します。詳細は各導入ガイドを参照してください。

Explorerはファイル操作をクライアントの下書きに保持し、保存ボタンから `onSave` へ最終一覧と差分を渡します。`onSave` 未指定なら読み取り専用です。保存・認証・DB・Blob / S3への接続は親アプリが担当します。

## 開発する

Node.js 22.13以上とnpmを使います。

```bash
npm ci
npm run dev
```

デモは `http://127.0.0.1:5173/`（Explorer）、`http://127.0.0.1:5173/spreadsheet`（Spreadsheet）で起動します。保存先はタブ内メモリです。Spreadsheetは基本操作から実装する初版で、Excel全機能・ファイル形式との互換を保証するものではありません。

```text
packages/explorer/  # 独立して配布・コピーできるExplorer
packages/core/      # 共通契約・ヘルパーの唯一の編集元
packages/spreadsheet/ # 独立して配布・コピーできるSpreadsheet
apps/playground/    # Vite + Reactのデモ
scripts/            # ビルド・配布・導入検証
docs/               # 開発・構成・公開手順
```

[開発ドキュメント](docs/README.md) にコマンド一覧、構成、配布手順、レビュー記録をまとめています。将来のモジュールは `packages/<module>/` に追加します。

GitHubリポジトリは公開しています。npm・GitHub Releasesへのパッケージ公開は未実施で、ルートと各パッケージは現在 `private: true` / `UNLICENSED` です。
