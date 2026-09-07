# LikeX

身近なアプリケーションのように操作できるReact UIを集めるリポジトリです。最初のモジュールは、Windows Explorer風の **`@likex/explorer`** です。

各モジュールはパッケージとして導入でき、ソースフォルダをコピーして使うこともできます。ほかのLikeXモジュールや共通Providerには依存しません。

## Explorerを使う

```tsx
import Explorer from "@likex/explorer";
import "@likex/explorer/styles.css";

<Explorer initialEntries={[]} style={{ height: 640 }} />
```

[パッケージの導入手順](packages/explorer/README.md) · [コピー導入・API・運用ガイド](packages/explorer/src/docs/README.md)

React / React DOMと表示枠の高さは利用側で用意します。生成済みCSSを同梱しているため、利用先へのTailwind CSSの導入は不要です。コピーする場合は `packages/explorer/src/` をまとめて持ち出し、ガイドに記載した実行時依存を導入します。

Explorerはファイル操作をクライアントの下書きに保持し、保存ボタンから `onSave` へ最終一覧と差分を渡します。`onSave` 未指定なら読み取り専用です。保存・認証・DB・Blob / S3への接続は親アプリが担当します。

## 開発する

Node.js 22.13以上とnpmを使います。

```bash
npm ci
npm run dev
```

デモは `http://127.0.0.1:5173/` で起動します。保存先はタブ内メモリです。

```text
packages/explorer/  # 独立して配布・コピーできるExplorer
apps/playground/    # Vite + Reactのデモ
scripts/            # ビルド・配布・導入検証
docs/               # 開発・構成・公開手順
```

[開発ドキュメント](docs/README.md) にコマンド一覧、構成、配布手順、レビュー記録をまとめています。将来のモジュールは `packages/<module>/` に追加します。

GitHubリポジトリは公開しています。npm・GitHub Releasesへのパッケージ公開は未実施で、ルートとExplorerは現在 `private: true` / `UNLICENSED` です。
