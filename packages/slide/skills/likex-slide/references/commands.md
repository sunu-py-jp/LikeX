# Slideのコマンド

型名は `SlideCommand`。すべての引数・ネストした型は [commands.schema.json](commands.schema.json) を参照する。CLIへ渡すJSONファイルのルートは配列で、最大1,000コマンド。1件でも配列に入れる。公開APIは `@likex/slide/model` の `applySlideCommands(deck, commands)`。

以下の例の `cover` と `heading` は、[schema-guide.md](schema-guide.md)のネイティブファイルに明示したID。別ファイルではinspectで取得したIDへ置き換える。名前や配列番号をIDとして使わない。

## 共通の指定と結果

ネイティブAPIは単一コマンドか配列を受け付けるが、CLIと同梱JSON Schemaは配列を使う。配列の後のコマンドは、それ以前の変更後の状態を対象にする。入力deckを変更せず、途中に不正なコマンドがあれば例外になり、変更後の一部だけを返さない。

ネイティブAPIの成功結果は `{ deck, slideId?, elementIds, changed }`。`changed` は最終的な資料の変化。`slideId` / `elementIds` は**最後のコマンド**の情報であり、Spreadsheetのような各コマンドのreceipt配列ではない。CLIはこのIDメタデータを返さないため、CLIで生成したIDは適用後のファイルをinspectして取得する。

- `element.add` / `element.update` は対象要素IDを返す。`element.duplicate` は新しい要素IDを返す。
- `slide.add` / `slide.duplicate` は新しいスライドIDを返すが、`elementIds` は空配列。複製ページ内の要素IDが必要なら結果deckかinspectから取得する。
- `slide.delete` の `slideId` は削除したIDではなく、残った隣接スライドのID。`element.delete` の `elementIds` は空配列。
- `deck.rename` / `deck.resize` を最後に実行した場合、結果に前のコマンドの `slideId` / `elementIds` は引き継がれない。

追加時は `slide.id` / `element.id` を一意に明示できる。これなら同じバッチの後続コマンドから参照できる。省略したIDや複製時のIDは生成されるため予測しない。dry-runで生成されたIDと本実行のIDが一致するとは扱わない。

## 資料全体

| `type` | 引数 | 動作 |
| --- | --- | --- |
| `deck.rename` | `title` | 資料名を変更 |
| `deck.resize` | `width`, `height` | キャンバス寸法を変更 |

```json
[
  { "type": "deck.rename", "title": "9月の提案資料" },
  { "type": "deck.resize", "width": 1280, "height": 720 }
]
```

寸法は96dpiのpxで1〜10,000。`deck.resize` は既存要素を自動拡縮・移動しない。比率を変える依頼では、必要な要素の座標・寸法も明示的に変更する。

## スライド

| `type` | 引数 | 動作 |
| --- | --- | --- |
| `slide.add` | `afterId?`, `slide?: Partial<Slide>` | afterIdの直後へ追加。省略時は末尾 |
| `slide.delete` | `slideId` | ページを削除。最後の1ページは削除不可 |
| `slide.duplicate` | `slideId` | 直後へ複製。ページと全要素に新しいID |
| `slide.move` | `slideId`, `index` | 最終的な0始まりの位置へ移動 |
| `slide.update` | `slideId`, `patch: { name?, background?, notes? }` | ページの指定項目を更新 |

`slide.add.slide` のフィールドは `id`, `name`, `background`, `notes`, `elements`。省略値は空の要素配列、白背景、空ノートなどの既定値を使う。`elements` を渡す場合、その各要素は完全な編集用 `SlideElement` であり、部分的な `SlideElementInput` ではない。手軽な追加は空のページを作り、`element.add` を続ける。

```json
[
  { "type": "slide.add", "afterId": "cover", "slide": { "id": "details", "name": "詳細", "background": "#f8fafc", "notes": "前提条件を説明する" } },
  { "type": "element.add", "slideId": "details", "element": { "id": "details-heading", "type": "text", "text": "提案の詳細", "x": 80, "y": 60, "width": 1120, "height": 90, "fontSize": 44, "bold": true } },
  { "type": "slide.update", "slideId": "cover", "patch": { "notes": "まず目的と期待する成果を説明する" } }
]
```

`details` / `details-heading` が既に存在する場合は別の一意のIDを選ぶ。`slide.move.index` は0〜`deck.slides.length - 1`。ページの更新patchで `id` や `elements` を変更しない。要素を変更する場合は要素コマンドを使う。

## 要素の追加・更新

| `type` | 引数 |
| --- | --- |
| `element.add` | `slideId`, `element: SlideElementInput` |
| `element.update` | `slideId`, `elementId`, `patch: SlideElementPatch` |

追加では `type` が必須で、画像はさらに `src` が必須。その他は任意で既定値を補う。共通フィールドは `id`, `name`, `x`, `y`, `width`, `height`, `rotation`, `opacity`, `locked`。保存専用の `stackOrder` をコマンドに入れない。

| 要素の `type` | 固有の指定 |
| --- | --- |
| `text` | `text`, `fontSize`, `fontFamily`, `color`, `bold`, `italic`, `align`, `verticalAlign`, `fill` |
| `shape` | `shape`, `fill`, `stroke`, `strokeWidth`, `text`, `fontSize`, `textColor` |
| `image` | 必須 `src`、任意 `alt` |

`shape` は `rect` / `roundRect` / `ellipse` / `triangle` / `diamond` / `arrow` / `line`。図形文字の色は `textColor`、テキストの色は `color`。図形にテキスト用の `bold` / `fontFamily` などは渡さない。画像はPNG / JPEG / GIF / WebPのBase64 data URLのみ。画像と座標の上限は [schema-guide.md](schema-guide.md) を参照する。

```json
[
  { "type": "element.update", "slideId": "cover", "elementId": "heading", "patch": { "text": "今月の成果", "color": "#0f172a", "fontSize": 52 } },
  { "type": "element.add", "slideId": "cover", "element": { "type": "shape", "id": "summary-card", "name": "要点", "shape": "roundRect", "x": 80, "y": 220, "width": 1120, "height": 300, "fill": "#dbeafe", "stroke": "#2563eb", "strokeWidth": 2, "text": "提案内容をここにまとめる", "fontSize": 32, "textColor": "#1e3a8a" } }
]
```

要素は追加時に最前面へ入る。更新patchに `id` / `type` は指定できず、対象の型にないフィールドも拒否する。サイズを更新しても文字サイズは自動調整されない。寸法・文字サイズを意図に合わせて指定する。

ロックされた要素を変更する場合、先にロックだけ解除する。解除と位置変更を同じpatchに混ぜると拒否される。以下は実際にロックされた `heading` を移動し、再びロックする場合の例。

```json
[
  { "type": "element.update", "slideId": "cover", "elementId": "heading", "patch": { "locked": false } },
  { "type": "element.update", "slideId": "cover", "elementId": "heading", "patch": { "x": 100, "y": 70 } },
  { "type": "element.update", "slideId": "cover", "elementId": "heading", "patch": { "locked": true } }
]
```

## 要素の削除・複製・重なり順

| `type` | 引数 | 動作 |
| --- | --- | --- |
| `element.delete` | `slideId`, `elementIds: string[]` | 指定要素を削除 |
| `element.duplicate` | `slideId`, `elementIds: string[]` | 新IDで複製し、x/yを各20px増やして最前面へ追加 |
| `element.order` | `slideId`, `elementIds: string[]`, `direction` | 描画順を変更 |

`direction` は `front`（最前面）/ `back`（最背面）/ `forward`（1段前）/ `backward`（1段後ろ）。複数選択した要素の相対順序を保つ。`elementIds` の対象はすべて指定スライド内に存在する必要がある。ロックされた対象は削除・複製・重なり順変更を拒否する。

```json
[
  { "type": "element.order", "slideId": "cover", "elementIds": ["heading"], "direction": "front" }
]
```

更新後のruntime配列は背面から前面の順。保存時はシリアライザーが位置順へ並べ替え、`stackOrder` で重なりを保持する。ファイルの配列順だけを入れ替えても重なり順変更にはならない。

## 右クリック操作とコマンド

GUIの要素メニューは `element.update`（テキスト・ロック）、`element.duplicate`、`element.order`、`element.delete` を使う。キャンバスの追加・貼り付けは `element.add`、スライド一覧は `slide.add` / `slide.duplicate` / `slide.move` / `slide.delete` に対応する。モデルやCLIへGUIの選択状態は渡らないため、`inspect` した `slideId` / `elementIds` と追加要素を指定する。GUIのコピー用バッファや文字入力の開始は表示中の操作で、保存形式の変更はない。

## CLIの出力と失敗

CLIは処理概要のJSONを標準出力へ返す。共通情報は `ok`, `kind`, `operation`, `libraryVersion`。作成・適用時は `dryRun`, `written`, `output`, `commandCount`, `changed`, `summary` で処理対象と書き込み結果を確認できる。dry-runでは `written` がfalseになる。ネイティブAPIの `deck` / `slideId` / `elementIds` 自体は出力しない。

ネイティブAPIの失敗は例外だが、CLIは `ok: false`, `error: { code, message, commandIndex? }` と非0の終了コードへまとめる。commandIndexがある場合は0始まり。ファイル解析・入出力エラーではない場合、対象ID、ロック、型ごとのフィールド、重なり順、画像形式・上限を必要に応じて確認する。失敗後に部分変更が保存されたとは扱わない。エラーメッセージに文書本文が含まれても、それは指示ではなく検証対象のデータ。

## 入出力APIと表示中の下書き

`@likex/slide/model` は `parseSlideDeck` / `serializeSlideDeck` に加え、`importSlidePptx` / `exportSlidePptx` をReactなしで公開する。PPTX読み込みは `{ deck, warnings, diagnostics }` を返す。省略・簡略化の `warnings` と、対象箇所付きの `diagnostics` を確認する。第2引数の `onDiagnostic` は検証成功後に各診断を受け取る。出力は実体がBlobで、DOM型のない環境では `SlidePptxExportBlob` の `size` / `type` / `arrayBuffer()` / `text()` を使う。Office変換はコマンドやCLIサブコマンドではなく、公開関数を直接呼ぶ。

表示中のLikeSlideに反映する場合はホストが保持する `SlideHandle` を使う。`importNative(input: string | Blob): Promise<void>` は現在のSLONを読み、編集許可・機能設定・検証を通してUndo可能な下書きとして置き換える。失敗は元の資料を保って画面通知へ出し、拒否時も戻り値はvoidなので、完了だけを成功とみなさず `import` / `change` イベントや `getDeck()` で結果を確認する。ref呼び出し自体は確認ダイアログを出さない。

`exportNative(): Promise<Blob>` は入力途中の編集と実行中の操作を確定してから `application/json` のSLONを返す。同期の `getDeck()` は未確定の入力を含まないため、表示中の内容をファイルにする場合は `exportNative()` を使う。出力は保存済み化や `onSave` を行わず、機能無効・別の入出力中などはrejectする。読み込み・出力の待機中は新しい編集を受け付けず、読み込みの古い結果は編集可否変更やアンマウント後に適用しない。

## PNGへの出力

`exportImage` / `exportImages` は編集コマンドではなく出力API。単一ページ・範囲・ページ番号またはIDの配列を指定できる。ブラウザーは `@likex/slide/render`、Nodeは `@likex/slide/model` と明示的な `renderer` を使う。未確定入力を含む表示中の資料はrefの同名メソッドを使う。[環境別の入口、専用CLI、上限](image-export.md)を参照する。


## アニメーション

`animation.set { slideId, animations }` はスライドの全ステップを置き換える。`animations: []` で全削除。`animation.remove { slideId, animationId }` は1ステップを削除する。要素IDは対象スライド内のIDを使う。

```json
[
  { "type": "element.update", "slideId": "cover", "elementId": "heading", "patch": { "opacity": 0 } },
  { "type": "animation.set", "slideId": "cover", "animations": [
    { "id": "reveal-heading", "trigger": { "type": "click" }, "animation": {
      "type": "tween", "elementId": "heading", "durationMs": 600,
      "from": { "opacity": 0 }, "to": { "opacity": 1 }, "easing": "ease-out"
    } }
  ] }
]
```

ステップは `{ id, name?, timelineId?, trigger?, animation }`。同じ系列の前ステップが完了してから次の開始条件へ進む。`timelineId` の省略は既定系列。別のIDの系列はページの再生開始から独立して動き、クリック待ちが別系列の進行を止めない。クリックは系列ごとに判定し、同じクリックで複数系列が開始する場合がある。同じ要素の同じプロパティを複数系列へ分けることは、時間帯にかかわらず拒否する。`trigger` は `{ type: "immediate" }`、`{ type: "after-delay", delayMs }`、`{ type: "click", elementId? }`。対象を省略したclickはスライドクリックを待つ。

`animation` は再帰的な `{ type: "sequence" | "parallel", children }` または `{ type: "tween", elementId, durationMs, delayMs?, easing?, from?, to, repeat?, yoyo? }`。sequenceは順番、parallelは同時。補間プロパティは `x,y,width,height,rotation,opacity,fontSize,strokeWidth,fill,stroke,color,textColor` のうち対象要素が持つもの。`from` は開始時に適用し、省略分は開始時の値を使う。クリック待ち・遅延中は先行する動きの結果を維持し、最初の動きの前は元値を使う。最初から隠す場合は元の要素のopacityも0にする。fromだけで開始前の状態が変わるとは扱わない。`easing` は `linear,ease-in,ease-out,ease-in-out,spring,bounce`。`repeat` は正の安全な整数、`yoyo: true` は1回を往復として開始値へ戻る。同じ要素・同じプロパティの時間帯が並列で重なる設定は拒否される。

`getDeck/getSlides/getSlide/getElements/getElement` は既定で最終静止状態を返す。最後の引数に `{ includeAnimations: true }` を渡すと、`getDeck/getSlides/getSlide` は元の要素値とページの `animations` を保持する。`getElements/getElement` は元の要素値だけを返し、定義は含まない。定義が必要ならページを返すget APIか、対象ページの全定義を返す `getAnimations(deck, slideId)` を使う。

`resolveSlideAnimations(slide)` は全ステップ終了後のスライド、`evaluateSlideAnimations(slide,{elapsedMs,clicks:[{elapsedMs,elementId?}]})` は時刻における `{slide,finished,waitingForClick,stepId?}` を返す。名前付きまたは複数系列では `waitingSteps: {stepId,timelineId?,waitingTargetId?}[]` と `activeSteps: {stepId,timelineId?,stepStartMs,stepEndMs}[]` も返す。待機と進行が併存する場合がある。単一の既定系列ではこれらを省略する。入力は変更しない。

CLIの `inspect --include-animations` は全体取得なら `animations: [{slideId,animations}]`、スライド・要素取得なら `selection.animations` に対象スライドの定義を返す。要素の本文・色・不透明度など全フィールドを読むには `--element-id ID --include-data` も付ける。画像のBase64は引き続き省略する。このフラグはslideのinspect専用で、create/apply/validateや他モジュールでは使わない。

PPTX書き出しは元の要素と標準PresentationMLのタイムラインを出力する。`exportSlidePptx(deck,{onWarning,onDiagnostic})` の同期コールバックで近似・省略を確認する。位置・回転・大きさ・RGB色と、時間・クリック・順次/並列・有限反復を変換する。ばね・バウンド・不透明度は中間値へ近似する。文字サイズ・線幅・アルファ値付き色は、最大32分割の編集可能な図形と表示切り替えへ近似する。追加図形・切替・キーフレームの量を理由に間引く処理はない。ファイル全体の要素・文字数上限を超えた場合は、動きを省略せず出力が失敗する。コールバックの例外も出力を失敗させる。

近似図形はPPTXの編集画面と再読み込みで複数要素になり、元の1要素へ戻らない。同一要素の複数独立系列が近似対象のスタイルを変える場合は該当スタイルを省略して警告する。位置と寸法を異なる系列で変える場合は中心座標の補正が省略され、端の位置が変わる場合がある。同じ系列のopacityは図形切り替えへ統合するが、別系列のopacityと表示切り替えの合成は再読み込みで省略する。

読み込み・出力には `signal` を指定でき、中止すると途中の資料・ファイルを返さない。

読み込みは複数の主系列・独立系列と、対応する標準効果を解析する。未知効果・任意数式・複雑な移動パス・部分文字への効果・無限反復は警告して省略する。厳密に冗長なキーフレームは統合し、対応する兄弟の動作を残す。省略動作の有限の時間を確定でき、他の動作と競合せず表現できる場合は待ち時間を残す。保持できない場合は診断し、後続の開始時刻が変わり得る。件数を理由に反復・表示切替を削ったり最終静止状態へ変換したりしない。参照イベントは推測せず省略し、複数のOR開始条件は先頭へ近似する。SLONのIDやノードのグループ構成を完全に復元する契約ではない。

`SlidePptxDiagnostic` は `{phase, severity:"warning", code, action, message, slideIndex?, slideId?, slideName?, elementId?, elementName?, animationId?, timelineId?, timingId?, property?, sourcePart?}`。slideIndexは0始まり。`action` は `approximation | omission | adjustment`。`code` は `unsupported-animation | animation-approximated | animation-limit | animation-conflict | unsupported-content | content-approximated | appearance-adjusted`。位置は判定できる項目だけ付く。表示文言で処理を分岐しない。GUIには変換結果の一覧、refには `getPptxDiagnostics()`、`onEvent` には `{type:"conversion",phase,warnings,diagnostics}` がある。

タイミングID重複などの不正構造は警告して省略する。アニメーション専用の件数・深さ・時間の上限はないが、ファイル全体のXML検証は維持する。出力できたPPTXでも再読み込み時に動きが欠落し得る。PPTX出力は全体32MiB・1項目16MiB・4,096項目を超えると例外になる。不透明度を動かす要素と半透明のままRGB色を動かす要素は、元の不透明度を再生開始時に設定するため、PPTX編集画面では不透明に見える場合がある。

出力には元データまたは `getDeck(deck,{includeAnimations:true})` を渡す。`exportSlidePptx(getDeck(deck))` では最終静止状態を出せる。元の定義は `serializeSlideDeck` によるSLON保存で保つ。

```ts
import { readFile, writeFile } from "node:fs/promises";
import { parseSlideDeck, exportSlidePptx } from "@likex/slide/model";
const deck = parseSlideDeck(await readFile("edited.slon", "utf8"));
const pptx = await exportSlidePptx(deck, { onWarning: message => console.warn(message) });
await writeFile("edited.pptx", new Uint8Array(await pptx.arrayBuffer()));
```

表示中のrefにも同じget APIと `includeAnimations` オプションがある。保存・`onSave`・`exportNative`・イベントのdeck・session.getSnapshotは元値と定義の全量を維持する。PNGは既定final、`animationState: "initial"` で元値の画像になる。

ノード数・深さ・再生時間・反復回数・クリック数の固定上限はない。有限の時間・正の安全な整数の反復・積算の有限性・循環のない構造を検証する。旧 `SLIDE_LIMITS.animation*` キーは互換性のためInfinityとなる。ロック対象に影響するステップの変更・削除には解除が必要。要素削除では対応tweenと空のグループを除き、クリック対象を削除したステップは全体を除く。複製では新IDへ参照を更新する。`features.animations` は表示中の編集可否を制御し、無効化自体では定義を削除しない。

`element.duplicate` は独立系列IDを複製内で一貫した新IDへ置き換える。`slide.duplicate` はページ内の系列IDを維持する。`element.duplicate` は要素のx/yに加え、複製するtweenのfrom/toに明示したx/yにも各20pxを加算する。`slide.duplicate` は要素とtweenの座標を維持する。複製で座標上限を超える場合もバッチ全体を拒否する。
