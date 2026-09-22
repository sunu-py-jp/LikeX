# @likex/document

Word風のReact文書エディターです。文章・見出し・文字書式・リスト・表・画像・用紙設定を編集できます。標準ファイルは `.dcon`、内容はProseMirrorの文書構造を含むJSONです。DOCXの読み込み・出力も公開します。

```tsx
"use client";
import LikeDocument, { createDocument, serializeDocument } from "@likex/document";
import "@likex/document/styles.css";

export default function DocumentEditor() {
  return <LikeDocument initialDocument={createDocument()}
    onSave={async document => {
      const response = await fetch("/api/document", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: serializeDocument(document),
      });
      if (!response.ok) throw new Error("保存できませんでした");
    }} style={{ height: 720 }} />;
}
```

`onSave` を省略すると読み取り専用です。React / React DOM 19.2.6以降の19系と、表示枠の高さを利用側で用意します。CSSを同梱しているためTailwind CSSは不要です。認証・DB・Blob/S3への保存や共同編集の競合解決は親アプリが担当します。

配布用tarballは、リポジトリで `npm ci` の後に `npm run pack:library -- --module document` で作ります。利用先ではCoreとDocumentのtarballをインストールします。npmレジストリへの公開は未実施です。

```bash
npm install ./likex-core-0.1.0.tgz ./likex-document-0.1.0.tgz
```

- [導入・ソースコピー](src/docs/getting-started.md)
- [文章・書式・表・画像の編集](src/docs/editing.md)
- [画面なしのモデルAPI・コマンド・履歴](src/docs/headless.md)
- [DCONファイルの保存構造](src/docs/native-files.md)
- [DOCXの読み込み・出力と対応範囲](src/docs/docx.md)
- [保存・編集許可・イベント](src/docs/lifecycle.md)
- [LLM向けスキル・スキーマ・CLI](skills/likex-document/SKILL.md)

Wordの全機能や改ページ位置の完全な再現を保証するものではありません。変換時の `warnings` を確認してください。デモは `/document` にあります。[MITライセンス](LICENSE)で、ProseMirrorを含む第三者ライセンス通知も配布時に保持してください。
