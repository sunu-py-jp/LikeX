# @likex/slide

PowerPoint風のReactスライドエディターです。Spreadsheetと同じグループ付きリボンを使い、テキスト・図形・画像、スライドの並べ替え、発表表示を扱えます。標準ファイルは `.slon`、中身はJSONです。

```tsx
"use client";
import LikeSlide, { createSlideDeck, serializeSlideDeck } from "@likex/slide";
import "@likex/slide/styles.css";

export default function Presentation() {
  return <LikeSlide initialDeck={createSlideDeck()}
    onSave={async deck => {
      const response = await fetch("/api/presentation", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: serializeSlideDeck(deck),
      });
      if (!response.ok) throw new Error("保存できませんでした");
    }} style={{ height: 720 }} />;
}
```

`onSave` なしでは読み取り専用になります。React / React DOM 19.2.6以降の19系が必要です。CSSを同梱しているためTailwind CSSは不要です。`initialDeck` は初回のみ読み込み、別の資料を開くときはReactの `key` を変えます。

- [導入・コピーする場合](src/docs/README.md)
- [スライドとオブジェクトの編集](src/docs/editing.md)
- [保存・編集許可・イベント](src/docs/lifecycle.md)
- [画面なしでJSONを操作するAPI](src/docs/commands.md)
- [LLM向けスキル・スキーマ参照・操作CLI](skills/likex-slide/SKILL.md)
- [PowerPointの読み込み・出力と対応範囲](src/docs/powerpoint.md)
- [PNG画像の書き出し（単一・範囲・任意ページ）](src/docs/image-export.md)
- [要素のアニメーションと最終静止状態の取得](src/docs/animations.md)

`line.add` / `line.update` の `routing: "elbow"` で、図形に追従する直角の折れ線を作れます。省略時は直線です。`getSlideLineRoute(lineElement, slide.elements)` は、`createSlideDeck`・`parseSlideDeck`・`applySlideCommands` が返した現在の正規化済み要素から、描画用の折れ点と外接矩形を取得します。接続先の位置・回転も計算するため、同じページの `elements` を渡してください。

配布用tarballは `npm run pack:library -- --module slide` で作ります。利用先ではCoreとSlideの両方をインストールしてください。npmレジストリへの公開は未実施です。

ソースをコピーする場合はCoreとSlideの `src/` 全体を同じバージョンで配置し、Slideの `core.ts` の1行だけをCoreへの相対パスに変更します。更新時も両方の `src/` 全体を差し替えて接続先を再設定してください。依存の導入を含む手順は[導入ガイド](src/docs/README.md)を参照してください。

```bash
npm install ./likex-core-0.1.0.tgz ./likex-slide-0.1.0.tgz
```

PowerPointの全機能を再現するものではありません。対応しない要素はインポート時の警告で確認できます。デモは `/slide` にあります。[MITライセンス](LICENSE)で、配布時は第三者ライセンス通知も保持してください。
