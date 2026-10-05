# リボンの表示モード

LikeSlideは、リボンを常時表示・タブのみ・自動非表示・完全非表示に切り替えられます。Spreadsheet、LikeDocumentと同じ4種類です。

| `SlideRibbonDisplayMode` | 表示 |
| --- | --- |
| `expanded` | タブとコマンドを常に表示。既定値 |
| `tabs` | タブだけを表示。タブを押すとコマンドを一時表示 |
| `autoHide` | リボンを隠し、`···` ボタンから一時表示 |
| `hidden` | タブ・コマンド・再表示ボタンをすべて非表示 |

タイトルバー・スライド一覧・ノート・ステータスバーは別の領域です。一時表示するリボンはスライド領域へ重ねるため、開閉のたびにキャンバスの大きさは変わりません。外側のクリック・フォーカス移動・Escapeで閉じます。Escapeではタブ、または自動非表示の再表示ボタンへフォーカスを戻します。

## 初期状態を指定する

```tsx
<LikeSlide initialDeck={deck} initialRibbonDisplayMode="hidden"
  onSave={saveDeck} style={{ height: 720 }} />
```

`initialRibbonDisplayMode` は初回だけ読み取ります。指定がなければ `expanded` です。完全非表示から戻せるようにしたい場合は、親側のボタンからpropsかrefで切り替えてください。内部の表示メニューには、完全非表示以外の3種類を用意しています。

## 外側で状態を管理する

```tsx
import { useState } from "react";
import LikeSlide, { type SlideRibbonDisplayMode } from "@likex/slide";

const [mode, setMode] = useState<SlideRibbonDisplayMode>("tabs");
<LikeSlide initialDeck={deck} onSave={saveDeck}
  ribbonDisplayMode={mode} onRibbonDisplayModeChange={setMode} />;
```

`ribbonDisplayMode` は制御用の値です。UI・refからの変更要求を `onRibbonDisplayModeChange` へ通知し、親が値を変更すると反映します。コールバックを省略した制御モードでは、UI・refからの変更を受け付けません。制御用の値を後から省略すると、最後に親が指定したモードを維持したまま内部管理へ移ります。

## refから操作する

```tsx
const ref = useRef<SlideHandle>(null);
<LikeSlide ref={ref} initialDeck={deck} initialRibbonDisplayMode="hidden" />;
ref.current?.getRibbonDisplayMode();
ref.current?.setRibbonDisplayMode("expanded");
```

`setRibbonDisplayMode(mode): boolean` は有効な変更要求を受け付けると `true` を返します。制御モードでは、親が変更を確定した意味ではありません。同じ値・不正な値・コールバックのない制御モード・アンマウント後の操作は `false` です。

タブのダブルクリックと、エディター内にフォーカスがあるときの `Ctrl+F1` で常時表示とタブのみ表示を切り替えます。自動非表示からの `Ctrl+F1` は常時表示へ戻し、完全非表示では何もしません。タブ間は左右キー・Home・Endでも移動できます。

表示設定なので、読み取り専用でも操作でき、編集許可の要求・未保存状態・Undo/Redoには影響しません。表示モードの変更で入力途中の文字や読み込みを破棄せず、リボンのコントロールもマウントしたまま保持します。`.slon` やPowerPointファイルに保存する値ではなく、モデルコマンドやCLIでの切り替えはありません。
