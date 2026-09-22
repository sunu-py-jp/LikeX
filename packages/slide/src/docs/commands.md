# JSONと画面なしの操作API

`@likex/slide/model` はReactやDOMなしで利用できます。GUIも同じコマンド処理と編集セッションを使います。PPTXの読み込み・出力もこの入口から利用できます。永続データに関数・Blob・DOM要素は含まれません。

## JSONの構造

```ts
type SlideDeck = {
  format?: "likex.slide";
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
  animations?: SlideAnimationStep[];
};
```

座標・寸法は96dpiのピクセル、角度は時計回りの度数、色はsRGBの16進数です。GUIではカラーピッカーを使います。要素は `type: "text" | "shape" | "image"` で区別し、共通の `id`、`name`、`x`、`y`、`width`、`height`、`rotation`、`opacity`、`locked` を持ちます。

## `.slon` ファイル

LikeSlideの標準ファイル拡張子は `.slon` です。中身はUTF-8のJSONで、ZIPや暗号化形式ではありません。既存の `parseSlideDeck` / `serializeSlideDeck` をそのまま使います。

```ts
import { parseSlideDeck, serializeSlideDeck } from "@likex/slide/model";

const deck = parseSlideDeck(await file.text()); // 現在のSLON形式のJSON
const output = new File([serializeSlideDeck(deck)], "提案資料.slon", {
  type: "application/json",
});
```

保存形式は `format: "likex.slide"` と `version: 1` を持つ `SlideFile` です。要素は位置順に並び、各要素に `stackOrder` が必要です。`parseSlideDeck` はこれを、要素が描画順に並ぶ編集用 `SlideDeck` へ復元します。`onSave` やコマンドは編集用モデルを扱います。形式・バージョンの省略、`stackOrder` のない要素を持つ旧構造、version 2、不正なデータ構造は拒否します。

### ページと要素の保存順

`slides` はページ順です。各ページの `elements` は、上から下（`y`）、同じ高さなら左から右（`x`）に並べます。位置が同じ場合は重なり順で決めます。各要素の `stackOrder` に元の描画順を記録するため、ファイルの配列順が変わっても見た目の前後関係は保たれます。`stackOrder: 0` が最背面です。

```ts
type SlideFileElement = SlideElement & { stackOrder: number };
type SlideFilePage = Omit<Slide, "elements"> & { elements: SlideFileElement[] };
type SlideFile = Omit<SlideDeck, "format" | "version" | "slides"> & {
  format: "likex.slide";
  version: 1;
  slides: SlideFilePage[];
};
```

これらの型は `@likex/slide/model` からimportできます。保存データを操作APIへ渡す前に `parseSlideDeck` を呼んでください。復元後の `elements` は描画順で、`stackOrder` は編集用モデルには残りません。重複・欠落・範囲外の重なり順を持つファイルは拒否します。

### 毎回同じ書式で保存する

フィールド順、2スペースのインデント、LF改行を固定します。BOM・末尾の改行は付けず、文字列の中の改行やUnicodeは保持します。保存のためにIDや日時を生成しません。同じページ・要素・重なり順・データを `serializeSlideDeck` でUTF-8に保存すれば、毎回同じバイト列・ハッシュになります。

親の `onSave` でも `serializeSlideDeck` を使ってください。描画順から保存順への変換と、`stackOrder` の付与もこのAPIが担当します。内容が同じ場合のBlob書き込み省略は親側で管理します。

ファイルタブでは `.slon` を標準で書き出します。読み込み時は `.json` も選べますが、内容は同じSLON形式が必要です。読み込んだデータは下書きになり、Undoで元の資料へ戻せます。保存先の通信やファイル名は `onSave` を実装する親側が管理し、コールバックに渡る値は `SlideDeck` です。出力や読み込みだけでは `onSave` を呼びません。

ブラウザーやストレージが独自拡張子のMIMEタイプを推測できるとは限らないため、アップロード時も `Content-Type: application/json` を指定してください。既存のBlobの名前や保存場所をコンポーネントが変更することはありません。

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

`SlideHandle` の `getDeck()`、`getSlides()`、`getSlide()`、`getElements()`、`getElement()`、`getAnimations()`、`getSelection()`、`select(selection)`、`execute()`、`undo()`、`redo()`、`save()`、`discard()`、`importNative()`、`exportNative()`、`importPptx()`、`exportPptx()`、`exportImage()`、`exportImages()` が使えます。`execute` は拒否時に `null`、`undo` / `redo` / `save` は成功をbooleanで返します。`execute` と履歴操作は編集許可・読み取り専用・機能設定を通ります。ヘッドレスAPIには認証の責務はありません。

```ts
await ref.current?.importNative(file); // Blob / File または現在のSLON形式のJSON文字列
const native: Blob | undefined = await ref.current?.exportNative();
```

`importNative(input: string | Blob): Promise<void>` はGUIと同じ検証・編集許可・機能設定を通り、資料全体を未保存の下書きとして置き換えます。入力途中の編集と実行中の操作を先に確定するため、Undoで読み込み直前の内容と選択へ戻せます。不正なJSONは元の資料を維持し、エラーを画面の通知へ表示します。読み取り専用・機能無効・別の入出力処理中・編集許可の拒否では適用せず、既存の `importPptx` と同様に成功値や例外を返しません。成功時は `import` イベント、内容が変わった場合は `change` イベントも通知します。

`exportNative(): Promise<Blob>` は入力途中の編集と実行中の操作を待って、`application/json` のSLONを返します。ダウンロード・保存済み化・`onSave` の呼び出しは行いません。読み取り専用でも利用できますが、`features.export === false`、別の入出力処理中、アンマウント後はPromiseをrejectします。`getDeck({ includeAnimations: true })` は確定済みの元の値と定義を同期取得するため、入力途中の内容も含むファイルが必要なら `exportNative()` を使います。

GUIのファイル選択では未保存の置き換え確認を表示します。refによる読み込みでは確認ダイアログを出さないため、必要な確認は呼び出し側で行ってください。ネイティブとPPTXのいずれも読み込み・出力だけで `onSave` は呼びません。

## データ量と画像

モデルは最大500スライド、1スライド1,000要素、資料全体10,000要素です。画像はPNG / JPEG / GIF / WebPのdata URLのみを受け付けます。上限値は公開定数 `SLIDE_LIMITS` で確認できます。外部から渡されたJSONも `parseSlideDeck` で検証してから利用してください。

画像出力の `exportImage` / `exportImages` は、ブラウザーでは `@likex/slide/render` からReactなしで呼べます。`/model` 版では `renderer` を注入します。表示中の入力を含める場合はrefの `exportImage` / `exportImages` を使います。[対象ページ、解像度、結果の型、制限](image-export.md)を参照してください。

アニメーション付きモデルのget APIは既定で最終静止状態を返します。`{ includeAnimations: true }` を渡すと、`getDeck` / `getSlides` / `getSlide` は元の要素値とページの定義を保持します。`getElements` / `getElement` は元の要素値だけを返し、定義は含みません。定義だけなら `getAnimations(deck, slideId)` を使います。ネイティブ保存は全定義を保持します。[アニメーションの設定・取得・評価](animations.md)

refのget APIも上記と同じ取得規則です。`onSave`、`exportNative`、イベントのdeck、セッションの `getSnapshot()` は元の値と全定義を保持するため、get APIの最終静止表示と区別してください。
