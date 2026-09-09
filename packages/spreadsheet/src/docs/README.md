# Spreadsheet利用ガイド

セルの編集結果はコンポーネント内の下書きです。「保存」を押すと `onSave` にブック全体を渡します。外部通信や永続化は自動で行いません。

## コピー導入

リポジトリの `packages/spreadsheet/src/` 全体を、利用先の `components/spreadsheet/` にコピーします。`model/`・`state/`・`ui/`・CSSを含めてください。React / React DOM `^19.2.6` と、TypeScript環境では対応する型定義が必要です。

```tsx
"use client";

import Spreadsheet, { createWorkbook, setCellValue } from "@/components/spreadsheet";
import "@/components/spreadsheet/styles.css";

const empty = createWorkbook();
const workbook = setCellValue(empty, empty.sheets[0].id, "A1", "売上");

export default function SheetView() {
  return <Spreadsheet initialWorkbook={workbook} style={{ height: 560 }} />;
}
```

`@/` は利用先で設定するパスエイリアスです。設定しない場合は相対パスでimportしてください。パッケージ導入では入口を `@likex/spreadsheet`、CSSを `@likex/spreadsheet/styles.css` に読み替えます。どちらもCSSを明示的に1回読み込み、ホストから高さを指定します。Tailwind CSSの設定は不要です。

Next.js App Routerでは `app/layout.tsx` にCSSのimportを置きます。コールバックのない読み取り専用ビューはServer Componentから呼び出せます。`onSave` 等を渡す親はClient Componentにしてください。

## 詳細

- [公開API・保存と機能設定](./api.md)
- [操作と初版の制約](./capabilities.md)
- [基本15関数・数式とJSON保存](./functions.md)
- [画像・図形・コメント・テキストボックスとJSON保存](./insertions-and-json.md)

スタイルは `.lxs-*`、`--lxs-*`、`data-likex-spreadsheet` の名前空間を使います。`colorMode="light" | "dark" | "system"` と `className` / `style` で表示を調整できます。必要ならコンポーネントのルートに `--lxs-background`、`--lxs-foreground`、`--lxs-panel`、`--lxs-border`、`--lxs-muted`、`--lxs-accent` を上書きします。
