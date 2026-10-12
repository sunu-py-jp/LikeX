# 検索

## 画面内で検索する

通常のLikeSlideは「ホーム」→「検索」、またはコンポーネント内にフォーカスがある状態で **Ctrl+F / Cmd+F** を押すと検索パネルを開きます。リボンの完全非表示（`hidden`）や読み取り専用でも使えます。入力した文字列を1語のリテラルとして検索し、空白では分割しません。大文字・小文字の区別を切り替えられます。

入力と文書変更に合わせて結果を更新し、件数・一致箇所を強調した抜粋を表示します。検索条件の変更と明示的な前後移動で対象を表示し、資料編集中の結果更新だけでは現在のページ・選択を移動しません。「前へ／次へ」またはEnter／Shift+Enterで巡回し、一致したスライドへ移動して本文の要素を選択・枠で強調します。継承したマスター／レイアウトの要素は枠だけを表示します。検索対象は本文と図形の文字で、ノート・画像内の文字は含みません。検索は保存内容・Undo履歴を変更せず、編集許可を要求しません。

```tsx
const ref = useRef<SlideHandle>(null);
<LikeSlide
  ref={ref}
  initialDeck={deck}
  initialSearchOpen
  initialSearchQuery="受注番号"
  readOnly
  initialRibbonDisplayMode="hidden"
/>;
ref.current?.openSearch("売上"); // 開いて文字列を設定。省略時は前回の文字列を保持。空文字ならクリア
ref.current?.closeSearch();
```

`initialSearchOpen`（既定`false`）で最初の描画から検索欄を表示し、`initialSearchQuery`（既定`""`）で検索語を指定します。両方ともマウント時に一度だけ読みます。検索語だけでは欄を開きませんが、後から`openSearch()`したときに使います。不正な初期検索語（文字列以外・4,096文字超）は空文字として扱います。初期検索が一致すると、通常の検索と同じように最初の一致箇所へ移動します。

表示後の変更にはrefを使います。`features.search: false`は初期表示指定より優先し、表示中の欄も閉じます。その後`true`に戻しても自動では開きません。Spreadsheet・Slide・Document・PDFで共通のprops／ref名と引数を使い、型はCoreの`SearchPanelInitialState`／`SearchPanelHandle`を共有します。サムネイルには検索UIを表示しません。

`openSearch(query?: string): boolean` は受付時にtrueを返します。機能無効・アンマウント後・不正な文字列（4,096文字超過を含む）の場合はfalseです。`features={{ search: false }}` でボタン・ショートカット・表示中パネル・refからの呼び出しを無効にします。公開モデルの`searchSlides`はその設定の影響を受けません。

Escまたは閉じるボタンでパネルを閉じるとキャンバスへ戻ります。読み込み・保存等の処理中や未確定の入力がある場合は結果への移動を受け付けません。結果は最大1,000フィールド、一致位置はその内側で数えます。大量の結果は100件ずつ表示し、前後の移動では全取得結果を巡回します。上限による省略は画面で通知します。

## 外部の検索結果を表示する

利用側の全文検索・意味検索などで取得した結果は `externalSearch` へ渡します。ライブラリは結果の順位と抜粋をそのまま表示し、指定されたスライド・要素へ移動します。抜粋を検索語として再検索せず、資料を書き換えません。

```tsx
<LikeSlide
  ref={ref}
  initialDeck={deck}
  initialSearchOpen
  externalSearch={{
    title: "顧客会議の検索結果",
    results: [
      { id: "hit-42", title: "提案内容", snippet: "前回会議の合意事項…",
        locationLabel: "提案書 / 3ページ",
        target: { slideId: "proposal", elementIds: ["summary"] } },
      { id: "hit-7", target: { slideId: "overview" } },
    ],
    initialResultId: "hit-42",
    onResultSelect: result => console.log(result.id),
  }}
/>;
ref.current?.openExternalSearch("hit-7");
ref.current?.openSearch("売上"); // 文書内検索へ切り替える
ref.current?.openSearch();       // 前回のモード・文字列を保持して開く
```

`SlideExternalSearchTarget` は `{ slideId: string; elementIds?: readonly string[] }` です。要素IDを省略するとページだけへ移動します。存在しないページ・削除済み要素・別ページの要素は移動せず、結果に理由を表示します。継承元のマスター／レイアウト要素は直接選択できないため、それらの結果は `elementIds` を省略してください。結果IDは非空で一覧内一意にし、更新時も同じ結果に同じIDを使います。重複IDは最初の有効な結果だけを表示します。

`initialSearchMode` は `"local" | "external"`。省略すると、外部結果があり、空でない初期検索語がなければ外部モードで開きます。明示したモードが初期検索語より優先します。`initialSearchOpen` が表示を決め、`initialResultId` または先頭結果へ最初の表示時に一度だけ移動します。段階的な結果取得で指定IDがまだ含まれない間は待機し、到着後に移動します。結果の追加・並べ替え・文書の編集では閲覧中のページを奪いません。選択中の結果を削除しても勝手に別の結果を選びません。

外部結果がある場合、左側の「検索結果／全ページ」で結果一覧と通常の一覧を切り替えます。両者はマウントを維持しスクロール位置を保持します。「選択した結果に戻る」で閲覧前の結果を再表示でき、「文書内を検索／外部検索結果」で検索モードを切り替えられます。前後ボタンと結果一覧内の上下キーは外部順位に従います。大量の結果は初めに200件を表示し「さらに表示」で増やせます。API・前後移動先の結果も表示します。全ページ一覧にはヒット件数を付けます。

閉じる操作は表示だけを閉じ、一覧・選択ID・検索モードを保持します。`openExternalSearch(resultId?)` は受付で `true`、外部結果なし・機能無効・不明なID・読み込み済み資料への不正な参照・アンマウント後は `false`。ID省略なら現在の閲覧位置を保持して開き、指定時はその結果へ移動します。`onResultSelect` は移動を受け付けた場合だけ呼ぶ通知で、例外で表示を巻き戻しません。

検索結果は現在の `deck.id` に結び付けます。別のIDの資料へ置き換えた場合、旧 `results` 配列のままでは参照先IDが偶然一致しても移動しません。利用側が新しい資料を検索して新しい `results` 配列を渡してください。結果は現在の資料に対応するものだけを渡し、別資料の管理・認可・検索・結果保存は利用側で行います。表示状態のみの追加なのでSLON／PPTXや編集CLIの変更はありません。

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
