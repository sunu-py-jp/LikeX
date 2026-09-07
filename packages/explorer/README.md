# @likex/explorer

Windows Explorer風のReact / TypeScriptコンポーネントです。ファイルの追加・移動・改名・削除をクライアントの下書きに保持し、「保存」で最終一覧と差分を親へ渡します。認証、DB、Blob / S3への保存処理は利用側で実装します。

このパッケージはReact / React DOM `^19.2.6` をpeer dependencyとして使用します。Tailwind CSSはライブラリの開発・CSS生成に使い、利用先への導入は不要です。実際の要求範囲は同梱の `package.json` を参照してください。Next.js専用ではありません。Next.jsでコールバックを渡す親はClient Componentにしてください。

## インストールとCSS

配布されたtarballを利用先へインストールします。パッケージ名は `@likex/explorer` です。

```bash
npm install ./likex-explorer-0.1.0.tgz
```

アプリの入口で生成済みCSSを1回読み込みます。Next.js App Routerでは `app/layout.tsx` で読み込めます。

```tsx
import "@likex/explorer/styles.css";
```

React / React DOMは利用先と共有します。Radix UI、Lucide、tailwind-mergeはパッケージの依存として導入されます。**利用先にはTailwind CSS・専用PostCSS設定・`@source`の追加は不要です。** 既にTailwindを使っているアプリも、既存設定を保ったまま同じCSSを読み込みます。

CSSはExplorer本体・メニュー・ダイアログの範囲へ適用します。専用の `lxe:` クラスと内部CSS変数を使い、ページ全体のリセットや配色を変更しません。CSSはJavaScriptから自動挿入しないため、上記のimportが必要です。

## 最小例

高さを指定し、公開入口からimportします。この例はブラウザのメモリだけに保存するデモで、ページを再読み込みすると空の一覧に戻ります。一覧の空白を右クリックしてファイルやフォルダを作成できます。

```tsx
"use client";

import { useState } from "react";
import Explorer, { type ExplorerEntry } from "@likex/explorer";

export default function FileManager() {
  const [savedEntries, setSavedEntries] = useState<readonly ExplorerEntry[]>([]);

  return (
    <Explorer
      initialEntries={savedEntries}
      onSave={({ entries }) => {
        setSavedEntries(entries);
        return entries;
      }}
      style={{ height: 640 }}
    />
  );
}
```

`onSave` を省略すると読み取り専用になります。`initialEntries` はマウント時だけ読みます。親の最新一覧を反映する場合は `onRefresh`、別ワークスペースへ切り替える場合は未保存変更を確認してからReactの `key` を使います。

## ソースをコピーして使う

このリポジトリの `packages/explorer/src/` の中身を、利用先の `components/explorer/` へまとめてコピーします。`src` 内のREADMEも一緒に持ち出せます。コピー後は `@/components/explorer` からimportします。

```bash
npm install radix-ui@1.6.7 lucide-react@1.31.0 tailwind-merge@3.6.0
```

React / React DOM 19も必要です。コピーした `styles.css` をアプリの入口で1回読み込みます。

```tsx
import "@/components/explorer/styles.css";
```

Tailwind CSS、他のLikeXパッケージ、共通Providerは不要です。詳しい設定とCSSの再生成は [コピー導入ガイド](./src/README.md#依存関係とcss) を参照してください。

## 本番へ接続するとき

| 目的 | 利用側で渡すもの |
| --- | --- |
| 初期表示 | `initialEntries`。保存先で管理する安定した項目IDと親フォルダIDを持つ一覧。 |
| 永続保存 | `onSave(payload)`。成功時に保存後の一覧を返せます。throw / rejectすると下書きを保持します。ローカル `File` はJSONだけでは送れません。 |
| 最新一覧へ更新 | `onRefresh()`。認証・取得した最新一覧を返します。初回取得の関数を共用でき、初回には自動実行しません。 |
| 既存本体の読込 | `readFile(sourceId)`。認証済みの `Blob` を返し、内蔵プレビュー・ダウンロード・サムネイルへ使います。 |
| 外部ダウンロード・プレビュー | `onDownloadRequest` / `onPreviewRequest`。取得方法、進捗、外部ダイアログ等を利用側で実装します。 |
| 本文・セマンティック検索 | `onSearchRequest(request, { signal })`。現在の一覧に存在する項目IDを検索順位順に返します。`search` でEnter確定や入力の待機時間を選べます。 |
| 操作の観測 | `onEvent`。通知の戻り値や例外では保存・操作を拒否できません。保存前の検証は `onSave`、編集開始の許可は `onEditRequest` で扱います。 |

## 検索を接続する

省略時は、読み込んだ全項目の名前を入力と同時に検索します。Enterで確定する場合は `search={{ trigger: "submit" }}`、外部検索を入力後300 ms待って実行する場合は次のように指定します。

```tsx
<Explorer
  initialEntries={entries}
  search={{ trigger: "input", debounceMs: 300 }}
  onSearchRequest={searchFiles}
  style={{ height: 640 }}
/>
```

`entries` と `searchFiles` は親が用意します。`searchFiles` の型は `ExplorerSearchHandler` で、`readonly string[]` またはそのPromiseを返します。未知・重複IDは無視し、返却順を維持するため外部検索中の並べ替えUIは表示しません。空の検索語では呼び出さず通常一覧へ戻り、古い検索は中断・破棄します。`features.search: false` で検索全体を無効にできます。

Explorerは検索のためにファイル本体を自動取得しません。本文キャッシュや認証済み検索APIの接続、未保存ファイルとの検索結果の合成は親が担当します。[公開型・本文キャッシュ・fetchの具体例](./src/README.md#search-integration) を参照してください。

## 主な制約

- 下書きはメモリ内です。標準の未保存離脱警告は永続保存の代わりになりません。SPA遷移・`key` の変更・アンマウント前の確認は親が `onDirtyChange` で扱います。
- Office形式の専用アイコンはありますが、Excel・Word・PowerPointの内蔵プレビューはありません。外部プレビューを注入できます。
- 内蔵フォルダZIPはクライアントで作る無圧縮ZIPで、4 GiB未満・65,534項目までです。実用上は端末メモリに収まる規模で使い、大きな取得は親のダウンロード処理へ委譲します。
- 内蔵ダウンロードの成功はブラウザへ処理を渡した時点です。端末への保存完了を意味しません。
- ポップアップ、フォルダ選択、OSクリップボード、離脱確認の可否はブラウザ・OSにも依存します。別ウィンドウはユーザー操作から開きます。
- アップロード制限や読み取り専用はクライアントUIの制御です。サーバー側の認証・認可・内容検証も利用側で行います。

機能ON/OFF、テーマ、外部アイコン、保存と更新の型、ポップアップ、運用例は [詳細ガイド](./src/README.md) を参照してください。ガイドの `@/components/explorer` はソースコピー時のimport例です。パッケージ利用時は `@likex/explorer` に読み替えてください。Azure等の設計例とジェネリックなアダプター方針は、実装済みのバックエンド機能ではありません。

ライセンスと公開可否は同梱の `package.json` に従います。`private: true` / `license: "UNLICENSED"` の配布候補は公開前の確認用であり、オープンソースライセンスを付与したリリースではありません。
