# ファイル・フォルダの選択

[ドキュメント一覧](./README.md)

`ExplorerPicker` はページ内へ配置する選択専用画面、`ExplorerPickerDialog` は同じ選択画面をモーダルで開くコンポーネントです。対象は利用側が `initialEntries`・`onLoadFolder`・`onSearchRequest` で渡すファイルとフォルダです。端末のファイルシステムを開くOSのファイル選択ダイアログではありません。

## モーダルで選択する

```tsx
import { useState } from "react";
import {
  ExplorerPickerDialog,
  type ExplorerEntry,
  type ExplorerPickerItem,
} from "@likex/explorer";
import "@likex/explorer/styles.css";

export function AttachmentPicker({ entries }: { entries: readonly ExplorerEntry[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<readonly ExplorerPickerItem[]>([]);
  return <>
    <button type="button" onClick={() => setOpen(true)}>資料を選ぶ</button>
    <ExplorerPickerDialog
      open={open}
      onOpenChange={setOpen}
      dialogTitle="添付する資料"
      initialEntries={entries}
      kind="file"
      multiple
      onConfirm={items => setSelected(items)}
    />
    <ul>{selected.map(item => <li key={item.id}>{item.path}</li>)}</ul>
  </>;
}
```

`onConfirm` が成功すると `onOpenChange(false)` を通知します。`open` は利用側で更新してください。再度開くと、初期場所・初期選択から新しいセッションを開始します。ページ内へ配置するときは `ExplorerPicker` に同じ選択propsを渡し、`open`・`onOpenChange`・`dialogTitle`・`dialogDescription` を省きます。

## 選択する対象

| prop | 契約 |
| --- | --- |
| `kind` | `"file"`（既定） / `"folder"` / `"both"`。確定できる種類を制限します。フォルダは移動のために表示します。 |
| `multiple` | 既定 `false`。`true` なら複数項目を選択できます。 |
| `initialSelectedIds` | 初回だけ評価する項目IDの配列。遅延取得でも対象と祖先のメタデータを初期キャッシュに含めてください。 |
| `onSelectionChange` | 初期状態と、その後の選択候補を `readonly ExplorerPickerItem[]` で通知します。選択の解除は空配列です。確定とは別の通知です。 |
| `onConfirm` | 必須。確定した項目と `{ signal: AbortSignal }` を受け取り、`void` または `Promise<void>` を返します。 |
| `onCancel` | キャンセルの通知。確定済みの結果を利用側で消すかどうかは利用側の判断です。 |
| `confirmLabel` / `cancelLabel` | 確定・キャンセルボタンの文言。 |
| `ref` | 任意の `React.Ref<ExplorerPickerHandle>`。下記の移動・選択・確定操作を呼び出せます。 |

ダイアログではさらに `open: boolean` と `onOpenChange: (open: boolean) => void` が必須で、`dialogTitle`・`dialogDescription` を指定できます。

ファイルのダブルクリックや Enter はそのファイルを確定します。フォルダのダブルクリックや Enter はその中へ移動します。フォルダ自体を選ぶ場合は選択して確定するか、`kind="folder"` / `"both"` の「現在のフォルダを選択」で現在地1件を直接確定します。現在フォルダは通常のフォルダとルートだけが対象で、検索中・お気に入り・最近の一覧では利用できません。読み込み中や取得エラーがある間も確定できません。

通常の項目はパス付きの `ExplorerItemInfo`、仮想ルートは次の専用型です。ルートは `folder` / `both` で選べます。フォルダの選択に配下すべての読み込みやファイル本体の取得は必要ありません。

```ts
type ExplorerPickerRootItem = Readonly<{
  kind: "root";
  id: "root";
  path: "/";
  name: string; // rootLabel。省略時は「ファイル」
}>;
type ExplorerPickerItem = ExplorerItemInfo | ExplorerPickerRootItem;
```

## 読み込み・検索・確定処理

`initialEntries`・`initialPath`・`onLoadFolder`・`folderLoading`・`onSearchRequest`・`search`・`renderSearch`・`renderSearchResult`・`renderEmptyState`・テーマなど、Explorerの表示・取得契約を共有します。[遅延読み込み](./folder-loading.md)では初期キャッシュに祖先を含め、[外部検索](./search.md)では `{ hits, entries }` を返して未取得の結果も選択できます。通信や認証、選択した資料を業務データへ関連付ける処理は利用側で実装します。

Pickerは読み取り専用です。選択や移動によって資料の改名・削除・保存は行いません。タブ追加・切り離し・プレビュー・ダウンロード・詳細ペイン・右クリックメニュー・項目メニューも表示しません。`onSelectionChange` に加えて `onEvent` で選択・移動などのExplorerイベントを受け取れます。確定結果は `onConfirm` で受け取ります。

非同期の `onConfirm` がrejectした場合はエラーを表示し、ダイアログを開いたまま再試行できます。キャンセル・閉じる・選択対象の変更では `signal` がabortされ、古い確定の完了では閉じません。利用側の通信にも `signal` を渡し、完了時に確認してください。すでに外部へ保存した処理をライブラリが取り消すものではありません。

```tsx
<ExplorerPicker
  initialEntries={entries}
  kind="both"
  multiple
  onConfirm={async (items, { signal }) => {
    await saveReferences(items.map(item => ({ id: item.id, path: item.path })), { signal });
    signal.throwIfAborted();
  }}
/>
```

## 外側から操作する

`ExplorerPickerHandle` は `navigate`・`selectFiles`・`selectEntries`・`openContainingFolder` を持ちます。引数と戻り値はExplorerの[移動・選択API](./api-reference.md#external-navigation)と共通で、Pickerの種類・件数制限も適用します。`openContainingFolder` は選択対象外でも親へ移動しますが、その項目を選択しません。

| 操作 | 戻り値 |
| --- | --- |
| `confirm()` | `Promise<boolean>`。選択を検証して `onConfirm` を実行します。成功は `true`、無効な選択・失敗・中断は `false`。 |
| `selectCurrentFolder()` | `Promise<boolean>`。現在のフォルダ1件を直接 `onConfirm` へ渡して確定します。成功は `true`、種類・場所・取得状態によって選択できない場合や失敗・中断は `false`。 |
| `cancel()` | `void`。進行中の確定を中断してキャンセルを通知します。 |

## 画面なしで選択を検証する

`@likex/explorer/model` の `resolveExplorerPickerItems` は、階層・対象の存在・種類・件数をまとめて検証します。入力を変更せず、成功時は凍結した項目のコピーを返します。通信・表示・確定コールバックは行いません。

```ts
import { resolveExplorerPickerItems } from "@likex/explorer/model";

const result = resolveExplorerPickerItems(entries, ["document-a", "folder-b"], {
  kind: "both", multiple: true, rootLabel: "共有資料",
});
if (result.ok) {
  console.log(result.items.map(item => item.path));
} else {
  console.log(result.code, result.message);
}
```

同じIDは最初の出現だけを採用し、異なる親の項目もまとめて検証できます。空選択は成功しません。`ExplorerPickerErrorCode` は `empty-selection` / `not-found` / `selection-kind` / `selection-limit` / `invalid-hierarchy` / `invalid-target` です。

Playgroundの `/explorer/picker` で、4種類の選択条件、埋め込みとモーダル、遅延取得、未取得の名前検索、確定したID・パスを確認できます。ブラウザの別ウィンドウでExplorerを起動する用途は [ExplorerPopup](./windows.md) を参照してください。
