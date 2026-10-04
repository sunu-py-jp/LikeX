# フォルダ単位の遅延読み込み

[ドキュメント一覧](./README.md)

`onLoadFolder` を渡すと、表示や展開に必要なフォルダの直下だけを取得します。取得済みの項目はワークスペース内のキャッシュに残り、開き直すと再利用します。ファイル本体の取得は従来どおり `readFile` の担当です。

## 最小構成

```tsx
import Explorer, { type ExplorerProps } from "@likex/explorer";

const loadFolder: NonNullable<ExplorerProps["onLoadFolder"]> = async (
  { folderId, path }, { signal },
) => {
  const response = await fetch("/api/files/children", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  if (!response.ok) throw new Error(`${path} の一覧を取得できませんでした`);
  return parseFolderEntries(await response.json());
};

<Explorer initialEntries={[]} onLoadFolder={loadFolder}
  folderLoading={{ initialLoadedFolderIds: [] }} />
```

`parseFolderEntries` は利用側の応答検証・変換です。認証・認可・API・保存先は利用側で用意します。`folderId` や `path` は権限の根拠として信用せず、サーバーでワークスペースとフォルダへのアクセスを確認してください。

`onLoadFolder` を一度も指定していない場合は従来の全件取得方式です。`initialEntries` を完全な一覧として扱い、追加取得をしません。`onLoadFolder` を指定した場合、`initialEntries` は既に手元にある項目だけでも構いません。ただし、そこに含める項目の祖先フォルダはルートまで揃えてください。`root` は仮想ルートのIDで、ルート自体のエントリーは渡しません。

`initialEntries` と `folderLoading.initialLoadedFolderIds` は初回マウント時だけ読みます。マウント後に後者を書き換えても、取得済み範囲を変更しません。一度遅延読み込みを有効にしたワークスペースでは、途中で `onLoadFolder` を外しても部分キャッシュを全件扱いへ変更しません。進行中の取得を中断し、未取得範囲に依存する操作と部分保存の契約を維持します。ハンドラーなしで未取得フォルダを読むとエラーになります。別のデータソースや初期状態へ切り替える場合は、未保存変更を処理してからReactの `key` を変えて再マウントします。

## 要求と応答

| 項目 | 契約 |
| --- | --- |
| `request.folderId` | 直下を取得するフォルダの項目ID。最上位は `"root"` |
| `request.path` | 現在のキャッシュ上の表示パス。ルートは `/`。ストレージのURLや本体参照ではない |
| `context.signal` | 要求の取消しを伝える `AbortSignal`。通信・タイマー等へ渡す |
| 戻り値 | 指定フォルダ**直下の完全な一覧** `readonly ExplorerEntry[]`、またはそのPromise |
| 各項目の `parent` | 要求された `folderId`。子孫の全階層や要求したフォルダ自身は含めない |

空配列 `[]` は空のフォルダの取得完了を表します。失敗はthrow/rejectで伝え、空配列へ置き換えないでください。各応答は100,000件以内で検証してからまとめて反映します。ページの一部だけを返す形式や、検索のようなAsyncIterableには対応しません。サーバーでページ分割している場合は、利用側でそのフォルダの全ページを集めてから返します。

返された新規IDの項目は保存の比較元と現在の下書きの両方へ追加されます。読み込みだけでは未保存にならず、`changes.created` にも入りません。既存のローカル編集を保持し、取得済みIDのメタデータを強制的に上書きする再読込には使いません。外部変更との再同期には、未保存確認のある `onRefresh` を使います。

`onRefresh` や編集許可で最新一覧を返す場合は、**ワークスペース全体の完全な一覧**を返します。反映後はルートと全フォルダを取得済みとして扱います。ルート直下だけを返して再同期するAPIではありません。通常の保存成功では、保存時点の取得済み範囲を維持します。

## 取得のタイミングとキャッシュ

初回のルート表示、未取得フォルダへの移動、フォルダツリーの展開で取得します。各フォルダの直下を一度取得すると、同じフォルダを再表示しても再取得しません。同じフォルダへの並行要求は共有されます。画面や要求が不要になった場合の取消し、別要求へ切り替わった後の古い応答の破棄は本体が扱います。利用側も `signal` に対応して不要な通信を止めてください。

`folderLoading.initialLoadedFolderIds` は、**初期キャッシュが直下一覧をすべて持っているフォルダ**のIDを指定します。省略時はルートを含めて未取得です。例えば最初にルート直下だけを取得してある場合は `initialLoadedFolderIds: ["root"]` とします。ルートの取得完了は子フォルダの取得完了を意味しません。未取得なのにIDを列挙すると、本体はその場所を完全な一覧として扱うため、取得済みの範囲だけを指定してください。

```tsx
<Explorer initialEntries={rootChildren} onLoadFolder={loadFolder}
  folderLoading={{ initialLoadedFolderIds: ["root"] }} />
```

取得済みメタデータはワークスペースに保持され、親・子ウィンドウで共有します。フォルダを離れたときに一覧を破棄する仕組みではありません。多くのフォルダを読み進めるほどキャッシュは増えます。

## 明示的な読み込みと未取得範囲の操作

`ExplorerHandle` の `loadFolder(folderId, options?): Promise<boolean>` で、表示を移動せずに読み込めます。直下だけならoptionsを省略し、配下全体が必要なら `recursive: true` を指定します。`signal` で親側から取消しもできます。

```ts
const api = explorerRef.current;
if (api && await api.loadFolder("folder-sales", { recursive: true })) {
  // 必要な配下を取得してから、GUIと共通のコマンドを実行する。
  await api.execute({ action: "copy", ids: ["folder-sales"], parent: "root" });
}
```

コピー・削除・移動・改名・フォルダのZIP作成など、未取得の子孫まで影響する操作は、不完全なキャッシュのまま実行しません。作成やアップロード等の送り先も、同名項目との競合を確認するため直下の取得が必要です。画面の「配下を読み込む」または公開 `loadFolder` で必要な範囲を取得してから、元の操作を再実行します。全ワークスペースを毎回取得する必要はありません。読み取り専用の画面でも読み込みは利用できます。

| 操作 | 必要な取得範囲 |
| --- | --- |
| ファイル・フォルダの新規作成、アップロード | 作成先フォルダの直下 |
| 名前変更 | 親フォルダの直下。対象がフォルダなら、その配下全体も必要 |
| コピー・移動 | 移動先の直下。対象がフォルダなら、その配下全体も必要 |
| フォルダの削除・ZIP | 対象フォルダの配下全体 |

ファイル単体の移動元については、既知IDの差分だけで扱えるため、その親一覧の追加取得を必須としません。通常の機能設定・編集許可・項目の操作権限は取得完了後も適用します。

`loadFolder` は正常終了時にtrue、取消しや失敗時にfalseを返します。取得が済んでいれば再通信しません。再帰取得が途中で失敗した場合も、正常に取得済みのフォルダはキャッシュへ残ります。未取得の範囲がある限り、それに依存する操作は許可されません。

低レベルの `useExplorerDraft` にも `loadFolder` を用意しています。フォルダごとの状態は `getFolderLoadState(folderId)` で `{ status: "unloaded" | "loading" | "loaded" | "error", error: string | null }` を取得し、状態変化の購読には返された `folderLoadRevision` を使います。低レベルフックを使う画面では、対象の表示・展開に合わせた呼び出しと、エラーや再試行の表示を利用側で組み立てます。

## 初期パス・移動・検索の範囲

`initialPath`、`selectedFile`、同期の `ref.navigate()` は、キャッシュにある項目と祖先から解決します。まだ取得していない任意のパスを、APIが自動でサーバー全体から探索することはありません。必要な祖先を `initialEntries` に含めるか、祖先を順に `loadFolder` してから移動してください。`navigate()` の成功は表示先の受け付けを意味し、フォルダ取得の完了通知ではありません。

内蔵検索・お気に入り・最近・`getEntries()` は取得済みのキャッシュを対象にします。未取得を含む全件を検索する場合は、利用側の `onSearchRequest` がサーバー上の検索を実行し、`{ hits, entries }` でヒット項目と必要な祖先の最小メタデータを返します。配列だけを返す旧形式も使えますが、メタデータがない未知IDは表示しません。[全件外部検索の型と例](./search.md)

検索の `entries` はキャッシュへ追加され、読み込みとして扱うためdirtyにはなりません。`search-hydrate` イベントの `addedCount` で追加件数を受け取れます。フォルダを検索結果として受け取っても、直下をすべて取得済みとはみなしません。そのフォルダを開いたときは `onLoadFolder` で残りの直下一覧を取得します。既知の項目やローカル編集は保持し、検索で受け取った項目を保存の `changes.created` に含めません。`onLoadFolder` 自体が検索や未知IDの取得を自動実行するのではなく、検索処理と返すメタデータは利用側が用意します。

## 部分キャッシュの保存

遅延読み込み中の `onSave` には、次の `scope` が追加されます。

```ts
{
  entries: cachedEntries,
  changes: { created, updated, deleted },
  scope: { kind: "partial", loadedFolderIds: ["root", "folder-sales"] },
}
```

`entries` はサーバーの全件ではありません。この配列でDB全体を置き換えたり、ここにないIDを削除扱いにしたりすると、未取得データを失います。`changes.created` / `updated` / `deleted` を使って差分保存してください。削除するのは `changes.deleted` の対象だけです。親の保存処理でも権限・競合・階層整合性を検証し、トランザクションで反映します。

`onSave` の戻り値は、保存後の**同じキャッシュ範囲**の項目を返します。アップロードしたローカル `File` はサーバーの本体参照へ変換します。メタデータや本体参照を変える必要がなければ、保存成功後にvoidを返せます。全件を読み込む旧方式には `scope` を追加しないため、既存の保存処理の契約は維持します。[保存の契約](./saving.md)も参照してください。

Playgroundの `/explorer/lazy-loading` は、サーバー相当のメモリ上の全件Mapへ `changes` だけを反映し、取得済み範囲だけ返す実装例です。初期キャッシュ1項目から、3階層・末端320ファイルずつの資料を必要時に取得できます。全件検索の例では、ルート取得後の4項目から、未取得の開発資料8件と祖先だけを受け取って18項目に増えます。全2,576項目をクライアントの一覧へ渡しません。外部通信・永続保存は行いません。

## 移動と取得のイベント

`onEvent` の `navigate` は従来から利用でき、表示場所が変わった後に `event.location` を通知します。初回表示では通知しません。読み込みの完了は `folder-load` の `status: "success"` で観測します。ルートの初回取得は `navigate` を伴わない場合があります。

```tsx
<Explorer initialEntries={[]} onLoadFolder={loadFolder}
  onEvent={event => {
    if (event.type === "navigate") console.log("移動", event.location);
    if (event.type === "folder-load" && event.status === "success") {
      console.log("取得", event.folderId, event.path, event.addedCount);
    }
  }} />
```

取得要求は `onLoadFolder`、移動・開始・成功・エラーの観測は `onEvent` という役割です。`navigate` の通知から独自に `initialEntries` を差し替えて取得を実装する必要はありません。イベントの戻り値や例外では、操作の成否を変更できません。
