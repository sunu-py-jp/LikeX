# 右クリックの非同期処理

カスタムメニューは、開いた時点の対象を受け取り、選択されたら必要な変更を返します。ExplorerとSpreadsheetはこの処理を組み込み済みです。利用側でメニューを追加する場合、通常は各コンポーネントの `getContextMenuItems` Propsを使います。

このページは、両コンポーネントで共通の型と、自作UIに接続する `createContextMenuExecutor` の説明です。

## メニュー項目

```ts
type ContextMenuResult<Change> = Readonly<{
  change: Change;
  description?: string;
}>;

type ContextMenuItem<Context, Change, Icon = never> = Readonly<{
  id: string;
  label: string;
  icon?: Icon;
  disabled?: boolean;
  onSelect: (
    context: Context,
    operation: OperationContext,
  ) => MaybePromise<ContextMenuResult<Change> | void>;
}>;

type ContextMenuProvider<Context, Change, Icon = never> = (
  context: Context,
) => readonly ContextMenuItem<Context, Change, Icon>[];
```

| 項目 | 必須 | 内容 |
| --- | --- | --- |
| `id` | 必須 | 同じメニュー内で一意のID |
| `label` | 必須 | 表示名 |
| `icon` | 任意 | UI側で決めたアイコン型。Coreは描画しない |
| `disabled` | 任意 | `true` なら実行不可 |
| `onSelect` | 必須 | 時間のかかる処理を行い、変更案または `undefined` を返す |

Providerはメニューを開く際に同期で呼ばれます。対象外なら空配列を返します。`resolveContextMenuItems(provider, context)` は、重複ID、空の表示名、不正な項目を拒否し、項目のコピーと配列をfreezeして返します。アイコンやcontext内部を深くコピーする関数ではありません。

## 対象によって項目を出す

```ts
import { resolveContextMenuItems } from "@likex/core";
import type { ContextMenuProvider } from "@likex/core";

type Context = { id: string; text: string; editable: boolean };
type Change = { id: string; text: string };

const contextMenu: ContextMenuProvider<Context, Change> = context => {
  if (!context.editable) return [];
  return [{
    id: "trim-text",
    label: "前後の空白を削除",
    onSelect: target => ({
      change: { id: target.id, text: target.text.trim() },
      description: "選択した項目の前後の空白を削除します",
    }),
  }];
};

const items = resolveContextMenuItems(contextMenu, {
  id: "note-1", text: "  メモ  ", editable: true,
});
```

APIリクエストなどの外部処理だけを行い、ローカルデータを書き換えない場合は `undefined` を返します。親で表示した入力ダイアログをキャンセルした場合は `throw new DOMException("キャンセル", "AbortError")` とすると、中止として通知されます。

## 待っている間の変更

`ContextMenuExecutionMode` の値で、処理中に別の操作を許すかを決めます。

| モード | 準備中 | 変更案の反映 |
| --- | --- | --- |
| `block`（既定） | 変更不可、閲覧は可能 | 開始時のrevisionと対象が維持されていれば反映 |
| `confirm` | 変更可能 | 必ず確認を挟む。確認時点のrevisionで対象を再検証して反映 |
| `reject-if-changed` | 変更可能 | 開始後にrevisionが変わっていたら中止 |

どのモードも反映中は `blocksChanges: true` になります。Coreはこの状態を返すだけなので、自作UIでは入力や操作APIにもガードを接続する必要があります。別ユーザーとのロックや競合判定は、このローカル制御とは別に親アプリで扱います。

## 自作UIへ接続する

```ts
import { createContextMenuExecutor } from "@likex/core";
import type { ContextMenuItem } from "@likex/core";

type Context = { id: string };
type Change = { text: string };

let note = { id: "note-1", text: "  メモ  " };
let revision = 0;

const executor = createContextMenuExecutor<Context, Change>({
  getRevision: () => revision,
  prepareChange: change => ({ text: change.text }),
  validateTarget: context => {
    if (context.id !== note.id) throw new Error("対象が見つかりません");
  },
  apply: (change, _context, { signal }, guard) => {
    signal.throwIfAborted();
    if (!guard.isCurrent()) throw new Error("対象が変更されました");
    note = { ...note, text: change.text };
    revision += 1;
  },
  onEvent: event => console.log(event.status),
});

const item: ContextMenuItem<Context, Change> = {
  id: "trim-text",
  label: "前後の空白を削除",
  onSelect: () => ({ change: { text: note.text.trim() } }),
};

const outcome = await executor.run(item, { id: note.id }, "confirm");
if (outcome === "confirmation-required") {
  // この間に、利用側の確認UIで結果を表示する。
  // 「適用」を選んだ場合: await executor.confirm();
  // 「キャンセル」を選んだ場合: executor.cancel();
}
```

| オプション | 役割 |
| --- | --- |
| `getRevision` | 不変データの同じ参照、または単調増加する番号を返す。毎回新しいコピーを返さない |
| `canRun` | 現在実行できるか。`false` は `busy` を返す |
| `prepareChange` | 変更案を検証し、必要ならコピーして呼び出し側の可変データから隔離する |
| `validateTarget` | 元のIDや座標の意味が維持されているか検証する。不適切ならthrowする |
| `apply` | 検証済みの変更案を反映する。必須 |
| `onStateChange` | phaseや `blocksChanges` などの状態通知 |
| `onEvent` | 開始、成功、中止、失敗などの通知 |

`apply` が編集許可などを非同期で待つ場合は、**待った後のコミット直前にも** `guard.isCurrent()` を確認してください。待機中に対象の削除やキャンセルが起きた場合、古い応答を書き込まないための判定です。

## 状態・結果・終了処理

| API | 返却値・動作 |
| --- | --- |
| `getState()` | `phase`、`mode`、`requestId`、`itemId`、`label`、`description`、`error`、`blocksChanges` |
| `run(item, context, mode?)` | `Promise<ContextMenuExecutionOutcome>` |
| `confirm()` | 確認待ちの変更を適用。確認待ちでなければ `busy` |
| `cancel()` | 実行中のsignalをabortし、遅れて返る結果を破棄 |
| `dispose()` | 再利用できない終了処理。以後の `run` は `busy` |

`phase` は `idle / preparing / confirming / applying`、実行結果は `success / cancelled / confirmation-required / failed / busy` です。

イベントは `type: "context-menu"` に加え、`status`、`requestId`、`itemId`、`label`、任意の `message` を持ちます。`status` は `start / confirmation-required / success / cancelled / error`。イベントの `error` と実行結果の `failed` は名称が異なります。

終了時は成功の場合もsignalがabortされます。アンマウント時は `cancel()` と `canRun` のガードで未完了の処理を止めます。React StrictModeなどで同じインスタンスを再接続する場合、`dispose()` を使うと以後再利用できません。
