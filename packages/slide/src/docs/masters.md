# スライドマスターの取り込みと利用

PowerPointの `.pptx` / `.potx` からマスターとレイアウトを取り込み、現在の資料で再利用できます。スライドのないPOTXも取り込めます。取り込みはカタログを追加する操作で、現在のページや本文を置き換えません。

## 画面で使う

1. 「デザイン」→「マスターを読み込む」で `.pptx` / `.potx` を選びます。元のページを追加・置換せず、マスターと配下のレイアウトだけを取り込みます。
2. 左の一覧で適用先のページを選び、「ホーム」→「レイアウト」を開きます。マスター名ごとにレイアウトのサムネイルが並び、選択した全ページに共通して適用されているレイアウトを強調表示します。
3. サムネイルで共通装飾とプレースホルダーの配置を確認し、使うレイアウトをクリックすると選択ページへ適用します。別の適用ボタンはありません。複数ページを選んでいれば、まとめて適用し、1回のUndoで戻せます。
4. 別のレイアウトでページを追加する場合は、「新しいスライド」の横の▼（「新しいスライドのレイアウト」）を開き、サムネイルを選びます。「新しいスライド」本体を押すと、現在のページのレイアウトを引き継いで追加します。

「デザイン」からも同じレイアウト一覧を開けます。一覧を開く・閉じる、サムネイルにマウスを重ねる操作では、本文・未保存状態・Undo履歴を変更しません。サムネイル内の文字はレイアウト原型の見本で、新しいテキスト欄にその本文を挿入するものではありません。一覧ではレイアウトのないマスターも見出しを表示しますが、適用・追加できる候補はありません。資料内にレイアウトが1つもない場合は、一覧ボタンを無効にして「デザイン」に読み込み案内を表示します。

取り込み・適用・解除はUndoできます。「継承を解除」では、共通装飾をページ自身の要素に変換して見た目を保ちます。

ロゴや背景図形はマスター／レイアウトの共有要素として背面に表示し、ページ上の選択・移動・削除の対象にはしません。タイトルや本文のプレースホルダーはページ自身の要素になるため、通常のテキストと同じように編集できます。空欄の入力案内はエディターだけに表示し、保存内容・画像・スライドショー・PPTXには含めません。

`features.masters` で機能全体を制御します。`features.import` は読み込み、`features.formatting` は適用・解除、`features.addSlides` は新規ページ作成に使います。読み取り専用や処理中は編集操作を無効にし、編集許可コールバックも通常の編集と同じ経路で確認します。`SlideHandle.importPptxMasters(input, { signal?, onDiagnostic? })` からも表示中の資料へ取り込めます。読み込みの途中で資料や編集可否が変わった場合、古い結果を適用しません。画面のキャンセルか `cancelMasterImport()` でも中止できます。handleにも `getSlideMasters()` / `getSlideLayouts(masterId?)` / `getSlideLayout(layoutId)` があり、表示中の下書きから取得します。

## 初期表示から全ページに適用する

`initialMaster` に `SlideMasterApplication` を指定すると、初回表示の時点で全ページにマスター配下のレイアウトを適用します。資料内に取り込み済みのレイアウトなら、そのIDだけで指定できます。

```tsx
<LikeSlide initialDeck={deck}
  initialMaster={{ layoutId: selectedLayoutId }} readOnly />;
```

別のPPTX／POTXを使う場合は、利用側でファイルの読み込みを完了してから `library` を渡します。`initialMaster` はBlobやURLを直接受け取りません。

```tsx
import LikeSlide, { importSlidePptxMasters } from "@likex/slide";

const { library, diagnostics } = await importSlidePptxMasters(templateFile);
// libraryの候補から利用者が選んだレイアウトIDを指定します。
// coverSlideId / appendixSlideId は初期資料に存在するページのIDです。
const view = <LikeSlide initialDeck={deck} initialMaster={{
  library,
  layoutId: bodyLayoutId,
  layoutsBySlideId: {
    [coverSlideId]: titleLayoutId,
    [appendixSlideId]: null,
  },
}} onSave={saveDeck} />;
```

| 指定 | 内容 |
| --- | --- |
| `layoutId` | 必須。例外指定のない全ページに適用するレイアウト |
| `library` | 任意。読み込み済みの `SlideMasterLibrary` を現在の資料に追加し、サイズ・IDを調整して適用 |
| `layoutsBySlideId` | 任意。ページIDをキーに別のレイアウトIDを指定。`null` はそのページを既存のレイアウト・本文のまま残す |

`library` を渡した場合、`layoutId` と例外のレイアウトIDは**取り込み元のlibrary内のID**です。適用先の新IDへの変換は内部で行います。省略時は `initialDeck` 内のレイアウトIDを使います。ページ番号やマスターIDだけでは指定せず、既存ページIDと利用するレイアウトIDを明示してください。

この指定は表示上の重ね合わせではなく、適用後の資料を初期状態にする処理です。`getDeck()`、保存、SLON／PPTX出力にも適用結果が含まれます。呼び出し側の `initialDeck` / `library` は変更しません。初期適用による未保存状態・Undo履歴・`onChange` 通知・編集許可要求は発生せず、後から加えた変更を破棄すると、適用後の初期状態に戻ります。`readOnly` や機能OFFでも初期データには反映し、機能設定は表示後の操作を制御します。

不正なID、ロックされた欄の変更、容量・構造の制限などで失敗した場合は、カタログ追加も含めて適用せず、元の資料とエラー通知を表示します。初期表示後のprops変更では再適用しません。別の初期設定で開く場合はコンポーネントの `key` を変えて再マウントし、表示中の資料を変更する場合は次のコマンドを使います。

```ts
await handle.execute({
  type: "deck.applyMaster",
  layoutId: selectedLayoutId,
  layoutsBySlideId: { [coverSlideId]: titleLayoutId },
});
```

`deck.applyMaster` も同じ `SlideMasterApplication` の引数を使います。表示中の操作では `features.masters` / `features.formatting`、`library` 付きなら `features.import`、読み取り専用・編集許可を確認し、全体を1回のUndoで戻せる変更として扱います。今回の指定で新しいページを追加し続ける規則を設定するわけではなく、実行時点のページが対象です。

## 表示中の資料をAPIから操作する

コンポーネントの `ref` が返す `SlideHandle` でも、マスターの取り込み・一覧取得・適用を操作できます。利用側の選択UIにはマスターごとのレイアウト一覧を渡し、選ばれたIDで適用します。

```ts
import type { SlideHandle } from "@likex/slide";

async function loadMasterChoices(handle: SlideHandle, file: Blob) {
  await handle.importPptxMasters(file);
  return handle.getSlideMasters().map(master => ({
    id: master.id,
    name: master.name,
    layouts: handle.getSlideLayouts(master.id),
  }));
}

async function applyChosenLayout(
  handle: SlideHandle, masterId: string, layoutId: string,
) {
  const layout = handle.getSlideLayouts(masterId).find(item => item.id === layoutId);
  if (!layout) throw new Error("選択したマスターのレイアウトが見つかりません");
  const selection = handle.getSelection();
  const slideIds = selection.slideIds ?? [selection.slideId];
  return handle.execute(slideIds.map(slideId => ({
    type: "slide.applyLayout" as const, slideId, layoutId: layout.id,
  })));
}
```

一覧取得は資料を変更しません。`execute` は表示中の読み取り専用・機能設定・編集許可を確認し、複数ページへの適用を1回のUndoで戻せる操作として実行します。マスターIDだけでページに適用するのではなく、その配下のレイアウトIDを指定します。

## 公開モデルAPI

```ts
import {
  importSlidePptxMasters, applySlideCommands,
  getSlideMasters, getSlideLayouts, resolveSlideAppearance,
} from "@likex/slide/model";

const { library, warnings, diagnostics } = await importSlidePptxMasters(file);
const imported = applySlideCommands(deck, { type: "masters.import", library });
const choices = getSlideMasters(imported.deck)
  .filter(master => imported.masterIds?.includes(master.id))
  .map(master => ({ ...master, layouts: getSlideLayouts(imported.deck, master.id) }));

// choicesから利用者が選んだマスターとレイアウトのIDを渡します。
function applyImportedLayout(masterId: string, layoutId: string) {
  const layout = choices.find(master => master.id === masterId)
    ?.layouts.find(item => item.id === layoutId);
  if (!layout) throw new Error("取り込んだレイアウトが見つかりません");
  const applied = applySlideCommands(imported.deck, {
    type: "slide.applyLayout", slideId: imported.deck.slides[0].id, layoutId: layout.id,
  });
  const added = applySlideCommands(applied.deck, {
    type: "slide.add", layoutId: layout.id, slide: { name: "提案内容" },
  });
  const appearance = resolveSlideAppearance(added.deck, added.deck.slides[0]);
  // background + inheritedElements + localElements の順で表示します。
  return { deck: added.deck, appearance };
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
| `applySlideMaster(deck, application)` | 画面なしで全ページへ適用。`{ deck, masterIds?, layoutIds? }` を返す |
| `deck.applyMaster { layoutId, library?, layoutsBySlideId? }` | カタログ追加と全ページへの適用をまとめて実行。例外指定可 |
| `slide.add { layoutId, slide? }` | レイアウトを使って1ページ作成 |
| `slide.applyLayout { slideId, layoutId }` | 既存ページへ適用 |
| `slide.detachLayout { slideId }` | 共有装飾を通常の要素へ変換して解除 |

適用時は既存のプレースホルダーをID、続いて種別と順序で対応づけ、内容と既存要素IDを維持して位置・書式を更新します。新しいテキスト欄の本文は空で追加し、画像の欄は原型の画像を引き継ぎます。対応する欄がなくなった本文は通常の要素として残します。通常の図形やテキストを勝手に削除しません。変更が必要なロック要素を含む操作は失敗し、途中まで変更しません。

`applySlideMaster` と型 `SlideMasterApplication` はUI入口と `@likex/slide/model` から公開します。純粋な関数は不正な指定で例外を投げ、入力を変更しません。GUIの初期適用と同じデータ処理を使いますが、編集許可・履歴・通知は呼び出し側が管理します。

`getSlide` / `getElements` はページ自身の要素だけを返します。共有装飾を含む見た目の取得には `resolveSlideAppearance` を使ってください。ページの背景を明示的に変更すると、そのページの背景色を優先します。

ページ自身の文字・図形・SVG素材は、要素コマンドで自由に配置できます。全面置換には `slide.replaceContent` を使い、共通装飾やプレースホルダーの領域を取得して配置を設計してください。レイアウト参照は保持されますが、新要素がタイトル等の欄を引き継ぐ場合は `layoutPlaceholderId` を明示します。背景を省略すれば既存の背景設定を保ちます。詳しくは [自由な資料設計とSVG](freeform-design.md) を参照してください。

## 保存とPowerPoint変換

`.slon` はマスター・レイアウトのカタログとページの `layoutId` を保存します。既存のカタログを持たないファイルも引き続き読めます。通常のPPTX読み込みでもマスターを保持し、PPTX出力ではマスター・レイアウトと各ページの参照を再構成します。

対応する背景、基本図形、画像、プレースホルダーの配置と基本書式、解決済みのテーマ色・フォントを取り込みます。PowerPointのマスター編集画面や、元のテーマ／XMLをそのまま保存する機能ではありません。グループ、表、グラフ、SmartArtなど未対応の内容は診断で通知します。共有カタログも資料全体の画像容量・文字数・要素数の上限に含めます。各ページの要素数と全ページの表示要素数は、継承装飾を含めて検証します。[PowerPoint変換の対応範囲](powerpoint.md)を確認してください。
