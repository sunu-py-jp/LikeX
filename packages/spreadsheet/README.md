# @likex/spreadsheet

Excel風のReact / TypeScriptスプレッドシートです。セル編集・基本数式・複数シートに加え、画像・図形・コメント・テキストボックスを挿入できます。保存は全内容をJSONで扱えるスナップショットとして利用側へ渡します。Explorerへの依存はありません。

## 最短導入

配布されたtarballをインストールします。npmレジストリへの公開はまだ行っていません。

```bash
npm install ./likex-spreadsheet-0.1.0.tgz
```

React / React DOM `^19.2.6` が必要です。Tailwind CSSや専用のPostCSS設定は不要です。

```tsx
"use client";

import { useState } from "react";
import Spreadsheet, { createWorkbook } from "@likex/spreadsheet";
import "@likex/spreadsheet/styles.css";

export default function Budget() {
  const [savedWorkbook, setSavedWorkbook] = useState(createWorkbook);
  return (
    <Spreadsheet
      initialWorkbook={savedWorkbook}
      onSave={workbook => { setSavedWorkbook(workbook); }}
      title="予算表"
      style={{ height: 560 }}
    />
  );
}
```

これはメモリ内に保存する例です。再読み込みで初期状態に戻るため、本番では `onSave` を保存処理へ接続します。CSSはアプリの入口で1回importします。Next.js App RouterではCSSを `app/layout.tsx` で読み込めます。コールバックを渡す親はClient Componentにしてください。

`onSave` がない場合は読み取り専用です。`initialWorkbook` はマウント時だけ読みます。別のブックを開く場合はReactの `key` を変更してください。

## 詳細ガイド

[利用ガイド](./src/docs/README.md) に、コピー導入、公開型、保存、機能設定、数式と制約をまとめています。[挿入機能とJSONの具体例](./src/docs/insertions-and-json.md) も参照できます。コピー導入ではリポジトリの `packages/spreadsheet/src/` 全体を持ち出します。

初版はExcelの完全互換ではありません。`.xlsx` 入出力、グラフ、ピボットテーブル、マクロは含みません。認証・認可・保存先との競合解決は利用側の責務です。現在は `private: true` / `UNLICENSED` であり、tarball作成は公開やライセンス付与を意味しません。
