# ファイルとフォルダのデータ

[ドキュメント一覧](./README.md)

`initialEntries` にはファイルとフォルダを1つの配列で渡します。階層は `parent` が指すフォルダIDで表します。配列の中に配列を入れる構造ではありません。

## ExplorerEntry

```ts
type ExplorerEntry = {
  id: string;
  parent: string;
  name: string;
  readonly extension?: string;
  kind: "file" | "folder";
  size: number;
  mime: string;
  createdAt: string;
  updatedAt: string;
  favorite: number;
  source:
    | { kind: "existing"; id: string }
    | { kind: "local"; file: File }
    | null;
};
```

上の型定義は構造の説明です。利用コードでは公開入口から型をimportしてください。

| フィールド | 指定する値 |
| --- | --- |
| `id` | ワークスペース内で一意の項目ID。空文字と予約語 `"root"` は使えません。 |
| `parent` | 親フォルダの `id`。最上位の項目には `"root"` を指定します。 |
| `name` | 表示するファイル名またはフォルダ名。ファイルは拡張子も含めます。同じフォルダに同じ名前は置けません。 |
| `extension` | 名前から計算する値。省略できます。渡しても `name` と `kind` から再計算します。 |
| `kind` | `"file"` または `"folder"`。 |
| `size` | ファイルサイズをバイトで指定します。フォルダには `0` を指定します。 |
| `mime` | ファイルのMIMEタイプ。フォルダには空文字を指定します。 |
| `createdAt` / `updatedAt` | `"2026-09-10T00:00:00.000Z"` のように時差を含むISO 8601文字列。表示には日本時間を使います。 |
| `favorite` | `0` が未登録、通常 `1` が登録済みです。 |
| `source` | 保存済みの本体参照、ブラウザの `File`、または `null`。フォルダには `null` を指定します。 |

ルートそのもののエントリーは作りません。子項目が参照するフォルダは、ルート以外すべて一覧に含めます。存在しない親、IDの重複、同じフォルダ内の同名項目、循環する親子関係は初期化時や保存結果の受け取り時にエラーになります。

## フォルダ1つとファイル1つを表示する

```tsx
"use client";

import { Explorer, type ExplorerEntry } from "@likex/explorer";
import "@likex/explorer/styles.css";

const entries: ExplorerEntry[] = [
  {
    id: "folder-guides",
    parent: "root",
    name: "ガイド",
    kind: "folder",
    size: 0,
    mime: "",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    favorite: 0,
    source: null,
  },
  {
    id: "file-start",
    parent: "folder-guides",
    name: "はじめに.txt",
    kind: "file",
    size: 6,
    mime: "text/plain",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    favorite: 0,
    source: { kind: "existing", id: "content-start-v1" },
  },
];

export default function GuideFiles() {
  return <Explorer
    initialEntries={entries}
    initialPath="/ガイド"
    readFile={async sourceId => {
      if (sourceId !== "content-start-v1") throw new Error("本体が見つかりません");
      return new Blob(["LikeX\n"], { type: "text/plain" });
    }}
    style={{ height: 480 }}
  />;
}
```

この例はメモリ上の本文を返す閲覧専用ビューです。ストレージを使う場合は `readFile` を認証済みの取得処理へ置き換えます。`onSave` を渡すと、同じデータで編集を有効にできます。

## ID・パス・本体参照の違い

| 値 | この例 | 用途 |
| --- | --- | --- |
| `entry.id` | `file-start` | 選択、操作対象、DBレコードとの対応。移動・名前変更・同じ場所への上書きでも維持します。 |
| `entry.parent` | `folder-guides` | 表示する親フォルダ。ファイルを移動すると変わります。 |
| 表示パス | `/ガイド/はじめに.txt` | 現在の親子関係と名前から計算します。BlobのキーやURLではありません。 |
| `entry.source.id` | `content-start-v1` | 既存のファイル本体を読むために親へ渡す参照。項目IDと同じ文字列にする必要はありません。 |

別のフォルダへ同名・同内容のファイルを新しく追加した場合は、別の項目IDになります。内容の一致から移動を推定しません。コピーでも新しい項目IDを作りますが、本体の `source` はコピー元と共有できます。保存先で本体を共有するか複製するかは親が決めます。

移動は `parent` だけを変更し、更新日時を維持します。同じ場所への上書きはIDを維持し、新しい `File` を `source` に設定します。内容が変わったかのハッシュ判定や、保存済み本体の更新は親で行います。[上書きの契約](./uploads.md#upload-conflicts)と[保存の契約](./saving.md)を参照してください。

## コールバックで受け取る情報

`ExplorerItemInfo` は `ExplorerEntry` に現在の `path` と正規化済みの `extension: string` を加えた読み取り専用の情報です。プレビュー、選択イベント、カスタムメニューなどに使います。

拡張子は最後のピリオド以降を小文字・点なしで表します。`Report.PDF` は `"pdf"`、`archive.tar.gz` は `"gz"`、`README`・`.env`・フォルダは `""` です。`ExplorerEntry.extension` は省略可能ですが、Explorerが保持する下書きや保存ペイロードでは計算済みの値を設定します。

```ts
type ExplorerSnapshot = { entries: ExplorerEntry[] };

type ExplorerSavePayload = {
  entries: ExplorerEntry[];
  changes: {
    created: ExplorerEntry[];
    updated: ExplorerEntry[];
    deleted: ExplorerEntry[];
  };
};
```

保存時の `entries` は最終的な全一覧、`changes` は保存の比較元からの差分です。操作履歴やファイル本体だけの差分ではありません。`source.kind === "local"` の `File` は `JSON.stringify()` では送信できないため、親がFormDataなどで本体を送ります。
