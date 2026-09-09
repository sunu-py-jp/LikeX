# @likex/core

LikeXコンポーネントの保存・編集許可・通知・機能設定に使う共通の型と小さなヘルパーです。React、Provider、継承用の抽象クラス、実行時依存はありません。

```ts
import { notifyHost, resolveFeatureFlags } from "@likex/core";
import type { SaveHandler, EditRequestHandler, EventHandler } from "@likex/core";

type Document = { id: string; content: string };
const onSave: SaveHandler<Document> = async document => {
  // 利用側で認証・検証・永続化し、失敗時はthrowする。
  console.log(document.id);
};
const onEditRequest: EditRequestHandler<{ action: string }, Document> =
  async (_request, { signal }) => !signal.aborted;
const onEvent: EventHandler<{ type: "saved" }> = event => console.log(event.type);
notifyHost(onEvent, { type: "saved" });
const features = resolveFeatureFlags({ download: true, edit: true }, { edit: false });
```

`notifyHost` は観測用通知の例外・Promise rejectionを隔離します。保存や許可判定をこの関数で呼ばないでください。それらは呼び出し側が結果を待って処理します。

`OperationContext` は `requestId` と `signal`、`EditMode` は `view / requesting / edit` です。`EditPermission<Baseline>` は `boolean | { allowed: true; data?: Baseline }`。第2型引数でデータのキーを変更でき、Explorerは `entries`、Spreadsheetは `workbook` を使います。`SaveHandler<Payload, Result>` と `RefreshHandler<Result>` は同期・非同期の両方を許容します。

`createUnsavedChangesGuard()` は登録されたWindowの `beforeunload` をdirty時だけ有効にします。ネイティブ確認文言はブラウザが決めます。SPA内の遷移確認・サーバーロック・認証・永続化自体は扱いません。

`ContextMenuProvider<Context, Change, Icon>` と `ContextMenuItem` は、条件付きの右クリックメニューを定義します。項目の `onSelect(context, { signal, requestId })` は `{ change, description? }` を返し、実際の書き込みはコンポーネントに委譲します。`undefined` を返すとローカル変更なしで終了します。CoreはReactやファイル・セル固有の型に依存しません。

親の入力ダイアログをキャンセルした場合は `throw new DOMException("キャンセル", "AbortError")` で中止を通知できます。通常のエラー・成功と区別して `cancelled` イベントが発火します。

`createContextMenuExecutor()` は準備・確認・反映を管理します。`block` は準備中の変更を禁止、`confirm` は変更を許可して結果反映前に確認、`reject-if-changed` は開始後にデータが変わっていれば中止します。表示と変更ガード、計画の隔離、対象検証、反映処理は各UIが接続します。非同期の編集許可を待った場合も、コミット直前に `apply` の `guard.isCurrent()` を確認します。キャンセル後の応答は破棄します。

ExplorerとSpreadsheetは通常のnpm依存として `@likex/core` を利用します。tarballで導入する際はcoreとUIの両tarballをnpmに渡してください。コピー導入では `core/src/` とUIの `src/` を隣接フォルダへ置き、UI側の `core.ts` 1行を `export * from "../core";` へ変更します。自動生成や特殊な解決設定はありません。core単体も `src/` のコピーで利用できます。

npm公開は未実施です。現在は `private: true` / `UNLICENSED` です。
