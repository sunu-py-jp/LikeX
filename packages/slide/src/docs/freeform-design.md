# 自由な資料設計とSVG

LikeSlideは、呼び出し側が指定した座標・寸法・書式で文字、図形、接続線、画像を描画します。ページの種類や配色のプリセットへ内容を当てはめる処理は持ちません。レイアウトは通常のコードでもLLMでも設計でき、同じ公開APIで編集・検証・履歴・保存を扱います。

## 利用側と本体の役割

利用側は文章、数値、視線の流れ、配置、素材を決めます。LLMを使う場合は接続、プロンプト、ツール実行のループ、画像を見て修正する工程も利用側が担当します。LikeSlide本体にLLMは接続しません。

本体は `element.add/update`、`line.add/update`、`slide.replaceContent` を適用し、無効な入力や参照を拒否します。画面の `SlideHandle.execute` は、読み取り専用・機能設定・編集許可・Undo/Redoを含めた既存の編集経路を使います。保存先の通信は利用側の責務です。

## 構図を自由に作る

要素ごとの `x/y/width/height`、書式、描画順を指定します。小さな変更は要素コマンドへまとめ、全面改稿は `slide.replaceContent { slideId, elements }` で対象ページを一括置換します。`elements` の配列は背面から前面への順序です。1件でも無効な要素があれば全体を適用しません。

ページ数、構図、文字量、配色は資料の目的から決めます。ページの種類に応じた固定スロットや件数制限はありません。文書全体のサイズ・要素数などの入力上限は維持します。新しいページは `slide.add` で追加できます。モデルAPIは複数ページの一括編集を扱い、AIデモは1回の書き込みを1ページに制限して、1回のユーザー指示で複数ページを順に生成します。

指定したマスターは `getSlideLayouts`、`resolveSlideAppearance` 等で確認し、その背景・共通装飾・プレースホルダーに合わせて本文を配置します。ページのローカル要素を置換してもレイアウト参照は保持します。プレースホルダーと結びつく新要素には `layoutPlaceholderId` を指定します。マスターの解除や背景の上書きは明示的な編集として扱ってください。

## SVG素材を追加する

`createSlideSvgSource(svg)` は静的なSVGを検証し、通常の画像要素の `src` に渡せるBase64 data URLを返します。React、DOM、ネットワーク接続は不要です。SVG内部の要素は単一画像として扱います。見出し・本文・更新する数値は通常のテキスト、追従が必要な線は通常の接続線として組み合わせると、後から編集できます。

```ts
import {
  createSlideDeck, createSlideSvgSource, applySlideCommands,
} from "@likex/slide/model";

const deck = createSlideDeck({ title: "業務データの活用" });
const src = createSlideSvgSource(`<svg xmlns="http://www.w3.org/2000/svg"
  width="600" height="320" viewBox="0 0 600 320">
  <defs><linearGradient id="flow" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0c6675"/>
    <stop offset="1" stop-color="#53c3a7"/>
  </linearGradient></defs>
  <path d="M30 240 C180 240 170 80 310 80 S450 200 570 50"
    fill="none" stroke="url(#flow)" stroke-width="18" stroke-linecap="round"/>
</svg>`);
const result = applySlideCommands(deck, {
  type: "element.add", slideId: deck.slides[0].id,
  element: {
    type: "image", id: "data-flow", name: "データの流れ", src,
    x: 550, y: 230, width: 600, height: 320,
    alt: "データが複数の処理を経てつながる概念図。数値の推移ではない。",
  },
});
```

この例はAPIの使い方を示すもので、座標や図の形を推奨するテンプレートではありません。GUIでは「挿入」の画像からSVGファイルを追加できます。画像として移動・拡大縮小・回転・削除でき、SLONにはSVG本体が保存されます。

対応するのは静的な `path`、基本図形、グループ、グラデーション、クリッピング、テキスト等です。スクリプト、イベント属性、外部参照、CSS、`foreignObject`、埋め込み画像、アニメーションは受け付けません。ルートはSVG名前空間付きの `svg` とし、正の `width/height` または `viewBox` が必要です。入力は1 MiB、10,000ノード、深さ32までで、寸法・資料全体の画像量の上限も検証します。不対応の機能を黙って削除して取り込む処理ではありません。詳しい入力条件は [スキルのSVG参照](../../skills/likex-slide/references/image-export.md#svg素材の入力) にあります。

## 描画後に確かめる

`measureSlideText` と `getSlideLayoutDiagnostics` で文字のはみ出しやページ外の配置を調べ、`exportImage` / `exportImages` で最後の編集後の画像を確認します。測定は描画環境の関数を注入でき、取得や診断だけでは資料を変更しません。

診断で判定するのは寸法や文字の収まりです。主張が伝わるか、図が内容を説明しているか、強調・余白・文字階層が適切か、全ページが単調になっていないかは画像を見て評価します。修正後はそのページを再度描画します。詳しくは [画像出力](image-export.md) と [文字の収まり](commands.md#文字の収まり) を参照してください。

## 保存とPowerPoint

SVGは既存の画像要素の `src` に保存するため、SLONの形式名・versionは変わりません。SVGの検証に対応していない旧ライブラリでは読み込めないので、利用側も対応版へ更新してください。

PPTXには元のSVGとPNG代替画像を保存します。対応するPowerPointではSVGを表示し、非対応の閲覧環境はPNGを使います。ブラウザー用の `@likex/slide` はPNGを自動生成します。DOMのない `@likex/slide/model` のPPTX出力では、利用側が `rasterizeSvg` を注入します。PNG変換の失敗を透明な画像などで置き換えず、出力を失敗として返します。

読み込みは検証できるSVGを優先し、未対応の場合はPPTX内の代替画像を使って診断へ通知します。SVG内部を通常の図形に分解する機能ではありません。対応条件とコールバックは [PowerPoint入出力](powerpoint.md) を参照してください。

## 固定構図APIからの移行

自由な資料設計を妨げるため、以前の `slide.compose`、`composeSlideContent`、`getSlideCompositionPresets`、`getSlideCompositionLayouts` と関連型は削除しました。AIデモの `compose_slide` / `get_slide_designs` も削除しました。互換エイリアスは提供しません。呼び出し側は要素コマンド、または `slide.replaceContent` へ移行してください。

旧APIが生成済みの資料は通常のテキスト・図形・接続線として保存されているため、そのSLONは引き続き読み込み・編集できます。固定構図の削除だけで保存形式を変更したり、既存資料を再配置したりはしません。
