# 導入・保存・権限

```tsx
import LikeDiagram, { createDiagram, serializeDiagram } from "@likex/diagram";
import "@likex/diagram/styles.css";

const initial = createDiagram({ title: "サンプル" });

<LikeDiagram
  initialDiagram={initial}
  primaryColor="#496a8f"
  colorMode="system"
  onSave={async model => {
    await saveToYourServer(serializeDiagram(model));
  }}
  style={{ height: 640 }}
/>
```

`initial`は初期値です。表示後に文書を置き換える場合はrefの`importJson()`または`execute()`の置換コマンドを使います。保存先やHTTPクライアントはライブラリに含みません。

| props | 型・挙動 |
| --- | --- |
| `initialDiagram` | `DiagramModel`。省略すると空のモデル |
| `onSave` | `(model) => void / model / Promise<void / model>`。処理が終わるまで編集と二重保存を抑止。返したモデルでサーバー側の変更を反映 |
| `onBeforeSave` | `(model) => boolean / void / Promise<boolean / void>`。`false`で保存を中止 |
| `onEditRequest` | `({ model }, { requestId, signal }) => boolean / Promise<boolean>`。変更前に許可を取得。未指定は許可 |
| `onChange` | `(model) => void`。適用済みのモデルを通知 |
| `onDirtyChange` | `(dirty: boolean) => void`。親の画面遷移確認に利用 |
| `onEvent` | `change`、`save`（start/success/cancelled/error）、`edit-mode`を通知 |
| `readOnly` | `true`で編集禁止。`onSave`未指定の場合も読み取り専用 |
| `features` | 機能ごとのboolean。未指定はすべてON |
| `onSelectionChange` | `(ids: readonly string[]) => void` |
| `primaryColor` | `#RGB`または`#RRGGBB`。文書内の色を変更せず、UIの色だけを変更 |
| `colorMode` | `light` / `dark` / `system` |
| `warnOnUnsavedChanges` | 既定`true`。未保存時のブラウザー離脱確認。アプリ内のルーティングは親で制御 |

保存完了後もUndo/Redoの履歴を保持します。保存・編集中の排他制御を行う場合、ロックの取得と解放、保存時の競合検知は親で実装してください。許可の取得中・インポート中に機能設定や読み取り専用状態が変わった場合、古い結果は適用しません。

## ref

`DiagramHandle`の`getModel()`、`execute(command / commands)`、`select(ids)`、`getSelection()`、`undo()`、`redo()`、`save()`、`discard()`、`importJson(string / Blob)`、`exportJson()`、`exportSvg()`を公開しています。

`execute()`と`importJson()`は適用後のモデル、拒否・失敗・変更なしの場合は`null`を返すPromiseです。`save()`・Undo/Redoは成否のbooleanを返します。`exportJson()`と`exportSvg()`は文字列を返します。純粋なモデルAPIは認証を行わず、表示中のref操作はGUIと同じ機能設定・許可・履歴を通ります。

## ソースコピー

`packages/diagram/src`を`components/diagram`、`packages/core/src`を`components/core`にコピーします。`core.ts`のimportを`../core`へ、`json.ts`を`../core/json`へ変更してください。React 19と`lucide-react`が必要です。利用側にTailwindの導入は不要です。
