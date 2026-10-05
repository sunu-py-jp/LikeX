# リボンの表示と非表示

[利用ガイドへ戻る](./README.md)

リボンのタブと操作ボタンを4通りに切り替えられます。表示だけを変えるため、セルの編集許可や機能設定とは独立しています。タイトルバー・数式バー・シートタブ・ステータスバーはそのまま残ります。

| `SpreadsheetRibbonDisplayMode` | 表示方法 | 操作 |
| --- | --- | --- |
| `expanded`（既定） | 常に表示 | タブと操作ボタンを常時表示します。 |
| `tabs` | タブのみ表示 | 操作ボタンを折りたたみます。タブを押すと操作ボタンを一時的に重ねて表示します。 |
| `autoHide` | 自動非表示 | タブと操作ボタンを隠し、上部の小さな再表示ボタンから一時的に重ねて表示します。 |
| `hidden` | 完全に非表示 | タブ・操作ボタン・再表示ボタンをすべて隠します。外側のpropsまたはHandleから解除します。 |

画面内のリボン表示設定には、常時表示・タブのみ・自動非表示の3つを用意しています。`hidden` は親アプリだけが設定します。完全非表示から戻す必要がある場合は、親アプリ側にボタンやセレクターを配置してください。

一時表示は外側のクリック、Escape、リボン外へのフォーカス移動で閉じます。グリッドの高さは変えず、セルの上へ重ねて表示します。Spreadsheet内の `Ctrl + F1` は常時表示とタブのみを切り替え、自動非表示の場合は常時表示へ戻します。完全非表示の場合はこのショートカットでも開きません。

## 初期表示を指定する

```tsx
import Spreadsheet from "@likex/spreadsheet";
import "@likex/spreadsheet/styles.css";

<Spreadsheet
  initialWorkbook={workbook}
  initialRibbonDisplayMode="hidden"
  style={{ height: 560 }}
/>;
```

`initialRibbonDisplayMode` はマウント時にだけ読み込み、省略時は `expanded` です。表示中の変更には制御用propまたはHandleを使います。`ribbonDisplayMode` も指定した場合は、そちらを優先します。

リボンを隠しても編集は無効になりません。閲覧用にする場合は `readOnly` を併用します。`onSave` を省略した場合も読み取り専用です。`features` の各機能設定も従来どおり適用されます。

## 親アプリから表示を制御する

```tsx
"use client";

import { useState } from "react";
import Spreadsheet, { type SpreadsheetRibbonDisplayMode } from "@likex/spreadsheet";

export function SheetView() {
  const [mode, setMode] = useState<SpreadsheetRibbonDisplayMode>("hidden");
  return <>
    <button onClick={() => setMode(current => current === "hidden" ? "expanded" : "hidden")}>
      {mode === "hidden" ? "リボンを表示" : "リボンを隠す"}
    </button>
    <Spreadsheet ribbonDisplayMode={mode} onRibbonDisplayModeChange={setMode}
      style={{ height: 560 }} />
  </>;
}
```

`ribbonDisplayMode` は親アプリが管理する現在値です。画面内の操作やHandleが変更を要求すると `onRibbonDisplayModeChange(mode)` を呼びます。親が新しい値をpropへ反映するまでは表示を変更しません。コールバックなしで制御用propを渡すと表示方法を固定できます。一時表示は指定した表示方法の範囲内で利用できます。

制御用propを省略した場合は内部で表示方法を管理し、変更時には同じコールバックで通知します。初期表示、同じ値の要求、親からのprop変更ではコールバックを呼びません。

## Handleで取得・変更する

| API | 戻り値・動作 |
| --- | --- |
| `getRibbonDisplayMode(): SpreadsheetRibbonDisplayMode` | 現在反映されている表示方法を取得します。一時的に開いているかどうかではありません。 |
| `setRibbonDisplayMode(mode): boolean` | 変更を受け付けると `true`。不正な値、同じ表示方法、制御用propがありコールバックがない場合は `false`。 |

```tsx
import { useRef } from "react";
import Spreadsheet, { type SpreadsheetHandle } from "@likex/spreadsheet";

export function RibbonControls() {
  const spreadsheet = useRef<SpreadsheetHandle>(null);
  return <>
    <button onClick={() => spreadsheet.current?.setRibbonDisplayMode("expanded")}>リボンを表示</button>
    <button onClick={() => spreadsheet.current?.setRibbonDisplayMode("hidden")}>リボンを隠す</button>
    <Spreadsheet ref={spreadsheet} initialRibbonDisplayMode="hidden" style={{ height: 560 }} />
  </>;
}
```

制御用propを使う場合、`setRibbonDisplayMode` の `true` は変更要求を通知したことを表します。`getRibbonDisplayMode` は親がpropを更新するまで元の表示方法を返します。

表示方法と一時表示はコンポーネントの表示状態です。SPON／XLSX、モデルコマンド、CLIには保存・反映しません。表示変更によって編集許可の要求、Undo／Redo、未保存状態、`onChange` は発生しません。利用者ごとの設定を記録する場合は親アプリが管理してください。
