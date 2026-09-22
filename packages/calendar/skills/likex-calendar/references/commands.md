# カレンダー操作

```json
[
  { "type": "calendar.update", "title": "チームの予定", "timeZone": "Asia/Tokyo" },
  { "type": "event.create", "event": {
    "id": "review-20260922", "title": "設計レビュー", "allDay": false,
    "start": "2026-09-22T09:00:00+09:00", "end": "2026-09-22T10:00:00+09:00",
    "location": "会議室A", "color": "#2563eb"
  } },
  { "type": "event.create", "event": {
    "id": "leave", "title": "休暇", "allDay": true,
    "start": "2026-09-23", "end": "2026-09-25"
  } }
]
```

この休暇は23・24日の2日間。日時にオフセットのない `2026-09-22T09:00` は保存しない。

更新は `{ "type": "event.update", "id": "review-20260922", "changes": { "title": "レビュー" } }`、削除は `{ "type": "event.delete", "id": "review-20260922" }`。予定のidは更新できない。`calendar.replace` の `calendar` は完全なネイティブモデルで、全体置換に使う。

イベントはid/title/allDay/start/endを持ち、description/location/color（#RRGGBB）は任意。create時だけidを省略できる。未知フィールドはエラーになり、繰り返し・招待等の保存領域はない。

## 直接API

`executeCalendarCommands(calendar, commandOrArray)` は `{ calendar, changed }` を返す。`getCalendarEvent(calendar,id)`、`getCalendarEvents(calendar,{start,end})` で取得する。日時範囲は `calendar.timeZone` で評価する。

`createCalendarRescheduleCommand(calendar,id,date,time?)` は期間を維持する移動コマンドを返す。時刻指定予定は経過時間、終日予定は日数を保つ。`calendarLocalTimeToISO(local,timeZone)` はローカル日時からISOへ変換し、夏時間で存在しない時刻を拒否、重複する時刻は先の瞬間を選ぶ。厳密に後の瞬間を指定するなら明示的なオフセットを使う。

入力は `parseCalendar`、保存は `serializeCalendar` を通す。JSON上限5MiB（整形出力にも適用）、予定10,000件、バッチ1,000コマンド。失敗したバッチで元モデルの一部だけが変更されることはない。

## 片側の時刻を変更する

開始または終了だけを変更する場合は `event.update` でそのフィールドだけを渡す。GUIのクイック作成・詳細編集・リサイズ・右クリックは同じcreate/update/deleteへ接続される。画面なしの `createCalendarResizeCommand(calendar,id,"start"|"end",date,time)` は表示タイムゾーンの日時を変換してupdateコマンドを返す。終日・不明ID・時刻の逆転・夏時間で存在しない時刻を拒否する。

```json
[
  { "type": "event.create", "event": {
    "id": "resize-example", "title": "設計レビュー", "allDay": false,
    "start": "2026-09-22T09:00:00+09:00", "end": "2026-09-22T10:00:00+09:00"
  } },
  { "type": "event.update", "id": "resize-example", "changes": { "end": "2026-09-22T11:30:00+09:00" } }
]
```
