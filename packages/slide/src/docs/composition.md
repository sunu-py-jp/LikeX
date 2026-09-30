# 内容と構図からページを作る

`slide.compose` は主張・比較・フローなどの意味を持つ入力から、1ページのテキスト・図形・接続線を配置します。LikeSlide本体の公開APIであり、AIやplaygroundを使わず利用できます。既定の構図と書式を本体で持つため、利用側が座標や文字サイズを一つずつ調整する必要はありません。生成結果は通常の編集可能な要素なので、GUIや要素コマンドで部分修正できます。

新規ページの本文や全面的な再設計に使います。対象ページのローカル要素はすべて置き換わるため、タイトルの変更や色の調整には `element.update` などの部分編集を使ってください。

## 公開APIとコマンド

```ts
import {
  createSlideDeck, applySlideCommands, composeSlideContent,
  getSlideCompositionPresets, getSlideCompositionLayouts,
} from "@likex/slide/model";
import type { SlideComposition } from "@likex/slide/model";

const deck = createSlideDeck({ title: "ERP新機能提案" });
const composition: SlideComposition = {
  kind: "comparison",
  title: "例外対応を、担当者任せにしない。",
  eyebrow: "ERP / PROPOSAL",
  before: { title: "個別に確認", body: "メールと表計算で状況を集める。\n担当と期限が分散する。" },
  after: { title: "一画面で判断", body: "関連する情報と根拠を集約。\n担当と期限を追跡する。" },
  footer: "提案コンセプト。効果は導入前の計測で検証します。",
};
const result = applySlideCommands(deck, {
  type: "slide.compose", slideId: deck.slides[0].id,
  preset: "executive", composition,
});

const presets = getSlideCompositionPresets();
// readonly { id, name, description }[]。資料やUI状態を変更しません。
const layouts = getSlideCompositionLayouts();
// 構図の名前・説明、件数制限、文字数の上限を読みます。

// 適用前の要素を調べる場合は、同じ処理から置換コマンドを作れます。
const command = composeSlideContent(deck, deck.slides[0].id, composition, {
  preset: "executive", notes: "現状の手作業と、提案後の判断の流れを比較する。",
});
// command.type === "slide.replaceContent"。生成・検証だけで、deckは変更しません。
const inspectedResult = applySlideCommands(deck, command);
```

`composeSlideContent(deck, slideId, composition, options?)` の `options` は `preset?`、`notes?`、`measureText?: SlideTextMeasure` です。戻り値は `Extract<SlideCommand, { type: "slide.replaceContent" }>`。`measureText` を注入するとホストのフォントによる文字幅で検証できます。関数をJSONコマンドや保存ファイルへ埋め込む必要はありません。

`slide.compose` も通常のコマンド配列、CLIの `apply`、表示中の `SlideHandle.execute` で使えます。1コマンドは1ページを対象とし、複数ページの生成はページごとのコマンドに分けます。純粋なモデルAPIは認証・保存・通信を行わず、表示中の編集は既存の機能設定、編集許可、履歴の経路を通ります。

## 内容の型

すべての構図で `title` が必須、`eyebrow`、`subtitle`、`footer` は任意です。文字列には通常の改行を使えます。JSONの `"\n"` は改行、`"\\n"` はバックスラッシュとnの2文字になります。

| `kind` | 内容 | 向いている情報 |
| --- | --- | --- |
| `hero` | `highlights?: string[]` | 主張と短い価値の提示 |
| `comparison` | `before` / `after`: `{ title, body }` | 現状と提案、導入前後の比較 |
| `features` | `items: { title, body }[]` | 並列の機能・価値 |
| `flow` | `steps: { title, body }[]` | 読む順序のある手順 |
| `architecture` | `columns: { title, nodes: { id, title, body? }[] }[]`, `connections: { from, to, label? }[]` | 区画ごとの要素と接続関係 |
| `closing` | `action: string`, `details?: string` | 具体的な次の行動 |

`architecture` のノードIDはその入力内で一意にし、接続の `from` / `to` から参照します。既存要素のIDを推測して指定するものではありません。接続は隣接する列か同じ列の異なるノード間に限り、同じ組の重複接続は拒否します。通常の2点の線に変換され、生成したノードへ追従します。任意の図の自動配線ではないため、複雑な経路は生成後に要素や接続線を編集してください。

構図と制限は `getSlideCompositionLayouts()` から取得できます。

| 対象 | 件数 |
| --- | --- |
| `hero.highlights` | 0〜3 |
| `features.items` | 2〜4。4項目は2列×2段 |
| `flow.steps` | 2〜5 |
| `architecture.columns` | 2〜4 |
| 各列の `nodes` | 1〜2 |
| `architecture.connections` | 0〜8 |

文字数の上限は書記素単位です。`title` 64、`eyebrow` 40、`subtitle` 120、`footer` 90。比較・機能の項目は見出し28／本文160、手順は見出し20／本文90、構成図は列見出し24／ノード見出し26／ノード本文70／接続ラベル12。`hero` の各強調項目は32、`closing` の `action` は72／`details` は160です。上限以内でも実際の行数が領域に収まらなければ拒否します。

## デザインとマスター

`preset` は `executive`（既定）/ `editorial` / `contrast` のいずれかで、カタログにはそれぞれの名前と用途を返します。Executiveは白地に紺と青緑、Editorialは暖色の背景・パネルとセリフ体見出し、Contrastは暗色の背景と紫のアクセントを使います。レイアウトのないページはプリセットの背景にします。資料内で配色・余白・文字階層を揃え、構図は内容に合わせて変えられます。これらはLikeSlideで独自に定義したプリセットであり、PowerPointのレイアウトIDとは別です。

対象ページにマスター・レイアウトがある場合、その参照、背景、共通装飾を保持します。利用可能なタイトルのプレースホルダーは位置・書式・対応IDを引き継ぎ、それ以外の新しい本文は選んだプリセットで配置します。共有要素をローカルに複製したり、背景を覆ったりしません。端の装飾を避けて本文領域を確保し、中央の共有装飾と衝突するなど十分な領域を確保できなければ拒否します。任意のマスターの本文書式まで完全に再現するAPIではないため、必要に応じて別の適切なレイアウトか低水準の配置を選んでください。

ページID、名前、順序、他ページは保持します。ノートは `notes` の省略で保持し、指定時だけ置き換えます。旧要素を参照するアニメーションはクリアします。ロックされた旧要素の破棄、無効な入力、収まらない内容は失敗し、入力資料やバッチの一部だけを変更しません。

## 文字の収まりと確認

対象サイズは640×360px以上、横縦比1.1〜2.5です。既存ページのサイズを勝手に変更せず、寸法に応じて配置します。構図ごとの件数制限と文字の収まりを適用前に検証し、内容を途中で切り捨てたり、読めないサイズまで自動縮小したりしません。日本語・結合文字を含む文字列は書記素のまとまりを尊重し、行数と文字幅から配置可能か判定します。長すぎる場合は要点を保って文章を整理するか、構図やページ分けを見直します。

描画環境の文字幅を使う例です。フォントのロードやCanvasの管理は利用側で行います。

```ts
import type { SlideTextMeasure } from "@likex/slide/model";
const measureText: SlideTextMeasure = (text, style) => {
  context.font = `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${style.fontSize}px ${style.fontFamily}`;
  return context.measureText(text).width;
};
const measured = composeSlideContent(deck, deck.slides[0].id, composition, { measureText });
```

既定の測定はホストにフォントを要求しないため、実際のフォントによるPNG・GUI・PowerPointの折り返しと完全には一致しません。最後の編集後に各ページの画像と `getSlideLayoutDiagnostics` を確認してください。診断は文字切れやページ外へのはみ出しを検出しますが、重なりの意図、線の交差、コントラスト、主張の伝わり方までは保証しません。

## 保存とAIホストの責務

構図の入力を新しい保存形式として持つのではなく、既存の文字・図形・線へ展開します。SLONのparse/serialize、PPTXのimport/exportは通常の要素とマスター参照を扱うため、画像1枚に固定されません。Office変換時の制約と診断は [PowerPoint入出力](powerpoint.md) に従います。

AIの選定、プロンプト、ツールの公開、処理の継続・キャンセル、保存先は利用側の責務です。playgroundでは `get_slide_designs` で構図とプリセットを取得し、`compose_slide` で1ページずつ適用します。1回のユーザー指示で複数ページを作成できます。部分修正は既存のテキスト・書式ツールを使い、最後に `preview_slide` で変更した各ページを確認します。
