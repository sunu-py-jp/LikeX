# 外部データとストレージの連携例

[ドキュメント一覧](./README.md)

外部型・保存方式を親で定義する参考例です。ジェネリックな `Explorer<T>` やアダプター専用propsは未実装で、現在は `initialEntries`・`onSave`・`readFile` へ変換して接続します。

## 今後の設計方針：外側で型と連携を定義する

アプリ固有のデータ型と、読み込み・保存のインターフェースは呼び出し元で定義します。Explorerは、外側で用意したアダプターを通してそのデータを扱い、表示・クライアント内の操作・下書き管理に責任を持つ構成を目指します。

**この節は今後の設計方針です。ジェネリックな `Explorer<T>` やアダプターを渡すpropsは未実装です。** 現在のデータ・保存APIは、[保存ガイド](./saving.md)の `ExplorerEntry`・`ExplorerSavePayload` に固定された `initialEntries`・`onSave`・`readFile` です。現時点でも親側で外部データとの変換を実装して接続できます。以下の方針によって、現在のpropsや動作が変わるわけではありません。

### 型と責務の境界

| 担当 | 定義・実装するもの |
| --- | --- |
| 呼び出し元 | アプリ固有の型 `T`、保存・読み込みの契約、BlobやDBへの接続、保存キー・URL・メタデータのルール。 |
| 呼び出し元のアダプター | 外部データとExplorerの表示・操作用データとの対応づけ、変更の外部形式への変換、新規項目の生成、保存後の参照の更新。 |
| Explorer | 名前・親子関係・項目の識別・ファイル内容の参照などの最小限の契約、UI、選択・移動・編集、保存するまでの下書き、保存要求と結果の表示。 |

型引数 `T` と型付きのアダプターで接続する方針とし、アプリ固有の型を `any` に落とさず、変換の入出力を検証できるようにします。Explorerが外側の型定義ファイルや保存サービスを直接importする依存は作りません。利用先がExplorerの公開入口をimportして接続することで、Explorerフォルダをコピーして別のプロジェクトへ組み込める構成を維持します。

外部レコードと表示項目は一対一とは限りません。ファイルのパスから作る仮想フォルダや、未保存の新規項目も表現できる契約が必要です。また、Explorerに表示しないアプリ固有の情報は、外側でIDとの対応を保持するなどして保存時に失わないようにします。具体的なアダプターの型名・メソッド・propsは、実装時に定義します。

```text
外側のデータ型・読み込み処理
  → アダプター → Explorer内の表示・下書き
  → 保存要求 → アダプター → 外側の保存処理
  → 保存結果をExplorerへ返す
```

アップロード・移動・コピー・名前変更・追加・削除による永続化は、保存ボタンで要求された時点にまとめます。プレビュー等の読み込みは必要に応じて外側へ依頼します。保存先への反映方法はExplorerに持たせません。

### Blobの階層と空フォルダの扱い

Blobへの保存構成も外側の契約で決めます。次の両方式を扱えることを前提とします。

| 保存方式 | 外側での階層の復元・反映 |
| --- | --- |
| 本体をフラットに保存し、プロパティに仮想パスを持つ | ファイルごとの仮想パスから表示階層を組み立て、保存時にプロパティを更新する。本体の保存キーは表示名と別の一意の値にする。 |
| Blobの保存キーに階層を反映する | `記事/2026/画像/サンプル.png` のようなキーから表示階層を組み立て、保存時に最終パスへ反映する。移動・改名では保存先に応じた移動処理やコピー・削除を行う。 |

ここでは、**空フォルダは永続化しない**方針とします。操作中の下書きには空フォルダを作れますが、保存データから再構成するときはファイルが存在する階層だけを復元します。空フォルダ用の管理レコードやダミーファイルは作りません。これは外側の保存方針であり、Explorer内のフォルダ作成機能を無効にするものではありません。

現行APIで接続する場合も、外側の実装で次を扱います。

- 初期一覧と保存後に返す一覧には、各ファイルの祖先となる仮想フォルダも含めます。空フォルダを保存しない場合でも、`parent` が参照するフォルダのエントリーは画面内に必要です。
- 保存時の最終パスは `entries` 全体の親子関係から計算します。フォルダの移動・名前変更では子孫のファイルが `changes.updated` に含まれない場合があるため、直接の差分だけで更新対象を決めません。
- 未保存の移動・名前変更では、既存の `source.id` を元の本体への参照として保持します。保存完了後、新しい参照に更新した一覧を返します。安定したIDを使う場合は、外側でIDから現在の保存キーを解決します。
- コピーによる本体参照の共有、保存キーの入れ替え、不要になった本体の削除は外側で処理します。コピー元がまだ必要な間に本体を上書き・削除しないよう、反映順序を管理します。
- Blobのキーを公開URLに使う場合、移動・改名に伴う参照URLの更新や固定ID経由の配信も外側で設計します。

## 外側の連携パターンと具体例

以下の外部型と `HostAdapter<T>` は、**呼び出し元で定義する例**です。Explorerが公開する型やpropsではありません。保存先固有のAPI呼び出しは利用先で実装します。最後のラッパー例は、現在の `initialEntries`・`onSave`・`readFile` で接続する形です。

外部型の例では一部の編集項目を省略しています。お気に入りなども保存する場合は、対応する項目を外部型と保存処理に追加します。扱わない機能はExplorerの `features` で無効にし、保存後に操作結果が失われる構成を避けます。

| パターン | 階層の情報源 | 向いている用途 |
| --- | --- | --- |
| フラットなBlob＋プロパティ | 各ファイルの `directoryPath` | 本体の保存先を動かさず、画面上の分類を変更したい場合。 |
| Blobのキーに階層を反映 | `記事/画像/logo.png` のような保存キー | ストレージ上のパスと画面上の階層を揃えたい場合。 |
| DBのレコード＋Blob | DBのファイル・フォルダの親子関係 | 記事との関連、説明文、所有者などの独自情報も管理する場合。 |
| メモリ保存 | 親が保持する一覧 | デモ、試作、永続ストレージを接続する前の動作確認。 |

### 1. フラットなBlobに保存し、プロパティで分類する

外側の型を、例えば次のように定義します。`AssetInfo` は以降の例でも使う共通のファイル情報です。

```ts
type AssetInfo = {
  id: string;
  size: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
};

type FlatAsset = AssetInfo & {
  blobKey: string;
  properties: {
    displayName: string;
    directoryPath: string;
  };
};
```

保存レコードの例（ファイル情報の一部は省略）です。

```json
{
  "id": "asset-001",
  "blobKey": "8c5f23.png",
  "properties": {
    "displayName": "logo.png",
    "directoryPath": "記事/2026/画像"
  }
}
```

アダプターは `directoryPath` の各階層を仮想フォルダに変換し、ファイルをその配下に置きます。ルート直下のファイルは `directoryPath: ""` とします。

| 操作例 | 保存時に反映するもの |
| --- | --- |
| `記事/2026/画像/logo.png` を `素材/logo.png` へ移動 | `directoryPath` を `素材` に変更。本体の `blobKey` は維持。 |
| `logo.png` を `ロゴ.png` に改名 | `displayName` を変更。 |
| `記事` フォルダを `アーカイブ` に改名 | 配下の全ファイルの `directoryPath` を再計算。 |

`素材/logo.png` と `記事/logo.png` は別の一意キーで保存するため、表示名が同じでも衝突しません。Blob自体のプロパティに所属パスを一つだけ持たせる場合、別の場所へのコピーは保存時に本体も複製し、別のキーとプロパティを割り当てます。

Azure Blobのユーザー定義メタデータにこの `properties` を保存すると、移動・改名でもBlobの更新日時が変わります。Azure AI Searchの増分Indexerで再処理を避けたい場合は、[固定BlobキーとDB／Blob Index Tagsを使う構成](./azure-ai-search.md#azure-ai-search-moves) を選びます。

### 2. Blobの保存キーを表示階層に合わせる

```ts
type PathAsset = AssetInfo & {
  key: string;
};
```

例えば `{ id: "asset-001", key: "記事/2026/画像/logo.png", ... }` を読み込んだとき、`key` の最後の部分をファイル名、それより前をフォルダ階層として使います。Explorerの表示名 `rootLabel`（標準の「ファイル」）は保存キーに自動では含めません。

| 操作例 | 保存キーの変化 |
| --- | --- |
| `logo.png` を `ロゴ.png` に改名 | `記事/2026/画像/logo.png` → `記事/2026/画像/ロゴ.png` |
| ファイルを `素材` へ移動 | `記事/2026/画像/logo.png` → `素材/logo.png` |
| `記事` フォルダを `アーカイブ` に改名 | 配下の全ファイルのキーの先頭を `記事/` から `アーカイブ/` に変更。 |

`id` は表示項目の安定した識別子として外側で管理し、パス変更だけでは変更しません。BlobのプロパティにIDを記録するか、外側にIDと現在のキーの対応を持たせるなどして実現します。階層自体はキーから復元するため、別の `directoryPath` は不要です。

例えば保存前に `A.txt` と `B.txt` の名前を入れ替えた場合、単純に片方を上書きすると元の内容を失います。外側で保存計画を作り、必要な本体を退避するなどしてから最終キーへ反映し、不要な旧キーを削除します。Explorerはこの反映手順を決めません。

この方式はBlobの保存キーそのものを変更します。移動によるAzure AI Searchの再処理を避ける用途では、[表示階層と固定Blobキーを分ける方式](./azure-ai-search.md#azure-ai-search-moves) を検討してください。

### 3. DBで親子関係とアプリ固有の情報を管理する

```ts
type DbFolder = {
  kind: "folder";
  id: string;
  parentId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type DbFile = AssetInfo & {
  kind: "file";
  folderId: string | null;
  filename: string;
  blobKey: string;
  articleId: string;
  altText: string;
  starred: boolean;
};

type DbRecord = DbFolder | DbFile;
```

この例は、外部型とExplorerの型でフィールド名や型が違う場合も示しています。

| 外側のデータ | Explorerへの変換 |
| --- | --- |
| `filename` / フォルダの `title` | `name` |
| `folderId` / フォルダの `parentId` | `parent`。外側の `null` は `"root"` に変換。 |
| `mimeType` | `mime` |
| `starred: boolean` | `favorite: 0 \| 1` |
| `articleId` / `altText` | 外側に保持し、Explorerの編集結果を元レコードへ反映するときに維持。 |

ファイルの移動は `folderId`、フォルダの移動は `parentId`、改名は `filename` / `title` の更新になります。Blobのキーは維持できるため、フォルダを移動しても配下の本体を移す必要はありません。

このパターンでも空フォルダを永続化しない場合は、保存対象のファイルから祖先をたどり、必要なフォルダだけをDBへ保存します。子フォルダの先にファイルがあれば、その祖先フォルダも必要です。

新規ファイルの `articleId` などは親が現在の記事情報から補います。既存ファイルの編集ではIDで元レコードを特定して変更項目を反映し、表示していない `altText` などを削除しません。コピーでどの独自情報を引き継ぐかも外側の契約で決めます。

### 4. 親のメモリだけに保存する

```ts
type MemoryWorkspace = {
  entries: readonly ExplorerEntry[];
  bodies: Map<string, Blob>;
};
```

親の `onSave` は、新規の `File` を `bodies` に入れ、`source` を保存済み参照に置き換えた一覧を保持して返します。`readFile` はそのMapからBlobを取得します。ネットワークやDBなしで、保存前後の状態遷移とプレビューを確認できます。

現在のデモはこの方式です。ただし、現在のデモは空フォルダもメモリ内の一覧に保持します。上記の空フォルダ非永続化を試す場合は、親側でファイルとその祖先フォルダだけに絞る処理を追加します。ページを再読み込みするとメモリ上の保存結果は失われます。

### 現在のAPIへ型付きアダプターを接続する例

次は利用先のClient Componentに置くラッパーの例です。`HostExplorer<T>` と `HostAdapter<T>` を外側で定義し、内部で現在のExplorerを使います。Explorer本体に型引数や `adapter` propsを渡す例ではありません。

```tsx
"use client";

import { useRef, useState } from "react";
import Explorer, {
  type ExplorerEntry,
  type ExplorerSavePayload,
} from "@/components/explorer";

type HostAdapter<T> = {
  toEntries: (records: readonly T[]) => readonly ExplorerEntry[];
  save: (
    payload: ExplorerSavePayload,
    previous: readonly T[],
  ) => Promise<readonly T[]>;
  readFile: (sourceId: string) => Promise<Blob>;
};

function HostExplorer<T>({
  initialRecords,
  adapter,
}: {
  initialRecords: readonly T[];
  adapter: HostAdapter<T>;
}) {
  const savedRecords = useRef(initialRecords);
  const [initialEntries] = useState(() => adapter.toEntries(initialRecords));

  return (
    <div style={{ height: 640, minWidth: 0 }}>
      <Explorer
        initialEntries={initialEntries}
        readFile={adapter.readFile}
        onSave={async (payload) => {
          const records = await adapter.save(payload, savedRecords.current);
          const entries = adapter.toEntries(records);
          savedRecords.current = records;
          return entries;
        }}
      />
    </div>
  );
}
```

フラット保存なら `HostAdapter<FlatAsset>`、キー階層なら `HostAdapter<PathAsset>`、DB管理なら `HostAdapter<DbRecord>` を外側で実装します。型 `T` を揃えることで、異なる保存方式のレコードを取り違えた呼び出しを型チェックできます。メモリ保存は、[App Routerで使う最小例](./getting-started.md#app-routerで使う最小例)のように直接コールバックを渡す方法でも接続できます。

このラッパーの対象ワークスペースとアダプターはマウント中に固定します。切り替える場合は、ラッパーのReact `key` を変更して再マウントします。`save` は本体と管理情報の反映をすべて終えてから返し、`readFile` が参照するIDと保存キーの対応も更新します。`toEntries` は初回・保存後とも、有効な親子関係と本体参照を持つ一覧を生成する必要があります。

### アダプター共通の変換ルール

- **表示項目IDと本体参照を区別する。** `entry.id` は編集する項目の識別子です。`source.id` に保存キーを入れる場合は、保存後に新キーへ置き換えます。外部レコードのIDを入れる場合は、`readFile` がそのIDから現在の保存キーを解決します。
- **コピー元の独自情報を識別できるようにする。** 外部レコードIDを `source.id` に使えば、コピーによって新しい `entry.id` が作られても、保存前の `source.id` からコピー元を引けます。保存後は新しいレコードのIDに正規化します。異なる外部レコードが共有するBlobキーだけを参照にすると、コピー元レコードを一意に識別できない場合があります。
- **新規ファイルは `source.kind === "local"` で扱う。** まだ元の外部レコードがないため、親の文脈と下書きから新しいレコードを作り、`source.file` をアップロードします。保存後は `existing` 参照に変換します。
- **パスは最終ツリーから計算する。** 例1・2ではフォルダの改名だけでも子孫のパスが変わります。`changes.updated` のファイルだけを処理せず、`entries` の全ファイルから最終パスを求め、保存済みのパスと比較します。
- **仮想フォルダのIDを保存前後で対応づける。** パスから生成するフォルダにも画面内のIDが必要です。外側で下書きのIDと最終パスの対応を保持し、保存後の一覧でも残る項目のIDを維持します。フォルダID自体の永続化は必須ではありません。
- **空フォルダを取り除くタイミングを決める。** 上のラッパーで保存済みファイルから一覧を再構成する場合は、保存成功直後に空フォルダが消えます。保存後も画面内に残したい場合は、親が正規化済みの下書き一覧を返す方式にし、次回読み込み時にだけ除外します。いずれも空フォルダをストレージには保存しません。
