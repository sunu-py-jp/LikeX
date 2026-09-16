# LikeSlideの検証用ファイル

`powerpoint-basic.pptx` は、LikeSlideの出力処理とは独立した `python-pptx` で作成したPPTXです。`slide-pptx.test.mjs` はこのチェックイン済みファイルを使うため、通常のテスト実行にPythonは不要です。

生成スクリプト・検証用ファイル・Pythonライブラリは開発用です。`@likex/slide` の配布パッケージには含まれず、エディターやPPTX入出力の実行時依存にもなりません。

## 内容

- 2枚のスライド、約1280 × 720ピクセル（13.333333 × 7.5インチ）。
- タイトルスライドのプレースホルダー、マスター由来の位置・フォント・テーマ色。
- 日本語とXML特殊文字、Arial 24ptの太字、色、右揃え。
- 単色背景、文字付きの角丸長方形（15度回転）。
- 40 × 20ピクセルのPNG画像を縦横比2:1で配置（20度回転）。
- 2行の発表者ノート。

PowerPointデスクトップアプリから直接保存したファイルではありません。通常のPresentationMLを別実装で生成し、LikeSlide自身の入出力だけを往復させるテストとは別の検証に使います。

## 再生成

リポジトリのルートで実行します。確認済みの環境は `python-pptx 1.0.2` と `Pillow 12.3.0` です。最初のインストールにはパッケージ取得の通信が必要ですが、生成・読み込み・出力・検証はネットワークを使いません。

```sh
python3 -m venv /tmp/likex-slide-fixtures-venv
/tmp/likex-slide-fixtures-venv/bin/python -m pip install python-pptx==1.0.2 Pillow==12.3.0
/tmp/likex-slide-fixtures-venv/bin/python packages/slide/tests/fixtures/create-pptx-fixture.py
node scripts/build-library.mjs --module core
node --test packages/slide/tests/slide-pptx.test.mjs
```

Node.js側の依存関係は、あらかじめリポジトリの `npm ci` で用意してください。生成先は `create-pptx-fixture.py` と同じディレクトリの `powerpoint-basic.pptx` です。作成者・最終更新者は `LikeX`、文書とZIP項目の日時は2026-09-16に固定します。生成環境の違いによる差分を避けるため、テストではファイル全体のバイト一致ではなく、読み込んだ内容を確認します。

## LikeSlideの出力を独立した実装で読み直す

次の手順はLikeSlideで取り込み・出力したPPTXを `python-pptx` で開き直します。読み込み時には、このfixtureのテーマ装飾と図形内の文字書式を簡略化した旨の警告が返ります。

```sh
node scripts/build-library.mjs --module core
node scripts/build-library.mjs --module slide
node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { importSlidePptx, exportSlidePptx } from './packages/slide/dist/index.js';

const input = new Uint8Array(await readFile('packages/slide/tests/fixtures/powerpoint-basic.pptx'));
const { deck, warnings } = await importSlidePptx(input);
console.log(warnings);
const output = await exportSlidePptx(deck);
await writeFile('/tmp/likex-slide-roundtrip.pptx', new Uint8Array(await output.arrayBuffer()));
JS
/tmp/likex-slide-fixtures-venv/bin/python <<'PY'
from io import BytesIO
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from PIL import Image

p = Presentation('/tmp/likex-slide-roundtrip.pptx')
assert len(p.slides) == 2
assert (p.slide_width, p.slide_height) == (12191999, 6858000)
assert p.slides[0].shapes[0].text == 'Inherited title geometry'
assert p.slides[0].notes_slide.notes_text_frame.text == 'Presenter notes\nSecond line'

text, shape, picture = p.slides[1].shapes
assert [text.shape_type, shape.shape_type, picture.shape_type] == [
    MSO_SHAPE_TYPE.TEXT_BOX, MSO_SHAPE_TYPE.AUTO_SHAPE, MSO_SHAPE_TYPE.PICTURE,
]
assert text.text == '日本語 & <PowerPoint>'
assert shape.text == 'Shape text' and shape.rotation == 15
assert picture.rotation == 20 and picture.width / picture.height == 2
assert picture.image.content_type == 'image/png'
with Image.open(BytesIO(picture.image.blob)) as image:
    assert image.size == (40, 20)
    image.load()
print('Independent PPTX reopen passed')
PY
```

2026-09-16に上記の出力・再読込を実施し、スライド数・寸法（EMU）、タイトル・日本語・図形内の文字、発表者ノート、図形と画像の回転、画像の比率・形式・デコードを確認しました。これは別のパーサーによる構造と内容の検証です。PowerPointデスクトップアプリでの表示や、あらゆるPPTXとの互換性を確認するものではありません。
