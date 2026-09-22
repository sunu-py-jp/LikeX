# カレンダーの保存構造

`.json` はUTF-8の `Calendar` を保存する。読み込みは `parseCalendar`、保存は `serializeCalendar` を通す。

```json
{
  "format": "likex.calendar",
  "version": 1,
  "id": "calendar-1",
  "title": "チームの予定",
  "timeZone": "Asia/Tokyo",
  "events": []
}
```

予定は `id`、`title`、`allDay`、`start`、`end` と任意の `description`、`location`、`color` を持つ。終日予定は日付文字列、時刻指定予定はZまたは明示的なオフセット付きISO日時を使う。endは排他的。`timeZone` は表示・ローカル入力のIANAタイムゾーンで、変更しても保存済みの時刻指定予定の瞬間は変わらない。

未知属性、重複ID、不正日時、逆転した期間、未対応バージョンを拒否する。整形済みJSONはUTF-8で5 MiB以下、予定は10,000件まで。既存ID・予定順・日時を保存だけで作り直さない。選択日・表示モード・履歴・未保存状態は保存対象外。

型の構造は [calendar.schema.json](calendar.schema.json)、コマンドは [commands.schema.json](commands.schema.json) と [操作例](commands.md) を参照する。Schemaで構造を確認した後も、実行時APIで日時・参照・サイズを検証する。
