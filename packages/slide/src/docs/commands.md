# JSONと画面なしの操作API

`@likex/slide/model` はReactやDOMなしで利用できます。GUIも同じコマンド処理と編集セッションを使います。永続データに関数・Blob・DOM要素は含まれません。

## JSONの構造

```ts
type SlideDeck = {
  version: 1;
  id: string;
  title: string;
  width: number;
  height: number;
  slides: Slide[];
};
type Slide = {
  id: string;
  name: string;
  background: string;
  notes: string;
  elements: SlideElement[];
};
```

座標・寸法は96dpiのピクセル、角度は時計回りの度数、色はsRGBの16進数です。GUIではカラーピッカーを使います。要素は `type: "text" | "shape" | "image"` で区別し、共通の `id`、`name`、`x`、`y`、`width`、`height`、`rotation`、`opacity`、`locked` を持ちます。

## テキストを追加する

```ts
import { createSlideDeck, applySlideCommands, serializeSlideDeck } from "@likex/slide/model";

const deck = createSlideDeck({ title: "月次報告" });
const result = applySlideCommands(deck, {
  type: "element.add",
  slideId: deck.slides[0].id,
  element: { type: "text", id: "heading", text: "売上実績",
    x: 80, y: 60, width: 900, height: 100, fontSize: 48, color: "#25364a" },
});
const json = serializeSlideDeck(result.deck);
```

戻り値は `{ deck: SlideDeck, slideId?: string, elementIds: string[], changed: boolean }` です。元のJSONは変更しません。配列で複数のコマンドを渡すとまとめて検証し、途中に不正な操作があれば全体を適用しません。

## 操作一覧

| `type` | 主な引数 |
| --- | --- |
| `deck.rename` | `title` |
| `deck.resize` | `width`, `height` |
| `slide.add` | `afterId?`, `slide?: Partial<Slide>` |
| `slide.delete` / `slide.duplicate` | `slideId` |
| `slide.move` | `slideId`, `index`（0始まりの移動先） |
| `slide.update` | `slideId`, `patch: { name?, background?, notes? }` |
| `element.add` | `slideId`, `element` |
| `element.update` | `slideId`, `elementId`, `patch` |
| `element.delete` / `element.duplicate` | `slideId`, `elementIds` |
| `element.order` | `slideId`, `elementIds`, `direction: "front" / "back" / "forward" / "backward"` |

```ts
const next = applySlideCommands(result.deck, [
  { type: "element.update", slideId: deck.slides[0].id, elementId: "heading", patch: { text: "修正した見出し", bold: true } },
  { type: "slide.add", afterId: deck.slides[0].id, slide: { name: "詳細" } },
]);
```

## 取得と復元

| API | 戻り値 |
| --- | --- |
| `createSlideDeck(input?)` | 既定値を補った `SlideDeck` |
| `createSlideElement(input)` | 既定値を補った `SlideElement` |
| `getSlide(deck, slideId)` | `Slide` または `undefined` |
| `getElement(deck, slideId, elementId)` | `SlideElement` または `undefined` |
| `normalizeSlideDeck(value)` | 検証済みの `SlideDeck`。不正な値は例外 |
| `parseSlideDeck(json)` | JSON文字列を検証した `SlideDeck` |
| `serializeSlideDeck(deck)` | JSON文字列 |

`deck.slides` が順序付きのスライド一覧、`slide.elements` が背面から前面への要素一覧です。画像には `src`（data URL）と `alt`、テキストには `text` などの書式情報があります。取得後に編集する場合もコマンドを使ってください。

## 履歴を持つセッション

```ts
import { createSlideSession } from "@likex/slide/model";
const session = createSlideSession(deck);
session.execute({ type: "deck.rename", title: "改訂版" });
session.undo();
session.redo();
session.markSaved();
const { deck: current, dirty, canUndo, canRedo } = session.getSnapshot();
```

`subscribe(listener)` は解除関数を返します。`replace(deck)` は読み込みをUndoできる変更として扱い、`replace(deck, { saved: true })` は別の保存済み資料として履歴も初期化します。`discard()` は保存時点へ戻し履歴を消します。`markSaved()` は履歴を消しません。

## 表示中のコンポーネントを操作する

```tsx
const ref = useRef<SlideHandle>(null);
<LikeSlide ref={ref} initialDeck={deck} onSave={saveDeck} />;

const result = await ref.current?.execute({ type: "element.add",
  slideId: deck.slides[0].id, element: { type: "text", text: "外部から追加" } });
```

`SlideHandle` の `getDeck()`、`getSelection()`、`select(selection)`、`execute()`、`undo()`、`redo()`、`save()`、`discard()`、`importPptx()`、`exportPptx()` が使えます。`execute` は拒否時に `null`、`undo` / `redo` / `save` は成功をbooleanで返します。`execute` と履歴操作は編集許可・読み取り専用・機能設定を通ります。ヘッドレスAPIには認証の責務はありません。

## データ量と画像

モデルは最大500スライド、1スライド1,000要素、資料全体10,000要素です。画像はPNG / JPEG / GIF / WebPのdata URLのみを受け付けます。上限値は公開定数 `SLIDE_LIMITS` で確認できます。外部から渡されたJSONも `parseSlideDeck` で検証してから利用してください。
