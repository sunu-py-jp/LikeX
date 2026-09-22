# ヘッドレスAPIとJSON

`@likex/calendar/model` はReact、DOM、保存先へ依存しません。ファイル拡張子は `.json`、ルートは `format: "likex.calendar"`、`version: 1`、`id`、`title`、`timeZone`、`events` です。

```ts
import { createCalendar, executeCalendarCommands, parseCalendar, serializeCalendar,
  getCalendarEvents, getCalendarVisibleRange } from "@likex/calendar/model";

const calendar = createCalendar({ title: "Team", timeZone: "Asia/Tokyo" });
const result = executeCalendarCommands(calendar, [
  { type: "event.create", event: { id: "review", title: "設計レビュー", allDay: false,
    start: "2026-09-22T09:00:00+09:00", end: "2026-09-22T10:00:00+09:00" } },
]);
const json = serializeCalendar(result.calendar);
const restored = parseCalendar(json);
const range = getCalendarVisibleRange("2026-09-22", "week", restored.timeZone);
const visible = getCalendarEvents(restored, range);
```

`createCalendar(input?)` は空のカレンダーを作成します。`normalizeCalendar(unknown)` は構造・ID・日時・ゾーンを検証して外部入力から分離した不変モデルを返します。`parseCalendar(string)` と `serializeCalendar(calendar)` を保存境界に使います。既存ID、予定の順序、ISOのオフセットは維持します。空欄のID生成は新規作成に限定され、読み込み時に勝手に追加しません。

| コマンド | 引数 |
| --- | --- |
| `event.create` | `event`（id省略可、title/allDay/start/end必須） |
| `event.update` | `id`, `changes`（idの変更不可） |
| `event.delete` | `id` |
| `calendar.update` | `title?`, `timeZone?` |
| `calendar.replace` | `calendar`（検証済み構造への全体置換） |

イベントの任意フィールドは `description`、`location`、`color`（#RRGGBB）です。バッチは入力を変更せず、途中で失敗した場合は全体が失敗します。戻り値は `{ calendar, changed }`。変更がない場合は同じモデルを返します。

`getCalendarEvent(calendar,id)` は該当イベントまたはundefined、`getCalendarEvents(calendar,range?)` は不変配列を返します。`createCalendarRescheduleCommand(calendar,id,date,time?)` は日付や時刻への移動をコマンドに変換します。`getCalendarLocalDate`、`getCalendarLocalDateTime`、`calendarLocalTimeToISO` はタイムゾーン変換、`getCalendarVisibleRange`、`addCalendarDays`、`shiftCalendarDate` は表示期間の計算に利用できます。

JSONはUTF-8で5MiB（整形した出力も上限内）、予定は10,000件、コマンドバッチは1,000件まで。重複ID、未知フィールド、未知形式・バージョン、日付の繰り上がり、終了が開始以前の予定、オフセットのない日時はエラーです。JSON Schemaは型の構造参照で、これらの意味検証はランタイムAPIが行います。入力本文をコードやエージェントへの指示として実行しません。

独立CLIは `skills/likex-calendar/scripts/document.mjs` を使います。create / inspect / apply / validateを備え、公開モデルAPIからJSONを操作します。表示中の下書きはCLIの変更で自動更新されないため、表示中コンポーネントには `CalendarHandle` を使用してください。

## 開始または終了だけを変える

`createCalendarResizeCommand(calendar, id, edge, date, time)` は画面のリサイズと同じ `event.update` を返します。`edge` は `"start"` または `"end"`、`date` は `YYYY-MM-DD`、`time` は表示タイムゾーンの `HH:mm` です。反対側の時刻とIDは維持します。終日予定、存在しない予定、開始以前の終了、存在しないローカル時刻はエラーです。

```ts
import { createCalendarResizeCommand, executeCalendarCommands } from "@likex/calendar/model";

const command = createCalendarResizeCommand(calendar, "review", "end", "2026-09-22", "11:30");
const { calendar: resized } = executeCalendarCommands(calendar, command);
// 表示中なら ref.current.execute(command) へ渡す。
```

CLIでは同じ操作を `event.update` の `changes.start` / `changes.end` で指定します。CLIへ渡す時刻はオフセット付きISO日時です。ヘルパーはGUIの15分スナップやスクロール状態に依存しません。
