# 検索

## 画面内で検索する

通常のLikeSlideは「ホーム」→「検索」、またはコンポーネント内にフォーカスがある状態で **Ctrl+F / Cmd+F** を押すと検索パネルを開きます。リボンの完全非表示（`hidden`）や読み取り専用でも使えます。入力した文字列を1語のリテラルとして検索し、空白では分割しません。大文字・小文字の区別を切り替えられます。

入力と文書変更に合わせて結果を更新し、件数・一致箇所を強調した抜粋を表示します。検索条件の変更と明示的な前後移動で対象を表示し、資料編集中の結果更新だけでは現在のページ・選択を移動しません。「前へ／次へ」またはEnter／Shift+Enterで巡回し、一致したスライドへ移動して本文の要素を選択・枠で強調します。継承したマスター／レイアウトの要素は枠だけを表示します。検索対象は本文と図形の文字で、ノート・画像内の文字は含みません。検索は保存内容・Undo履歴を変更せず、編集許可を要求しません。

```tsx
const ref = useRef<SlideHandle>(null);
<LikeSlide ref={ref} initialDeck={deck} readOnly initialRibbonDisplayMode="hidden" />;
ref.current?.openSearch("売上"); // 開いて文字列を設定。省略時は前回の文字列を保持
ref.current?.closeSearch();
```

`openSearch(query?: string): boolean` は受付時にtrueを返します。機能無効・アンマウント後・不正な文字列（4,096文字超過を含む）の場合はfalseです。`features={{ search: false }}` でボタン・ショートカット・表示中パネル・refからの呼び出しを無効にします。公開モデルの`searchSlides`はその設定の影響を受けません。

Escまたは閉じるボタンでパネルを閉じるとキャンバスへ戻ります。読み込み・保存等の処理中や未確定の入力がある場合は結果への移動を受け付けません。結果は最大1,000フィールド、一致位置はその内側で数えます。大量の結果は100件ずつ表示し、前後の移動では全取得結果を巡回します。上限による省略は画面で通知します。

## 描画しないキーワード検索

`searchSlides` はサーバーやWorkerで、モデルの本文を検索してスライドID・ページ番号・要素IDを返します。React、DOM、スライド描画は不要です。SLONは `parseSlideDeck`、PPTXは `importSlidePptx` でモデルへ読み込んでから呼びます。

```ts
import { importSlidePptx, searchSlides } from "@likex/slide/model";

const { deck } = await importSlidePptx(pptxBytes);
const result = searchSlides(deck, {
  keywords: ["顧客", "会議"],
  operator: "and", // "and"（既定）または "or"
  matchCase: false,
});

// 例: 同じページの別々の要素がそれぞれのキーワードに一致
// {
//   matches: [
//     { slideId: "page-2", pageNumber: 2, elementId: "heading",
//       source: "text", owner: "slide", ownerId: "page-2", text: "顧客向け提案",
//       matches: [{ keyword: "顧客", from: 0, to: 2 }] },
//     { slideId: "page-2", pageNumber: 2, elementId: "body",
//       source: "text", owner: "slide", ownerId: "page-2", text: "次回の会議で確認",
//       matches: [{ keyword: "会議", from: 3, to: 5 }] }
//   ],
//   truncated: false
// }
```

`pageNumber` は1始まりです。検索結果をクライアントへ返し、通常画面の `initialSlideId` / `initialPageNumber`、表示中の `ref.current?.goToPage(hit.pageNumber)`、サムネイルの `slideId` / `pageNumber` に渡せます。要素を選択する場合は既存の選択APIへ `elementId` を渡します。`owner: "master" | "layout"` の要素は継承元の読み取り専用装飾なので、ページ自身の編集・要素選択には使いません。

## 条件と一致単位

`KeywordSearchQuery` の `keywords` はリテラル文字列の配列です。空配列は0件、空文字の語や不正な `operator` はエラーになります。語は最大64個、1語4,096文字、合計16,384文字です。空白での自動分割や正規表現への変換はしません。`matchCase` は既定 `false` です。

| オプション | 既定値 | 意味 |
| --- | --- | --- |
| `matchBy` | `"page"` | `"page"` は同じページ全体、`"element"` は同じ要素内でAND／ORを判定 |
| `includeNotes` | `false` | ページのノートも検索 |
| `includeNames` | `false` | ページ名・要素名も検索。資料タイトルやカタログ名は対象外 |
| `includeImageAlt` | `false` | 画像の代替テキストも検索。画像を読み込んだりOCRしたりしない |
| `limit` | `1000` | 返す一致フィールド数の上限。1〜10,000の整数 |

既定のANDでは「顧客」と「会議」が同じページの別要素にあっても一致します。ページ間をまたいだANDは一致しません。1つの語が要素境界をまたぐ一致もありません。`matchBy: "element"` では同一要素の本文・名前・代替テキストのうち有効にしたフィールドで判定し、ページ名とノートはそれぞれ独立した単位にします。返すのは、一致条件を満たした単位の中で実際にいずれかの語が見つかったフィールドだけです。

## 検索範囲と結果の位置

本文はテキスト要素と図形の `text` を対象にします。適用中のマスター／レイアウトから継承した要素も、`resolveSlideAppearance` と同じ範囲で検索します。`showMasterShapes: false` で除外されたマスター、未使用カタログ、プレースホルダー原型は検索しません。ページ自身の要素は透明・画面外でも含みます。画像やSVGの内部文字・フォントの描画結果は対象外です。

結果はページ順で、ページ名、継承要素、ページ自身の要素、ノートの順に並びます。要素はモデル内の描画順を維持します。`owner` / `ownerId` がその要素の定義元を示します。1つのフィールドに複数の一致があっても外側の結果は1件で、内側の `matches` に一致語と開始／終了位置を返します。`from` / `to` は返した `text` 内のUTF-16オフセットで、終了位置は含みません。`text.slice(from, to)` で元の表記を取得できます。

`limit` は一致条件の評価を切り詰めず、返すフィールド数だけを制限します。続きが存在すると `truncated: true` になるので、全件と誤認せず条件や上限を調整してください。1フィールドの一致箇所が10,000、返す位置の総数が100,000を超える場合は例外になり、不完全な位置一覧を成功として返しません。戻り値は元のモデルから独立し、検索で資料・ID・保存形式・編集履歴を変更しません。保存対象の追加機能ではないため、SLON／PPTX形式の変更もありません。

アクセス権、ファイルの列挙、更新日時などによる候補の絞り込み、外部検索インデックス、検索結果の保存は利用側が担当します。
