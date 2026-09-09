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

ExplorerとSpreadsheetは通常のnpm依存として `@likex/core` を利用します。tarballで導入する際はcoreとUIの両tarballをnpmに渡してください。コピー導入では `core/src/` とUIの `src/` を隣接フォルダへ置き、UI側の `core.ts` 1行を `export * from "../core";` へ変更します。自動生成や特殊な解決設定はありません。core単体も `src/` のコピーで利用できます。

npm公開は未実施です。現在は `private: true` / `UNLICENSED` です。
