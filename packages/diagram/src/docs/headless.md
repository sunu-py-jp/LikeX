# JSONモデル・コマンド

`@likex/diagram/model`はReact・DOM・ネットワークなしで操作できます。

```ts
import { createDiagram, executeDiagramCommands, getDiagramNode,
  serializeDiagram, exportDiagramSvg } from "@likex/diagram/model";

let model = createDiagram({ title: "申請フロー" });
model = executeDiagramCommands(model, [
  { type: "node.add", node: { id: "start", shape: "ellipse", text: "開始", x: 0, y: 0 } },
  { type: "node.add", node: { id: "review", text: "確認", x: 280, y: 0 } },
  { type: "edge.add", edge: { sourceId: "start", targetId: "review", label: "次へ" } },
]);
const node = getDiagramNode(model, "review"); // DiagramNode | undefined
const json = serializeDiagram(model); // string
const svg = exportDiagramSvg(model); // string
```

モデルは`{ format: "likex.diagram", version: 1, id, title, nodes, edges }`です。ノードは`id, shape, text, x, y, width, height, fill, stroke, textColor`、接続線は`id, sourceId, targetId, label, color`を保持します。配列順が描画順です。座標とサイズはキャンバス上のピクセル、色は`#RRGGBB`です。

| コマンド | パラメーター |
| --- | --- |
| `node.add` | `node: Partial<DiagramNode>`。省略IDは新規発行 |
| `node.update` | `id, patch`。ID以外のノード属性を更新 |
| `node.remove` | `ids`。つながっている接続線も削除 |
| `nodes.move` | `ids, dx, dy` |
| `nodes.align` | `ids, alignment`。left/center/right/top/middle/bottom |
| `edge.add` | `edge`。sourceIdとtargetIdは必須 |
| `edge.update` | `id, patch`。ID以外の接続線属性を更新 |
| `edge.remove` | `ids` |
| `diagram.update` | `title` |
| `diagram.replace` | `model` |

`executeDiagramCommands()`は更新後の`DiagramModel`を返します。入力は変更しません。一括処理の途中で不正な参照・値があれば例外となり、一部分だけを反映したモデルは返しません。重複ID、存在しない接続先、自己接続、非有限数、上限超過を拒否します。

`createDiagramNode()`、`createDiagramEdge()`で初期属性を補完できます。`normalizeDiagram()`で外部データを検証し、`parseDiagram()`でJSON文字列から復元します。`getDiagramEdge()`は`DiagramEdge | undefined`、`getDiagramBounds()`は`{x,y,width,height}`、`getDiagramEdgeGeometry(source,target)`は`{start,end,label}`の座標を返します。

上限は5,000ノード・10,000接続、JSON 8 Mi文字です。大規模な図は表示コストが増えるため、利用する端末で実データを確認してください。保存でIDや日時は更新せず、同じモデルは同じJSON文字列になります。
