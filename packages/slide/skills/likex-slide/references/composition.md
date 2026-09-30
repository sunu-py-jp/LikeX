# 意味からページを組み立てる

`slide.compose` は1ページのローカル要素を、内容に適した構図で一括置換する。新規内容や全面再設計で使い、既存の1文・色・位置だけを変える場合は要素コマンドを使う。全要素の座標をLLMが列挙する必要はない。作成後は通常のテキスト・図形・接続線として編集できる。

## 最小の流れ

1. 必要なページとマスターを取得する。ページがなければ `slide.add` で作り、マスターが指定されていれば `layoutId` を付ける。
2. 各ページの目的・主張・構図を決める。指定デザインを優先し、マスターがなければ1つのプリセットを資料全体で使う。
3. ページごとに `slide.compose` を適用する。ホストが提供する場合は `get_slide_designs` → `compose_slide` を使い、実際のツール定義に従う。
4. 最後の編集後の各ページを画像で確認し、文字切れ・はみ出し・読み順・接続線を点検する。修正したページは再プレビューする。

公開モデルAPIは `@likex/slide/model` の `getSlideCompositionPresets()` で `{ id, name, description }[]` を返す。プリセットIDは `executive`（既定）/ `editorial` / `contrast`。`getSlideCompositionLayouts()` は構図の `kind` / `name` / `description` / `minItems` / `maxItems` / `textLimits` を返す。モデル・CLIにはAIホストのツール名を渡さない。

## 入力

コマンドは `{ type: "slide.compose", slideId, composition, preset?, notes? }`。すべての構図で `title` が必須、`eyebrow` / `subtitle` / `footer` は任意。

| `composition.kind` | 追加フィールド | 用途 |
| --- | --- | --- |
| `hero` | `highlights?: string[]` | 主張、表紙 |
| `comparison` | `before` / `after`: `{ title, body }` | 課題と変化 |
| `features` | `items: { title, body }[]` | 並列の機能・価値 |
| `flow` | `steps: { title, body }[]` | 手順、処理の順番 |
| `architecture` | `columns: { title, nodes: { id, title, body? }[] }[]`, `connections: { from, to, label? }[]` | 区画と接続関係 |
| `closing` | `action: string`, `details?: string` | 次の行動 |

`architecture` のノードIDは入力内で一意。接続の `from` / `to` にはそのIDを使う。隣接する列か同じ列の異なるノード間へ接続でき、自己接続や同じ組の重複接続はできない。生成後の要素IDは取得結果で確認する。接続は通常の2点の線に展開され、対象ノードに追従する。複雑な自動配線や任意の図の生成を保証するものではない。

件数は `hero.highlights` 0〜3、`features.items` 2〜4、`flow.steps` 2〜5、`architecture.columns` 2〜4／各列のノード1〜2／接続0〜8。4つの機能は2列×2段で配置する。キャンバスは640×360px以上、横縦比1.1〜2.5。

文字数は書記素単位で、`title` 64／`eyebrow` 40／`subtitle` 120／`footer` 90まで。比較・機能の見出し28／本文160、手順の見出し20／本文90、構成図の列見出し24／ノード見出し26／本文70／接続ラベル12、強調項目32、最後の `action` 72／`details` 160。これは上限であり、実際の行数による制限がさらに厳しいことがある。

以下は **nativeコマンド形式**。CLIのコマンドファイルは配列。AIホストのstrictなwire形式では、任意フィールドに `null` が必要になる場合があるため、公開されたツール定義を優先する。`cover` は実際に取得したページIDへ置き換える。

```json
[
  {
    "type": "slide.compose",
    "slideId": "cover",
    "preset": "executive",
    "composition": {
      "kind": "hero",
      "eyebrow": "ERP / PROPOSAL",
      "title": "止まる前に気づくERPへ。",
      "subtitle": "例外の発見から解決までを、一画面で。",
      "highlights": ["情報を集める", "根拠を確認する", "人が判断する"],
      "footer": "提案コンセプト。効果は検証フェーズで確認します。"
    },
    "notes": "受注・調達・在庫を横断した例外対応を提案する。"
  }
]
```

## 保持するものと置き換えるもの

ページID・名前・順序・他ページ・レイアウト参照・共通装飾は保持する。レイアウト付きページの背景は保持し、レイアウトのないページはプリセットの背景にする。`notes` は省略すれば保持する。対象ページのローカル要素は全置換し、旧要素へのアニメーションはクリアする。ロックされた要素があれば失敗する。失敗で旧ページの一部だけが変更されることはない。

指定マスターがあればその背景と共通装飾を優先し、共通装飾をローカルへ複製しない。利用可能な上部タイトルのプレースホルダーは位置・書式・対応IDを引き継ぐ。新しい本文はプリセットの書式で配置し、端の共通装飾を避ける。中央の装飾と衝突するなど領域が足りなければ拒否する。任意のPPTXマスターの本文書式や意図まで再現するわけではない。必要なら適切なレイアウトか自由配置を選び、`slide.detachLayout` で勝手に解除しない。

`composeSlideContent(deck, slideId, composition, { preset?, notes?, measureText? })` は検証済みの `slide.replaceContent` コマンドを返し、資料を変更しない。戻り値を `applySlideCommands` で適用する。`measureText` は描画環境の文字幅を注入する関数で、CLIやJSONに渡すフィールドではない。

## 収まらないとき

各構図の件数と文字領域には制限があり、文字列の切り捨てや自動縮小では補わない。日本語は英語の単語数に換算せず、書記素のまとまり、折り返し行数、文字幅で確認する。要点を保って短くする、構図を変える、ページを分ける方法で直す。同じ入力で再試行せず、エラーの対象フィールドを変更する。

既定の測定だけでは環境の代替フォントやPowerPointの折り返しを保証できない。最新の画像と診断を確認し、必要な部分だけ直す。SLON・PPTXは通常の文字・図形・線として保存し、独自の構図データや一枚の画像として固定しない。
