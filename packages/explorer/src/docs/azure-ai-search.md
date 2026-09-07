# Azure AI Searchで移動による再処理を避ける設計例

[ドキュメント一覧](./README.md)

呼び出し元で実装する参考設計です。移動時の再処理を避ける条件と方式を比較します。具体的なDB・Blob・Indexの定義は[Cosmos DB連携サンプル](./azure-cosmos-sample.md)を参照してください。

<a id="azure-ai-search-moves"></a>

## Azure AI Searchと連携し移動時の再処理を避ける

Azure Blob Storageに本体を保存し、Azure AI SearchのBlob Indexerで検索インデックスを作る場合の、**呼び出し元で実装する保存方式**です。現行の `initialEntries`・`onSave`・`readFile` で接続でき、Explorer本体へAzure SDKやDB、Indexerの制御を追加する必要はありません。以下は2026年9月7日に確認した公式仕様に基づく設計案で、このリポジトリからAzure実環境への接続・再処理件数の実測は行っていません。

### 前提：画面上の移動とBlobの保存先を分ける

既に取り込み済みのBlobに対する、通常の増分Indexer実行を対象にします。**表示上の移動・改名では、Blobの保存キー・本体・ユーザー定義メタデータを変更しない**構成にします。

Blob Indexerは `LastModified` で変更を検知し、ユーザー定義メタデータの更新もこの日時を変えます。本文やハッシュが同じでも、メタデータに保存したパスを変更すれば再処理対象になります。パスを検索フィールドへマッピングしないだけでは、この変更検知を止められません。[Blob Indexerの変更検知](https://learn.microsoft.com/en-us/azure/search/search-how-to-index-azure-blob-storage#standard-blob-metadata-properties)、[Set Blob Metadataの更新日時](https://learn.microsoft.com/en-us/rest/api/storageservices/set-blob-metadata#response-headers)

「移動が再処理の原因にならない」と「Indexer自体が起動しない」は別です。定期実行はそのまま続きます。起動も制御したい場合は、外側でオンデマンド実行を管理し、移動・改名のみの保存では起動依頼を出さず、新規本体・本文更新・検索からの削除などが必要なときに依頼します。リセット、Indexerの再作成などによる取り込み直しは別途発生します。[Indexerの実行とリセット](https://learn.microsoft.com/en-us/azure/search/search-howto-run-reset-indexers)

### 方法A：固定Blobキー＋DBの階層情報（推奨）

本体は表示名に依存しない固定キーへ保存します。DBに項目ID、表示名、`parentId`、Blobキーの対応を持たせ、フォルダの親子関係もDBで扱います。[DBで親子関係とアプリ固有の情報を管理する例](./storage-adapters.md#3-dbで親子関係とアプリ固有の情報を管理する)も参照してください。

```text
Blob container: file-content
Blob key: workspace-42/file-123/content.pdf
DB移動前: id=file-123, parentId=folder-a, name=仕様書.pdf
DB移動後: id=file-123, parentId=folder-b, name=仕様書.pdf
Explorer: source={ kind: "existing", id: "file-123" }
```

`readFile("file-123")` はホスト側で固定Blobキーを解決します。移動しても同じ本体を読み出せます。

| 保存する操作 | 外側で更新するもの | 通常のBlob Indexerへの影響 |
| --- | --- | --- |
| ファイル移動 | DBの `parentId` | Blobは変わらず、この移動による再処理なし。 |
| フォルダ移動・改名 | DBの `parentId` / `name` | 配下のDB項目やBlobを更新する必要なし。 |
| ファイル改名・お気に入り変更 | DBの `name` / `favorite` | Blobは変わらず、この変更による再処理なし。 |
| 新規本体の保存・本文更新 | Blob本体とDBの対応情報 | 新規・更新Blobを取り込む。 |
| コピー | 新しい表示項目をDBへ追加。本体を共有するか複製するかはホストが決定。[連携サンプル](./azure-cosmos-sample.md)は新ID用のBlobを作る。 | 新しいBlobを作る場合は取り込み対象。 |
| 削除 | DBの項目を削除。共有参照を確認して不要な本体を処理。 | 索引からの削除は別途必要。 |

空フォルダは永続化しません。保存するファイルから祖先をたどって必要なフォルダだけをDBへ保存し、読み込み時にもその階層を組み立てます。

DBを使わない代案として、検索対象とは別のBlobコンテナに、表示名・仮想パス・固定Blobキーの対応をJSONで保存する構成も考えられます。Indexerのデータソースに含めないことを条件に、移動時はそのJSONだけを更新します。複数ユーザーによる同時編集や部分更新は、ホスト側で管理します。

### 方法B：固定Blobキー＋Blob Index Tags

Blob Index Tagsは、`x-ms-meta-*` のユーザー定義メタデータとは別機能です。`Set Blob Tags` はBlobの `ETag` と最終更新日時を変えません。この仕様から、固定Blobのタグだけで仮想パスを変更すれば、その変更は通常のBlob Indexerの増分取り込みの契機にならないと判断できます。[Set Blob Tagsの仕様](https://learn.microsoft.com/en-us/rest/api/storageservices/set-blob-tags#remarks)

例えば `file-123.pdf` に次のタグを持たせ、移動時は `directoryPath` だけを変えます。ホストは各ファイルのタグを読み、パスからExplorer用の祖先フォルダを復元します。タグだけで完結させる場合は、表示名もタグから読みます。

```json
{
  "displayName": "proposal.pdf",
  "directoryPath": "docs/2026"
}
```

| 制約 | 外側での扱い |
| --- | --- |
| 1 Blobにつき最大10タグ。キーは1〜128文字、値は0〜256文字。 | パスと表示名を含む保存情報が収まるか検証する。 |
| 使用できるのは英数字・空白と一部記号。日本語は直接保存できない。 | UTF-8をBase64等へ変換する場合も、変換後の長さで判定する。長い日本語パスにはDB方式が適する。 |
| タグ更新はタグ集合全体を置き換え、BlobのETagも変えない。 | アプリが必要とする他のタグを保持し、BlobのETagだけに頼らない同時更新制御を行う。 |
| タグ検索の反映は結果整合。 | 保存直後の再表示は保存結果や `Get Blob Tags` を利用する。 |
| AI SearchのBlob IndexerはBlob Index Tagsを取り込まない。 | 名前・パスの表示や検索フィルターへの反映は外側で扱う。 |

文字・件数制限は [Set Blob Tagsのリクエスト仕様](https://learn.microsoft.com/en-us/rest/api/storageservices/set-blob-tags#request-body)、整合性は [タグ更新の仕様](https://learn.microsoft.com/en-us/rest/api/storageservices/set-blob-tags#remarks)、AI Search側の対応は [Blobメタデータの取り込み](https://learn.microsoft.com/en-us/azure/search/search-how-to-index-azure-blob-storage#indexing-blob-metadata) を参照してください。階層型名前空間（HNS）を有効にしたアカウントではタグ機能の対応API・プレビュー条件も確認します。

空フォルダ用のBlobやタグ用ダミーBlobは作りません。フォルダ改名・移動では配下ファイルのパスタグを更新します。本体も一緒に再アップロードしたり、同じパスをユーザー定義メタデータにも書き戻したりすると、再処理回避の条件を満たさなくなります。

### 検索結果の名前・場所を最新に保つ

検索結果に固定のファイルIDまたは固定Blobキーを持たせ、表示時にDB／タグから最新の名前・パスを解決する方式なら、移動のために検索インデックスを書き換える必要はありません。Blobをチャンクへ分割している場合は、各チャンクから元ファイルを識別できる対応も保持します。複数の表示項目で本体を共有する場合は、同じ検索結果に対応する表示先が複数になることも外側で扱います。

Search内でフォルダをフィルター条件に使う場合は、そのフィールドを別途同期する必要があります。既存検索ドキュメントの名前・パス等だけをDocuments APIの `merge` で更新する方式なら、Indexerを起動せずに更新できます。チャンク構成では該当する全チャンクが対象です。後のIndexer実行で古い値に戻らないよう、フィールドごとの更新元と、本文取り込み後の再適用を決めます。ベクトルフィールドが `stored: false` の場合は部分更新でもベクトルの再送が必要になるため、単純なパスだけの更新では保持できない点に注意してください。[検索ドキュメントの部分更新](https://learn.microsoft.com/en-us/azure/search/search-howto-reindex#update-content)、[ベクトルを含む増分更新](https://learn.microsoft.com/en-us/azure/search/search-howto-reindex#tips-for-incremental-indexing)

### 現行のonSaveへ接続する手順

1. 親は保存済みの外部レコードを保持し、`onSave` の `entries` と照合して最終的な保存計画を作ります。クライアントの `onEvent` は操作通知に使い、Blobへの即時同期には使いません。AzureやDBへの永続化・Indexerの制御は、親から呼ぶサーバー側の処理に置きます。
2. 移動・改名・お気に入りだけなら、DBまたはタグだけを更新します。移動ではExplorerの `updatedAt` を維持しますが、`parent` の差分は `changes.updated` に含まれます。改名等で更新日時が変わった場合も、日時や `updated` 配列だけを本文更新の判定に使わず、既存Blobを一律アップロードし直さないようにします。
3. `source.kind === "local"` の本体は、同じ `entry.id` の保存済みデータと照合します。同じ親・同じ名前の上書きではExplorerが既存IDを維持するため、親がそのIDのハッシュと比較し、同じ内容なら本体の再アップロードを省略できます。Explorer自身はハッシュ比較や差分同期を行いません。コピーで作成された項目は既存の `source.id` を共有することもあるため、`changes.created` をすべてローカルの新規本体と扱いません。
4. パスを各ファイルのDBレコード・タグ・検索ドキュメントへ保存する方式では、`entries` 全体から最終パスを計算します。フォルダ移動・改名でパスが変わる子孫が、`changes.updated` に載るとは限りません。
5. 保存が成功したら、元からある項目の `id` と固定本体参照を維持し、新規本体を `existing` 参照へ正規化した一覧を返します。空フォルダを除いた一覧でも、ファイルが参照する祖先フォルダは含めます。Indexerの完了を保存完了条件に含めるか、永続化済みの非同期ジョブとして追跡するかは外側で定義します。

例えば、既存ファイルと同じ内容を新しいフォルダBへ再アップロードしてから元ファイルを削除すると、新しいIDとローカル `File` が `changes.created` に、元のIDが `changes.deleted` に入ります。別パスへの新規追加と元項目の削除として扱い、ハッシュの一致から移動やIDの再利用へ推測変換しません。

削除は移動とは別に扱います。DBの項目削除だけでは検索結果は消えません。共有中の本体を残す条件を決め、削除検知ポリシーまたは検索ドキュメントの明示削除を外側で用意します。[変更・削除の検知](https://learn.microsoft.com/en-us/azure/search/search-how-to-index-azure-blob-changed-deleted)

採用前の確認では、取り込み済みの少数ファイルに対して移動・改名だけを保存し、対象Blobの保存キー・`LastModified` が変わらないことと、通常のIndexer実行で対象ファイルが再処理されないことを確認します。続けて本体更新と削除が意図どおり反映されることも確認します。確認中に別の更新やリセットを混ぜず、移動の影響を区別します。
