# 保存・編集許可・操作API

`onSave(calendar)` を省略すると閲覧専用です。保存処理はホストが実装し、成功時には省略またはサーバーが確定したCalendarを返します。失敗時は例外を返すと通知を表示し、未保存状態を保持します。

`onBeforeSave(calendar)` がfalseを返すと保存しません。`onEditRequest({ calendar }, { requestId, signal })` は実際の最初の変更時に呼び、trueの場合だけ編集します。保存・破棄の後は新しい編集許可を要求します。保存、許可要求、読み込みの処理中は別の編集を受け付けません。readOnlyや機能フラグの変更、アンマウントで古い非同期結果を無効にします。サーバーのロック・同時更新制御そのものはホストが担当します。

`onChange(calendar)`、`onDirtyChange(boolean)`、`onEvent(event)` で連携します。イベントは `change`（`model` と `source`）、`save`（`phase`）、`edit-mode`（`mode`）。初期データは深く凍結された通常のJSONオブジェクトとして扱います。

`features` は `events`、`metadata`、`import`、`export`、`history` の部分オブジェクトで、falseの機能をGUIとコンポーネントrefの両方で止めます。`events` は予定の作成・更新・削除、`metadata` はタイトル・タイムゾーン、`import` はカレンダー全体の置換に適用されます。純粋なモデルAPIはUIのフラグに依存しません。

```tsx
import { useRef } from "react";
import LikeCalendar, { type CalendarHandle } from "@likex/calendar";

function CalendarPage() {
  const ref = useRef<CalendarHandle>(null);
  return <LikeCalendar ref={ref} onSave={async calendar => calendar}
    onEditRequest={async (_request, { signal }) => !signal.aborted}
    onVisibleRangeChange={range => console.log(range)} />;
}
```

| CalendarHandle | 内容 |
| --- | --- |
| `getCalendar()` / `getSnapshot()` | 現在モデル / dirty・履歴・処理中・機能状態 |
| `getVisibleRange()` / `setDate(date)` / `setView(view)` | 表示期間の取得・移動 |
| `execute(commandOrArray)` | 検証と編集許可を経て変更し `{ calendar, changed: true }`。変更なし・拒否・失敗はnull |
| `undo()` / `redo()` / `save()` | 非同期、成功時true |
| `discard()` | 保存時点へ戻し履歴を消去 |
| `cancelPending()` | 進行中の許可・保存・読み込みの結果を無効化 |
| `importNative(stringOrBlob)` | ネイティブJSONを検証して置換。成功時true、Undo可能 |
| `exportNative()` | 現在の下書きをJSONのBlobで返す |

履歴は最大100操作で、保存後にもUndo/Redoできます。dirtyは現在の内容と最後に保存した内容を比較します。未保存状態ではタブを閉じる際のブラウザ警告を登録します。`warnOnUnsavedChanges={false}` で無効にできます。アプリ内の画面遷移確認はホストで処理します。
