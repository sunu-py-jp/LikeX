# JSONモデル・コマンド

`@likex/whiteboard/model`はReact・DOM・ネットワークなしで操作できます。

```ts
import { createWhiteboard, executeWhiteboardCommands,
  getWhiteboardElement, serializeWhiteboard } from "@likex/whiteboard/model";

let model = createWhiteboard({ title: "検討メモ" });
model = executeWhiteboardCommands(model, [
  { type: "element.add", element: { id: "note", kind: "sticky", text: "次に試すこと", x: 80, y: 100 } },
  { type: "element.add", element: { id: "caption", kind: "text", text: "アイデア", x: 80, y: 30 } },
  { type: "elements.move", ids: ["note"], dx: 40, dy: 0 },
]);
const note = getWhiteboardElement(model, "note"); // WhiteboardElement | undefined
const json = serializeWhiteboard(model);
```

モデルは`{ format: "likex.whiteboard", version: 1, id, title, elements }`です。全オブジェクトは`id, kind, x, y, width, height`を持ちます。付箋・テキスト・四角・楕円は`text, fill, stroke, textColor, fontSize`を、画像は`src, alt`を持ちます。`src`は検証済みPNG・JPEGのdata URLです。

| コマンド | パラメーター |
| --- | --- |
| `element.add` | `element`。kindはsticky/text/rectangle/ellipse/image。画像以外の未指定kindはsticky |
| `element.update` | `id, patch`。ID・種類以外の属性を変更 |
| `element.remove` | `ids` |
| `elements.move` | `ids, dx, dy` |
| `elements.align` | `ids, alignment`。left/center/right/top/middle/bottom |
| `elements.order` | `ids, position`。front/back。選択内の順番は維持 |
| `whiteboard.update` | `title` |
| `whiteboard.replace` | `model` |

`executeWhiteboardCommands()`は更新後の`WhiteboardModel`を返します。入力を変更せず、複数コマンドも全体を検証して適用します。失敗時は例外になり、一部だけの変更を返しません。

`createWhiteboardElement()`で初期値を補完できます。画像の追加時は幅か高さだけを指定すると、実画像の縦横比から残りを補完します。更新コマンドの`patch`は指定された属性だけを変えるため、既存画像の幅・高さを変更する場合は両方を指定してください。SVGでは実画像の比率を保って指定枠内に表示します。

`normalizeWhiteboard()`は外部オブジェクトの検証、`parseWhiteboard()`はJSONの復元、`serializeWhiteboard()`は安定したJSON保存を担当します。`exportWhiteboardSvg()`はSVG文字列、`getWhiteboardBounds()`は`{x,y,width,height}`を返します。

上限は5,000オブジェクト、画像1件8 MiB・画像合計24 MiB、JSON 40 Mi文字です。画像の実行形式や外部URL、不正な座標・色、重複IDを拒否します。ズームによる仮想化は行っていないため、大量配置は利用する端末で確認してください。
