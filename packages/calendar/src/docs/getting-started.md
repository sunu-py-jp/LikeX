# 導入と初期表示

LikeCalendarはReact 19のクライアントコンポーネントです。パッケージのdefault exportと `LikeCalendar` named exportは同じコンポーネントです。

```tsx
"use client";
import LikeCalendar, { createCalendar } from "@likex/calendar";
import "@likex/calendar/styles.css";

const initialCalendar = createCalendar({ title: "チームの予定", timeZone: "Asia/Tokyo" });
export default function Example() {
  return <LikeCalendar initialCalendar={initialCalendar} initialView="week"
    initialDate="2026-09-22" weekStartsOn={1} onSave={async calendar => calendar}
    primaryColor="#2563eb" colorMode="system" style={{ height: 720 }} />;
}
```

`initialCalendar`、`initialDate`、`initialView` は初回だけ使います。別の保存対象を開く場合はReactの `key` を変えて再マウントし、進行中の処理をキャンセルします。日時の初期値はカレンダーのタイムゾーンにおける当日です。タイムゾーンの既定値はUTCです。

`onSave` がない場合と `readOnly` がtrueの場合は閲覧専用です。ダウンロード、表示切り替え、予定の詳細表示は利用できます。

`primaryColor`、`colorMode: "light" | "dark" | "system"`、`className`、`style`、`aria-label` を設定できます。CSSは `.lxc-` に限定され、ホストにTailwindの導入を要求しません。

## ソースコピー

`packages/calendar/src` と `packages/core/src` を、それぞれ `components/likex/calendar` と `components/likex/core` のような兄弟フォルダへコピーします。Calendarの `core.ts` の参照を `export * from "../core";` に変更します。`browser.ts` は `export * from "../core/browser";` へ変更し、React、React DOM、lucide-reactを利用先に導入します。モデルは `calendar/model-entry`、UIは `calendar`、スタイルは `calendar/styles.css` から読み込みます。LICENSEとTHIRD_PARTY_NOTICES.mdを保持してください。

Next.jsのサーバーでJSONを準備する場合は `@likex/calendar/model` を使用し、保存コールバックはクライアント側で定義します。モデル入口はReact・DOMに依存しません。
