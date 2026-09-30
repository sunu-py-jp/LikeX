# スライドマスターの取り込みと利用

PowerPointの `.pptx` / `.potx` からマスターとレイアウトを取り込み、現在の資料で再利用できます。スライドのないPOTXも取り込めます。取り込みはカタログを追加する操作で、現在のページや本文を置き換えません。

## 画面で使う

「デザイン」のマスター読み込みからファイルを選びます。取り込んだレイアウトを選んで現在のページへ適用するか、そのレイアウトで新しいページを追加します。左の一覧で複数ページを選んだ場合はまとめて適用できます。取り込み・適用・解除はUndoできます。適用解除では、共通装飾をページ自身の要素に変換して見た目を保ちます。

ロゴや背景図形はマスター／レイアウトの共有要素として背面に表示し、ページ上の選択・移動・削除の対象にはしません。タイトルや本文のプレースホルダーはページ自身の要素になるため、通常のテキストと同じように編集できます。空欄の入力案内はエディターだけに表示し、保存内容・画像・スライドショー・PPTXには含めません。

`features.masters` で機能を制御します。読み取り専用、インポートや書式設定の可否、編集許可コールバックも通常の編集と同じ経路で確認します。`SlideHandle.importPptxMasters(input, { signal?, onDiagnostic? })` からも表示中の資料へ取り込めます。読み込みの途中で資料や編集可否が変わった場合、古い結果を適用しません。画面のキャンセルか `cancelMasterImport()` でも中止できます。handleにも `getSlideMasters()` / `getSlideLayouts(masterId?)` / `getSlideLayout(layoutId)` があり、表示中の下書きから取得します。

## 公開モデルAPI

```ts
import {
  importSlidePptxMasters, applySlideCommands,
  getSlideMasters, getSlideLayout, resolveSlideAppearance,
} from "@likex/slide/model";

const { library, warnings, diagnostics } = await importSlidePptxMasters(file);
const imported = applySlideCommands(deck, { type: "masters.import", library });
const importedLayoutId = imported.layoutIds?.[0];
const layout = importedLayoutId ? getSlideLayout(imported.deck, importedLayoutId) : undefined;
if (layout) {
  const applied = applySlideCommands(imported.deck, {
    type: "slide.applyLayout", slideId: imported.deck.slides[0].id, layoutId: layout.id,
  });
  const added = applySlideCommands(applied.deck, {
    type: "slide.add", layoutId: layout.id, slide: { name: "提案内容" },
  });
  const appearance = resolveSlideAppearance(added.deck, added.deck.slides[0]);
  // background + inheritedElements + localElements の順で表示します。
}
```

`importSlidePptxMasters` は `{ library, warnings, diagnostics }` を返し、資料を変更しません。入力とキャンセル・診断コールバックは `importSlidePptx` と同じです。`masters.import` がサイズの違いを現在の資料へ合わせ、追加するIDを新しく割り当てて追加します。既存資料のIDは変更しません。取り込み元のIDをそのまま適用先へ渡さず、戻り値か取得APIで追加後のIDを確認してください。結果の `masterIds` / `layoutIds` は追加後のIDです。純粋なモデルAPIは編集許可や保存を行わないため、利用側で管理します。

| API／コマンド | 内容 |
| --- | --- |
| `getSlideMasters(deck)` | 取り込んだマスター一覧 |
| `getSlideLayouts(deck, masterId?)` | レイアウト一覧。マスターで絞り込み可 |
| `getSlideLayout(deck, layoutId)` | 特定のレイアウトとプレースホルダー |
| `resolveSlideAppearance(deck, slide)` | 解決後の背景、共有装飾、ページ自身の要素 |
| `masters.import { library }` | カタログ追加。入力を直接変更しない |
| `slide.add { layoutId, slide? }` | レイアウトを使って1ページ作成 |
| `slide.applyLayout { slideId, layoutId }` | 既存ページへ適用 |
| `slide.detachLayout { slideId }` | 共有装飾を通常の要素へ変換して解除 |

適用時は既存のプレースホルダーをID、続いて種別と順序で対応づけ、内容と既存要素IDを維持して位置・書式を更新します。新しいテキスト欄の本文は空で追加し、画像の欄は原型の画像を引き継ぎます。対応する欄がなくなった本文は通常の要素として残します。通常の図形やテキストを勝手に削除しません。変更が必要なロック要素を含む操作は失敗し、途中まで変更しません。

`getSlide` / `getElements` はページ自身の要素だけを返します。共有装飾を含む見た目の取得には `resolveSlideAppearance` を使ってください。ページの背景を明示的に変更すると、そのページの背景色を優先します。

内容から配置を作る [slide.compose](composition.md) も利用できます。レイアウト参照・背景・共通装飾を保ち、利用可能なタイトルの欄は位置と書式を引き継ぎます。新しい本文はプリセットで配置し、共通装飾と衝突して領域を確保できない場合は拒否します。任意のマスターの本文書式まで自動再現するものではありません。

## 保存とPowerPoint変換

`.slon` はマスター・レイアウトのカタログとページの `layoutId` を保存します。既存のカタログを持たないファイルも引き続き読めます。通常のPPTX読み込みでもマスターを保持し、PPTX出力ではマスター・レイアウトと各ページの参照を再構成します。

対応する背景、基本図形、画像、プレースホルダーの配置と基本書式、解決済みのテーマ色・フォントを取り込みます。PowerPointのマスター編集画面や、元のテーマ／XMLをそのまま保存する機能ではありません。グループ、表、グラフ、SmartArtなど未対応の内容は診断で通知します。共有カタログも資料全体の画像容量・文字数・要素数の上限に含めます。各ページの要素数と全ページの表示要素数は、継承装飾を含めて検証します。[PowerPoint変換の対応範囲](powerpoint.md)を確認してください。
