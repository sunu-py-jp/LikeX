# LikeDataView

型付きのフィールドとレコードを表形式で編集するReactコンポーネントです。テキスト・数値・日付・チェックボックス・選択肢、並べ替え・絞り込み・グループ化、JSON / CSV入出力を提供します。

```tsx
import LikeDataView, { createDataView } from '@likex/dataview';
const data = createDataView({ fields: [{ id: 'name', name: '名前', type: 'text' }] });
<LikeDataView initialData={data} onSave={async data => { await persist(data); }} />
```

保存・認証・DB通信は親の責務です。`onSave` 未指定時は読み取り専用。詳細は [導入](docs/getting-started.md)、[操作API](docs/commands.md)、[CSV](docs/csv.md) を参照してください。

ソースコピー時は `src` と `packages/core/src` を隣接する `dataview` / `core` に置き、`dataview/core.ts` の1行だけを `export * from '../core';` に変更します。`json.ts`・`browser.ts` は内部でこの入口を参照するため、そのまま使います。React 19・React DOM・lucide-reactとCoreの実行時依存 `re2js@2.8.6` が必要です。Tailwindは不要です。
