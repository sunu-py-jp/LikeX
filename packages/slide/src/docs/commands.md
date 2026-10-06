# JSONと画面なしの操作API

`@likex/slide/model` はReactやDOMなしで利用できます。GUIも同じコマンド処理と編集セッションを使います。PPTXの読み込み・出力もこの入口から利用できます。永続データに関数・Blob・DOM要素は含まれません。

埋め込み画像を解析用に取り出すときは `await collectSlideImages(deck)` を使います。同一バイト列の画像をSHA-256でまとめた `images` と、各ページでの位置・寸法を保つ `placements` を返します。利用例・取得範囲・ホスト側のキャッシュは[画像の収集と重複判定](image-analysis.md)を参照してください。

サーバーで本文を検索するときは `searchSlides(deck, { keywords: ["顧客", "会議"], operator: "and" })` でページ番号・スライドID・要素ID・一致箇所を取得できます。AND／ORの一致単位、継承要素、ノート等の指定は[描画しないキーワード検索](search.md)を参照してください。

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
  masters?: SlideMaster[];
  layouts?: SlideLayout[];
};
type Slide = {
  id: string;
  name: string;
  background: string;
  notes: string;
  elements: SlideElement[];
  animations?: SlideAnimationStep[];
  layoutId?: string;
  inheritBackground?: boolean;
  showMasterShapes?: boolean;
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
type SlideFileMaster = Omit<SlideMaster, "elements"> & { elements: SlideFileElement[] };
type SlideFileLayout = Omit<SlideLayout, "elements"> & { elements: SlideFileElement[] };
type SlideFile = Omit<SlideDeck, "format" | "version" | "slides" | "masters" | "layouts"> & {
  format: "likex.slide";
  version: 1;
  slides: SlideFilePage[];
  masters?: SlideFileMaster[];
  layouts?: SlideFileLayout[];
};
```

これらの型は `@likex/slide/model` からimportできます。保存データを操作APIへ渡す前に `parseSlideDeck` を呼んでください。復元後の `elements` は描画順で、`stackOrder` は編集用モデルには残りません。重複・欠落・範囲外の重なり順を持つファイルは拒否します。

### 毎回同じ書式で保存する

フィールド順、2スペースのインデント、LF改行を固定します。BOM・末尾の改行は付けず、文字列の中の改行やUnicodeは保持します。保存のためにIDや日時を生成しません。同じページ・要素・重なり順・データを `serializeSlideDeck` でUTF-8に保存すれば、毎回同じバイト列・ハッシュになります。

親の `onSave` でも `serializeSlideDeck` を使ってください。描画順から保存順への変換と、`stackOrder` の付与もこのAPIが担当します。内容が同じ場合のBlob書き込み省略は親側で管理します。

ファイルタブでは `.slon` を標準で書き出します。読み込み時は `.json` も選べますが、内容は同じSLON形式が必要です。読み込んだデータは下書きになり、Undoで元の資料へ戻せます。保存先の通信やファイル名は `onSave` を実装する親側が管理し、コールバックに渡る値は `SlideDeck` です。出力や読み込みだけでは `onSave` を呼びません。

ブラウザーやストレージが独自拡張子のMIMEタイプを推測できるとは限らないため、アップロード時も `Content-Type: application/json` を指定してください。既存のBlobの名前や保存場所をコンポーネントが変更することはありません。

## テキストを追加する

要素の位置・寸法・書式は呼び出し側が自由に指定します。本体は決まった構図へ当てはめません。[自由な資料設計とSVG](freeform-design.md) も参照してください。

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

`element.update.patch` の `SlideElementPatch` はtext・shape・imageそれぞれの部分更新型のunionです。対象の種類に合うフィールドを使い、例えばテキスト更新へ図形専用の `shape` や画像専用の `src` を混ぜません。生成JSON Schemaも種類別の分岐になり、実際の対象種類との一致はモデルAPIが検証します。既存の有効な部分更新はそのまま利用できます。

## 操作一覧

| `type` | 主な引数 |
| --- | --- |
| `deck.rename` | `title` |
| `deck.resize` | `width`, `height` |
| `slide.add` | `afterId?`, `slide?: Partial<Slide>` |
| `slide.delete` / `slide.duplicate` | `slideId` |
| `slide.move` | `slideId`, `index`（0始まりの移動先） |
| `slide.update` | `slideId`, `patch: { name?, background?, notes? }` |
| `slide.replaceContent` | `slideId`, `elements: SlideElementInput[]`, `name?`, `background?`, `notes?`, `animations?` |
| `line.add` | `slideId`, `start`, `end`, `id?`, `name?`, `stroke?`, `strokeWidth?`, `startArrow?`, `endArrow?`, `routing?` |
| `line.update` | `slideId`, `elementId`, `start?`, `end?`, `startArrow?`, `endArrow?`, `routing?`（1項目以上） |
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

## 1ページの内容を置き換える

全面的に作り直す場合は、旧要素のIDを列挙して削除する代わりに `slide.replaceContent` を使います。ページID・ページ順・他ページを保持し、本文を一度に検証して置換します。旧要素はすべて除去されるため、背景の裏に残りません。省略した `name` / `background` / `notes` は保持します。古い要素への参照を残さないため、`animations` は省略時にクリアし、指定時は新しい要素に対して検証します。

```ts
const rebuilt = applySlideCommands(deck, {
  type: "slide.replaceContent", slideId: deck.slides[0].id,
  background: "#101c2f",
  elements: [
    { type: "text", id: "new-heading", text: "次の成長を、ここから。",
      x: 64, y: 100, width: 1000, height: 170, fontSize: 60, color: "#ffffff", bold: true },
    { type: "shape", shape: "rect", x: 80, y: 300, width: 160, height: 6, fill: "#5eead4", strokeWidth: 0 },
  ],
});
```

要素の `type` は必須で、その他は `createSlideElement` と同じ既定値を補います。新しいIDを省略すれば自動生成します。既存のロックされた要素を破棄する置換は拒否し、無効な要素・重複ID・不正なアニメーションがあれば全体を適用しません。`SlideHandle.execute` では編集許可、読み取り専用、書式・該当する要素型・ノート・アニメーションの機能設定を確認し、選択を新しい要素へ変更します。Undoは内容と選択を一度で戻します。モデルAPIにはホスト固有のページ数制限はありません。AIホストが1回1ページに制限する場合、複数ページを1回の依頼で順に処理できます。

## 2点の線と接続

線は `line.add` で始点と終点を指定し、`line.update` で片方または両方を変更します。矩形の幅・高さや回転から端点を逆算する必要はありません。`shape: "arrow"` は面を持つ矢印図形で、端点を持つ線とは別です。

```ts
const connected = applySlideCommands(deck, {
  type: "line.add", slideId: "architecture", id: "api-data",
  start: { x: 0, y: 0, binding: { targetId: "api", port: "right" } },
  end: { x: 0, y: 0, binding: { targetId: "data", port: "left" } },
  stroke: "#0b817d", strokeWidth: 2, routing: "elbow", endArrow: "triangle",
});
// bindingを省略した端点は自由な座標になり、その端だけ接続を解除します。
const detached = applySlideCommands(connected.deck, {
  type: "line.update", slideId: "architecture", elementId: "api-data", end: { x: 900, y: 400 },
});
```

端点はズームに依存しない資料内のpx座標です。`binding` があれば `x/y` は現在の接続先から解決します。`port` は回転前の `top/topRight/right/bottomRight/bottom/bottomLeft/left/topLeft` の8方向で、楕円・角丸・三角形・ひし形・矢印では輪郭上の位置を使います。接続先は同じページの線以外の要素です。存在しないID・他ページ・線自身・他の線への接続を拒否するため、循環接続は作れません。接続先の移動・サイズ変更・回転に追従し、削除時はその時点の座標で接続だけを解除します。線をロックしても接続先からの追従は維持します。

水平・垂直・逆方向の直線、始終点が同じ点も指定できます。同一点の線は丸い点として表示します。保存用の外接矩形は従来の正寸法契約に合わせ最小1pxですが、線の実際の端点は変更しません。端点の座標は−100,000〜100,000、両端の差は各軸100,000px以下です。旧 `shape: "line"` は読み込み時に描画を変えず、端点編集時に任意の `line: { start, end }` を追加します。`getSlideLineEndpoints` は旧線も含めた現在の端点を返します。

`routing: "elbow"` は始終点から直角に折れる経路を自動計算します。省略または `"straight"` は従来の直線です。接続した図形の位置・サイズ・回転に合わせて端点と折れ位置を更新し、接続先の外側を通る経路を選びます。未接続の別図形を含むページ全体の障害物回避や、折れ位置の手動編集は対象外です。`getSlideLineRoute(lineElement, slide.elements)` はcreate/parse/applyで正規化した現在の要素を受け取り、描画と同じ資料内座標の `points` と `bounds` を返します。第2引数は接続先の輪郭と回転を考慮するために渡してください。保存するのは2端点・接続・経路の種類で、折れ位置は派生値です。

矢印は線直属の `startArrow` / `endArrow` で `none/triangle/openArrow/diamond/oval/stealth` を指定します（省略時none）。`line.update` は矢印だけの更新も可能です。GUIの線メニューは直線・右向き矢印線・左向き矢印線・双方向矢印線と、それぞれの折れ線を用意し、書式パネルで経路と各端の矢印を変更できます。図形の太い右矢印 `shape: "arrow"`・左矢印 `shape: "leftArrow"` とは別です。

GUIは端点の2ハンドルを使い、ドラッグ中に近づいた最寄りの図形だけ8接続点を表示します。表示は32画面px以内、吸着は12画面px以内です。点から離して移動するとその端を解除します。線本体の移動は両端を解除し、接続先と一緒に移動した場合はその接続を保持します。線だけの複製・コピーでは接続を解除し、接続先も一緒なら新しいIDへ張り替えます。`line.add` は `features.shapes`、`line.update` は `features.formatting`、編集許可・ロック・Undo/Redoは既存の操作経路を使います。

## 文字の収まり

以下は `@likex/slide/model` と通常の公開入口から利用できる、React・DOMに依存しない補助APIです。測定関数だけをホストから注入します。文字レイアウトはPNG描画と同じ余白・行高・折り返し処理を使います。フォントの用意やCanvasの管理はホストが担当します。

```ts
import { measureSlideText, fitSlideText, getSlideLayoutDiagnostics } from "@likex/slide/model";
import type { SlideTextMeasure } from "@likex/slide/model";

const measureText: SlideTextMeasure = (text, style) => {
  context.font = `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${style.fontSize}px ${style.fontFamily}`;
  return context.measureText(text).width;
};
const diagnostics = getSlideLayoutDiagnostics(page, { width: deck.width, height: deck.height, measureText });
const layout = measureSlideText(textElement, measureText);
const fitted = fitSlideText(textElement, { measureText, minFontSize: 20 });
// fitted.fits が false なら最小文字サイズでも収まらない。文章を短くするか領域を拡大する。

```

- `measureSlideText` は `lines`, `measuredWidth`, `measuredHeight`, `availableWidth`, `availableHeight`, `overflow` を返します。画像には使えません。
- `fitSlideText` は入力を変更せず `{ element, layout, fits }` を返し、最大0.1px単位で文字を縮小します。既定の最小値は12px（元の文字がそれ未満なら元のサイズ）。文章自体や配置は変更しません。
- `getSlideLayoutDiagnostics` は `{ code: "text-overflow" | "out-of-bounds", elementId, message, ...測定値 }[]` を返します。回転した要素のはみ出しも調べます。背景や図形内ラベルなど、意図した重なりをエラーにしません。静止したページに対する助言であり、アニメーション途中の状態や見た目全体を保証するものではありません。
- `getSlideElementBounds(element)` は回転を考慮した外接矩形 `{ left, top, right, bottom }` を返します。

旧 `element.connect` / `createSlideConnector` / `SlideConnectorOptions` / `SlideConnectorSide` は削除しました。接続関係を持つ線は `line.add/update` を使います。旧SLONに保存済みの線の集合は引き続き読み込めます。自動の直交経路は `line.add/update` の `routing: "elbow"` を使います。文字測定とレイアウト診断は保存されず、選択・認証・通信にも依存しません。

## 取得と復元

| API | 戻り値 |
| --- | --- |
| `createSlideDeck(input?)` | 既定値を補った `SlideDeck` |
| `createSlideElement(input)` | 既定値を補った `SlideElement` |
| `getSlide(deck, slideId)` | `Slide` または `undefined` |
| `getElements(deck, slideId)` | 指定ページの `SlideElement[]` |
| `getElement(deck, slideId, elementId)` | `SlideElement` または `undefined` |
| `normalizeSlideDeck(value)` | 検証済みの `SlideDeck`。不正な値は例外 |
| `parseSlideDeck(json)` | JSON文字列を検証した `SlideDeck` |
| `serializeSlideDeck(deck)` | JSON文字列 |

`deck.slides` が順序付きのスライド一覧、`slide.elements` が背面から前面への要素一覧です。画像には `src`（data URL）と `alt`、テキストには `text` などの書式情報があります。取得後に編集する場合もコマンドを使ってください。

スキルCLIでは `inspect --slide-id ID --include-data` で、指定ページの全要素の本文・書式・配置を `selection.elements` にまとめて取得できます。公開モデルのページ取得と同じ要素順を保ち、画像の `src` / `dataUrl` は応答から除きます。`selection.slide` は従来のメタデータのまま、ノートは本文ではなく `notesLength` です。`--include-data` を省略した要約取得、`--element-id ID --include-data` による単一要素取得は従来どおりです。

元の値とアニメーション定義が必要なら `--include-animations` を併用し、`selection.elements` と `selection.animations` を読みます。対象ページを編集する際は一括取得を優先し、CLIの1 MiBの応答上限を超えた場合だけ必要な要素へ絞ってください。結果を切り詰めたり要素を省略したりはしません。公開get API、SLON保存形式、PPTX入出力の契約は変更していません。[スキルCLIの取得手順](../../skills/likex-slide/references/inspect.md)

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

## 非同期作業中の条件付き編集

AIや非同期処理が取得した状態と、実際の書き込み時点の状態を比較してからコマンドを適用できます。`SlideCommand` の全操作を受け付け、1件でも競合すればバッチ全体を適用せず、Undo履歴も増やしません。

```ts
import { prepareSlideConditionalEdit } from "@likex/slide/model";

const snapshot = ref.current!.getMutationSnapshot();
// ここでAIなどがsnapshotに基づいてcommandsを作成する。
const edit = prepareSlideConditionalEdit(snapshot.deck, commands, { scope: "deck" });
const result = await ref.current!.executeConditional(edit, {
  expected: snapshot.token,
  signal: abortController.signal,
});
if (result && !result.ok) {
  // result.code === "conflict"。現在値を確認し、再取得して計画を作り直す。
  console.log(result.conflicts); // [{ path, expected, actual, ... }]
}
```

`getMutationSnapshot()` はアニメーション適用前の編集データと `{ sessionId, structureRevision }` を返します。トークンは同じエディターでのみ有効で、ページ・要素の追加、削除、並べ替え、読み込みなどで失効します。Undo・Redo、ホストからの保存結果による基準データの更新、変更の破棄でも失効します。同一の値やIDへ戻った場合も、古い位置・対象の判断を引き継ぎません。トークンは保存形式に含めません。

| 比較範囲 | 挙動 |
| --- | --- |
| `scope: "deck"` | 取得した資料全体と一致するときだけ適用。AIが他ページや他要素の内容を根拠に判断した場合に使う |
| `scope: "targets"` または省略 | タイトル・ページのメタデータ・要素の文字や書式は、書き込む項目と対象ID・種別・ロック状態を比較。別項目のユーザー変更を保持する |
| 構造や関連を変更する操作 | `targets` でも資料全体を比較。追加・削除・複製・順序、位置や大きさ、接続線、アニメーション、ページ置換、サイズ、マスターとレイアウトが対象 |

例えば本文の変更では、同時に行われた文字色の変更を保持できます。ただし「別要素の数値を読んで本文を書き換える」といった判断の依存関係は、コマンドだけから推測できません。その場合は `deck` を使います。構造操作では別ページの編集でも競合として扱うことがあるため、結果を取得し直して再計画してください。競合応答を無視して無条件の `execute()` に切り替えないでください。

書き込み前に入力途中の文字を確定し、非同期の編集許可を待った後も最新状態を再照合します。照合から適用まで非同期の隙間を作りません。成功時は `{ ok: true, ...SlideCommandResult }`、競合時は `{ ok: false, code: "conflict", conflicts }`、権限拒否・中止・読み取り専用などは `null` です。適用済みバッチはそれぞれ1回のUndoで戻せます。ユーザーが見ているページ・選択は可能な限り維持します。

ヘッドレスでも `prepareSlideConditionalEdit(before, commands, options)` → `applySlideConditionalEdit(current, edit)` が使えます。セッションでは `getMutationSnapshot()` → `executeConditional(edit, snapshot.token)` を使います。純粋なモデルAPIは外部ストレージの同時書き込みをロックしないため、サーバーでは最新データの取得・条件照合・保存を同じトランザクション内で行います。`before` はホストで保持する比較用データで、LLMへ全文送信する必要はありません。

新規IDは実際の適用結果を正とします。複製、マスター取り込み、レイアウト適用などをサーバーとブラウザーで別々に実行するとIDが変わるため、書き込み主体は一つにし、その結果を次の取得・編集へ引き継いでください。このAPIは編集実行の契約の追加で、SLONやPPTXの保存内容は変更しません。

スキルCLIでも `apply --expected before.slon --expected-scope document` で取得時のファイルを照合できます。scopeの既定は `document`、独立した項目だけを比較する場合は `targets` です。両オプションは `apply` 専用で、セッショントークンは含まないため、共有ファイルの並行読み書きは利用ホストがロック・世代管理してください。[CLIの条件付き編集](../../skills/likex-slide/references/commands.md#条件付き編集と逐次反映)

## 表示中のコンポーネントを操作する

```tsx
const ref = useRef<SlideHandle>(null);
<LikeSlide ref={ref} initialDeck={deck} onSave={saveDeck} />;

const result = await ref.current?.execute({ type: "element.add",
  slideId: deck.slides[0].id, element: { type: "text", text: "外部から追加" } });
```

`SlideHandle` の `getDeck()`、`getSlides()`、`getSlide()`、`getPageNumber()`、`goToPage(pageNumber)`、`getSelectedPageNumbers()`、`getSelectedSlides()`、`getElements()`、`getElement()`、`getAnimations()`、`getSelection()`、`select(selection)`、`deleteSelection(scope)`、`execute()`、`undo()`、`redo()`、`save()`、`discard()`、`importNative()`、`exportNative()`、`importPptx()`、`exportPptx()`、`exportImage()`、`exportImages()` が使えます。`execute` は拒否時に `null`、`undo` / `redo` / `save` は成功をbooleanで返します。`execute` と履歴操作は編集許可・読み取り専用・機能設定を通ります。ヘッドレスAPIには認証の責務はありません。

`SlideSelection` は `{ slideId, elementIds, slideIds? }` です。`slideId` はキャンバスで表示するページ、`slideIds` は複数選択したページを表します。存在しないIDと重複は取り除き、アクティブな `slideId` を含めて資料順に揃えます。2枚以上のときだけ `slideIds` を返し、`elementIds` は空にします。単一ページは従来の `{ slideId, elementIds }` のままです。選択自体は未保存状態や履歴を増やしません。

`getPageNumber(): number` は表示中のページ番号、`getSelectedPageNumbers(): number[]` は選択中のページ番号を資料順に返します。番号は1始まりで、並べ替えや削除後は現在の資料順から求めます。アクティブなページが選択配列の先頭になるとは限りません。`getSelectedSlides(options?: SlideQueryOptions): Slide[]` は選択したスライドを資料順にまとめて返し、単一選択でも配列になります。`getSlides()` / `getSlide()` と同じく既定はアニメーションの最終静止状態、`{ includeAnimations: true }` は元の要素値と定義です。返す配列・スライド・ネストした要素は防御コピーで、書き換えても内部状態へ影響しません。

```ts
const activePage = ref.current?.getPageNumber(); // 例: 4
const pageNumbers = ref.current?.getSelectedPageNumbers(); // 例: [2, 4]
const selectedSlides = ref.current?.getSelectedSlides({ includeAnimations: true });
const selection = ref.current?.getSelection();
const selectedIds = selection ? selection.slideIds ?? [selection.slideId] : [];
```

選択IDは従来の `getSelection()` と `onSelectionChange(selection)` でも取得できます。これらの取得APIは読み取り専用でも使え、編集許可や出力機能のON/OFFには依存しません。表示中の確定済みデータと選択を同期取得するUI APIで、入力途中の編集を確定したり、選択状態を保存したりしません。画面なしのモデルAPI・CLIには選択状態がないため、対象IDを明示して取得してください。

```ts
ref.current?.select({ slideId: "page-2", slideIds: ["page-1", "page-2"], elementIds: [] });
await ref.current?.deleteSelection("slides");
ref.current?.select({ slideId: "page-3", elementIds: ["title", "box"] });
await ref.current?.deleteSelection("elements");
```

`deleteSelection("slides" | "elements")` はGUIと同じ選択削除で、`Promise<SlideCommandResult | null>` を返します。既存の `slide.delete` の配列または `element.delete` を通り、1回のUndoで内容と選択を復元します。編集許可・機能設定・読み取り専用・処理中の制御を維持し、許可待ち中に選択や資料が変わった場合も `null` で取り消します。全ページの削除は拒否し、最低1枚を残します。UIを使わない編集では同じ既存コマンドに対象IDを明示してください。選択情報はSLONに保存せず、PPTX入出力の契約も変わりません。

```ts
await ref.current?.importNative(file); // Blob / File または現在のSLON形式のJSON文字列
const native: Blob | undefined = await ref.current?.exportNative();
```

`importNative(input: string | Blob, target?: SlidePageTarget): Promise<void>` はGUIと同じ検証・編集許可・機能設定を通り、資料全体を未保存の下書きとして置き換えます。入力途中の編集と実行中の操作を先に確定するため、Undoで読み込み直前の内容と選択へ戻せます。不正なJSONは元の資料を維持し、エラーを画面の通知へ表示します。読み取り専用・機能無効・別の入出力処理中・編集許可の拒否では適用せず、既存の `importPptx` と同様に成功値や例外を返しません。成功時は `import` イベント、内容が変わった場合は `change` イベントも通知します。

`exportNative(): Promise<Blob>` は入力途中の編集と実行中の操作を待って、`application/json` のSLONを返します。ダウンロード・保存済み化・`onSave` の呼び出しは行いません。読み取り専用でも利用できますが、`features.export === false`、別の入出力処理中、アンマウント後はPromiseをrejectします。`getDeck({ includeAnimations: true })` は確定済みの元の値と定義を同期取得するため、入力途中の内容も含むファイルが必要なら `exportNative()` を使います。

GUIのファイル選択では未保存の置き換え確認を表示します。refによる読み込みでは確認ダイアログを出さないため、必要な確認は呼び出し側で行ってください。ネイティブとPPTXのいずれも読み込み・出力だけで `onSave` は呼びません。

## データ量と画像

モデルは最大500スライド、1スライド1,000要素、資料全体10,000要素です。画像はPNG / JPEG / GIF / WebP / 静的SVGのBase64 data URLを受け付けます。SVGは `createSlideSvgSource(svg)` で検証・変換できます。[自由配置とSVGの対応範囲](freeform-design.md)を参照してください。上限値は公開定数 `SLIDE_LIMITS` で確認できます。外部から渡されたJSONも `parseSlideDeck` で検証してから利用してください。

画像出力の `exportImage` / `exportImages` は、ブラウザーでは `@likex/slide/render` からReactなしで呼べます。`/model` 版では `renderer` を注入します。表示中の入力を含める場合はrefの `exportImage` / `exportImages` を使います。[対象ページ、解像度、結果の型、制限](image-export.md)を参照してください。

アニメーション付きモデルのget APIは既定で最終静止状態を返します。`{ includeAnimations: true }` を渡すと、`getDeck` / `getSlides` / `getSlide` は元の要素値とページの定義を保持します。`getElements` / `getElement` は元の要素値だけを返し、定義は含みません。定義だけなら `getAnimations(deck, slideId)` を使います。ネイティブ保存は全定義を保持します。[アニメーションの設定・取得・評価](animations.md)

refのget APIも上記と同じ取得規則です。`onSave`、`exportNative`、イベントのdeck、セッションの `getSnapshot()` は元の値と全定義を保持するため、get APIの最終静止表示と区別してください。

PowerPoint変換の詳細は `ref.current.getPptxDiagnostics(): readonly SlidePptxDiagnostic[]` で取得できます。最後に成功した読み込み・出力が対象で、初回は空配列です。[変換診断の型と通知](powerpoint.md#変換結果を確認する)を参照してください。

## マスターとレイアウトのAPI

`masters.import`、`slide.applyLayout`、`slide.detachLayout`、`slide.add.layoutId` を使います。取得は `getSlideMasters` / `getSlideLayouts` / `getSlideLayout`、背景と共有装飾の解決は `resolveSlideAppearance` です。保存用のカタログ要素にも `stackOrder` を使うため、専用のparse/serializeを通してください。[型・コマンド・Office変換](masters.md)を参照してください。

固定構図の `slide.compose` と関連する構図・プリセットAPIは削除しました。通常の要素コマンドか `slide.replaceContent` へ移行してください。既に生成済みの通常要素を持つSLONはそのまま読み込めます。[移行の説明](freeform-design.md#固定構図apiからの移行)


## Officeの図形プリセット

ホーム／挿入タブの「その他の図形…」から、カギ矢印、Uターン矢印、多方向矢印、多角形、星、フローチャート記号を追加できます。`SLIDE_SHAPES` を公開入口から取得すると、挿入用の `shape`、Office用の `preset`、日本語の `label`、`category` を参照できます。GUIもこの一覧と `element.add` を使います。

```ts
import { SLIDE_SHAPES, applySlideCommands } from "@likex/slide/model";
const result = applySlideCommands(deck, {
  type: "element.add", slideId,
  element: { type: "shape", shape: "bentArrow", x: 320, y: 160,
    width: 260, height: 200, fill: "#dbeafe", stroke: "#2563eb",
    strokeWidth: 2, text: "確認", fontSize: 20, textColor: "#1e3a8a" },
});
```

主な追加名は `bentArrow`（カギ矢印）、`bentUpArrow`、`uturnArrow`、`leftUpArrow`、`leftRightUpArrow`、`quadArrow`、`chevron`、`homePlate`、`pentagon`、`hexagon`、`octagon`、`star5`、`plus` です。フロー図には `flowChartProcess`、`flowChartDecision`、`flowChartTerminator`、`flowChartInputOutput`、`flowChartPredefinedProcess`、`flowChartDocument`、`flowChartMultidocument`、`flowChartPreparation`、`flowChartManualInput`、`flowChartManualOperation`、`flowChartMerge`、`flowChartDelay` を使えます。全一覧は `SLIDE_SHAPES` が正本です。既存の右ブロック矢印は引き続き `arrow`（Officeでは `rightArrow`）、線は `line.add` / `line.update` で扱います。カギ矢印は面を持つ図形で、端点を持つ折れ線コネクターではありません。

文字領域は図形に合わせて決まり、`getSlideShapeTextRect` が返す領域を、UI、PNG、文字収まりの診断で共有します。追加図形も8接続点に線を接続できます。SLON version 1の追加プリセットとして保存します。新しい図形を含むファイルを以前の実装で開くには、対応版への更新が必要です。

## リボンの表示

`SlideHandle.getRibbonDisplayMode()` と `setRibbonDisplayMode(mode): boolean` で、表示中のリボンを操作できます。`SlideRibbonDisplayMode` は `expanded` / `tabs` / `autoHide` / `hidden` です。保存する資料・履歴・編集許可には影響しません。[初期値・制御props・操作例](ribbon-display.md)を参照してください。


### 指定ページから開く

```tsx
<LikeSlide initialDeck={deck} initialPageNumber={3} />
// スライドIDは並べ替え後も同じページを指します。
<LikeSlide initialDeck={deck} initialSlideId="architecture" />

ref.current?.goToPage(3); // 読み取り専用でも移動可能。番号は1始まり。
await ref.current?.importNative(file, { pageNumber: 3 });
await ref.current?.importPptx(pptx, { slideId: "architecture" });
```

`initialPageNumber` / `initialSlideId` は初回だけ読み、後のprops変更は無視します。初期指定が不正ならエラー通知を表示して先頭ページを開きます。表示先は保存内容・未保存状態・Undo履歴に影響しません。`goToPage` は移動を受け付けると `true`、無効番号・同じページ・アンマウント後・入出力処理中・未確定入力がある場合は `false` です。移動は既存の `select` と同じ選択通知を通ります。ID指定で後から移動する場合は `select({ slideId, elementIds: [] })` が使えます。

`SlidePageTarget` は `{ pageNumber?: number; slideId?: string }` です。`importNative` / `importPptx` の第2引数に指定すると、読み込み後の資料に対して検証してから一括で置き換えます。指定が不正なら元の資料と選択を維持し、画面へエラーを通知します。両方を渡した場合は同じページである必要があります。インポート本来の編集許可・読み取り専用・Undoの規約は変わりません。省略時は従来どおり先頭ページです。
