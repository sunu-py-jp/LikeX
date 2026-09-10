# @likex/spreadsheet

Excel風のReact / TypeScriptスプレッドシートです。セル編集・検索置換・オートフィル・書式・条件付き書式・入力規則・複数シートに加え、画像・図形・コメント・テキストボックスを挿入できます。保存は全内容をJSONで扱えるスナップショットとして利用側へ渡します。Explorerへの依存はありません。

## 最短導入

配布されたtarballをインストールします。npmレジストリへの公開はまだ行っていません。

```bash
npm install ./likex-core-0.1.0.tgz ./likex-spreadsheet-0.1.0.tgz
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

`ref` 経由の `execute` / `batch` で、セル・行列・画像・図形などを外側から操作できます。[外部操作API](./src/docs/external-operations.md) に型、具体例、一括処理と保存のルールをまとめています。

画面を用意せずにJSONを編集する場合は `@likex/spreadsheet/model` を使えます。[画面なしでJSONを編集する](./src/docs/headless.md)に、セル設定、値を伴う行挿入、AIの操作JSONをまとめて適用する例があります。

画像の下に表を続ける場合は、コマンド結果の `placement` と[配置位置のヘルパー](./src/docs/drawing-placement.md)を利用できます。

[利用ガイド](./src/docs/README.md) に、コピー導入、公開型、保存、機能設定と制約をまとめています。[基本15関数と数式](./src/docs/functions.md)、[挿入機能とJSONの具体例](./src/docs/insertions-and-json.md) も参照できます。コピー導入では `packages/core/src/` と `packages/spreadsheet/src/` をそれぞれ `components/core/` と `components/spreadsheet/` へコピーし、`spreadsheet/core.ts` の1行を `export * from "../core";` へ変更します。

`.xlsx` への[Excel出力](./src/docs/excel-export.md)に対応します。保存・復元の基本形式はJSONです。Excelの完全互換ではなく、`.xlsx` インポート、グラフ、ピボットテーブル、マクロは含みません。認証・認可・保存先との競合解決は利用側の責務です。現在は `private: true` / `UNLICENSED` であり、tarball作成は公開やライセンス付与を意味しません。
