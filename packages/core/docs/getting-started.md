# Coreの導入

`@likex/core` は、Explorer・Spreadsheet・LikeSlide・LikeDocumentなどが共通で使う型とヘルパーです。保存のコールバック、編集許可、通知、右クリック処理などの接続方法をそろえます。Core自体にデータの保存先はありません。

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
2. 利用するUIの `src/` の中身を、隣のフォルダにコピーします。
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

Coreの実行時依存として `npm install re2js@2.8.6` を実行します。Spreadsheet・LikeSlide・LikeDocumentで変更するCoreの参照は `core.ts` の1か所だけです。`ooxml.ts`・`json.ts`・`model/core-*.ts` と、LikeSlide・LikeDocumentの `browser.ts` は内部でこの入口を参照するため、そのまま使います。既存のコピーを更新するときは利用するUIとCoreを同じバージョンから一緒に更新し、以前に参照先を書き換えたこれらのファイルもコピーし直してください。

Coreは複数のコンポーネントで共有できます。LikeDocumentのProseMirror依存、UIのReact依存とスタイルの読み込み、Explorerなどの追加の入口は各コンポーネントの導入手順に従ってください。

ブラウザーの共通メニューは `openContextMenu` と `ContextMenuAction` / `ContextMenuSurfaceOptions` 型を `@likex/core` または `@likex/core/browser` から読み込んで使います。両入口は同じ実装を共有し、import時はDOMへアクセスしません。メニューの表示にはDOMが必要です。

## どのページを読むか

| やりたいこと | API |
| --- | --- |
| 保存や編集許可の型を共通にする | [保存・編集許可](./host-contracts.md) |
| 操作の通知、機能の初期値をそろえる | [通知・機能設定](./events-and-features.md) |
| 非同期の右クリック処理を追加する | [右クリックの非同期処理](./context-menu.md) |
| 未保存のままウィンドウを閉じる操作を確認する | [離脱確認](./unsaved-changes.md) |
| 複数のBlobをZIPにまとめる | [ZIPの生成](./zip.md) |
| 線の端点・8接続点・吸着位置を計算する | [線の端点と接続点](./connectors.md) |

LikeXはMITライセンスです。コピーする場合は`src/LICENSE`と`src/THIRD_PARTY_NOTICES.md`も保持してください。npmへの公開は未実施で、`private: true`は誤公開防止のため維持しています。tarballを使う場合は、Coreと利用するUIの両方をインストールしてください。
