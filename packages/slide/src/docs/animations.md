# 要素のアニメーション

スライドの `animations` に実行順のステップを保存します。要素の移動・サイズ・回転・不透明度・文字サイズ・線幅・色を補間し、順次実行・並列実行、遅延、クリック開始、有限の繰り返しを組み合わせます。画面切り替えの設定ではありません。

「アニメーション」タブの「移動を追加」で選択要素にステップを追加し、「アニメーションの詳細設定」で開始条件・対象・開始値と終了値・時間・グループ構成を編集します。「アニメーションを再生」で再生結果を確認できます。編集キャンバスは元の要素値を表示し、以下のget APIが既定で返す最終静止状態とは区別します。

## モデルと公開コマンド

```ts
const animations = [{
  id: "reveal-heading",
  name: "見出しを表示",
  trigger: { type: "click" as const },
  animation: {
    type: "tween" as const,
    elementId: "heading",
    durationMs: 600,
    easing: "ease-out" as const,
    from: { opacity: 0, x: 40 },
    to: { opacity: 1, x: 80 },
  },
}];

const changed = applySlideCommands(deck, [
  { type: "element.update", slideId: "cover", elementId: "heading", patch: { opacity: 0 } },
  { type: "animation.set", slideId: "cover", animations },
]);
const nativeJson = serializeSlideDeck(changed.deck);
```

`animation.set` は対象スライドのステップ一覧を置き換え、`animation.remove` は `{ slideId, animationId }` で1ステップを削除します。空の配列を設定すると全ステップを除去します。GUIやref経由の操作も同じコマンド・編集許可・履歴の経路を通ります。

| 構造 | 設定 |
| --- | --- |
| ステップ | `id`、任意の `name`・`timelineId`・`trigger`、`animation` |
| `trigger` | `immediate`、`after-delay`（`delayMs`）、`click`（任意の `elementId`） |
| `sequence` | `children` の順に実行 |
| `parallel` | `children` を同時に開始 |
| `tween` | `elementId`、`durationMs`、`to`、任意の `from`・`delayMs`・`easing`・`repeat`・`yoyo` |

同じ `timelineId` のステップは配列順に進み、次の開始条件は同じ系列の前ステップの完了を基準にします。`timelineId` の省略は共通の既定系列です。`click` の `elementId` を省略するとスライド上のクリック、指定するとその要素のクリックを待ちます。要素IDは同じスライド内の既存IDです。

`tween` の `from` は開始時に適用し、省略したプロパティは開始時の値を使います。クリック待ちや遅延中は先行する動きの結果を維持し、最初の動きの前は元の要素値を使います。`from: { opacity: 0 }` だけでは開始前に隠れません。最初から非表示にしたい場合は、上の例のように元の要素の `opacity` も0にします。`to` は終了値です。補間できるプロパティは `x`、`y`、`width`、`height`、`rotation`、`opacity`、`fontSize`、`strokeWidth`、`fill`、`stroke`、`color`、`textColor` で、要素の型にあるものだけ指定できます。テキスト本文・画像データ・IDなどは補間しません。

`easing` は `linear`・`ease-in`・`ease-out`・`ease-in-out`・`spring`・`bounce`。`repeat` は正の安全な整数で指定する有限回数、`yoyo: true` は1回を往復として開始値へ戻します。並列の枝で、同じ要素の同じプロパティを同じ時間帯に変更する設定は拒否します。異なるプロパティは並列に変更できます。無効な対象・値・設定はバッチ全体を失敗させ、途中の変更を残しません。

アニメーションの編集は `features.animations` で制御します。無効にしても保存済みの定義は保持します。ロックされた要素やクリック対象に影響するステップの変更・削除には、先にその要素のロック解除が必要です。要素を削除すると関連tweenを除き、空のグループ・ステップも除きます。クリック対象そのものを削除した場合は、そのステップ全体を除きます。複製では要素の新IDに合わせてアニメーションの参照先も更新します。

`element.duplicate` は独立系列のIDも複製対象内で一貫した新IDへ置き換えます。`slide.duplicate` はページ内で使う系列IDを維持します。

`element.duplicate` は要素の `x`・`y` と、複製するtweenの `from`・`to` に明示した `x`・`y` をそれぞれ20px増やします。`slide.duplicate` は元の要素とtweenの座標を維持します。

アニメーションの件数・グループの深さ・再生時間・反復回数・クリック履歴数に、製品上の固定上限はありません。tweenの時間は正の有限値、遅延は0以上の有限値です。反復回数は正の安全な整数、時間の積算は有限である必要があります。循環したグループ構造は拒否します。`SLIDE_LIMITS` の旧 `animation*` 上限キーは互換性のため残し、値は `Infinity`（制限なし）です。JSON全体のサイズなど、ファイルの検証は維持します。

## 独立した系列を動かす

別々の `timelineId` を指定すると、同じページの再生開始を基準に独立して進みます。一方がクリック待ちでも、他方は再生を続けます。詳細設定の「タイムラインID」からも指定できます。

```ts
const animations = [
  { id: "move", timelineId: "motion", animation: {
    type: "tween" as const, elementId: "heading", durationMs: 2000, to: { x: 240 },
  } },
  { id: "recolor", timelineId: "color", trigger: { type: "click" as const }, animation: {
    type: "tween" as const, elementId: "heading", durationMs: 400, to: { color: "#ff8800" },
  } },
];
```

クリック履歴は系列ごとに判定します。同じクリックに一致する待機中の系列が複数ある場合、それぞれ開始します。同じ系列の連続したクリック待ちを1回のクリックでまとめて進めることはありません。

独立系列どうしで同じ要素の同じプロパティを変更する設定は、時間が重ならないつもりでも拒否します。クリック時刻によって順序が変わるためです。同じプロパティを順番に動かす場合は同一系列へまとめます。系列IDはページ内の分類で、空白なしの1〜200文字。系列数によって動きを自動で省略する処理はありません。

## 取得と保存を区別する

`getDeck` / `getSlides` / `getSlide` / `getElements` / `getElement` は、既定では全ステップが完了した最終静止状態を返します。返り値にアニメーション定義は含まれません。

```ts
import { getDeck, getSlide, getAnimations } from "@likex/slide/model";

const finalSlide = getSlide(deck, "cover");
const sourceSlide = getSlide(deck, "cover", { includeAnimations: true });
const sourceDeck = getDeck(deck, { includeAnimations: true });
const steps = getAnimations(deck, "cover");
```

`includeAnimations: true` では元の要素値を取得します。`getDeck` / `getSlides` / `getSlide` は、返すページの `animations` に全定義も保持します。`getElements` / `getElement` は要素だけを返すため、このオプションでもアニメーション定義は付きません。定義にはページを返すAPIか、定義の配列を返す `getAnimations(deck, slideId)` を使います。

保存・編集を続けるための資料全体は `getDeck(deck, { includeAnimations: true })` で取得してください。通常のgetの返り値を保存すると、最終静止状態だけの資料になります。

`parseSlideDeck` / `serializeSlideDeck` は元の要素値と全アニメーション定義を保持します。表示中のrefにも同じget APIを公開し、`includeAnimations` の意味も共通です。保存・`onSave`・`exportNative`・イベントの `deck`・セッションの `getSnapshot()` は元の値と全定義を維持し、getの既定静止表示とは区別します。保存形式はversion 1のまま、`Slide.animations` は省略可能な追加フィールドです。以前のアニメーションなしの資料も読み込めます。

## 画面なしで再生状態を評価する

```ts
import { evaluateSlideAnimations, resolveSlideAnimations } from "@likex/slide/model";

const source = getSlide(deck, "cover", { includeAnimations: true });
if (source) {
  const frame = evaluateSlideAnimations(source, {
    elapsedMs: 850,
    clicks: [{ elapsedMs: 200 }],
  });
  // frame.slide / frame.finished / frame.waitingForClick / frame.stepId
  const finalFrame = resolveSlideAnimations(source);
}
```

経過時間とクリック時刻は、同じ再生開始時点からのミリ秒です。要素クリックを表す場合はクリックに `elementId` を渡します。関数は元のスライドを書き換えず、評価結果のスライドと完了・クリック待ちの状態を返します。最終静止状態の解決ではクリックや遅延を待たず、全ステップの終了値を計算します。往復するtweenの最終値は開始値です。

名前付きまたは複数の系列がある場合、返り値に `waitingSteps` と `activeSteps` の配列が付きます。待機中は `{ stepId, timelineId?, waitingTargetId? }`、進行中は `{ stepId, timelineId?, stepStartMs, stepEndMs }` です。`waitingForClick` がtrueでも別系列が動いている場合があります。従来の `stepId` などは最初の待機系列、待機がなければ最初の進行系列を表します。既定系列1つだけの資料では従来通りこの配列を省略します。

## PNG・PPTXとの関係

PNGの既定出力は最終静止状態です。`animationState: "initial"` を指定すると元の要素値で出力します。PPTXは元の要素とPowerPoint標準のアニメーションタイムラインを書き出します。書き出し前に通常のgetで静止状態へ変換すると定義を失うため、元データを渡してください。

```ts
const original = getDeck(deck, { includeAnimations: true });
const pptx = await exportSlidePptx(original, {
  onWarning: message => console.warn(message),
});
```

順番・同時実行・遅延・クリック・繰り返し・往復を変換します。ばね・バウンドや透明度には近似を使います。文字サイズ・線幅・透明色は複数の編集可能な図形の表示切り替えへ近似し、その影響を通知します。SLONは元の定義をそのまま保持しますが、PPTXへの変換・再読み込みではノードの分割やグループ構成が変わることがあります。編集原本はSLONで保管し、出力時の `onDiagnostic` と読み込み結果の `diagnostics` で対象箇所を確認してください。従来の `onWarning` / `warnings` も使えます。[PowerPointの対応範囲](powerpoint.md)

[JSONとコマンド](commands.md) · [PNG画像出力](image-export.md)
