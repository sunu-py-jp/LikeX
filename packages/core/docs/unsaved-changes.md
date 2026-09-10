# 未保存データの離脱確認

`createUnsavedChangesGuard` は、未保存の変更がある間だけ、登録したWindowの `beforeunload` を有効にします。ブラウザのタブを閉じる操作やページの再読み込みに使います。

## API

```ts
type UnsavedChangesGuardOptions = Readonly<{
  closeMessage?: string;
}>;

function createUnsavedChangesGuard(options?: UnsavedChangesGuardOptions): {
  setActive(value: boolean): void;
  register(view: Window | null | undefined): () => void;
  confirmClose(view: Window): boolean;
};
```

| API | 動作 |
| --- | --- |
| `setActive(true)` | 登録済みのWindowへ `beforeunload` を追加 |
| `setActive(false)` | 全登録先から `beforeunload` を解除 |
| `register(window)` | Windowを登録し、登録解除関数を返す。同じWindowの複数登録にも対応 |
| `register(null)` | 何も登録しない。返る解除関数も何もしない |
| `confirmClose(window)` | 未保存なら `window.confirm` の結果を返す。未保存でなければ `true` |
| `closeMessage` | `confirmClose` で使う文言。ブラウザ標準の離脱確認には適用されない |

登録解除関数は繰り返し呼べます。関数の生成時には `window` を参照しないため、SSRでも生成できます。Windowの登録はクライアント側で行ってください。

## 接続の例

```ts
import { createUnsavedChangesGuard } from "@likex/core";

const guard = createUnsavedChangesGuard({
  closeMessage: "未保存の変更を破棄して閉じますか？",
});

// ブラウザ側で実行する。
const unregister = guard.register(window);

// ドラフトが変更されたら有効にする。
guard.setActive(true);

// 保存が成功したら無効にする。
guard.setActive(false);

// 画面の破棄時に登録を解除する。
unregister();
```

親ページとポップアップが同じドラフトを共有する場合は、両Windowを同じguardに登録できます。ただし、別のJavaScriptコンテキストにいる他のタブと自動同期する機能はありません。

## SPAの画面遷移

SPAのルーター操作では `beforeunload` が起きない場合があります。その経路には利用側の遷移ガードを接続します。標準の確認ダイアログでよければ `confirmClose` を呼び、`false` なら遷移を中止できます。

```ts
function leavePage(navigate: () => void) {
  if (!guard.confirmClose(window)) return;
  navigate();
}
```

Coreはルーターや独自の確認ダイアログを実装しません。Explorer・Spreadsheetの組み込みUIを使う場合は、それぞれの離脱確認のPropsや操作APIを使用し、同じWindowへ重複して独自guardを登録する必要がないか確認してください。

ブラウザ標準の確認文言や表示可否はブラウザに依存します。`beforeunload` は必ず表示されるものとして扱わず、必要なデータ保護は親アプリでも設計してください。[MDN: beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)
