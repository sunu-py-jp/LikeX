# 画像一覧と配置の取得

```bash
node "$skill_dir/scripts/document.mjs" inspect --project "$project_dir" --input document.dcon --images
```

`selection.images` は `{ imageId, mimeType, byteLength }`、`selection.placements` は `{ imageId, documentId, blockId, from, to, width, height, alt }`。画像の `src`・Base64本体は返さない。同じ元バイト列は `sha256:` と64桁の小文字16進数のIDでまとまり、表示寸法が違う場合も全配置が残る。画像一覧は初出順、配置は本文の走査順。空の文書では両配列が空になる。

本文・表セル・リスト内の画像を含む。`blockId` は既存の画像ブロックID、`from` / `to` はその時点のProseMirror位置、寸法はpx。ページ番号や画面座標は描画しないと決まらないため返さない。編集後は位置を再取得する。

Documentの `--images` は他の取得セレクター、`--include-data`、`--offset` / `--limit`、`--compact-summary`、`--include-animations` と併用できない。1 MiBを超えると `RESPONSE_TOO_LARGE` になり、部分的な一覧は返さない。`.dcon` は変更しない。

ホストが画像本体を取得する場合は `await collectDocumentImages(document, { signal? })` を使う。戻り値の `images` には `src` も含まれるので、画像ごとに1回だけ解析し、結果を `imageId` で全配置へ対応付ける。キャッシュは画像IDと解析モデル・版・プロンプト・オプションを含め、利用者のアクセス範囲ごとに分ける。周囲の文章も使う解析ではその文脈も条件へ含める。

対応画像はLikeDocumentモデルと同じPNG・JPEG。DOCXからは先に `importDocumentDocx` で取り込み、変換警告を確認する。ヘッダー・フッター、外部参照、未対応形式など、取込で省略された画像は収集されない。同じ絵でも再圧縮・元画像リサイズ・形式変換・メタデータ変更でバイト列が変われば別IDになる。類似画像判定や外部API送信は収集APIに含まれない。

型、Web Cryptoの要件、DOCXの変換範囲、ホスト解析例は[画像の収集と重複判定](../../../src/docs/image-analysis.md)を参照する。画像IDは読み取り結果だけで、DCON/DOCXへ自動保存されない。
