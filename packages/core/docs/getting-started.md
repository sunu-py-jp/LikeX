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

## 埋め込み画像の共通ID

Spreadsheet・LikeSlide・LikeDocumentの `collectSpreadsheetImages` / `collectSlideImages` / `collectDocumentImages` は、共通の `collectEmbeddedImageAssets` を使います。同じ画像バイトなら資料形式をまたいでも同じ `sha256:...` のIDとなり、ホストが画像ごとの解析結果を再利用できます。配置や名前、表示サイズはIDに含めません。画像を再圧縮・リサイズした場合や、メタデータが異なる場合は別のIDです。

Coreの関数と型は `@likex/core` と `@likex/core/image-assets` の両方から利用できます。後者はDOM型を含まない入口で、ブラウザーの型定義を読み込まないNodeプロジェクトにも対応します。ソースコピー時に変更する入口は従来どおり各モジュールの `core.ts` だけです。

```ts
import { collectEmbeddedImageAssets } from "@likex/core";

// 各モデル等で内容を検証済みの画像データURLを渡します。
const result = await collectEmbeddedImageAssets([imageSource, imageSource], { signal });
// result.images: 重複を除いた { imageId, src, mimeType, byteLength }[]
// result.imageIds: 入力順のID配列。上記の2要素には同じIDが入ります。
```

Coreの関数はbase64形式と容量を検証しますが、画像ファイルの実体・SVGの安全性を検証するものではありません。通常は各モジュールの収集APIを使い、既存のモデル検証を通してください。画素へのデコード・描画・外部通信は行わず、ブラウザーのWeb Crypto（HTTPS / localhost）またはNode.js 22.13以降で動きます。`signal` による中断と不正な入力はPromiseをrejectし、部分結果を返しません。入力文字列は最初の非同期処理前に取り込みます。

共通の `IMAGE_ASSET_LIMITS` は入力100,000件、画像1件10MiB、異なるデータURLの合計100MiBです。モジュールから呼ぶ場合は、各モデルのより小さい上限も維持します。`EmbeddedImageAsset` / `EmbeddedImageCollection` / `EmbeddedImageCollectionOptions` を公開します。保存形式にハッシュは追加せず、解析サービスへの送信・キャッシュの所有者はホストです。

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
