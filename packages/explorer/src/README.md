# LikeX Explorer

React向けのファイルエクスプローラーです。表示・クライアント内の操作・保存前の下書きを扱い、DBやストレージとの通信は親コンポーネントへ委譲します。

## 導入

このフォルダの中身を利用先の `components/explorer/` へコピーします。React / React DOM 19.2.6以降の19系と実行時依存を用意し、生成済みCSSをアプリの入口で1回読み込んでください。Tailwind CSSの導入・専用設定は不要です。

```bash
npm install radix-ui@1.6.7 lucide-react@1.31.0 tailwind-merge@3.6.0
```

```tsx
import Explorer from "@/components/explorer";
import "@/components/explorer/styles.css";

// 閲覧用。編集する場合は親が実装したonSaveを渡します。
<Explorer initialEntries={[]} style={{ height: 640 }} />
```

パッケージ導入ではimport元を `@likex/explorer` と `@likex/explorer/styles.css` に読み替えます。Next.jsではコールバックをClient Componentから渡してください。[導入の具体例](./docs/getting-started.md)

## 重要事項

- `onSave` を省略すると読み取り専用です。下書きとローカル `File` はメモリで保持し、自動で永続化しません。
- `initialEntries` は初回のみ反映します。最新一覧の取得には `onRefresh` を使います。
- `onEvent` は通知専用です。保存前検証、認証・認可、複数人の競合解決は親とサーバーが担当します。
- Officeファイルは親のプレビューUIへ委譲できます。内蔵ZIPは4 GiB未満・65,534項目までで、端末メモリに収まる規模が前提です。内蔵ダウンロードの成功はブラウザへの引渡しを表します。
- ポップアップ・OS貼り付けはブラウザやOSに依存します。SPA遷移やアンマウント前の未保存確認は親が行います。
- 公開入口 `index.ts` からimportし、内部ファイルへ直接依存しないでください。`styles.css` は生成物で、手編集しません。

## ドキュメント

[目的別ガイド](./docs/README.md)に、[API一覧](./docs/api-reference.md)、[機能設定](./docs/configuration.md)、[保存](./docs/saving.md)、[検索](./docs/search.md)、外部連携などの詳細をまとめています。`docs/` はこのフォルダとパッケージの両方に同梱します。

Azure・Cosmos DB・ストレージの連携例は、**利用側で実装する参考サンプル**です。このコンポーネントにバックエンド実装は含まれません。
