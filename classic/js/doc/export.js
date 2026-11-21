/* =============================================================
 * 多格式导出：Word (.docx) · Excel (.xlsx) · CSV · HTML
 *
 * 全部**零依赖**、纯前端生成，不联网、不装库：
 *   · Excel —— 手写 OOXML + ZIP，产出真 .xlsx（3 张工作表，数字是数字）
 *   · Word  —— 手写 WordprocessingML + ZIP，产出真 .docx（带表格样式）
 * 为什么不用老办法（Office HTML 存成 .doc）：
 *   实测 LibreOffice 直接拒收（要求 OLE compound document），
 *   真 Word 打开会弹「文件格式与扩展名不符」的警告，用户会以为文件坏了。
 * ============================================================= */

import { docMeta, itemColumns, columnsHiddenByRows } from '../core/schema.js';
import { otherFeeRows } from '../core/calc.js';
import { getTemplate, tableLabels } from '../core/templates.js';
import { t } from '../core/i18n.js';
import * as toast from '../ui/toast.js';
import { makeZip } from './zip.js';
import { buildDocumentXml, packDocx } from './docx.js';

/* ============================ 通用小工具 ============================ */

/** 生成安全文件名（不含扩展名） */
export function baseFileName(doc, suffix = '') {
  const who = (doc.buyer && doc.buyer.companyName) || 'customer';
  return [doc.docNo || doc.type, who, suffix]
    .filter(Boolean)
    .join('_')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'document';
}

/** 触发浏览器下载 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function plainNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function withUnit(v, unit, digits = 3) {
  const n = plainNumber(v);
  if (!n) return '';
  return `${Number(n.toFixed(digits))} ${unit || ''}`.trim();
}

function humanType(type) {
  return t(`doc.${type}`);
}

/* ============================ 收集单据数据 ============================ */

/**
 * 把单据整理成结构化表格：Word / Excel / CSV 三种导出共用这一份数据
 */
export function collectDocData(doc) {
  const tpl = getTemplate(doc.docLang);
  const labels = tpl.label || {};
  const L = tableLabels(doc.docLang);
  const meta = docMeta(doc.type);
  // 必须传 doc：列集合由单据的显示开关决定，不传的话导出会和单据上看到的不一致。
  // 再滤掉「所有行都不需要」的列 —— 用户要的是整列不显示，导出里也不该有这一列。
  const drop = columnsHiddenByRows(doc);
  const cols = itemColumns(doc.type, doc).filter((c) => !drop.has(c.key));
  const packing = meta.mode === 'packing';

  /* --- 抬头信息 --- */
  const head = [];
  const push = (k, v) => { if (String(v || '').trim()) head.push([k, String(v)]); };
  const noLabel = {
    quotation: labels.quotationNo, pi: labels.piNo, contract: labels.contractNo,
    ci: labels.invoiceNo, pl: labels.plNo,
  }[doc.type] || labels.docNo;
  push(noLabel || 'No.', doc.docNo);
  push(labels.date || 'Date', doc.date);
  push(labels.validUntil || 'Valid Until', doc.validUntil);
  push(labels.incoterms || 'Incoterms', doc.incoterms);
  push(labels.destination || 'Destination', doc.destination);
  push(labels.loadingPort || 'Port of Loading', doc.loadingPort);
  push(labels.leadTime || 'Lead Time', doc.leadTime);
  push(labels.paymentTerms || 'Payment Terms', doc.paymentTerms);
  if (!packing) push(labels.currency || 'Currency', doc.currency);
  push(labels.customerCode || 'Customer Code', doc.customerCode);
  push(labels.poNo || 'PO / Reference No.', doc.poNo);
  push(labels.lcNo || 'L/C No.', doc.lcNo);
  push(labels.awbNo || 'AWB / B/L No.', doc.awbNo);
  push(labels.shippingMethod || 'Shipping Method', doc.shippingMethod);
  push(labels.countryOfExport || 'Country of Export', doc.countryOfExport || doc.seller?.country);
  push(labels.countryOfOrigin || 'Country of Origin', doc.countryOfOrigin);
  push(labels.reasonForExport || 'Reason for Export', doc.reasonForExport);
  push(labels.tradeTermsPlace || 'Trade Terms Place', doc.tradeTermsPlace);
  push(labels.preparedBy || 'Prepared By', doc.preparedBy);

  /* --- 双方 / 收货人 --- */
  const partyRows = (p) => {
    if (!p) return [];
    const rows = [];
    const add = (k, v) => { if (String(v || '').trim()) rows.push([k, String(v)]); };
    add(labels.address || 'Address', p.address);
    add(labels.city || 'City', p.city);
    add(labels.state || 'State', p.state);
    add(labels.zip || 'Zip Code', p.zip);
    add(labels.country || 'Country', p.country);
    add(labels.attn || 'Attn', p.contact);
    add(labels.tel || 'Tel', p.tel);
    add(labels.fax || 'Fax', p.fax);
    add(labels.email || 'E-mail', p.email);
    add(labels.taxId || 'Tax ID', p.taxId);
    return rows;
  };

  const parties = [
    { title: labels.from || 'FROM', company: doc.seller?.companyName, rows: partyRows(doc.seller) },
    { title: labels.to || 'TO', company: doc.buyer?.companyName, rows: partyRows(doc.buyer) },
  ];
  if (doc.type === 'ci' || doc.type === 'pl') {
    const same = !doc.consignee?.companyName || doc.consignee.companyName === doc.buyer?.companyName;
    parties.push({
      title: labels.consignee || 'CONSIGNEE',
      company: same ? doc.buyer?.companyName : doc.consignee?.companyName,
      rows: partyRows(same ? doc.buyer : doc.consignee),
    });
  }

  /* --- 产品明细 --- */
  const itemCols = cols.map((c) => ({
    key: c.key,
    label: L[c.label] || c.label,
    align: ['qty', 'unitPrice', 'amount', 'nw', 'gw', 'meas'].includes(c.key) ? 'right' : 'left',
    // 描述列最宽；表头文字长的列（Photo / HS Code / No.）都要给够，否则表头会折行很难看
    width: c.key === 'description' ? 2.6
      : (c.key === 'photo' ? 0.85
        : (c.key === 'hsCode' ? 1.15
          : (c.key === 'no' ? 0.55 : 1))),
  }));

  const wi = (doc.items || []).find((it) => it.weightUnit) || {};
  const mi = (doc.items || []).find((it) => it.measUnit) || {};
  const wUnit = wi.weightUnit || 'kg';
  const mUnit = mi.measUnit || 'm³';

  const items = (doc.items || []).map((it, i) => cols.map((c) => {
    switch (c.key) {
      case 'no': return i + 1;
      case 'photo': return it.photo ? t('exp.hasPhoto') : '';
      case 'description': {
        const spec = [];
        if (it.size) spec.push(`${L.size}: ${it.size}`);
        if (it.color) spec.push(`${L.color}: ${it.color}`);
        if (it.material) spec.push(`${L.material}: ${it.material}`);
        if (it.styleName) spec.push(`${L.styleName}: ${it.styleName}`);
        if (plainNumber(it.moq)) spec.push(`${L.moq}: ${plainNumber(it.moq)}`);
        if (it.specNote) spec.push(it.specNote);
        if (it.remark) spec.push(it.remark);
        return [it.description, ...spec].filter(Boolean).join('\n');
      }
      case 'qty': return packing ? plainNumber(it.ctns || it.qty) : plainNumber(it.qty);
      case 'unitPrice': return plainNumber(it.unitPrice);
      case 'amount': return packing ? '' : plainNumber(it.amount);
      case 'nw': return plainNumber(it.nw);
      case 'gw': return plainNumber(it.gw);
      case 'meas': return plainNumber(it.meas);
      default: return it[c.key] ?? '';
    }
  }));

  /* --- 合计 --- */
  const tt = doc.totals || {};
  const totals = [];
  if (packing) {
    totals.push([tpl.sum?.totalCtn || 'Total Cartons', plainNumber(tt.totalQty)]);
    totals.push([tpl.sum?.totalNw || 'Total N.W.', withUnit(tt.totalNw, wUnit)]);
    totals.push([tpl.sum?.totalGw || 'Total G.W.', withUnit(tt.totalGw, wUnit)]);
    totals.push([tpl.sum?.totalMeas || 'Total Meas.', withUnit(tt.totalMeas, mUnit, 4)]);
  } else {
    totals.push([tpl.sum?.totalQty || 'Total Qty', plainNumber(tt.totalQty)]);
    const hasExtra = doc.discount || doc.taxRate || doc.shippingFee
      || doc.insuranceFee || doc.toolingFee || otherFeeRows(doc).length;
    if (hasExtra) {
      totals.push([t('sum.subtotal'), plainNumber(tt.subtotal)]);
      if (plainNumber(doc.discount)) totals.push([t('sum.discount'), -plainNumber(tt.discount)]);
      if (plainNumber(doc.taxRate)) totals.push([`${t('sum.tax')} ${plainNumber(doc.taxRate)}%`, plainNumber(tt.taxAmount)]);
      if (plainNumber(doc.insuranceFee)) totals.push([t('sum.insurance'), plainNumber(tt.insuranceFee)]);
      if (plainNumber(doc.shippingFee)) totals.push([t('sum.shipping'), plainNumber(tt.shippingFee)]);
      // 其它费用逐项导出，和单据上看到的一致
      for (const r of otherFeeRows(doc)) totals.push([r.label || t('sum.other'), plainNumber(r.amount)]);
      if (plainNumber(doc.toolingFee)) totals.push([t('sum.tooling'), plainNumber(tt.toolingFee)]);
      totals.push([t('sum.grandTotal'), plainNumber(tt.grandTotal)]);
    } else {
      totals.push([tpl.sum?.totalAmount || 'Total Amount', plainNumber(tt.totalAmount)]);
    }
    if (plainNumber(tt.totalGw)) totals.push([tpl.sum?.totalGw || 'Total G.W.', withUnit(tt.totalGw, wUnit)]);
    if (doc.toolingRefund) totals.push([t('sum.tooling'), doc.toolingRefund]);
  }
  totals.push([t('f.currency'), doc.currency || '']);

  /* --- 附加区块 --- */
  const extras = [];
  const addBlock = (title, rows) => {
    const r = rows.filter(([, v]) => String(v || '').trim());
    if (r.length) extras.push({ title, rows: r });
  };
  if (doc.contractClauses && doc.contractClauses.length) {
    extras.push({
      title: labels.terms || 'Terms',
      rows: doc.contractClauses.map((c, i) => [`${i + 1}. ${c.title || ''}`, c.body || '']),
    });
  } else if (doc.terms) {
    addBlock(labels.terms || 'Terms', [[labels.terms || 'Terms', doc.terms]]);
  }
  addBlock(labels.marks || 'Shipping Marks', [[labels.marks || 'Marks', doc.marks]]);
  addBlock(t('tab.logistics'), [
    [labels.deliveryPlace || t('f.deliveryPlace'), doc.deliveryPlace],
    [labels.productionTime || t('f.productionTime'), doc.productionTime],
    [labels.warranty || t('f.warranty'), doc.warranty],
    [labels.invoiceType || t('f.invoiceType'), doc.invoiceType],
    [labels.payingBank || t('f.payingBank'), doc.payingBank],
    [labels.sampleNote || t('f.sampleNote'), doc.sampleNote],
  ]);
  addBlock(labels.bankInfo || t('tab.bank'), [
    [labels.beneficiary || 'Beneficiary', doc.beneficiaryAccount || doc.bank?.beneficiary],
    [labels.bankName || 'Bank Name', doc.bank?.bankName],
    [labels.bankAddress || 'Bank Address', doc.bank?.bankAddress],
    [labels.accountNo || 'Account No.', doc.bank?.accountNo],
    [labels.swift || 'SWIFT', doc.bank?.swift],
    [labels.iban || 'IBAN', doc.bank?.iban],
  ]);
  addBlock(labels.remarks || 'Remarks', [[labels.remarks || 'Remarks', doc.remarks]]);

  return {
    title: `${humanType(doc.type)} ${doc.docNo || ''}`.trim(),
    docTitle: doc.titleOverride || tpl.docTitle?.[doc.type] || humanType(doc.type),
    seller: doc.seller?.companyName || '',
    meta: head,
    parties,
    itemCols,
    items,
    totals,
    extras,
    packing,
  };
}

/* ============================ Word (.docx) ============================ */

/** 导出 Word：真 .docx，Word / WPS / Pages 双击即开，无格式警告 */
export async function exportWord(doc) {
  if (!doc) { toast.warn(t('msg.needDoc')); return false; }
  const d = collectDocData(doc);

  const blocks = [];
  blocks.push({ type: 'para', text: d.seller, opts: { bold: true, size: 32 } });
  blocks.push({
    type: 'para',
    text: [d.docTitle, doc.docNo, doc.date].filter(Boolean).join('  ·  '),
    opts: { size: 18, color: '666666' },
  });

  blocks.push({ type: 'title', text: t('tab.basic') });
  blocks.push({ type: 'table', rows: d.meta, opts: { widths: [1, 3] } });

  for (const p of d.parties) {
    if (!p.company && !p.rows.length) continue;
    blocks.push({ type: 'title', text: `${p.title}${p.company ? ' — ' + p.company : ''}` });
    if (p.rows.length) blocks.push({ type: 'table', rows: p.rows, opts: { widths: [1, 3] } });
  }

  blocks.push({ type: 'title', text: t('tab.items') });
  blocks.push({
    type: 'table',
    rows: [d.itemCols.map((c) => c.label), ...d.items],
    opts: {
      head: true,
      widths: d.itemCols.map((c) => c.width),
      align: d.itemCols.map((c) => c.align),
    },
  });

  blocks.push({ type: 'title', text: `${t('sum.totalAmount')}${d.packing ? '' : '  ' + (doc.currency || '')}` });
  blocks.push({
    type: 'table',
    rows: d.totals.map(([k, v]) => [
      k,
      typeof v === 'number' && !d.packing
        ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : v,
    ]),
    opts: { widths: [2, 1], align: ['left', 'right'] },
  });

  for (const b of d.extras) {
    blocks.push({ type: 'title', text: b.title });
    blocks.push({ type: 'table', rows: b.rows, opts: { widths: [1, 3] } });
  }

  blocks.push({ type: 'para', text: t('exp.wordFooter'), opts: { size: 16, color: '888888' } });

  const blob = await packDocx(buildDocumentXml(blocks));
  downloadBlob(blob, `${baseFileName(doc)}.docx`);
  toast.ok(t('exp.wordDone'), 2600);
  return true;
}

/* ============================ Excel (.xlsx) ============================ */

/** 列号：0 → A */
function colName(i) {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/**
 * 根据内容估算列宽（字符数）
 * Excel 不会自动适应列宽，不设的话 A 列会把「Invoice No.」截成「Invoice No」
 */
function guessWidths(rows, opts = {}) {
  const maxCols = Math.max(1, ...rows.map((r) => (r ? r.length : 0)));
  const widths = [];
  for (let c = 0; c < maxCols; c++) {
    let w = 8;
    for (const row of rows) {
      const v = row && row[c];
      if (v === null || v === undefined || v === '') continue;
      // 多行内容按最长那行算，并给宽一点（描述列）
      const lines = String(v).split('\n');
      const longest = Math.max(...lines.map((x) => x.length));
      const perLine = opts.wideText && c === opts.wideTextCol ? longest * 0.55 : longest;
      w = Math.max(w, perLine + 2);
    }
    widths.push(Math.min(opts.max || 60, Math.max(6, Math.round(w))));
  }
  return widths;
}

/** 生成 <cols> 片段 */
function colsXml(widths) {
  return `<cols>${widths.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
}

function sheetXml(rows, widths = null) {
  const rowsXml = rows.map((cells, ri) => {
    const cs = cells.map((c, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      if (c === null || c === undefined || c === '') return '';
      if (typeof c === 'number' && Number.isFinite(c)) return `<c r="${ref}"><v>${c}</v></c>`;
      const style = ri === 0 ? ' s="1"' : '';
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xescXml(c)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cs}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${widths ? colsXml(widths) : ''}
<sheetData>${rowsXml}</sheetData>
</worksheet>`;
}

function xescXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** 导出 Excel：真 .xlsx，三张工作表 */
/** 带样式与合并单元格的工作表（样式编号见 styles.xml） */
function sheetXmlStyled(spec) {
  const { cols = null, rows = [], merges = [] } = spec;
  const rowsXml = rows.map((cells, ri) => {
    const cs = (cells || []).map((c, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      if (c === null || c === undefined || c === '') return '';
      const cell = (typeof c === 'object') ? c : { v: c };
      const v = cell.v;
      if (v === null || v === undefined || v === '') return '';
      const s = cell.s ? ` s="${cell.s}"` : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xescXml(v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cs}</row>`;
  }).join('');
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${cols ? colsXml(cols) : ''}
<sheetData>${rowsXml}</sheetData>${mergeXml}
</worksheet>`;
}

const EXCEL_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
  <font><sz val="11"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><name val="Calibri"/></font>
  <font><b/><sz val="15"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F8"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE7F3EA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border>
    <left style="thin"><color rgb="FFB8C2D0"/></left>
    <right style="thin"><color rgb="FFB8C2D0"/></right>
    <top style="thin"><color rgb="FFB8C2D0"/></top>
    <bottom style="thin"><color rgb="FFB8C2D0"/></bottom>
    <diagonal/>
  </border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<cellXfs count="7">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
  <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
</cellXfs>
</styleSheet>`;

/** 导出 Excel：按单据版式排版（标题 / 双方 / 带边框明细 / TOTAL / 合计 / 条款）+ 数据表 */
export async function exportExcel(doc) {
  if (!doc) { toast.warn(t('msg.needDoc')); return false; }
  const d = collectDocData(doc);

  const nCols = Math.min(10, Math.max(6, d.itemCols.length));
  const lastCol = colName(nCols - 1);
  const rows = [];
  const pad = (arr) => {
    const out = arr.slice();
    while (out.length < nCols) out.push('');
    return out;
  };
  const push = (arr) => rows.push(pad(arr));

  // 标题
  push([{ v: d.docTitle, s: 2 }]);
  // 单号 / 日期
  push([{ v: 'No.', s: 3 }, doc.docNo || '', '', { v: 'Date', s: 3 }, doc.date || '']);
  push([]);

  // 卖方块
  const parties = d.parties || [];
  const seller = parties[0];
  if (seller) {
    push([{ v: seller.title || 'SELLER', s: 3 }, seller.company || '']);
    for (const [k, v] of (seller.rows || [])) push([`  ${k}`, v]);
  }
  // 其余当事方
  for (const p of parties.slice(1)) {
    if (!p.company && !(p.rows || []).length) continue;
    push([]);
    push([{ v: p.title || '', s: 3 }, p.company || '']);
    for (const [k, v] of (p.rows || [])) push([`  ${k}`, v]);
  }

  // 明细表
  push([]);
  push(d.itemCols.map((c) => ({ v: c.label, s: 1 })));
  for (const row of d.items) {
    push(row.map((v) => ({ v, s: (typeof v === 'number' ? 5 : 4) })));
  }
  // TOTAL 行（首格加粗填色，其余同底色）
  push([{ v: 'TOTAL', s: 6 }, ...Array(Math.max(0, nCols - 1)).fill({ v: '', s: 6 })]);

  // 合计
  push([]);
  for (const [k, v] of d.totals) push([{ v: k, s: 3 }, v]);

  // 条款 / 备注 / 银行等
  for (const b of d.extras) {
    if (!(b.rows || []).length && !b.title) continue;
    push([]);
    push([{ v: b.title || '', s: 3 }]);
    for (const [k, v] of (b.rows || [])) push([{ v: k, s: 4 }, { v: String(v), s: 4 }]);
  }

  const docCols = [26, 46];
  while (docCols.length < nCols) docCols.push(15);

  const sheets = [
    { name: (d.docTitle || 'DOC').slice(0, 28), styled: { cols: docCols, rows, merges: [`A1:${lastCol}1`] } },
    { name: t('exp.sheetItems'), rows: [d.itemCols.map((c) => c.label), ...d.items], widths: guessWidths([d.itemCols.map((c) => c.label), ...d.items], { wideText: true, wideTextCol: 2, max: 48 }) },
    { name: t('exp.sheetTotals'), rows: [[t('sum.totalAmount'), ''], ...d.totals.map(([k, v]) => [k, typeof v === 'number' ? v : String(v)])], widths: [30, 24] },
  ];

  const files = [
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xescXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', text: EXCEL_STYLES_XML },
    {
      name: 'docProps/core.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>TradeDocs</dc:creator><cp:lastModifiedBy>TradeDocs</cp:lastModifiedBy>
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
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      text: s.styled ? sheetXmlStyled(s.styled) : sheetXml(s.rows, s.widths),
    })),
  ];

  const blob = await makeZip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  downloadBlob(blob, `${baseFileName(doc)}.xlsx`);
  toast.ok(t('exp.excelDone'), 2600);
  return true;
}

/* ============================ CSV ============================ */

export function exportCsv(doc) {
  if (!doc) { toast.warn(t('msg.needDoc')); return false; }
  const d = collectDocData(doc);
  const quote = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];
  lines.push([d.docTitle, doc.docNo || '', doc.date || ''].map(quote).join(','));
  lines.push('');
  lines.push(d.itemCols.map((c) => quote(c.label)).join(','));
  for (const row of d.items) lines.push(row.map(quote).join(','));
  lines.push('');
  for (const [k, v] of d.totals) lines.push([quote(k), quote(v)].join(','));

  const blob = new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `${baseFileName(doc)}.csv`);
  toast.ok(t('exp.csvDone'), 2400);
  return true;
}

/* ============================ 统一入口 ============================ */

export async function exportAs(doc, format) {
  if (!doc) { toast.warn(t('msg.needDoc')); return false; }
  if (format === 'word') return exportWord(doc);
  if (format === 'excel') return exportExcel(doc);
  if (format === 'csv') return exportCsv(doc);
  toast.warn(t('exp.unknownFormat'));
  return false;
}

export function exportFormats() {
  return [
    { key: 'word', icon: '📝', labelKey: 'exp.word', descKey: 'exp.wordDesc', ext: '.docx' },
    { key: 'excel', icon: '📊', labelKey: 'exp.excel', descKey: 'exp.excelDesc', ext: '.xlsx' },
    { key: 'csv', icon: '📑', labelKey: 'exp.csv', descKey: 'exp.csvDesc', ext: '.csv' },
  ];
}
