# @likex/calendar

月・週・日のグリッドで予定を表示・編集するReactカレンダーです。時刻指定・終日予定、ドラッグ移動・上下のリサイズ、クイック入力・詳細設定、右クリック、Undo/Redo、JSONの読み込み・出力に対応します。保存、認証、共有、通知配信は利用側が担当します。

```tsx
"use client";
import LikeCalendar, { createCalendar, serializeCalendar } from "@likex/calendar";
import "@likex/calendar/styles.css";

export default function CalendarPage() {
  return <LikeCalendar initialCalendar={createCalendar({ timeZone: "Asia/Tokyo" })}
    onSave={async calendar => {
      const response = await fetch("/api/calendar", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: serializeCalendar(calendar),
      });
      if (!response.ok) throw new Error("保存できませんでした");
    }} style={{ height: 760 }} />;
}
```

`onSave` を省略すると閲覧専用です。React/React DOM 19.2.6以降の19系を使用します。Tailwindは不要です。初期データの切り替えはReactの `key` を変更してください。

- [導入とコピー](src/docs/getting-started.md)
- [表示と予定の編集](src/docs/editing.md)
- [保存・編集許可・操作API](src/docs/lifecycle.md)
- [画面なしでJSONを操作](src/docs/headless.md)
- [LLM向けスキル](skills/likex-calendar/SKILL.md)

標準ファイルは `.json`、識別子は `likex.calendar`、バージョンは1です。繰り返し予定、招待・参加者、ICS/CalDAV/Google Calendar同期は未対応です。対応しないフィールドを含むファイルは黙って取り込まず検証エラーにします。デモは `/calendar` です。

配布は `npm run pack:library -- --module calendar`。生成したCoreとCalendarのtarballを利用先へ導入します。npmレジストリに公開済みとは扱いません。

```bash
npm install ./likex-core-0.1.0.tgz ./likex-calendar-0.1.0.tgz
```

[MITライセンス](LICENSE)。第三者ライセンス通知も保持してください。
