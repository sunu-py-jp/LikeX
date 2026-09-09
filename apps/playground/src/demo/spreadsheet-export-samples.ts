import type { SpreadsheetWorkbook, SpreadsheetSheet, SpreadsheetCell, SpreadsheetCellFormat, SpreadsheetImageResource } from "@likex/spreadsheet";
import imageSamples from "./spreadsheet-image-samples.json";

const heading: SpreadsheetCellFormat = { bold: true, color: '#ffffff', background: '#1e3a5f' };
const muted: SpreadsheetCellFormat = { background: '#eff6ff', color: '#1e3a5f' };
const column = (index: number) => String.fromCharCode(65 + index);
function sheet(id: string, name: string, headers: string[], widths: number[]): SpreadsheetSheet {
  return { id, name, rowCount: 100, columnCount: 12,
    columnWidths: Object.fromEntries(widths.map((width, index) => [index, width])),
    rowHeights: { 0: 38, 2: 30 },
    cells: { A1: { value: name, format: { bold: true, color: '#1e3a5f' } },
      ...Object.fromEntries(headers.map((value, i) => [`${column(i)}3`, { value, format: heading }])) },
  };
}
function row(target: SpreadsheetSheet, n: number, values: string[], formats: SpreadsheetCellFormat[] = []) {
  values.forEach((value, i) => { (target.cells as Record<string, SpreadsheetCell>)[`${column(i)}${n}`] =
    { value, ...(formats[i] ? { format: formats[i] } : {}) }; });
}
/** Extend the basic demo with the same fictional data used for the downloadable Excel sample. */
export function withExportSamples(base: SpreadsheetWorkbook): SpreadsheetWorkbook {
  const workbook = { ...base };
  const guide = sheet('sample-guide', 'はじめに', ['シート', '確認する内容'], [210, 760]);
  row(guide, 1, ['LikeX Excelエクスポート：実データサンプル'], [heading]);
  guide.merges = [{ top: 0, left: 0, bottom: 0, right: 1 }];

  const types = sheet('value-types', '値と文字列', ['パターン', '出力値', '見どころ'], [230, 360, 530]);
  const values = [
    ['商品コード', '00123', '先頭ゼロを保持。文字列として保存'],
    ['電話番号風の数字', '0120000123', '数値へ変換しない'],
    ['15桁の整数', '123456789012345', 'Excelの精度内なので数値'],
    ['16桁の数字列', '1234567890123456', '丸めを避けるため文字列'],
    ['20桁のID', '12345678901234567890', '最後の桁まで文字列で保持'],
    ['極小指数', '1e-400', '0に化けないよう文字列で保持'],
    ['ゼロの指数', '0e-400', '値が本当にゼロなので数値0'],
    ['負の数', '-1234.5', '数値として保存'],
    ['真偽値', 'TRUE', 'Excelの真偽値'],
    ['偽の値', 'FALSE', 'Excelの真偽値'],
    ['明示した文字列', "'TRUE", 'TRUEという文字列'],
    ['数式に似た文字', "'=SUM(A1:A3)", '計算せず文字列として表示'],
    ['特殊文字', '日本語 😀 & < > "', '日本語・絵文字・XMLの特殊文字'],
    ['エスケープ風の文字', '_x0041_', 'Aへ化けず、そのまま保持'],
    ['空白を含む文字', '  前後に空白  ', '前後の空白を保持'],
    ['複数行の文章', '1行目：計画\n2行目：実行\n3行目：確認', '改行を保持。行高72pxに設定'],
    ['日付風の文字', '2026-09-09', '現在は日付型ではなく文字列として出力'],
  ];
  values.forEach((v, i) => row(types, i + 4, v));
  types.rowHeights = { ...types.rowHeights, 18: 72 };
  types.comments = { B4: { id: 'code-note', author: 'LikeX サンプル', text: '商品コード 00123。\n先頭ゼロを保持します。' },
    B16: { id: 'unicode-note', author: 'LikeX', text: 'メモでも日本語 😀 & < > " と _x0041_ を保持します。' } };

  const formats = sheet('format-matrix', '書式の比較', ['入力値', '標準', '数値', '円通貨', 'パーセント', '太字・斜体・下線'], [170, 165, 165, 170, 165, 250]);
  ['1234.567', '-1234.5', '0', '0.125'].forEach((value, i) => row(formats, i + 4,
    [`'${value}`, value, value, value, value, value], [{}, { numberFormat: 'general' }, { numberFormat: 'number' },
      { numberFormat: 'currency' }, { numberFormat: 'percent' }, { bold: true, italic: true, underline: true, background: '#fef3c7', color: '#92400e' }]));
  row(formats, 10, ['配置', '左寄せ', '中央寄せ', '右寄せ'], [heading, { align: 'left' }, { align: 'center' }, { align: 'right' }]);
  row(formats, 12, ['色の指定', 'HEX', 'RGB', 'HSL', 'OKLCH', '半透明色'], [heading,
    { background: '#dbeafe', color: '#1d4ed8' }, { background: 'rgb(220,252,231)', color: 'rgb(21,128,61)' },
    { background: 'hsl(45,95%,90%)', color: 'hsl(25,80%,35%)' },
    { background: 'oklch(0.92 0.06 300)', color: 'oklch(0.4 0.15 300)' },
    { background: 'rgba(37,99,235,0.2)', color: '#1e3a5f' }]);
  row(formats, 15, ['セルの幅と高さ', '狭い列・広い列、行高の指定を反映します']);
  formats.rowHeights = { ...formats.rowHeights, 9: 42, 11: 50 };

  const reference = sheet('quoted-name', "顧客 O'Brien", ['項目', '金額'], [200, 180]);
  row(reference, 4, ['受注A', '100']); row(reference, 5, ['受注B', '200']); row(reference, 6, ['受注C', '300']);
  const edges = sheet('formula-patterns', '数式の追加パターン', ['パターン', '式（文字列）', '計算結果', '期待値'], [230, 360, 210, 260]);
  const formulas = [
    ['符号と累乗', '=-2^2', '-4'], ['累乗の順序', '=2^3^2', '512'], ['かっこ', '=(1+2)*3', '9'],
    ['セミコロン区切り', '=SUM(1;2)', '3'], ['百分率の式', '=50%', '0.5'],
    ['ゼロ除算', '=1/0', '#DIV/0!（意図したエラー）'],
    ['エラーを文字へ', '=IFERROR(1/0,"未確定")', '未確定'], ['真偽値の結果', '=1<2', 'TRUE'],
    ['空文字を返す式', '=IF(1=1,"",0)', '空文字'],
    ['引用符を含むシート名', "='顧客 O''Brien'!B4", '100'],
    ['シート間の範囲合計', "=SUM('顧客 O''Brien'!B4:B6)", '600'],
    ['絶対参照と混合参照', '=$H$4*H5+H$4*$H5', '60'],
    ['売上シートを参照', "='売上計画'!D11", '3029000'],
    ['文字列結合', '=CONCAT("Like","X"," / ","サンプル")', 'LikeX / サンプル'],
  ];
  formulas.forEach(([label, formula, expected], i) => row(edges, i + 4, [label, `'${formula}`, formula, expected]));
  (edges.cells as Record<string, SpreadsheetCell>).H4 = { value: '10', format: muted };
  (edges.cells as Record<string, SpreadsheetCell>).H5 = { value: '3', format: muted };
  edges.comments = { C9: { id: 'intentional-error', author: 'LikeX', text: 'ゼロ除算を意図的に入れています。エクスポート失敗ではありません。' } };

  const images: Record<string, SpreadsheetImageResource> = Object.fromEntries(
    Object.entries(imageSamples).map(([id, image]) => [id, { ...image, mimeType: "image/png" }]),
  );
  workbook.resources = { images: { ...workbook.resources?.images, ...images } };
  const ratios = sheet('image-ratios', '画像の縦横比', [], Array(12).fill(100));
  row(ratios, 2, ['丸が楕円にならないこと、縦長・横長・正方形の比率を確認してください。']);
  ratios.merges = [{ top: 1, left: 0, bottom: 1, right: 10 }];
  ratios.drawings = [];
  ['wide', 'portrait', 'square'].forEach((id, i) => {
    const resource = images[id];
    const width = id === 'portrait' ? 120 : 240;
    const height = width * resource.height / resource.width;
    (ratios.cells as Record<string, SpreadsheetCell>)[`${column(i * 4)}4`] = { value: `${id}：元画像 ${resource.width} × ${resource.height}`, format: muted };
    (ratios.cells as Record<string, SpreadsheetCell>)[`${column(i * 4)}18`] = { value: '同じ240 × 180の枠に配置', format: muted };
    ratios.drawings = [...ratios.drawings!,
      { id: `ratio-original-${id}`, type: 'image', resourceId: id, alt: `${id} normal ratio`, anchor: { row: 4, column: i * 4, offsetX: 6, offsetY: 8 }, width, height },
      { id: `ratio-frame-${id}`, type: 'shape', shape: 'rectangle', fill: '#eff6ff', stroke: '#94a3b8', strokeWidth: 1,
        anchor: { row: 18, column: i * 4, offsetX: 6, offsetY: 8 }, width: 240, height: 180 },
      { id: `ratio-fitted-${id}`, type: 'image', resourceId: id, alt: `${id} contained within 240x180 frame`,
        anchor: { row: 18, column: i * 4, offsetX: 6, offsetY: 8 }, width: 240, height: 180 },
    ];
  });

  const detail = sheet('thousand-rows', '明細1000行', ['番号', '商品コード', '区分', '数量', '単価', '金額', '税額', '税込金額'], [90, 170, 140, 90, 140, 150, 140, 170]);
  detail.rowCount = 1010;
  for (let i = 0; i < 1000; i++) {
    const r = i + 4;
    row(detail, r, [String(i + 1), `P-${String(i + 1).padStart(5, '0')}`, ['ソフトウェア', '運用', '制作'][i % 3],
      String(i % 9 + 1), String((i % 17 + 1) * 1250), `=D${r}*E${r}`, `=ROUND(F${r}*0.1,0)`, `=F${r}+G${r}`],
      [{}, {}, {}, {}, { numberFormat: 'currency' }, { numberFormat: 'currency' }, { numberFormat: 'currency' }, { numberFormat: 'currency' }]);
  }
  row(detail, 1005, ['合計', '', '', '=SUM(D4:D1003)', '', '=SUM(F4:F1003)', '=SUM(G4:G1003)', '=SUM(H4:H1003)'],
    [heading, heading, heading, heading, heading, { ...heading, numberFormat: 'currency' }, { ...heading, numberFormat: 'currency' }, { ...heading, numberFormat: 'currency' }]);
  const empty: SpreadsheetSheet = { id: 'empty-sheet', name: '空シート', rowCount: 50, columnCount: 12, cells: {} };
  const labeled = sheet('labeled-shapes', '文字入り図形', [], Array(12).fill(100));
  row(labeled, 2, ['文字も図形自体の一部です。Excel上で図形を選択して編集・移動できます。']);
  labeled.merges = [{ top: 1, left: 0, bottom: 1, right: 10 }];
  labeled.drawings = [
    { id: 'workflow-input', type: 'shape', shape: 'rectangle', text: '申請受付\n担当：総務', fontSize: 20, color: '#1e3a5f', bold: true,
      fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 2, anchor: { row: 4, column: 0, offsetX: 12, offsetY: 10 }, width: 220, height: 120 },
    { id: 'workflow-arrow', type: 'shape', shape: 'arrow', text: '確認へ', fontSize: 16, color: '#334155', fill: 'transparent', stroke: '#64748b', strokeWidth: 2,
      anchor: { row: 5, column: 2, offsetX: 40, offsetY: 10 }, width: 120, height: 35 },
    { id: 'workflow-review', type: 'shape', shape: 'rectangle', text: '内容確認\n金額・期日を照合', fontSize: 18, color: '#92400e',
      fill: '#fef3c7', stroke: '#d97706', strokeWidth: 2, anchor: { row: 4, column: 4, offsetX: 0, offsetY: 10 }, width: 220, height: 120 },
    { id: 'workflow-done', type: 'shape', shape: 'ellipse', text: '承認済み', fontSize: 22, color: '#166534', bold: true,
      fill: '#dcfce7', stroke: '#16a34a', strokeWidth: 2, anchor: { row: 4, column: 8, offsetX: 0, offsetY: 10 }, width: 220, height: 120 },
    { id: 'white-on-blue', type: 'shape', shape: 'rectangle', text: '白文字のラベル\n進捗 100%', fontSize: 22, color: '#ffffff', bold: true,
      fill: '#1d4ed8', stroke: '#1e40af', strokeWidth: 2, anchor: { row: 12, column: 0, offsetX: 12, offsetY: 0 }, width: 280, height: 130 },
    { id: 'unicode-shape', type: 'shape', shape: 'ellipse', text: '日本語 & <XML>\n確認 OK 😀', fontSize: 20, color: '#6b21a8',
      fill: '#f3e8ff', stroke: '#9333ea', strokeWidth: 2, anchor: { row: 12, column: 4, offsetX: 0, offsetY: 0 }, width: 300, height: 150 },
  ];
  workbook.sheets = [guide, ...workbook.sheets, types, formats, reference, edges, ratios, labeled, detail, empty];
  const descriptions = [
    'サンプルの目次。実データはすべて架空です。', '売上・粗利・達成率、通貨・割合、シート間参照',
    '費用の計算と集計', 'PNG画像・矩形・楕円・矢印・線・テキストボックス・メモ',
    '対応している15種類の関数', '横・縦・矩形の結合、結合セル内の数式',
    '先頭ゼロ、長いID、真偽値、日本語・絵文字、文字列保持',
    '数値・通貨・割合、文字装飾、配置、色、列幅・行高',
    'シート名に引用符がある場合の参照元',
    '演算順序、絶対参照、シート間参照、意図した計算エラー',
    '3つの画像比率を6配置で比較。枠と画像の比率が異なる場合も確認',
    '図形内の文字、改行、文字色・サイズ・太字、日本語・特殊文字',
    '1,000行、3,000個の明細数式と集計', '中身のないシートも維持',
  ];
  workbook.sheets.forEach((s, i) => row(guide, i + 4, [s.name, descriptions[i]]));
  row(guide, 20, ['注意', '「数式の追加パターン」のゼロ除算は、エラー表示を確認するためのサンプルです。']);
  row(guide, 21, ['画像', '「挿入サンプル」の棒グラフは静止画像です。Excelのグラフ機能ではありません。']);
  row(guide, 22, ['コメント', 'Excelではスレッドコメントではなく「メモ」として表示されます。']);
  row(guide, 23, ['出力経路', 'LikeXのexportSpreadsheetXlsxで生成。Excelを別ライブラリで作り直していません。']);
  row(guide, 24, ['再計算', 'Excelで開くと数式を再計算します。列幅や文字組みは環境により多少変わります。']);
  return workbook;
}
