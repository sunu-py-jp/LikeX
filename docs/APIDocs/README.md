# APIリファレンス

[`index.html`](index.html) が入口です。左メニューでコンポーネントを開くと、関連する操作をまとめた機能ページへ移動できます。各ページは個別のフォルダに分かれ、直接URLを共有できます。

## 開く

HTMLをダブルクリックして開けます。CSS・JavaScript・画像はすべて同梱しており、表示のためのnpmインストールや外部CDNは不要です。静的サイトとして公開する場合も、このフォルダ全体を配置してください。

ローカルサーバーを使う場合:

```bash
python3 -m http.server 5190 --bind 127.0.0.1 --directory docs/APIDocs
```

ブラウザで `http://127.0.0.1:5190/` を開きます。GitHubの通常のファイル画面ではHTMLがプレビューされないため、ダウンロードして開くか静的ホスティングを利用します。

## 構成と編集元

```text
APIDocs/
  index.html                    入口（生成）
  overview.md / page.json        入口の本文と設定
  explorer/search/
    index.html                  検索APIのページ（生成）
    page.json                   表示名・分類・編集元・画面例
  explorer/clipboard/            コピー・切り取り・貼り付け
  explorer/tabs/                 タブ・別ウィンドウ
  spreadsheet/clipboard-and-fill/
  spreadsheet/sheets/
  core/host-contracts/
  assets/
    docs.css / docs.js          共通の見た目・操作
    search-index.js             ページ検索用データ（生成）
    screenshots/               実際のデモ画面
  pages.json                    ページ・見出し一覧（生成）
```

本文の編集元は各コンポーネントのMarkdownです。`page.json` の `source`（リポジトリのルートからのパス）で対応づけます。`sections` を指定すると、既存MarkdownのH2見出しだけを選んでページにできます。複数の編集元は `sources` で指定できます。

```json
{
  "title": "コピー・切り取り・貼り付け",
  "summary": "項目の複製や移動と、ローカルファイルの貼り付けを扱います。",
  "source": "packages/explorer/src/docs/clipboard.md",
  "section": "ファイル操作",
  "order": 50,
  "keywords": ["copy", "cut", "paste"]
}
```

`title` はメニューに収まる長さにし、操作の細目は `summary` に書きます。本文を生成HTMLへ直接追記しないでください。

```bash
npm ci
npm run docs:build
npm run docs:check
```

チェックでは生成漏れ、相対リンク、見出しアンカー、スクリーンショットの存在を確認します。リリースチェックにも含まれます。Markdownの実装例・公開型との整合性は、変更した機能のテストと合わせて確認してください。

## 画面例を更新する

`screenshots` に画像パス（APIDocsからの相対パス）、代替テキスト、説明を指定します。実際のデモを撮影し、個人情報や認証情報が含まれていないことを確認します。APIの説明に関係のない装飾画像は追加しません。

コードやデータの関係図は、保存契約を追いやすい表として生成します。対応するMermaid記法が増えた場合は、`scripts/api-docs/relationships.mjs` と回帰テストを更新します。

文章・デザインの調査と判断は [EDITORIAL.md](EDITORIAL.md) に記録しています。
