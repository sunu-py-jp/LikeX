# 表示倍率の変更

[利用ガイドへ戻る](./README.md)

グリッドの表示倍率を25〜200％で変更できます。右下の「−」「＋」やスライダーを使い、倍率のボタンを押すと100％に戻ります。スライダーの中央が100％です。グリッド上ではCtrlを押しながらホイールを動かす操作と、トラックパッドのピンチでも拡大・縮小できます。

倍率はコンポーネント内の全シートで共有する表示設定です。読み取り専用でも変更でき、セルの値・行高・列幅や保存JSONは変えません。Undo／Redo、未保存状態、`onChange` の対象にもなりません。

## 初期倍率

`initialZoom?: number` にパーセント値を渡します。省略時は100です。25〜200の範囲に収め、小数は整数へ四捨五入します。`NaN` や `Infinity` など有限でない数値は100として扱います。

```tsx
import Spreadsheet from "@likex/spreadsheet";
import "@likex/spreadsheet/styles.css";

export function EnlargedSheet() {
  return <Spreadsheet initialZoom={125} style={{ height: 560 }} />;
}
```

`initialZoom` はマウント時に一度だけ読み込みます。表示中に変更する場合は、次のHandle APIを使います。

## 外部から倍率を変更する

| API | 動作 |
| --- | --- |
| `getZoom(): number` | 現在のパーセント値を取得 |
| `setZoom(percent: number): boolean` | 25〜200の整数へ補正して設定。受け付けたら `true`。有限でない数値、または `features.zoom: false` なら `false` |

```tsx
"use client";

import { useRef } from "react";
import Spreadsheet, { type SpreadsheetHandle } from "@likex/spreadsheet";
import "@likex/spreadsheet/styles.css";

export function ZoomControls() {
  const sheet = useRef<SpreadsheetHandle>(null);
  return <>
    <button onClick={() => sheet.current?.setZoom(150)}>150％で表示</button>
    <button onClick={() => sheet.current?.setZoom(100)}>100％に戻す</button>
    <Spreadsheet ref={sheet} style={{ height: 560 }} />
  </>;
}
```

これらはブックを書き換えるコマンドではないため、`execute` や編集許可の取得は不要です。同じ倍率の指定でも `setZoom` は `true` を返しますが、変更イベントは発生しません。

## 変更通知と操作の無効化

実際に倍率が変わったときだけ、`onEvent` へ `{ type: "zoom-change", zoom, previousZoom }` を通知します。どちらの数値もパーセント値です。必要なら親アプリがこのイベントを使って表示設定を記録できます。

```tsx
<Spreadsheet
  initialZoom={125}
  onEvent={event => {
    if (event.type === "zoom-change") {
      console.log(event.previousZoom, event.zoom);
    }
  }}
  style={{ height: 560 }}
/>;
```

`features={{ zoom: false }}` は右下の倍率操作とグリッド上のCtrl＋ホイール・ピンチ、`setZoom` を無効にします。現在の倍率と `initialZoom` の表示は維持します。倍率を100％へ戻してから固定したい場合は、操作を無効にする前に `setZoom(100)` を呼びます。
