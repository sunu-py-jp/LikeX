# 操作・状態変化のイベント

[ドキュメント一覧](./README.md)

onEventで操作・状態を観測するための型と利用例です。保存前後の処理は[保存ガイド](./saving.md#save-lifecycle)、親から画面にメッセージを出す場合は[通知の表示](./notifications.md)を参照してください。

## 操作や状態変化を親画面で受け取る

`onEvent?: ExplorerEventHandler` は、ローカル操作や表示状態の変化を親へ通知します。親のステータス表示や、別のUIとの連携に利用できます。現在使える公開APIです。

```ts
type ExplorerEventHandler = (event: ExplorerEvent) => void | Promise<void>;
```

`ExplorerEvent` は `type` で判別するunionです。`save`・`refresh`・`download`・`upload` はさらに `status`、`window` は `action` で判別できます。`ExplorerEvent`、`ExplorerEventHandler`、`ExplorerDraftEvent`、`ExplorerChangeInfo`、`ExplorerLocationInfo`、`ExplorerDownloadRequest`、`ExplorerUploadRejectedEvent`、`ExplorerUploadSkippedEvent` を公開入口からimportできます。

| `event.type` | 通知のタイミングと主なデータ |
| --- | --- |
| `change` | 成功したローカル操作に実変更があったとき。`action` は `create` / `createFile` / `rename` / `move` / `copy` / `delete` / `favorite` / `upload`。操作後の全 `entries` と、直前との差分 `changes: { created, updated, deleted }`。 |
| `upload` | 制約違反時の `status: "rejected"` はその回の全体中止、`"skipped"` は条件違反の除外または同名競合のスキップ。`parentId` / `parentPath`、`attemptedCount`、違反ファイルの `rejections` と `message` を持ち、`"skipped"` は `addedCount` / `overwrittenCount` / `skippedCount` も持ちます。 |
| `discard` | 下書きを破棄したとき。戻した一覧 `entries`。 |
| `save` | `status: "start"` は保存に渡す `payload`、`"success"` は保存後の `entries`、`"error"` は `message`。 |
| `refresh` | `status: "start"` は再取得開始、`"success"` は反映した最新の `entries`、`"error"` は失敗の `message`。未保存確認の取り消しでは発行しません。 |
| `edit-mode` | 編集許可の `mode`・`reason`・`requestId`・最初の操作 `request` と任意の `message`。要求・許可・拒否・取得失敗・セッション終了を通知します。 |
| `navigate` | 表示場所が変わった後。`location` に `kind`、`id`、`name`、`path`。お気に入り・最近の一覧は `id` と `path` が `null`。 |
| `selection` | 選択状態が変わった後。選択項目の `ids` と `entries`。 |
| `tabs` | タブの状態が変わった後。`activeTabId` と、各タブの `id`・`title` を持つ `tabs`。 |
| `view` | 表示設定が変わった後。`mode`、`compact`、`query`、`sort: { key, asc }`。`key` は `"name"` / `"updatedAt"` / `"extension"` / `"size"` で、検索・並べ替えも含みます。 |
| `details` | 詳細表示が変わった後。開いた項目の `entry`、閉じたときは `null`。 |
| `clipboard` | コピー・切り取りをクリップボードへ設定したとき。`action: "copy" \| "move"` と対象の `ids`。 |
| `preview` | プレビューを要求したとき。`request` と、親のプレビューを使うかを表す `external`。表示完了の通知ではありません。 |
| `download` | 従来どおり `status: "start"` / `"success"` / `"error"` と `request: ExplorerDownloadRequest`。成功時は `result`、失敗時は `message`。`result.status: "handed-off"` はブラウザーへの引渡し、`"completed"` は親が保存完了を確認した場合です。内蔵処理の成功は `handed-off`。 |
| `download-progress` | ダウンロード処理途中の `progress: ExplorerDownloadProgress` と対象の `request`。この通知では処理は終了しません。 |
| `download-cancelled` | ダウンロードを取り消したときの `reason`・`message` と対象の `request`。失敗通知とは分けます。 |
| `context-menu` | 追加メニューの `status: "start" \| "confirmation-required" \| "success" \| "cancelled" \| "error"`。実行を識別する `requestId`、項目の `itemId`・`label`、必要に応じて `message` を持ちます。[メニューの実行と反映](./context-menu.md)を参照してください。 |
| `window` | `action: "detach"` / `"reattach"` / `"close"` / `"blocked"` と `windowId`・`tabIds`。起動確認後の切り離し・明示的な復帰・子のタブ終了・ポップアップのブロックや起動失敗を通知します。`detach` / `blocked` には `sourceWindowId` も含み、説明用の `message` を含む場合があります。 |

`navigate`・`selection`・`tabs`・`view`・`details` は初回マウント時には通知せず、その後の状態変化を通知します。操作に伴って複数のイベントが届く場合があります。イベント内の項目情報は `ExplorerItemInfo` で、要求時点の表示パスと本体参照を含みます。フォルダの `extension` は空文字です。`save` の `start.payload` は通常の `ExplorerSavePayload` です。

子ウィンドウで発生した `navigate`・`selection`・`tabs`・`view`・`details`・`clipboard`・`preview`・`download`・`download-progress`・`download-cancelled` には、その子の `windowId` を追加します。親のこれらの通知では省略します。`window` イベントには常に対象の `windowId` があります。`change`・`discard`・`save`・`refresh`・`upload`・`edit-mode` はワークスペース全体の通知で、ウィンドウごとに二重発行しません。

`edit-mode.reason` は、`request` / `granted` / `denied` / `error` / `saved` / `refreshed` / `discarded` / `ended` / `cancelled` / `read-only` / `unmounted` です。初期の閲覧モードでは通知せず、要求・許可・終了等で発行します。操作元は `request.windowId` で識別します。外部ハンドラー未指定なら同期で許可するため、`requesting` を経ず `granted` を通知します。保存の成功通知後に、セッション終了の `saved` を通知します。再取得が成功した場合は `refreshed` で終了します。

ダウンロード関連の通知は、同じ実行を示す `requestId` と、外部ハンドラー利用の有無 `external` を持ちます。既存の `download` 型では後方互換のため追加フィールドを任意にしていますが、新しい実装が発行する通知には含めます。進捗と取消しは別の `type` なので、既存の `download.status` の開始・成功・失敗という3分岐を変更する必要はありません。各要求の状態を親で並行管理する場合は `requestId` をキーにします。

`window.action: "reattach"` は「元のウィンドウに戻す」を選んだときだけ通知します。子を閉じるなどしてタブを終了した場合は `"close"` です。`close` の `tabIds` は終了したタブのIDであり、ファイルの削除や下書きの破棄を表すイベントではありません。

`window.action: "detach"` は `open()` が参照を返した時点ではなく、描画・文書の表示状態・表示領域を確認した後に通知します。起動失敗や5秒の起動確認タイムアウトでタブを復元した場合は `"blocked"` を通知し、`"reattach"` / `"close"` は通知しません。

`window` の `sourceWindowId?: string` は切り離し元を識別する項目です。型では任意ですが、`action: "detach"` / `"blocked"` の通知では必ず設定し、メインからの操作は `"main"`、子からの操作はその子のウィンドウIDを渡します。この2つの通知で `windowId` は開く先の新しいウィンドウID、`tabIds` は切り離す対象タブです。`reattach` / `close` の `windowId` は従来どおり、戻す・終了する対象の子を表します。

`ExplorerPopup` の最初の起動に失敗した場合も `blocked` を通知します。この場合は切り離す対象がないため `tabIds: []`、`sourceWindowId: "main"` です。最初のポップアップの正常な開閉は `onOpenChange` で受け取り、`detach` / `close` は通知しません。最初のポップアップ内での操作はメイン扱いになり、`navigate` 等の `windowId` は省略します。

`change.changes` は**その操作の直前と直後**の差分です。`onSave` に渡す差分は**現在の比較元から**の差分です。比較元は初期一覧、前回の保存成功時の一覧、再取得に成功した一覧、または編集許可で反映した最新一覧です。例えば名前を変更して元に戻すと `change` はそれぞれ通知しますが、保存対象の差分は残りません。操作イベントをストレージへ逐次反映する方式にはしません。

### 型付きswitchで親の状態を更新する

この例は、変更・保存・選択・プレビュー要求・ダウンロード・ウィンドウ操作を受け取って最新の通知を表示します。複数のダウンロードを個別表示する場合は、親のstateを `requestId` ごとのMap等にします。ほかのイベントも `case` を追加して扱えます。

```tsx
"use client";

import { useState } from "react";
import Explorer, {
  type ExplorerEventHandler,
  type ExplorerProps,
} from "@/components/explorer";

type Props = Omit<ExplorerProps, "onEvent">;

export default function ExplorerWithEvents(props: Props) {
  const [status, setStatus] = useState("操作待ち");
  const observe: ExplorerEventHandler = (event) => {
    switch (event.type) {
      case "change":
        setStatus(
          `${event.action}: 追加 ${event.changes.created.length}件、` +
          `更新 ${event.changes.updated.length}件、削除 ${event.changes.deleted.length}件`,
        );
        break;
      case "save":
        if (event.status === "start") {
          setStatus(`${event.payload.entries.length}項目を保存中`);
        } else if (event.status === "success") {
          setStatus(`${event.entries.length}項目を保存しました`);
        } else {
          setStatus(`保存エラー: ${event.message}`);
        }
        break;
      case "edit-mode":
        setStatus(event.message ?? `編集状態: ${event.mode} (${event.reason})`);
        break;
      case "selection":
        setStatus(`${event.windowId ?? "親"}: ${event.ids.length}項目を選択中`);
        break;
      case "preview":
        setStatus(`${event.request.path} のプレビューを要求しました`);
        break;
      case "download":
        if (event.status === "start") {
          setStatus(`${event.request.name} のダウンロードを要求しました`);
        } else if (event.status === "error") {
          setStatus(`ダウンロードエラー: ${event.message}`);
        } else {
          setStatus(event.result?.message ?? (
            event.result?.status === "completed"
              ? "保存完了を確認しました"
              : "ダウンロードをブラウザーへ引き渡しました"
          ));
        }
        break;
      case "download-progress":
        setStatus(`${event.request.name}: ${event.progress.message ?? event.progress.phase}`);
        break;
      case "download-cancelled":
        setStatus(event.message);
        break;
      case "window":
        setStatus(
          event.action === "blocked"
            ? (event.message ?? "別ウィンドウを開けませんでした")
            : `${event.windowId}: ${event.action} (${event.tabIds.length}タブ)`,
        );
        break;
      default:
        break;
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p role="status">{status}</p>
      <div style={{ height: 640, minWidth: 0 }}>
        <Explorer {...props} onEvent={observe} />
      </div>
    </div>
  );
}
```

| コールバック | 責務 |
| --- | --- |
| `onSave` | 永続化の本処理。保存成功・失敗を決めます。 |
| `onRefresh` | 認証等を含む親の取得処理から最新の `readonly ExplorerEntry[]` を返します。取得失敗はthrow/rejectします。 |
| `onEditRequest` | 最初の有効な変更を適用する直前に許可を取得します。ロックの取得・解放は親の実装に接続します。 |
| `onPreviewRequest` | 内蔵プレビューの代わりに親の表示を開きます。 |
| `onSearchRequest` | 名前検索を置き換え、親の検索結果から現在の項目IDを順位順に返します。 |
| `onDownloadRequest` | ダウンロードの実処理。進捗を報告し、引渡し・保存完了・取消しを返します。失敗はthrow/rejectします。 |
| `onEvent` | 操作や状態を観測する通知。編集・保存・プレビュー・ダウンロードの実装を置き換えません。 |

`onEvent` の完了は待たず、戻り値・同期例外・Promiseのrejectを無視します。例外を投げても操作を取り消せず、保存成功を失敗に変えることもありません。観測処理の失敗を親画面に表示したい場合は、コールバック内で処理します。編集開始の許可は `onEditRequest`、永続化は `onSave`、外部プレビューへの差し替えは `onPreviewRequest`、ダウンロードの委譲は `onDownloadRequest` を使います。
