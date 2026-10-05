# リボンの表示

LikeDocumentのリボンは、タブとコマンドを表示する範囲を利用側から指定できます。文書の内容とは別の画面状態です。読み取り専用でも変更でき、編集許可・未保存状態・Undo/Redoには影響しません。

| `DocumentRibbonDisplayMode` | 表示 |
| --- | --- |
| `expanded` | タブとコマンドを常に表示。既定値 |
| `tabs` | タブのみ表示。タブを選ぶとコマンドを一時表示 |
| `autoHide` | タブも隠し、上部の「···」からリボンを一時表示 |
| `hidden` | タブ・コマンド・再表示ボタンを完全に非表示。外側のpropsまたはrefで戻す |

## 初期状態を指定する

```tsx
<LikeDocument initialDocument={document}
  initialRibbonDisplayMode="hidden"
  onSave={saveDocument} />
```

`initialRibbonDisplayMode` はマウント時に一度だけ読みます。あとから変更する場合は `ribbonDisplayMode` またはrefを使ってください。タイトルバー・本文・ステータスバーはこの設定の対象外です。

## 外側で表示を管理する

```tsx
import { useState } from "react";
import { LikeDocument, type DocumentRibbonDisplayMode } from "@likex/document";

function Viewer() {
  const [mode, setMode] = useState<DocumentRibbonDisplayMode>("hidden");
  return <>
    <button onClick={() => setMode(mode === "hidden" ? "expanded" : "hidden")}>
      リボンの表示を切り替える
    </button>
    <LikeDocument ribbonDisplayMode={mode} onRibbonDisplayModeChange={setMode} />
  </>;
}
```

`ribbonDisplayMode` 指定時はその値が表示を決めます。画面内の操作やrefによる変更要求は `onRibbonDisplayModeChange` に届き、利用側がpropsを更新すると反映されます。コールバックがない場合は表示を固定します。初期表示とpropsによる同期では通知しません。制御を解除すると最後に表示したモードを引き継ぎます。

## refで操作する

```tsx
import { useRef } from "react";
import { LikeDocument, type DocumentHandle } from "@likex/document";

function Viewer() {
  const editor = useRef<DocumentHandle>(null);
  return <>
    <button onClick={() => editor.current?.setRibbonDisplayMode("expanded")}>リボンを表示</button>
    <LikeDocument ref={editor} initialRibbonDisplayMode="hidden" />
  </>;
}
```

`getRibbonDisplayMode()` は現在のモードを返します。`setRibbonDisplayMode(mode)` の戻り値は変更要求を受け付けた場合に `true` です。controlledの場合は利用側によるprops更新まで表示は変わりません。不正な値・同一モード・コールバックのないcontrolled・アンマウント後は `false` になります。

## 画面内の操作

リボン右端の「リボンの表示」から、常に表示・タブのみ・自動非表示を選べます。タブのダブルクリック、エディター内の `Ctrl+F1` でも常に表示とタブのみを切り替えられます。自動非表示中の `Ctrl+F1` は常に表示へ戻します。完全非表示は外側からのみ解除できます。

タブ上では左右キーとHome/Endで移動できます。一時表示中はリボンの外へのクリック・フォーカス移動、またはEscapeで閉じます。Escapeでは選択中のタブ、自動非表示では再表示ボタンへフォーカスを戻します。本文の選択や開いている挿入・書式ダイアログは表示モードの変更で破棄しません。

リボンの設定は `.dcon`・DOCXへ保存しません。画面なしのコマンドやCLIには追加せず、利用側の画面設定として保存・復元してください。
