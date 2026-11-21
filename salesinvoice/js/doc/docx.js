/* =============================================================
 * 生成真正的 Word 文档 (.docx)
 *
 * 为什么不用「Office HTML 存成 .doc」那套老办法：
 *   实测 LibreOffice 直接拒收（要求 OLE compound document），
 *   真 Word 打开也会弹「文件格式与扩展名不符」的警告，用户会虚。
 *   所以这里手写 OOXML（WordprocessingML）+ ZIP，产出货真价实的 .docx，
 *   Word / WPS / Pages / LibreOffice 都能直接双击打开，零警告。
 * ============================================================= */

import { makeZip } from './zip.js';

/** XML 转义 + 去掉 XML 不允许的控制字符（否则 Word 报文档损坏） */
export function xesc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** 一段文本 → 若干 w:p（\n 拆成多段，空行保留） */
function para(text, opts = {}) {
  const { bold = false, size = 20, color = null, align = null, italic = false } = opts;
  const lines = String(text ?? '').split('\n');
  return lines.map((line) => {
    const rPr = [
      bold ? '<w:b/>' : '',
      italic ? '<w:i/>' : '',
      `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
      color ? `<w:color w:val="${color}"/>` : '',
      // 中英文字体都指定，避免 Word 用错字体导致中文/泰文变方块
      '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei" w:cs="Arial"/>',
    ].join('');
    const pPr = [
      align ? `<w:jc w:val="${align}"/>` : '',
      '<w:spacing w:before="20" w:after="20" w:line="264" w:lineRule="auto"/>',
    ].join('');
    return `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xesc(line)}</w:t></w:r></w:p>`;
  }).join('');
}

/**
 * 生成一张表
 * @param {Array<Array<string|number>>} rows
 * @param {object} opts { head:boolean, widths:number[]（相对比例）, align:string[] }
 */
function table(rows, opts = {}) {
  const { head = false, widths = null, align = [] } = opts;
  if (!rows.length) return '';
  const nCols = Math.max(...rows.map((r) => r.length));
  // 页面可用宽度（twips）：A4 宽 11906 减去左右页边距 850×2
  const total = 11906 - 850 * 2;
  const w = widths && widths.length === nCols
    ? widths
    : Array.from({ length: nCols }, () => 1);
  const wSum = w.reduce((a, b) => a + b, 0);
  const colW = w.map((x) => Math.round((x / wSum) * total));

  const trs = rows.map((row, ri) => {
    const isHead = head && ri === 0;
    const tcs = Array.from({ length: nCols }, (_, ci) => {
      const val = row[ci] ?? '';
      const num = typeof val === 'number';
      const jc = align[ci] === 'right' || (num && !isHead) ? 'right' : 'left';
      // 表格单元格里的多行用 w:br 分隔，保持在一个格子里
      const lines = String(val).split('\n');
      const runs = lines.map((ln, li) => {
        const br = li > 0 ? '<w:br/>' : '';
        const rPr = [
          isHead ? '<w:b/>' : '',
          '<w:sz w:val="18"/><w:szCs w:val="18"/>',
          '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei" w:cs="Arial"/>',
        ].join('');
        return `${br}<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xesc(ln)}</w:t></w:r>`;
      }).join('');
      const shd = isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F8"/>' : '';
      return `<w:tc><w:tcPr><w:tcW w:w="${colW[ci]}" w:type="dxa"/>${shd}`
        + '<w:tcBorders>'
        + '<w:top w:val="single" w:sz="4" w:color="999999"/>'
        + '<w:left w:val="single" w:sz="4" w:color="999999"/>'
        + '<w:bottom w:val="single" w:sz="4" w:color="999999"/>'
        + '<w:right w:val="single" w:sz="4" w:color="999999"/>'
        + '</w:tcBorders>'
        + `<w:vAlign w:val="top"/></w:tcPr>`
        + `<w:p><w:pPr><w:jc w:val="${jc}"/><w:spacing w:before="10" w:after="10"/></w:pPr>${runs}</w:p></w:tc>`;
    }).join('');
    // 表头行跨页重复
    const trPr = isHead ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
    return `<w:tr>${trPr}${tcs}</w:tr>`;
  }).join('');

  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>`
    + '<w:tblLayout w:type="fixed"/>'
    + '<w:tblBorders>'
    + '<w:top w:val="single" w:sz="4" w:color="999999"/>'
    + '<w:left w:val="single" w:sz="4" w:color="999999"/>'
    + '<w:bottom w:val="single" w:sz="4" w:color="999999"/>'
    + '<w:right w:val="single" w:sz="4" w:color="999999"/>'
    + '<w:insideH w:val="single" w:sz="4" w:color="999999"/>'
    + '<w:insideV w:val="single" w:sz="4" w:color="999999"/>'
    + '</w:tblBorders></w:tblPr>'
    + `<w:tblGrid>${colW.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>`
    + trs + '</w:tbl>';
}

/** 区块小标题（带下边框） */
function sectionTitle(text) {
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="888888"/></w:pBdr>`
    + '<w:spacing w:before="180" w:after="60"/></w:pPr>'
    + '<w:r><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/>'
    + '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei" w:cs="Arial"/>'
    + `</w:rPr><w:t xml:space="preserve">${xesc(text)}</w:t></w:r></w:p>`;
}

/** 生成 document.xml */
export function buildDocumentXml(blocks) {
  // blocks: Array<{type:'para'|'title'|'table', ...}>
  const body = blocks.map((b) => {
    if (b.type === 'title') return sectionTitle(b.text);
    if (b.type === 'table') return table(b.rows, b.opts || {}) + para('', { size: 8 });
    return para(b.text, b.opts || {});
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${body}
<w:sectPr>
  <w:pgSz w:w="11906" w:h="16838"/>
  <w:pgMar w:top="1020" w:right="850" w:bottom="1020" w:left="850" w:header="709" w:footer="709" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;
}

/**
 * 打包成 .docx（最小但完整的 OOXML 包）
 * @param {string} documentXml
 * @returns {Promise<Blob>}
 */
export async function packDocx(documentXml) {
  const files = [
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: 'word/styles.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei" w:cs="Arial"/>
<w:sz w:val="20"/><w:szCs w:val="20"/>
</w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`,
    },
    {
      name: 'docProps/core.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>TradeDocs</dc:creator>
<cp:lastModifiedBy>TradeDocs</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>
</cp:coreProperties>`,
    },
    {
      name: 'docProps/app.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>TradeDocs</Application>
</Properties>`,
    },
    { name: 'word/document.xml', text: documentXml },
  ];

  return makeZip(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
