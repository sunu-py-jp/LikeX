# Spreadsheet利用ガイド

[セル・範囲・画像の取得](./data-access.md)と[画面なしの編集セッション・Undo／Redo](./history-session.md)は、保存JSONと表示中の下書きの両方に対応します。

セルの編集結果はコンポーネント内の下書きです。「保存」を押すと `onSave` にブック全体を渡します。外部通信や永続化は自動で行いません。

## コピー導入

リポジトリの `packages/spreadsheet/src/` 全体を `components/spreadsheet/`、`packages/core/src/` 全体を `components/core/` にコピーします。`model/`・`state/`・`ui/`・CSSも含めてください。Spreadsheetの配置先は `components/like-spreadsheet/` などの名前でも、Coreと隣接していれば同じ手順です。

コピー後に変更するCoreの参照は、`components/spreadsheet/core.ts` の次の1行だけです。

```ts
export * from "../core";
```

`ooxml.ts`・`json.ts`・`model/core-connectors.ts`・`model/core-office-shapes.ts`・`model/core-text-search.ts` は、内部で `core.ts` へ接続するため変更しません。Coreの実行時依存として `npm install re2js@2.8.6` を実行します。パッケージ導入ではcoreの依存として自動解決します。React / React DOM `^19.2.6` と、TypeScript環境では対応する型定義も必要です。

コピーしたソースの型チェックには、画面なしの `model-entry.ts` だけを使う場合もTypeScriptの `lib: ["ES2022", "DOM", "DOM.Iterable"]` を指定してください。これは型定義の要件で、モデルの実行時にはReactやDOMを使いません。パッケージの `@likex/spreadsheet/model` は、DOM型定義を追加しない `lib: ["ES2022"]` のstrict環境でも使えます。

以前のコピーから更新する場合は、SpreadsheetとCoreのソースを同じバージョンから一緒に更新してください。以前に参照先を書き換えた `ooxml.ts`・`json.ts`・`model/core-*.ts` も新しいファイルをコピーし直し、利用先への参照変更は `core.ts` に集約します。

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

この例は閲覧用です。編集・保存を有効にする場合は、`onSave` に利用側の保存処理を渡します。[保存とイベント](./lifecycle.md)に接続例があります。

`@/` は利用先で設定するパスエイリアスです。設定しない場合は相対パスでimportしてください。パッケージ導入では入口を `@likex/spreadsheet`、CSSを `@likex/spreadsheet/styles.css` に読み替えます。どちらもCSSを明示的に1回読み込み、ホストから高さを指定します。Tailwind CSSの設定は不要です。

Next.js App Routerでは `app/layout.tsx` にCSSのimportを置きます。コールバックのない読み取り専用ビューはServer Componentから呼び出せます。`onSave` 等を渡す親はClient Componentにしてください。

## 詳細

- [埋め込み画像と配置の収集](./image-collection.md)
- [公開API・保存と機能設定](./api.md)
- [保存・編集許可・イベントの注入](./lifecycle.md)
- [機能のON/OFF](./features.md)
- [リボンの表示と非表示](./ribbon-display.md)
- [条件付きの右クリックメニュー](./context-menu.md)
- [外部からセル・行列・画像・図形を操作する](./external-operations.md)
- [画面なしでJSONを編集する](./headless.md)
- [セルの書き込み・クリアと上書き方針](./cell-writing.md)
- [名前付き範囲の追加・取得・削除](./named-ranges.md)
- [テーブルとセル範囲へのデータ配置](./tables.md)
- [配置位置と次の行・列](./drawing-placement.md)
- [書式・表示形式・条件付き書式](./formatting.md)
- [検索・置換・貼り付け・オートフィル](./editing-tools.md)
- [シートの追加・名前変更・複製・並べ替え](./sheets.md)
- [入力規則・プルダウン・チェックボックス](./input-validation.md)
- [操作と対応範囲](./capabilities.md)
- [表示倍率の変更](./zoom.md)
- [セル・範囲・行列の複数選択](./selection.md)
- [セル範囲をずらして挿入・削除する](./cell-shifts.md)
- [セルの結合・解除とJSON保存](./merged-cells.md)
- [対応関数・数式とJSON保存](./functions.md)
- [画像・図形・コメント・テキストボックスとJSON保存](./insertions-and-json.md)
- [Spreadsheet形式（.spon）の読み込み・書き出し](./native-files.md)
- [Excelの取り込み](./excel-import.md)
- [Excelへのエクスポート](./excel-export.md)
- [内部構成と拡張の方針](./architecture.md)

スタイルは `.lxs-*`、`--lxs-*`、`data-likex-spreadsheet` の名前空間を使います。`colorMode="light" | "dark" | "system"` と `className` / `style` で表示を調整できます。必要ならコンポーネントのルートに `--lxs-background`、`--lxs-foreground`、`--lxs-panel`、`--lxs-border`、`--lxs-muted`、`--lxs-accent` を上書きします。
