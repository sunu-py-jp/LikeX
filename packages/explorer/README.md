# @likex/explorer

Windows Explorer風のReact / TypeScriptコンポーネントです。ファイルの追加・移動・改名・削除をクライアントの下書きに保持し、「保存」で最終一覧と差分を親へ渡します。保存・認証・DB・Blob / S3への接続は利用側が担当します。

## 最短導入

検証用または配布されたtarballをインストールします。npmレジストリへの公開はまだ行っていません。

```bash
npm install ./likex-explorer-0.1.0.tgz
```

React / React DOM `^19.2.6` が必要です。その他の実行時依存はパッケージから導入されます。**利用先へのTailwind CSS・専用PostCSS設定は不要です。**

```tsx
"use client";

import { useState } from "react";
import Explorer, { type ExplorerEntry } from "@likex/explorer";
import "@likex/explorer/styles.css";

export default function FileManager() {
  const [savedEntries, setSavedEntries] = useState<readonly ExplorerEntry[]>([]);

  return (
    <Explorer
      initialEntries={savedEntries}
      onSave={({ entries }) => {
        setSavedEntries(entries);
        return entries;
      }}
      style={{ height: 640 }}
    />
  );
}
```

これはメモリ内に保存する例です。一覧の空白を右クリックしてファイルやフォルダを作成でき、ページの再読み込みで初期状態に戻ります。本番では `onSave` を利用側の保存処理へ接続します。

CSSはアプリの入口で1回読み込みます。Next.js App Routerでは `app/layout.tsx` にCSSのimportを移せます。コールバックを渡す親はClient Componentにしてください。

## 導入時の要点

- `onSave` 未指定なら読み取り専用です。`initialEntries` はマウント時だけ読み、最新一覧への更新には `onRefresh` を使います。
- コピー導入はリポジトリの `packages/explorer/src/` 全体を持ち出し、実行時依存とCSSのimportを用意します。詳細な手順は [利用ガイド](./src/docs/README.md) にあります。
- 下書きはメモリ内です。SPA遷移やアンマウント前の未保存確認は親が `onDirtyChange` で扱います。UIの制限はサーバーの認証・認可に代わるものではありません。
- Office文書の内蔵プレビューはありません。プレビュー、認証付きダウンロード、本文・セマンティック検索は親から処理を渡せます。
- 内蔵ZIPはメモリ内で生成します。大きなダウンロードは親の処理へ委譲してください。ウィンドウ・クリップボード等の動作はブラウザとOSにも依存します。

## 詳細ガイド

[利用ガイドの目次](./src/docs/README.md) から、公開型、機能ON/OFF、検索、保存・更新、プレビュー・ダウンロード、テーマ、ポップアップ、制約、運用例を参照できます。ガイドの `@/components/explorer` はコピー導入の例で、パッケージ利用時は `@likex/explorer` に読み替えます。

Azure等の構成例は設計サンプルであり、バックエンドの実装ではありません。現在のmanifestは `private: true` / `UNLICENSED` です。tarballの作成・配布はオープンソースライセンスの付与やnpm公開を意味しません。
