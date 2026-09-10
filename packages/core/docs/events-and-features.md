# 通知・機能設定

`notifyHost` は操作結果を利用側へ通知します。`resolveFeatureFlags` は機能設定の未指定項目を既定値で補います。どちらもCoreのデータモデルやReactの状態を必要としません。

## 観測用の通知

```ts
type EventHandler<Event> = (event: Event) => MaybePromise<void>;

function notifyHost<Args extends readonly unknown[]>(
  handler: ((...args: Args) => unknown) | undefined,
  ...args: Args
): void;
```

```ts
import { notifyHost } from "@likex/core";
import type { EventHandler } from "@likex/core";

type NoteEvent =
  | { type: "saved"; id: string }
  | { type: "downloaded"; id: string };

const onEvent: EventHandler<NoteEvent> = event => {
  console.log(event.type, event.id);
};

notifyHost(onEvent, { type: "saved", id: "note-123" });
notifyHost(undefined, { type: "saved", id: "note-123" }); // 何もしない
```

通知先で例外やPromiseのrejectが発生しても、操作を取り消しません。戻り値も待ちません。保存や編集許可の判定を `notifyHost` 経由で呼ぶと、失敗を検知できなくなります。その場合はハンドラーを直接呼び、結果を待ってください。

CoreはExplorerとSpreadsheetの全イベントを1つの型にはまとめていません。対象のファイルやセルを受け取るイベントは各コンポーネントの型を使います。

## 機能の初期値

```ts
type FeatureFlags<Feature extends string> = Partial<Record<Feature, boolean>>;

function resolveFeatureFlags<Feature extends string>(
  defaults: Readonly<Record<Feature, boolean>>,
  overrides?: Readonly<FeatureFlags<Feature>>
): Record<Feature, boolean>;
```

```ts
import { resolveFeatureFlags } from "@likex/core";
import type { FeatureFlags } from "@likex/core";

type Feature = "rename" | "download" | "upload";

const defaults: Record<Feature, boolean> = {
  rename: true,
  download: true,
  upload: true,
};
const overrides: FeatureFlags<Feature> = { rename: false };

const features = resolveFeatureFlags(defaults, overrides);
// { rename: false, download: true, upload: true }
```

| 指定 | 解決後 |
| --- | --- |
| `false` | 無効 |
| `true` | 有効 |
| 省略、`undefined` | その項目の既定値 |
| `defaults` にないキー | 結果へ含めない |

引数のオブジェクトは変更せず、新しいオブジェクトを返します。Coreは機能の親子関係、読み取り専用モード、メニューの表示を判定しません。Explorer・Spreadsheetを使う場合は各コンポーネントの `features` Propsに指定すれば、表示と操作の制御も反映されます。
