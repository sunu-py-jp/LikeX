# ドラッグの表示計算

各UIのドラッグ操作に使う、DOMやReactに依存しない計算関数です。実際のスクロール対象、プレビュー表示、ドロップ確定は各コンポーネントが担当します。保存対象のデータを編集するAPIではありません。

```ts
import { getDragScrollDelta, getDragInsertionIndex } from "@likex/core";

const delta = getDragScrollDelta(
  { x: 400, y: 490 }, // ビューポート内のポインタ座標
  { left: 100, top: 100, right: 600, bottom: 500 },
  16, // 前フレームからの経過ミリ秒
  { axes: "y" },
);
// delta: { x: number, y: number } — このフレームで動かすCSS px

const index = getDragInsertionIndex(180, [
  { start: 100, end: 160 },
  { start: 200, end: 320 },
]); // 1: 2つの項目の間
```

## 自動スクロール

`getDragScrollDelta(point, bounds, elapsedMs = 16, options?)` は `{ x, y }` を返します。`options` は `edge`（端から反応する幅、既定48px）、`maxSpeed`（毎秒の最大CSS px、既定720）、`axes: "both" | "x" | "y"`（既定both）です。端へ近づくほど速度が上がり、領域の外では最大速度を保ちます。経過時間は0〜64msに制限し、休止後の大きな飛びを防ぎます。

スクロールの実行側はrequestAnimationFrame等を使い、ポインタが止まった状態でも更新します。ドロップ・Escape・キャンセル・アンマウントで停止してください。キャンバス座標へ変換する場合は表示倍率を考慮します。

## 挿入位置

`getDragInsertionIndex(position, items)` は0〜items.lengthの境界番号を返します。itemsは表示順の `{ start, end }[]`。各項目の中点を境に前後を決めるため、高さや幅が異なる項目も扱えます。移動元の項目を除いた配列を渡すと、移動後の挿入indexとして利用できます。
