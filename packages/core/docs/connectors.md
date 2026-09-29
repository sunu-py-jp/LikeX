# 線の端点と接続点

SlideとSpreadsheetなどで使う、端点・8接続点・座標変換の純粋な型と関数です。React・DOM・通信には依存しません。実際の文書編集、選択、吸着プレビュー、履歴、参照の保持は各モジュールが担当します。

```ts
import { getConnectorPortPoint, findNearestConnectorPort, getConnectorBounds } from "@likex/core/connectors";
import type { ConnectorEndpoint, ConnectorBox } from "@likex/core/connectors";

const box: ConnectorBox = { x: 100, y: 60, width: 200, height: 100, rotation: 90 };
const point = getConnectorPortPoint(box, "top"); // { x: 250, y: 110 }
const end: ConnectorEndpoint = { ...point, binding: { targetId: "diagram-node", port: "top" } };
const bounds = getConnectorBounds({ x: 20, y: 110 }, end);
const snap = findNearestConnectorPort({ x: 247, y: 110 }, [{ id: "diagram-node", box }], 12);
// snap: { point: { x: 250, y: 110 }, binding: { targetId: "diagram-node", port: "top" }, distance: 3 }
```

## 座標と型

`ConnectorPoint` は `{ x, y }`、`ConnectorEndpoint` は `{ x, y, binding? }`、`ConnectorBinding` は `{ targetId, port }` です。座標は表示倍率を適用する前の文書座標です。文書の原点やシートの行・列アンカーとの変換は利用モジュールが決めます。

`ConnectorArrowhead` と `CONNECTOR_ARROWHEADS` は `none / triangle / openArrow / diamond / oval / stealth` を定義します。`isConnectorArrowhead` で検証でき、両端の装飾の保存と描画は各モジュールが担当します。DrawingMLの `arrow` は `openArrow` に対応し、それ以外は同名です。

`ConnectorBox` は `{ x, y, width, height, rotation?, flipX?, flipY? }` です。`x/y` は変形前の左上、`rotation` は中心を基準に画面上で時計回りの度数です。左右・上下反転をローカル座標へ適用してから回転します。幅・高さは0以上で、水平線や垂直線に必要な0幅・0高さを許可します。

`ConnectorPort` と公開配列 `CONNECTOR_PORTS` は次の順序を固定しています。`isConnectorPort(value)` で未知の値を検証できます。

| port | 変形前の位置 |
| --- | --- |
| `top` | 上辺の中央 |
| `topRight` | 右上隅 |
| `right` | 右辺の中央 |
| `bottomRight` | 右下隅 |
| `bottom` | 下辺の中央 |
| `bottomLeft` | 左下隅 |
| `left` | 左辺の中央 |
| `topLeft` | 左上隅 |

省略時の接続点は外接矩形上の位置です。任意の `ConnectorOutline` で図形の輪郭へ合わせられます。

- `{ type: "ellipse" }`: 上下左右と正規化座標の45°方向にある楕円の輪郭上の点。
- `{ type: "polygon", points: [{ x, y }, ...] }`: 0〜1で正規化した単純多角形。中心から各方向へ進んだ最初の辺との交点。3点以上、非ゼロ面積、外接矩形の中心を内部か辺上に含む形状を指定します。
- `{ type: "roundedRect", radiusX, radiusY }`: 各軸0〜0.5で正規化した角丸半径。角の接続点はその楕円弧の45°位置になります。

輪郭の計算後に幅高さ・反転・回転を適用します。多角形の中心が辺上の場合、外向きの接続点は中心の境界位置、内向きは次の辺、辺に沿う方向は正方向の頂点まで進みます。0サイズや細長い図形も扱えます。

名前は回転・反転前のローカル位置を表すため、回転後も同じ接続先を追従できます。Officeの既定図形の接続点番号は図形により異なるため、この配列の添字を既定図形の番号として直接使いません。独自の8接続点を同じ順序で保存する場合に限り、添字と接続点番号を一致させられます。

## 計算関数

| 関数 | 戻り値・挙動 |
| --- | --- |
| `getConnectorPortPoint(box, port, outline?)` | 回転と反転を適用した文書座標 `{ x, y }` |
| `getConnectorPortPoints(box, outline?)` | `CONNECTOR_PORTS` 順の `{ port, point }[]` |
| `connectorLocalToWorld(point, box)` | 変形前の左上を原点とするローカル座標から文書座標へ変換 |
| `connectorWorldToLocal(point, box)` | 上記の逆変換。外接矩形の外の点も変換可能 |
| `getConnectorBounds(start, end)` | 2端点の `{ x, y, width, height }`。端点の向きは入れ替えず、余白は追加しない |
| `findNearestConnectorPort(point, targets, maxDistance)` | 最短の `{ point, binding, distance }`。対象がなければ `undefined` |

`targets` は `{ id, box, outline? }[]`、しきい値は文書座標の距離です。表示上12px以内で吸着させる場合、利用UIで `12 / zoom` のように表示倍率を除いて渡します。距離がしきい値と等しい点も対象にし、同距離なら対象配列順、次に `CONNECTOR_PORTS` 順で決めます。非表示・接続不可・自分自身などの対象除外も利用側で行います。

関数は入力を変更しません。非有限数・負の幅高さ・不正な回転や反転・未知のport・負のしきい値・空の対象IDは `TypeError`、計算結果が有限数に収まらない場合は `RangeError` になります。0サイズの矩形は受け入れ、重なる接続点も省略しません。

接続先の移動・サイズ変更・回転時は、保存済み `binding` を使って `getConnectorPortPoint` を再計算します。接続先の削除、複製時のID置換、切断、循環接続、保存形式の検証はドメイン固有の処理なので、各モジュールの公開モデルAPIで扱います。

## Office用の8接続点

`@likex/core/ooxml` の `createOfficeConnectorGeometry(shapeTag, outline?)` は、輪郭の標準DrawingMLパスと8接続点を持つ `a:custGeom` を返します。座標guideが実際の図形の幅・高さへ比例するので、パスの座標単位を接続点の実座標と混同しません。`shapeTag` は48文字以内の英数字識別子（先頭英字、以降は `_` も可）です。

`readOfficeConnectorShapeTag(custGeom)` は標準 `gdLst` のバージョン識別guideと8点の存在を確認し、元のtagを返します。各モジュールでtagを自分の対応図形と照合します。外部画像参照やスクリプトの実行、任意のguide数式の評価はしません。

`getOfficePresetConnectorPort(preset, index)` は、変更されていない既定のrect/roundRect/diamond/ellipse/triangleと矢印の左右端の接続点番号を変換します。未対応の番号は `undefined` です。調整値つきの図形や任意のcustom geometryには使わず、利用側で端点を維持して未対応の接続を通知します。番号順は[Apache POIのDrawingML図形定義](https://raw.githubusercontent.com/apache/poi/trunk/poi/src/main/resources/org/apache/poi/sl/draw/geom/presetShapeDefinitions.xml)に沿います。

モデル層で使う場合は純粋な専用入口 `@likex/core/connectors` を読み込みます。この入口はReact・DOM・ブラウザーイベント・Office処理へ依存しません。通常の `@likex/core` からも同じ型・関数を公開します。コピー導入では `core/connectors.ts` を参照します。
