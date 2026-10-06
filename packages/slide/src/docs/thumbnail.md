# スライドとPDFの軽量サムネイル

一覧カードなどには `LikeSlideThumbnail` / `LikeSlidePdfThumbnail` を使います。タイトルヘッダーを残し、先頭の1ページだけを表示します。編集セッション、リボン、左のページ一覧、選択操作、ズーム操作は作成しません。

```tsx
import { LikeSlideThumbnail, LikeSlidePdfThumbnail } from "@likex/slide/thumbnail";
import "@likex/slide/styles.css";

<LikeSlideThumbnail deck={deck} style={{ height: 280 }} />
<LikeSlidePdfThumbnail loadPdf={loadPdf} title="提案資料.pdf" style={{ height: 280 }} />
```

`deck` は `parseSlideDeck` / `importSlidePptx` などで読み込んだモデルです。別のモデルを渡すと表示が更新されます。`loadPdf` は [PDFの閲覧](pdf-viewer.md)と同じ `SlidePdfLoader` で、`createSlidePdfLoader` も `/thumbnail` からimportできます。同じPDFではloaderの参照を保持してください。

共通の指定項目は `title`、`colorMode`、`primaryColor`、`className`、`style`、`aria-label`、`onError` です。高さは既定280pxで、ヘッダーを除く枠内に縦横比を保って縮小します。原寸より大きくは表示しません。編集用refやページ切り替えpropsはありません。詳細を開くボタンやカードのクリック処理は、利用側の外枠に用意してください。

通常のスライドは1枚目の背景・マスター・レイアウト・要素を既存の静止画描画と共用します。アニメーションは再生せず、最終静止状態を表示します。本文のリンクや要素は操作できません。SSRでも先頭ページの描画を出力します。

PDFは1ページ目だけを取得・描画し、ビットマップを約20万画素までに制限します。枠のサイズ変更ではCSS/SVGによる縮小だけを行い、PDFを再描画しません。読み込み中・エラーの表示と、入力変更やアンマウント時のキャンセル・文書破棄を行います。SSRではヘッダーと読み込み表示を出し、PDFはブラウザーで読み込みます。

サムネイルでも入力全体の検証は省略しません。正規化済みのスライドモデルは検証キャッシュを利用します。PDFの全ファイル読み込み・解析コストは注入したloaderに依存するため、部分的な通信まで保証するものではありません。大量の一覧では利用側で画面内のカードだけをマウントするなどの制御を組み合わせてください。

パッケージの `/thumbnail` は編集UIを含まない専用入口です。ソースコピーでは `components/slide/thumbnail` を利用できます。通常の入口からも両コンポーネントを名前付きimportできます。保存モデル・SLON・PPTX・PDFファイル自体は変更しません。
