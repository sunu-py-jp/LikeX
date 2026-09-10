# Coreの導入

`@likex/core` は、ExplorerとSpreadsheetが共通で使う型とヘルパーです。保存のコールバック、編集許可、通知、右クリック処理などの接続方法をそろえます。Core自体に画面やデータの保存先はありません。

## インポート

LikeXのパッケージを導入済みのプロジェクトでは、必要なものだけインポートします。ReactのProviderやCSSの追加は不要です。

```ts
import { resolveFeatureFlags } from "@likex/core";
import type { SaveHandler } from "@likex/core";

type Note = { id: string; body: string };

const saveNote: SaveHandler<Note> = async note => {
  const response = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(note),
  });
  if (!response.ok) throw new Error("保存できませんでした");
};

const features = resolveFeatureFlags(
  { edit: true, download: true },
  { edit: false },
);
// features: { edit: false, download: true }
```

上のAPIパスは利用側の実装例です。Coreは通信・認証・永続化を代行しません。各コンポーネントのPropsには、それぞれのデータモデルに合わせた型が用意されているため、通常はその型を使えます。

## ソースをコピーして使う

1. `packages/core/src/` の中身を、利用先の `components/core/` にコピーします。
2. ExplorerまたはSpreadsheetの `src/` の中身を、隣のフォルダにコピーします。
3. コピーしたUIの `core.ts` を次の1行に変更します。

```ts
export * from "../core";
```

```text
components/
  core/
    index.ts
    contracts.ts
    ...
  explorer/
    core.ts
    ...
  spreadsheet/
    core.ts
    ...
```

Coreは両コンポーネントで共有できます。UIのReact依存とスタイルの読み込みは各コンポーネントの導入手順に従ってください。

## どのページを読むか

| やりたいこと | API |
| --- | --- |
| 保存や編集許可の型を共通にする | [保存・編集許可](./host-contracts.md) |
| 操作の通知、機能の初期値をそろえる | [通知・機能設定](./events-and-features.md) |
| 非同期の右クリック処理を追加する | [右クリックの非同期処理](./context-menu.md) |
| 未保存のままウィンドウを閉じる操作を確認する | [離脱確認](./unsaved-changes.md) |
| 複数のBlobをZIPにまとめる | [ZIPの生成](./zip.md) |

現在のリポジトリは `private: true` / `UNLICENSED` で、npmへの公開は未実施です。tarballを使う場合は、Coreと利用するUIの両方をインストールしてください。
