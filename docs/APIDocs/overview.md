# LikeXを組み込む

## コンポーネントを選ぶ

| コンポーネント | 用途 | はじめのページ |
| --- | --- | --- |
| **Explorer** | ファイル・フォルダを表示し、アップロードや移動の結果を下書きに保持します。 | [導入と初期表示](../../packages/explorer/src/docs/getting-started.md) |
| **Spreadsheet** | セル・数式・書式・画像などを編集し、ブックをJSONで受け渡します。 | [導入](../../packages/spreadsheet/src/docs/README.md) |
| **Core** | 保存・編集許可・通知など、両コンポーネントが使う共通の契約です。 | [Coreの導入](../../packages/core/docs/getting-started.md) |

ExplorerとSpreadsheetはReact / React DOM **19.2.6以降の19系**を利用します。CSSはパッケージに含まれ、利用先のTailwind CSS設定は不要です。

## まず読み取り専用で表示する

```tsx
import Explorer from "@likex/explorer";
import "@likex/explorer/styles.css";

export default function Files() {
  return <Explorer initialEntries={[]} style={{ height: 640 }} />;
}
```

`onSave` を省略すると読み取り専用になります。編集を許可する場合は `onSave` を渡し、その中で保存先に反映します。コンポーネント内の操作が、その都度サーバーへ送られることはありません。

Next.js App RouterではCSSを `app/layout.tsx` で読み込み、コールバックを渡す親コンポーネントに `"use client"` を付けます。

## 必要な機能へ進む

| やりたいこと | Explorer | Spreadsheet |
| --- | --- | --- |
| 保存先や編集許可をつなぐ | [保存・再取得](../../packages/explorer/src/docs/saving.md) | [保存・編集許可・イベント](../../packages/spreadsheet/src/docs/lifecycle.md) |
| コピーや貼り付けを使う | [コピー・切り取り・貼り付け](../../packages/explorer/src/docs/clipboard.md) | [コピー・貼り付け・オートフィル](../../packages/spreadsheet/src/docs/editing-tools.md#形式を選択して貼り付け) |
| 機能を非表示にする | [機能・選択・表示設定](../../packages/explorer/src/docs/configuration.md) | [機能のON・OFF](../../packages/spreadsheet/src/docs/features.md) |
| 独自の右クリックメニューを加える | [右クリックメニュー](../../packages/explorer/src/docs/context-menu.md) | [右クリックメニュー](../../packages/spreadsheet/src/docs/context-menu.md) |
| 外観を調整する | [配色・アイコン](../../packages/explorer/src/docs/appearance.md) | [書式・サイズ・条件付き書式](../../packages/spreadsheet/src/docs/formatting.md) |

## 導入方法

GitHubのソースから配布用tarballを作る方法と、フォルダをコピーする方法があります。**npmレジストリへの公開はまだ行っていません。** 上のパッケージ名のimportは、配布用tarballをインストールした環境で使えます。

```bash
npm ci
npm run pack:library -- --all
```

生成されたCoreと利用するUIのtarballを、利用先のプロジェクトへインストールします。コマンドの詳細は [Explorerのパッケージ導入](../../packages/explorer/README.md) または [Spreadsheetのパッケージ導入](../../packages/spreadsheet/README.md) を参照してください。

コピーする場合は `packages/core/src/` と利用するUIの `src/` を隣り合うフォルダへ置きます。UI側の `core.ts` を `export * from "../core";` に変更し、UIのCSSを1回読み込んでください。表示枠の高さも親側で指定します。

## APIと利用例の読み方

- **API表**では、プロパティ・型・省略時の動作を確認できます。
- **利用例**の `@/components/...` はコピー導入時の配置先です。パッケージ導入では `@likex/...` に読み替えます。
- **画面例**はデモの実画面です。デモデータは製品へ自動で追加されません。
- 認証・認可、DBやBlob/S3への保存、他ユーザーとの競合処理は親アプリで実装します。

各ページの本文はリポジトリ内の利用ガイドから生成しています。末尾の「編集元」から元のMarkdownを確認できます。
