# 保存・編集許可

保存・再読み込み・編集許可は、利用側の処理が終わるまで結果を待つコールバックです。通信や検証の失敗は `throw` で伝えます。結果を待たない観測用の通知は、[通知・機能設定](./events-and-features.md)を参照してください。

## 型

```ts
type MaybePromise<T> = T | Promise<T>;

type SaveHandler<Payload, Result = Payload> =
  (payload: Payload) => MaybePromise<void | Result>;

type RefreshHandler<Result> = () => MaybePromise<Result>;

type OperationContext = Readonly<{
  requestId: string;
  signal: AbortSignal;
}>;

type RequestHandler<Request, Result> = (
  request: Request,
  context: OperationContext,
) => MaybePromise<Result>;
```

| 型 | 受け取るもの | 返すもの |
| --- | --- | --- |
| `SaveHandler` | 保存対象のデータ | 省略、または保存後のデータ |
| `RefreshHandler` | なし | 再読み込みしたデータ |
| `RequestHandler` | リクエストと操作情報 | リクエストに対する結果 |
| `OperationContext` | 所有コンポーネントが作成 | 操作を識別する `requestId` と中止通知の `signal` |

`SaveHandler` と `RefreshHandler` に第2引数はありません。`OperationContext` は `RequestHandler`、編集許可、カスタムメニューなど、型の定義に含まれている処理で渡されます。

## 保存の例

```ts
import type { SaveHandler, RefreshHandler } from "@likex/core";

type Document = { id: string; text: string; version: number };

export const onSave: SaveHandler<Document> = async document => {
  const response = await fetch(`/api/documents/${encodeURIComponent(document.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(document),
  });
  if (!response.ok) throw new Error("保存できませんでした");
  return await response.json() as Document;
};

export const onRefresh: RefreshHandler<Document> = async () => {
  const response = await fetch("/api/documents/current");
  if (!response.ok) throw new Error("再読み込みできませんでした");
  return await response.json() as Document;
};
```

APIのURLとデータ構造はサンプルです。レスポンスの実行時検証、認証、バージョン競合の判定は利用側で追加します。Coreは型を提供するだけで、成功時にどのデータを採用するか、保存ボタンをどう制御するかは各コンポーネントが決めます。

## 編集許可

```ts
type EditMode = "view" | "requesting" | "edit";

type EditPermission<Baseline, Field extends string = "data"> =
  | boolean
  | Readonly<{ allowed: true } & Partial<Record<Field, Baseline>>>;

type EditRequestHandler<Request, Baseline, Field extends string = "data"> = (
  request: Request,
  context: OperationContext,
) => MaybePromise<EditPermission<Baseline, Field>>;
```

| 返却値 | 意味 |
| --- | --- |
| `true` | 現在のデータで編集を許可する |
| `false` | 編集を許可しない |
| `{ allowed: true }` | データを差し替えず編集を許可する |
| `{ allowed: true, data: baseline }` | 最新データを渡して編集を許可する |

第3型引数で初期データのキー名を変更できます。Explorerでは `entries`、Spreadsheetでは `workbook` を使います。拒否を表す値は `false` です。`{ allowed: false }` はこの型に含まれません。

```ts
import type { EditRequestHandler } from "@likex/core";

type Document = { id: string; text: string; version: number };
type EditRequest = { documentId: string; action: string };

export const requestEdit: EditRequestHandler<EditRequest, Document> =
  async (request, { signal, requestId }) => {
    const response = await fetch("/api/edit-permissions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, requestId }),
    });
    if (response.status === 409) return false;
    if (!response.ok) throw new Error("編集権限を確認できませんでした");
    const document = await response.json() as Document;
    return { allowed: true, data: document };
  };
```

これはサーバーに許可を問い合わせる例です。ロックの取得・更新・解放は親アプリが管理します。操作の所有者が終了したときに `signal` が中止されるため、対応する通信へそのまま渡せます。

`EditEndReason` には `saved`、`discarded`、`refreshed`、`ended`、`cancelled`、`read-only`、`unmounted` があります。コンポーネントが通知する具体的なイベントはExplorer・Spreadsheetそれぞれのイベント定義を確認してください。

## 同期処理をそのまま返す

`chainResult(value, next)` は、同期の値にはその場で `next` を実行し、Promiseの場合だけ解決を待ちます。エラーを握りつぶさないため、許可判定や検証の接続に使えます。

```ts
import { chainResult, isPromiseLike } from "@likex/core";

const immediate = chainResult(3, value => value * 2); // 6
const deferred = chainResult(Promise.resolve(3), value => value * 2);
console.log(isPromiseLike(immediate)); // false
console.log(await deferred); // 6
```
