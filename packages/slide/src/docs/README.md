# LikeSlideの導入

LikeSlideはスライドをJSONで保持するReactコンポーネントです。標準ファイルは `.slon` で、中身はJSONです。保存先への通信は親アプリに任せ、編集はクライアント側の下書きとして扱います。

PDFを同じ外観で閲覧する場合は、[PDFの閲覧](pdf-viewer.md)の `LikeSlidePdfViewer` を使います。閲覧時だけPDF.js等の描画エンジンをホストから注入します。

サーバー側でキーワードからページ・要素を探す場合は、[キーワード検索](search.md)の `searchSlides` を使います。

一覧カードなどでタイトルと先頭ページだけを表示する場合は、[軽量サムネイル](thumbnail.md)の `LikeSlideThumbnail` / `LikeSlidePdfThumbnail` を使います。

## パッケージで使う

CoreとSlideのtarballをインストールします。npmレジストリへの公開は未実施です。

```bash
npm install ./likex-core-0.1.0.tgz ./likex-slide-0.1.0.tgz
```

```tsx
"use client";
import LikeSlide, { createSlideDeck, serializeSlideDeck } from "@likex/slide";
import "@likex/slide/styles.css";

const initialDeck = createSlideDeck({ title: "提案資料" });
export default function Editor() {
  return <LikeSlide initialDeck={initialDeck} onSave={async deck => {
    const response = await fetch("/api/deck", { method: "PUT", body: serializeSlideDeck(deck),
      headers: { "Content-Type": "application/json" } });
    if (!response.ok) throw new Error("保存できませんでした");
  }} colorMode="system" style={{ height: 720 }} />;
}
```

CSSはアプリの入口で1回importします。Next.js App Routerでは `app/layout.tsx` に置けます。イベントを渡す親はClient Componentにしてください。React / React DOMは19.2.6以降の19系を使用します。Tailwind CSSや専用Providerは不要です。

## コピーで使う

1. `packages/core/src/` を `components/core/` にコピーします。
2. `packages/slide/src/` を `components/slide/` にコピーします。
3. `slide/core.ts` を `export * from "../core";` に変更します。
4. `react`、`react-dom`、`lucide-react`、`re2js` を利用先へインストールし、`components/slide` と `components/slide/styles.css` をimportします。

Coreへの参照は `slide/core.ts` に集約されています。`browser.ts`・`ooxml.ts`・`json.ts`・`model/core-*.ts` の変更は不要です。`re2js` はCoreの依存です。各依存の対応バージョンはCoreとSlideの `package.json` を参照してください。

更新時はCoreとSlideの `src/` 全体を同じバージョンで差し替え、`slide/core.ts` の接続先を再設定してください。`LICENSE` と `THIRD_PARTY_NOTICES.md` は両方のフォルダに残してください。

## 表示と編集の設定

| プロパティ | 型 | 省略した場合 |
| --- | --- | --- |
| `initialDeck` | `SlideDeck` | 空のスライド1枚 |
| `initialMaster` | `SlideMasterApplication` | 初期マスター適用なし。全ページへの初期適用とページ別の例外を指定（[マスター](masters.md#初期表示から全ページに適用する)） |
| `initialPageNumber` / `initialSlideId` | `number` / `string` | 先頭ページ。初回のみ適用し、両方指定すると一致を検証 |
| `initialSearchOpen` / `initialSearchQuery` | `boolean` / `string` | 検索欄は閉じた状態・空文字。初回のみ適用（[検索](search.md)） |
| `onSave` | `(deck) => void または Promise<void / SlideDeck>` | 読み取り専用 |
| `readOnly` | `boolean` | `onSave` の有無に従う |
| `layout` | `"auto" / "desktop" / "mobile"` | `auto`。コンポーネントの幅が720px未満ならモバイル表示 |
| `colorMode` | `"light" / "dark" / "system"` | ライト |
| `primaryColor` | `string`（`#RGB` / `#RRGGBB`） | オレンジ |
| `initialRibbonDisplayMode` | `SlideRibbonDisplayMode` | 初回は `expanded` |
| `ribbonDisplayMode` | `SlideRibbonDisplayMode` | 省略時は内部管理 |
| `onRibbonDisplayModeChange` | `(mode) => void` | 制御中の変更要求を通知 |
| `title` | `string` | 資料のタイトルを利用 |
| `exportFileName` | `string` | 資料のタイトルをダウンロード名に利用。`.slon` / `.json` / `.pptx` の末尾は出力形式に合わせて置換 |
| `style` / `className` | Reactの標準型 | 親側で高さを指定 |
| `features` | `SlideFeatures` | 全機能有効 |
| `warnOnUnsavedChanges` | `boolean` | 未保存の離脱確認を有効化 |

`features` のキーは `addSlides`、`deleteSlides`、`reorderSlides`、`text`、`shapes`、`images`、`formatting`、`masters`、`animations`、`notes`、`import`、`export`、`presentation`、`history`、`search` です。`false` の機能は画面から隠し、対応する操作も受け付けません。

「デザイン」ではPPTX／POTXからマスターだけを取り込めます。「ホーム」の「レイアウト」では、マスター名ごとのサムネイル一覧からクリックして選択ページへ適用します。「新しいスライド」横の▼からは、レイアウトを選んでページを追加できます。画面とAPIの手順は[スライドマスターの取り込みと利用](masters.md)を参照してください。

```tsx
<LikeSlide initialDeck={deck} onSave={saveDeck}
  features={{ import: false, images: false }} style={{ height: 720 }} />
```

`initialDeck` / `initialMaster` は初回のみ読み込みます。`initialMaster` は適用後の資料を編集・保存の初期状態とし、読み取り専用でも使えます。別の資料に切り替えるときは `<LikeSlide key={documentId} ... />` とします。認証・保存先・共同編集の競合解決は親アプリの責務です。

## スマートフォン・狭い領域での表示

`layout` を省略すると、ブラウザー全体ではなく配置先の幅を監視し、720 CSS px未満でモバイル表示に切り替えます。スマートフォン以外でも、狭いダイアログや分割ペイン内では同じ表示になります。`layout="desktop"` / `"mobile"` で固定でき、propsの変更にも追従します。型 `ResponsiveLayout` は公開入口からimportできます。

```tsx
<LikeSlide initialDeck={deck} readOnly layout="auto"
  style={{ width: "100%", height: "80dvh", minHeight: 420 }} />
```

モバイルでは本文を優先し、スライド一覧・検索をボタンから開くパネルにします。一覧からページを選ぶとパネルを閉じ、前後のページボタンでも移動できます。ノートは初期状態で閉じ、ノートボタンで表示します。書式パネルは表示領域内に重ね、リボンのタブとコマンドは横スクロールできます。編集可否・機能フラグ・リボン表示モードは引き続き同じ設定が適用されます。

タッチでは一覧やキャンバスをスワイプしてスクロールします。キャンバスの要素はタップで選択し、選択済みの編集可能な要素をドラッグすると移動します。選択ハンドルはタッチしやすい大きさになり、スライドの並べ替えは各カードの「…」から前後へ移動できます。読み取り専用でもページ移動・検索・ズームを利用でき、要素に触れても編集ドラッグは開始しません。表示切り替えで資料寸法、`.slon`、PPTX、Undo履歴を変更しません。

## プライマリカラー

```tsx
<LikeSlide initialDeck={deck} onSave={saveDeck}
  primaryColor="#2563eb" colorMode="system" style={{ height: 720 }} />
```

`primaryColor` は一番上のタイトルバー・保存ボタン・選択表示などのUI色です。文字色や選択色は読みやすさに合わせて調整します。値を変更すれば表示へ即時反映され、スライド内の文字・図形・背景の色や保存するJSONは変わりません。未指定・不正な値は既定色を使用します。`style` で明示したCSS変数は優先します。

[リボンの表示](ribbon-display.md) · [編集](editing.md) · [保存とイベント](lifecycle.md) · [コマンドとJSON](commands.md) · [自由な資料設計とSVG](freeform-design.md) · [PowerPoint入出力](powerpoint.md) · [PNG画像の書き出し](image-export.md) · [画像の収集と重複判定](image-analysis.md) · [アニメーション](animations.md)
