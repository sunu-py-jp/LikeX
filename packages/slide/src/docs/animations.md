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
| ステップ | `id`、任意の `name` と `trigger`、`animation` |
| `trigger` | `immediate`、`after-delay`（`delayMs`）、`click`（任意の `elementId`） |
| `sequence` | `children` の順に実行 |
| `parallel` | `children` を同時に開始 |
| `tween` | `elementId`、`durationMs`、`to`、任意の `from`・`delayMs`・`easing`・`repeat`・`yoyo` |

ステップは配列順に進み、次の開始条件は前ステップの完了を基準にします。`click` の `elementId` を省略するとスライド上のクリック、指定するとその要素のクリックを待ちます。要素IDは同じスライド内の既存IDです。

`tween` の `from` は開始時に適用し、省略したプロパティは開始時の値を使います。クリック待ちや遅延中は先行する動きの結果を維持し、最初の動きの前は元の要素値を使います。`from: { opacity: 0 }` だけでは開始前に隠れません。最初から非表示にしたい場合は、上の例のように元の要素の `opacity` も0にします。`to` は終了値です。補間できるプロパティは `x`、`y`、`width`、`height`、`rotation`、`opacity`、`fontSize`、`strokeWidth`、`fill`、`stroke`、`color`、`textColor` で、要素の型にあるものだけ指定できます。テキスト本文・画像データ・IDなどは補間しません。

`easing` は `linear`・`ease-in`・`ease-out`・`ease-in-out`・`spring`・`bounce`。`repeat` は1〜100の有限回数、`yoyo: true` は1回を往復として開始値へ戻します。並列の枝で、同じ要素の同じプロパティを同じ時間帯に変更する設定は拒否します。異なるプロパティは並列に変更できます。無効な対象・値・設定はバッチ全体を失敗させ、途中の変更を残しません。

アニメーションの編集は `features.animations` で制御します。無効にしても保存済みの定義は保持します。ロックされた要素やクリック対象に影響するステップの変更・削除には、先にその要素のロック解除が必要です。要素を削除すると関連tweenを除き、空のグループ・ステップも除きます。クリック対象そのものを削除した場合は、そのステップ全体を除きます。複製では要素の新IDに合わせてアニメーションの参照先も更新します。

`element.duplicate` は要素の `x`・`y` と、複製するtweenの `from`・`to` に明示した `x`・`y` をそれぞれ20px増やします。`slide.duplicate` は元の要素とtweenの座標を維持します。

1スライドのアニメーションノードは合計500、再帰の深さは8、クリック待ちを除いた遅延・繰り返し込みの合計時間は600,000msまでです。tweenの時間は1ms以上、評価へ渡せるクリック履歴は10,000件まで。公開の `SLIDE_LIMITS` でも確認できます。

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

## PNG・PPTXとの関係

PNGの既定出力は最終静止状態です。`animationState: "initial"` を指定すると元の要素値で出力します。SLONはアニメーション定義を保持しますが、PPTXには最終静止状態を書き出します。PPTXのタイムラインへ変換したり、独自メタデータを埋め込んだりはしません。書き出し時の `onWarning` と、既存PPTXのアニメーションを省略する読み込み警告を利用側で確認してください。[PowerPointの対応範囲](powerpoint.md)

[JSONとコマンド](commands.md) · [PNG画像出力](image-export.md)
