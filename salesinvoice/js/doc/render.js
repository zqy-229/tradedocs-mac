/* =============================================================
 * 单据版式渲染 —— 生成右侧预览用的 HTML
 * 与 PDF / 打印使用完全相同的 HTML 与 CSS，保证「所见即所得」
 * 支持 12 种模板语言（含阿拉伯语 RTL 镜像排版）
 * 单据配色走 --doc-* 变量，随主题切换（见 THEME_DOC_VARS）
 * ============================================================= */

import { esc, escLines, formatDateDoc, money, qty, num } from '../core/util.js';
import { docMeta, itemColumns, columnsHiddenByRows } from '../core/schema.js';
import { getTemplate, tableLabels, CURRENCY_SYMBOL } from '../core/templates.js';
import { amountInWords, hasExtraCharges, otherFeeRows } from '../core/calc.js';
import { renderSalesInvoice, SI_CSS } from './sales_invoice.js';

/** 币种前缀：USD 1,200.00 */
function amountText(v, currency) {
  const sym = CURRENCY_SYMBOL[currency] || '';
  const code = currency && currency !== 'USD' ? `${currency} ` : (sym ? `${sym}` : '');
  return `${code}${money(v)}`;
}

/** 简单金额：只数字 */
function amountPlain(v) {
  return money(v);
}

/** 默认单位（老数据没有单位字段时用这些） */
const D_UNIT = { weight: 'kg', meas: 'm³', pack: 'ctn' };

/** 重量显示（3 位小数 + 单位） */
function w3(v, unit) {
  const n = Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  return `${n} ${unit || D_UNIT.weight}`;
}

/** 体积显示（4 位小数 + 单位，行业惯例） */
function v4(v, unit) {
  const n = Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  return `${n} ${unit || D_UNIT.meas}`;
}

/**
 * 地址块（两栏：左标签 + 右内容）
 * 客户 / 货代 / 银行看单据时要一眼分清哪一行是什么，所以每行都带 Address: / ที่อยู่: 之类前缀。
 * 用「标签列 + 内容列」而不是「标签 内容」挤一行：
 *   泰语这类标签较长的语言，挤一行会让值换行后不缩进、糊成一团（实测过）。
 */
function partyLines(p, L = {}) {
  if (!p) return [];
  const lb = (k, fallback) => (L && L[k]) || fallback;
  const out = [];
  const line = (label, value) =>
    out.push(`<div class="ln"><span class="k">${esc(label)}</span><span class="v">${escLines(value)}</span></div>`);

  if (p.companyName) out.push(`<div class="nm">${esc(p.companyName)}</div>`);
  if (p.address) line(lb('address', 'Address'), p.address);   // line() 内部用 escLines，换行会自动变成 <br>
  if (p.city) line(lb('city', 'City'), p.city);
  if (p.state) line(lb('state', 'State'), p.state);
  if (p.zip) line(lb('zip', 'Zip Code'), p.zip);
  if (p.country) line(lb('country', 'Country'), p.country);
  if (p.contact) line(lb('attn', 'Attn'), p.contact);
  if (p.tel) line(lb('tel', 'Tel'), p.tel);
  if (p.fax) line(lb('fax', 'Fax'), p.fax);
  if (p.email) line(lb('email', 'E-mail'), p.email);
  if (p.website) line(lb('website', 'Website'), p.website);
  if (p.whatsapp) line('WhatsApp', p.whatsapp);
  if (p.taxId) line(lb('taxId', 'Tax ID'), p.taxId);
  return out;
}

/** 印章尺寸/位置：custom 由用户在表单里调，存到单据上 */
function stampSizePx(doc) {
  const s = Number(doc && doc.stampScale);
  const scale = Number.isFinite(s) && s > 0 ? Math.min(2, Math.max(0.4, s)) : 1;
  return Math.round(96 * scale);
}
/** 手写签名的位移（拖动后存到 signDX / signDY） */
function signInlineStyle(doc) {
  const dx = Number(doc && doc.signDX) || 0;
  const dy = Number(doc && doc.signDY) || 0;
  return (dx || dy) ? ` style="transform:translate(${dx}px,${dy}px);"` : '';
}
function stampInlineStyle(doc, basePx) {
  // 基准尺寸（签署区 96 / 装箱单 84）× 用户选的缩放比例
  const s = Number(doc && doc.stampScale);
  const scale = Number.isFinite(s) && s > 0 ? Math.min(2, Math.max(0.4, s)) : 1;
  const px = Math.round((basePx || 96) * scale);
  const dx = Number(doc && doc.stampDX) || 0;
  const dy = Number(doc && doc.stampDY) || 0;
  const move = (dx || dy) ? `transform:translate(${dx}px,${dy}px);` : '';
  return ` style="width:${px}px;height:${px}px;${move}"`;
}
function partyBox(title, p, L = {}) {
  return `<div class="party-box"><div class="ttl">${esc(title)}</div>${partyLines(p, L).join('') || '&nbsp;'}</div>`;
}

/**
 * 是否需要**单独**画一个收货人框
 *
 * 判据（都要成立）：
 *   1. 用户没有勾「收货人同买方」（sameAsBuyerConsignee === false）；
 *   2. 收货人确实填了公司名；
 *   3. 收货人的内容跟买方**确实不一样**（逐字段比，避免内容相同还画两个框）。
 *
 * 满足才返回收货人框的 HTML，否则返回空串 —— 这就是「不重复显示」的关键。
 */
function separateConsigneeBox(doc, tpl) {
  const L = tpl.label;
  if (!doc || doc.sameAsBuyerConsignee !== false) return '';
  const c = doc.consignee || {};
  if (!String(c.companyName || '').trim()) return '';

  // 逐字段比对：一模一样就没必要画第二个框
  const b = doc.buyer || {};
  const KEYS = ['companyName', 'address', 'city', 'state', 'zipCode', 'country',
    'attn', 'tel', 'fax', 'email', 'taxId'];
  const same = KEYS.every((k) => String(c[k] || '').trim() === String(b[k] || '').trim());
  if (same) return '';

  return partyBox(L.consignee || 'CONSIGNEE', c, L);
}

/** 英文标准单据名（非英文模板时作为副标题，便于国外客户识别） */
const EN_TITLES = {
  quotation: 'QUOTATION',
  pi: 'PROFORMA INVOICE',
  contract: 'SALES CONTRACT',
  ci: 'COMMERCIAL INVOICE',
  pl: 'PACKING LIST',
  bill_of_lading: 'BILL OF LADING',
  certificate_of_origin: 'CERTIFICATE OF ORIGIN',
  customs_declaration: 'CUSTOMS DECLARATION',
  inspection_certificate: 'INSPECTION CERTIFICATE',
  fumigation_certificate: 'FUMIGATION CERTIFICATE',
  beneficiary_certificate: 'BENEFICIARY CERTIFICATE',
  shipper_letter_instruction: 'SHIPPER LETTER OF INSTRUCTION',
  insurance_policy: 'INSURANCE POLICY',
  cost_estimation: 'COST ESTIMATION',
};

/** 单据编号行参数（不同单据显示不同标签） */
function docNoLabel(type, labels) {
  switch (type) {
    case 'quotation': return labels.quotationNo;
    case 'pi': return labels.piNo;
    case 'contract': return labels.contractNo;
    case 'ci': return labels.invoiceNo;
    case 'pl': return labels.plNo;
    default: return labels.docNo;
  }
}

/** 表头：LOGO + 卖方 + 标题 + 关键信息 */
function renderHead(doc, tpl) {
  const labels = tpl.label;
  const title = doc.titleOverride || tpl.docTitle[doc.type] || doc.type;
  const titleClass = doc.docLang === 'zh' ? 'doc-title doc-title-zh' : 'doc-title';

  const metaLines = [];
  metaLines.push([docNoLabel(doc.type, labels), esc(doc.docNo || '')]);
  metaLines.push([labels.date, esc(formatDateDoc(doc.date))]);
  // 合同专有（对照 exradoc 的 Trade Contract：签署地 / 装运日期）
  if (doc.placeOfSigning) metaLines.push([labels.placeOfSigning || 'Place of Signing', esc(doc.placeOfSigning)]);
  if (doc.shipmentDate) metaLines.push([labels.shipmentDate || 'Shipment Date', esc(formatDateDoc(doc.shipmentDate))]);
  // 报价单：整单最小起订量（对照 exradoc 的商业报价单）
  if (doc.minOrderQty) metaLines.push([labels.minOrderQty || 'Min. Order Qty', esc(doc.minOrderQty)]);
  if (doc.validUntil) metaLines.push([labels.validUntil, esc(formatDateDoc(doc.validUntil))]);
  if (doc.incoterms) metaLines.push([labels.incoterms, esc(doc.incoterms)]);
  if (doc.destination) metaLines.push([labels.destination, esc(doc.destination)]);
  if (doc.loadingPort) metaLines.push([labels.loadingPort, esc(doc.loadingPort)]);
  if (doc.leadTime) metaLines.push([labels.leadTime, esc(doc.leadTime)]);
  if (doc.paymentTerms) metaLines.push([labels.paymentTerms, esc(doc.paymentTerms)]);
  if (docMeta(doc.type).mode === 'money' && doc.currency) metaLines.push([labels.currency, esc(doc.currency)]);
  if (doc.customerCode) metaLines.push([labels.customerCode || 'Customer Code', esc(doc.customerCode)]);

  const half = Math.ceil(metaLines.length / 2);
  const colLeft = metaLines.slice(0, half)
    .map(([k, v]) => `<div class="meta-line"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`).join('');
  const colRight = metaLines.slice(half)
    .map(([k, v]) => `<div class="meta-line"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`).join('');
  return `<div class="doc-head">
    ${doc.seller.logo ? `<img class="doc-logo" src="${doc.seller.logo}" alt="LOGO" />` : '<div class="doc-logo placeholder"></div>'}
    <div class="doc-seller">
      <div class="cn">${esc(doc.seller.companyName || '')}</div>
      ${partyLines(doc.seller, labels).slice(1).join('')}
    </div>
    <div class="doc-title-box">
      <div class="${titleClass}">${esc(title)}</div>
      ${doc.docLang !== 'en' && !doc.titleOverride ? `<div class="doc-subtitle">${esc(EN_TITLES[doc.type] || '')}</div>` : ''}

    </div>
  </div>
  <div class="doc-meta">
    <div class="doc-meta-col">${colLeft}</div>
    <div class="doc-meta-col">${colRight}</div>
  </div>
  <div style="height:2px"></div>`;
}

/**
 * 买卖双方 + 银行信息整块（所有单据类型共用这一个渲染器）
 *
 * 为什么要统一：早先每个类型各写一套分支，结果同一份单据换个类型就换一种表现，
 * 还出过「同一张 CI 走不同分支、一个多出重复框」的 bug。
 *
 * ── 关于 CONSIGNEE 框 ──
 * ⚠️ **不要**无条件画 CONSIGNEE 框。
 * 早先 CI / 装箱单写成「TO 用 doc.buyer、CONSIGNEE 用 sameAsBuyerConsignee ? buyer : consignee」，
 * 而 sameAsBuyerConsignee 默认就是 true → 两个框都渲染 doc.buyer，
 * 单据上出现两个一模一样的框（用户反馈「这俩框重复了」）。
 * `separateConsigneeBox()` 只在**收货人确实与买方不同**时才返回内容。
 *
 * ── 布局两种方式（用户可切换，见 `doc.partyLayout`）──
 *   'split'  两栏：左边买方框，右边银行信息框（没有再退回单栏）
 *   'single' 单栏：只画买方框，占满整行，不显示银行信息
 * 默认按单据类型给一个合理值（`DEFAULT_PARTY_LAYOUT`），用户可覆盖。
 */
const DEFAULT_PARTY_LAYOUT = {
  // 用户要求：报价单 / 形式发票 / 商业发票（+ 合同）默认「买方 + 银行」两栏同时显示。
  // 银行信息没填时渲染层会自动退回单栏（不会印一个空框），填了就自动变两栏。
  quotation: 'split',
  pi: 'split',
  contract: 'split',
  ci: 'split',
  pl: 'single',          // 装箱单是给货代/报关看的，不需要银行信息
};

function renderPartiesBlock(doc, tpl) {
  const labels = tpl.label;
  const consigneeBox = separateConsigneeBox(doc, tpl);

  // 收货人独立时两个框并排；否则买方框的标题合并成「买方 / 收货人」
  const buyerTitle = consigneeBox
    ? labels.to
    : (doc.consignee?.companyName && labels.consignee
      ? `${labels.to} / ${labels.consignee}`
      : labels.to);

  const buyerBox = partyBox(buyerTitle, doc.buyer, labels);
  const bankBox = renderBeneficiaryBox(doc, tpl);      // 没填银行信息时返回 ''

  // 用户显式选择优先；没设过就用该类型的默认值
  const layout = doc.partyLayout || DEFAULT_PARTY_LAYOUT[doc.type] || 'single';

  if (layout === 'split' && bankBox) {
    // 两栏：买方（+收货人）在左，银行信息在右
    const boxes = [buyerBox, consigneeBox, bankBox].filter(Boolean);
    const cls = boxes.length >= 3 ? 'parties-3' : 'parties-2split';
    return `<div class="parties ${cls}">${boxes.join('')}</div>`;
  }

  // 单栏：买方框占满整行。装箱单保持原来的自然宽度（信息少，拉满反而空荡）
  const wide = docMeta(doc.type).mode === 'packing' ? 'parties-narrow' : 'parties-1';
  return `<div class="parties ${wide}">${buyerBox}${consigneeBox}</div>`;
}

/**
 * 出口 / 清关参考信息条（PI、CI 用）
 * 对应真实单证上那一排：PO NO. / L/C NO. / AWB NO. / COUNTRY OF EXPORT / TRADE TERMS …
 * 只显示填了内容的格子，避免出现一排空框
 */
function renderExportRefs(doc, tpl) {
  const labels = tpl.label;
  const wi = (doc.items || []).find((it) => it.weightUnit) || {};
  const wUnit = wi.weightUnit || D_UNIT.weight;

  const tradeTerms = [doc.incoterms, doc.tradeTermsPlace || doc.loadingPort || doc.seller?.city]
    .filter(Boolean).join(' ');  // 不再兜底取卖方国家：新建单据是空白的，印出来也不该有"看起来已填好"的值
  const exportCountry = doc.countryOfExport || '';
  const totalPkgs = doc.totals?.totalQty
    ? `${qty(doc.totals.totalQty)} ${D_UNIT.pack} / ${w3(doc.totals.totalGw, wUnit)}`
    : '';

  const cells = [
    [labels.poNo, doc.poNo],
    [labels.lcNo, doc.lcNo],
    [labels.awbNo, doc.awbNo],
    [labels.shippingMethod, doc.shippingMethod],
    [labels.countryOfExport, exportCountry],
    [labels.countryOfOrigin, doc.countryOfOrigin],
    [labels.tradeTerms, tradeTerms],
    [labels.reasonForExport, doc.reasonForExport],
    [labels.totalPackages, totalPkgs],
  ].filter(([, v]) => String(v || '').trim());

  if (!cells.length) return '';
  const mid = Math.ceil(cells.length / 2);
  const col = (arr) => arr
    .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('');
  return `<table class="ref-table"><tbody>
    <tr><td class="ref-col"><table class="ref-inner"><tbody>${col(cells.slice(0, mid))}</tbody></table></td>
        <td class="ref-col"><table class="ref-inner"><tbody>${col(cells.slice(mid))}</tbody></table></td></tr>
  </tbody></table>`;
}

/** 收款银行块（PI / CI 头部右侧，按真实单证放在显著位置） */
function renderBeneficiaryBox(doc, tpl) {
  const labels = tpl.label;
  const b = doc.bank || {};
  // ⚠️ 只有「收款人」不算填了银行信息（收款人默认取卖方名）——
  // 必须有 开户行 / 账号 / SWIFT / IBAN / 银行地址 之一，否则不印这个框
  //（用户要求：银行信息可以不满，但不能印出一个只有名字的空框）
  const hasRealBank = [b.bankName, b.accountNo, b.swift, b.iban, b.bankAddress]
    .some((x) => String(x || '').trim());
  if (!hasRealBank) return '';
  const rows = [
    [labels.beneficiary, doc.beneficiaryAccount || b.beneficiary || doc.seller?.companyName],
    [labels.bankName, b.bankName],
    [labels.bankAddress, b.bankAddress],
    [labels.accountNo, b.accountNo],
    [labels.swift, b.swift],
    [labels.iban, b.iban],
    [labels.payingBank, doc.payingBank],   // 开证行也归到这里，和银行信息放一起
  ].filter(([, v]) => String(v || '').trim());
  if (!rows.length) return '';
  return `<div class="party-box benef-box">
    <div class="ttl">${esc(labels.bankInfo)}</div>
    ${rows.map(([k, v]) => `<div class="ln"><span class="k">${esc(k)}</span><span class="v">${escLines(v)}</span></div>`).join('')}
  </div>`;
}

/** 公司名按长度分档：长名字给更小的字号，保证一行放得下 */

/**
 * 把产品规格压成「少而整齐」的几行
 * 真实报价单会为规格开很多列，A4 竖版放不下，所以按语义分组：
 * Size/Color/Material 一行，Style/MOQ 一行，装箱一行，样品与大货价一行
 */
function specLines(it, L, labels, skip = {}) {
  const groups = [];
  const parts1 = [];
  // 规格如果已经单独成列（明细列显示里勾了「规格」），就不要再在品名下面重复一遍
  if (it.size && !skip.size) parts1.push(`${L.size}: ${it.size}`);
  if (it.color) parts1.push(`${L.color}: ${it.color}`);
  if (it.material) parts1.push(`${L.material}: ${it.material}`);
  if (parts1.length) groups.push(parts1.join(' · '));

  const parts2 = [];
  if (it.styleName) parts2.push(`${L.styleName}: ${it.styleName}`);
  if (num(it.moq)) parts2.push(`${L.moq}: ${qty(it.moq)}`);
  if (it.leadTime) parts2.push(`${labels.leadTime}: ${it.leadTime}`);
  if (parts2.length) groups.push(parts2.join(' · '));

  const parts3 = [];
  if (num(it.unitsPerCtn)) parts3.push(`${L.unitsPerCtn}: ${qty(it.unitsPerCtn)}`);
  if (num(it.ctnL) || num(it.ctnW) || num(it.ctnH)) {
    parts3.push(`${L.ctnSize}: ${num(it.ctnL)}×${num(it.ctnW)}×${num(it.ctnH)} cm`);
  }
  if (num(it.netWeight)) parts3.push(`${L.netWeight}: ${num(it.netWeight)}`);
  if (parts3.length) groups.push(parts3.join(' · '));

  const sample = [];
  if (num(it.sampleQty)) sample.push(`${L.sampleQty}: ${qty(it.sampleQty)}`);
  if (num(it.sampleFee)) sample.push(`${L.sampleFee}: ${money(it.sampleFee)}`);
  if (num(it.bulkPrice)) sample.push(`${L.bulkPrice}: ${money(it.bulkPrice)}`);
  if (num(it.toolingCost)) sample.push(`${L.toolingCost}: ${money(it.toolingCost)}`);

  return { groups, sample };
}

/** 某个格子是否被「按行控制」隐藏了（columnsHiddenByRows 见 schema.js） */
function cellHidden(it, key) {
  return !!(it && it.hide && it.hide[key]);
}

/** 表格列数（含操作列与否按单据类型） */
function qtyPcsCell(it) {
  return `<td class="num">${qty(it.qty)}</td>`;
}

/* ============================ 装箱单专用版式 ============================
 * 对照真实装箱单模板：
 *   标题居中 → L/C NO. / INV NO. / CONTRACT NO. / INV DATE 四栏 →
 *   客户 TO 块 → 船由 ROUTE 行（FROM x TO y BY z）→ 明细表（Marks 打头，
 *   重量体积表头下带单位行 KGS / M3）→ TOTAL → 底部汇总（含原产国）→ 盖章签字
 * ====================================================================== */

/** 单据头部：标题居中 + 两栏键值（装箱单/发票都用它） */
/**
 * 装箱单 / 单据抬头
 * 对照真实 PL 模板：
 *   公司名居中 → EMAIL / TEL·WeChat·WhatsApp 联系行 → 居中标题
 *   → 明细信息区（左：To / Attn / Add / Tel，右：Date / INV No. / L/C No. / Contract No. / PI No. / PO No. / Price Term）
 * 每个值前面都必须带标签，不能只甩一个值（用户明确要求）。
 */
function renderPlHead(doc, tpl) {
  const labels = tpl.label;
  const s = doc.seller || {};
  const packing = docMeta(doc.type).mode === 'packing';
  const title = doc.titleOverride || tpl.docTitle[doc.type] || doc.type;

  // --- 卖方联系行：每项都带标签 ---
  const contactBits = [];
  if (s.email) contactBits.push(`<b>${esc(labels.email || 'EMAIL')}:</b> ${esc(s.email)}`);
  if (s.tel) contactBits.push(`<b>${esc(labels.tel || 'TEL')}:</b> ${esc(s.tel)}`);
  if (s.fax) contactBits.push(`<b>${esc(labels.fax || 'FAX')}:</b> ${esc(s.fax)}`);
  if (s.website) contactBits.push(`<b>WEB:</b> ${esc(s.website)}`);

  return `<div class="pl-head">
    ${s.logo ? `<img class="doc-logo" src="${s.logo}" alt="LOGO" />` : '<div class="doc-logo placeholder"></div>'}
    <div class="pl-seller">
      <div class="cn">${esc(s.companyName || '')}</div>
      ${contactBits.length ? `<div class="ln">${contactBits.join(' &nbsp;|&nbsp; ')}</div>` : ''}
      ${s.address ? `<div class="ln"><b>${esc(labels.address || 'Address')}:</b> ${esc([
        s.address, [s.city, s.state, s.zip].filter(Boolean).join(' '), s.country,
      ].filter(Boolean).join(', '))}</div>` : ''}
    </div>
  </div>
  <div class="pl-title">${esc(title)}</div>
  ${doc.docLang !== 'en' && !doc.titleOverride ? `<div class="pl-subtitle">${esc(EN_TITLES[doc.type] || '')}</div>` : ''}`;
}

/**
 * 「标签 + 值」行里，值算不算空（空串 / 全空白 / null 都算空）
 */
function rowBlank(v) {
  return !String(v == null ? '' : v).trim();
}

/**
 * 按用户设置过滤掉「值为空」的行（默认过滤）
 *
 * 用户的诉求：「PO 没填的时候，就不要显示 PO 这一行」。
 * 空值还留着标签，会印出一行只有标题的空行 —— 既难看又像漏填。
 *
 * `doc.showEmptyRows === true` 时**保留**空行 —— 给「先打出来手写补填」的场景用。
 * 老版本就是这个行为，所以留个开关，不是硬改掉。
 */
function keepRows(doc, rows) {
  if (doc && doc.showEmptyRows === true) return rows;
  return rows.filter((r) => r && !rowBlank(r[1]));
}

/**
 * 一张「标签 + 值」明细信息表（左右两栏）
 *
 * 空值行默认不画。某一侧全空时，另一侧按自己的行数正常展开
 * （不会出现「左边 4 行、右边 7 行，右侧多出三行空标签」）。
 */
function plInfoTable(doc, left, right) {
  const L = keepRows(doc, left);
  const R = keepRows(doc, right);
  if (!L.length && !R.length) return '';
  const cell = ([k, v]) =>
    `<td class="pl-lbl">${esc(k)}</td><td class="pl-val">${v ? esc(v) : '&nbsp;'}</td>`;
  const blank = '<td class="pl-lbl"></td><td class="pl-val"></td>';
  const rows = Math.max(L.length, R.length);
  const body = [];
  for (let i = 0; i < rows; i++) {
    body.push(`<tr>${L[i] ? cell(L[i]) : blank}${R[i] ? cell(R[i]) : blank}</tr>`);
  }
  return `<table class="pl-info"><tbody>${body.join('')}</tbody></table>`;
}

/**
 * 客户 / 明细信息区（对照模板的 To / Attn / Add / Tel + 右侧 Date / PI No. / PO No. …）
 * 每一项都必须是「标签: 值」两格，值留空也要显示标签，方便手写补填。
 */
function renderPlCustomer(doc, tpl) {
  const labels = tpl.label;
  const b = doc.buyer || {};
  const packing = docMeta(doc.type).mode === 'packing';

  // 地址拼成一行完整地址
  const addr = [
    b.address,
    [b.city, b.state, b.zip].filter(Boolean).join(' '),
    b.country,
  ].filter(Boolean).join(', ');
  const tel = [b.tel, b.fax ? `${labels.fax || 'FAX'}: ${b.fax}` : '', b.email].filter(Boolean).join(' / ');

  const left = [
    [labels.to || 'To', b.companyName],
    [labels.attn || 'Attn', b.contact],
    [labels.addr || 'Add', addr],
    [labels.tel || 'Tel', tel],
  ];

  const right = packing
    ? [
      [labels.date || 'Date', formatDateDoc(doc.date)],
      // 装箱单也要有自己的单号（以前漏了，用户填了 PL-001 单据上却找不到）
      [labels.docNo || 'PL No.', doc.docNo],
      [labels.invoiceNoShort || 'INV No.', doc.invoiceNo],
      [labels.piNoShort || 'PI No.', doc.piNo],
      [labels.poNoShort || 'PO No.', doc.poNo],
      [labels.lcNo || 'L/C No.', doc.lcNo],
      [labels.contractNo || 'Contract No.', doc.contractNo],
      [labels.priceTerm || 'Price Term', doc.incoterms
        ? `${doc.incoterms}${doc.tradeTermsPlace ? ` ${doc.tradeTermsPlace}` : ''}` : ''],
    ]
    : [
      [labels.date || 'Date', formatDateDoc(doc.date)],
      [docNoLabel(doc.type, labels), doc.docNo],
      [labels.paymentTerms || 'Payment Terms', doc.paymentTerms],
      [labels.incoterms || 'Incoterms', doc.incoterms],
    ];

  // 路由行（可选）
  const route = (doc.routeFrom || doc.routeTo || doc.routeBy || doc.loadingPort || doc.destination)
    ? `FROM ${doc.routeFrom || doc.loadingPort || ''} TO ${doc.routeTo || doc.destination || ''}${
      doc.routeBy ? ` BY ${doc.routeBy}` : (doc.shippingMethod ? ` BY ${String(doc.shippingMethod).toUpperCase()}` : '')}`.trim()
    : '';

  return plInfoTable(doc, left, right)
    + (route
      ? `<table class="pl-box"><tbody><tr>
          <td class="pl-lbl">${esc(labels.route || 'ROUTE')}</td>
          <td class="pl-val">${esc(route)}</td>
        </tr></tbody></table>`
      : '');
}

/**
 * 装箱单明细表
 * 表头两行：第一行是列名（毛重/净重/体积会跨两行），第二行是单位行（PCS / KGS / M3）
 */
function renderPlItems(doc, tpl) {
  const tbl = tableLabels(doc.docLang);
  const labels = tpl.label;
  const drop = columnsHiddenByRows(doc);          // 所有行都不需要的列 → 整列去掉
  // containerId 是表单里的"装柜"下拉，打印时用按柜分组表达，不印这一列（否则会印出内部 id）
  const cols = itemColumns(doc.type, doc).filter((c) => c.key !== 'containerId' && !drop.has(c.key));
  const wi = doc.items.find((it) => it.weightUnit) || {};
  const mi = doc.items.find((it) => it.measUnit) || {};
  const wUnit = (wi.weightUnit || D_UNIT.weight).toUpperCase();
  const mUnit = (mi.measUnit || D_UNIT.meas).toUpperCase();
  const pUnit = (doc.items[0]?.packUnit || D_UNIT.pack).toUpperCase();

  // 表头：件数与数量共用一组双行表头（件数 PKGS/CTNS、数量 QTY/PCS）
  const head1 = [];
  const head2 = [];
  for (const c of cols) {
    switch (c.key) {
      case 'ctnNo':
        head1.push(`<th rowspan="2" class="col-ctn">${esc(tbl.ctnNo)}</th>`); break;
      case 'no':
        head1.push(`<th rowspan="2" class="col-no">${esc(tbl.no)}</th>`); break;
      case 'description':
        head1.push(`<th rowspan="2" class="col-desc">${esc(tbl.description)}</th>`); break;
      case 'hsCode':
        head1.push(`<th rowspan="2" class="col-hs">${esc(tbl.hsCode || 'HS Code')}</th>`); break;
      case 'qty':
        head1.push(`<th class="col-qty">${esc(tbl.pkgs)}</th>`);
        head2.push(`<th class="col-qty unit-row">${esc(pUnit)}</th>`); break;
      case 'qtyPcs':
        head1.push(`<th class="col-qty">${esc(tbl.qty)}</th>`);
        head2.push(`<th class="col-qty unit-row">${esc(tbl.pcs || 'PCS')}</th>`); break;
      case 'gw':
        head1.push(`<th class="col-num">${esc(tbl.gw)}</th>`);
        head2.push(`<th class="col-num unit-row">${esc(wUnit)}</th>`); break;
      case 'nw':
        head1.push(`<th class="col-num">${esc(tbl.nw)}</th>`);
        head2.push(`<th class="col-num unit-row">${esc(wUnit)}</th>`); break;
      case 'meas':
        head1.push(`<th class="col-num">${esc(tbl.meas)}</th>`);
        head2.push(`<th class="col-num unit-row">${esc(mUnit)}</th>`); break;
      default:
        head1.push(`<th rowspan="2" class="${c.cls || ''}">${esc(tbl[c.label] || c.label)}</th>`);
    }
  }

  /** 单行 */
  const rowHtml = (it, i) => {
    const tds = cols.map((c) => {
      // 按行隐藏：这一行的这个格子留空，别行不受影响
      if (cellHidden(it, c.key)) return `<td class="num"></td>`;
      switch (c.key) {
        case 'ctnNo':
          // 只用本行自己填的箱号/唛头，不再从 doc.marks 兜底
          // （兜底会导致「删了箱号单据上还显示」，用户报过）
          return `<td class="ctr">${escLines(it.ctnNo || '')}</td>`;
        case 'no':
          return `<td class="ctr">${i + 1}</td>`;
        case 'description':
          return `<td class="desc">${escLines(it.description || '')}</td>`;
        case 'hsCode':
          return `<td class="ctr">${esc(it.hsCode || '')}</td>`;
        case 'qty':
          return `<td class="num">${qty(it.ctns || it.qty)}</td>`;
        case 'qtyPcs':
          return `<td class="num">${qty(it.qty)}</td>`;
        case 'gw':
          return `<td class="num">${num(it.gw)}</td>`;
        case 'nw':
          return `<td class="num">${num(it.nw)}</td>`;
        case 'meas':
          return `<td class="num">${num(it.meas)}</td>`;
        default:
          return `<td>${esc(it[c.key] || '')}</td>`;
      }
    }).join('');
    return `<tr>${tds}</tr>`;
  };

  /* ---------- 多柜：按柜分组 + 每柜小计 ---------- */
  const ctnList = Array.isArray(doc.containers) ? doc.containers : [];
  // ⚠️ 口径要和 calc.js 一致：装箱单/报关单的毛净重体积是「箱数 × 每箱值」，
  // 直接相加会和底部的整票合计对不上（用户一眼就能看出来）
  const sumOf = (list) => list.reduce((a, { it }) => {
    const mult = num(it.ctns) || 1;
    a.ctns += num(it.ctns || it.qty);
    a.pcs += num(it.qty);
    a.gw += Math.round(mult * num(it.gw) * 1000) / 1000;
    a.nw += Math.round(mult * num(it.nw) * 1000) / 1000;
    a.meas += Math.round(mult * num(it.meas) * 10000) / 10000;
    return a;
  }, { ctns: 0, pcs: 0, gw: 0, nw: 0, meas: 0 });

  /** 每柜小计行（数字落在对应列） */
  const subTotalRow = (label, sums) => {
    let first = true;
    const tds = cols.map((c) => {
      if (first) { first = false; return `<td class="ctr pl-ctn-sum-k" colspan="2">${esc(label)}</td>`; }
      if (c.key === 'no' || c.key === 'ctnNo') return '';
      switch (c.key) {
        case 'qty': return `<td class="num">${qty(sums.ctns)}</td>`;
        case 'qtyPcs': return `<td class="num">${qty(sums.pcs)}</td>`;
        case 'gw': return `<td class="num">${num(sums.gw)}</td>`;
        case 'nw': return `<td class="num">${num(sums.nw)}</td>`;
        case 'meas': return `<td class="num">${num(sums.meas)}</td>`;
        default: return '<td></td>';
      }
    }).join('');
    return `<tr class="pl-ctn-sum">${tds}</tr>`;
  };

  const groupHeadRow = (title) =>
    `<tr class="pl-ctn-h"><td colspan="${cols.length}">${esc(title)}</td></tr>`;

  let rows;
  if (ctnList.length) {
    const all = doc.items.map((it, i) => ({ it, i }));
    const ids = new Set(ctnList.map((c) => c.id));
    const assignedRows = all.filter(({ it }) => it.containerId && ids.has(it.containerId));
    const unassigned = all.filter(({ it }) => !it.containerId || !ids.has(it.containerId));
    const parts = [];
    ctnList.forEach((c, idx) => {
      const list = all.filter(({ it }) => it.containerId === c.id);
      if (!list.length) return;                     // 空柜不占版面
      const title = [
        `${tbl.container || 'Container'} ${idx + 1}：${c.no || '(未填柜号)'}`,
        c.seal ? `${tbl.seal || 'Seal'} ${c.seal}` : '',
        c.type || '',
      ].filter(Boolean).join(' · ');
      parts.push(groupHeadRow(title));
      parts.push(list.map(({ it, i }) => rowHtml(it, i)).join(''));
      parts.push(subTotalRow(`${tbl.subtotal || 'Subtotal'} (${c.no || '#' + (idx + 1)})`, sumOf(list)));
    });
    if (unassigned.length) {
      if (assignedRows.length) {
        parts.push(groupHeadRow(tbl.unassigned || '未分配柜'));
        parts.push(subTotalRow(`${tbl.subtotal || 'Subtotal'} (${tbl.unassigned || 'Unassigned'})`, sumOf(unassigned)));
      }
      parts.push(unassigned.map(({ it, i }) => rowHtml(it, i)).join(''));
    }
    rows = parts.join('');
  } else {
    rows = doc.items.map((it, i) => rowHtml(it, i)).join('');
  }

  // 合计行：第一列（Marks）与第二列（No.）合并成 TOTAL
  const tt = doc.totals || {};
  const totalPcs = (doc.items || []).reduce((s, it) => s + num(it.qty), 0);
  let skipped = false;
  const foot = cols.map((c) => {
    if (!skipped) { skipped = true; return `<td class="ctr" colspan="2">${esc(tbl.total)}</td>`; }
    if (c.key === 'no' || c.key === 'ctnNo') return '';
    switch (c.key) {
      case 'qty': return `<td class="num">${qty(tt.totalQty)}</td>`;
      case 'qtyPcs': return `<td class="num">${qty(totalPcs)}</td>`;
      case 'gw': return `<td class="num">${num(tt.totalGw)}</td>`;
      case 'nw': return `<td class="num">${num(tt.totalNw)}</td>`;
      case 'meas': return `<td class="num">${num(tt.totalMeas)}</td>`;
      default: return '<td></td>';
    }
  }).join('');

  // 底部汇总（Total Cartons / Quantity / Net / Gross / Measurement）
  // 原产国移到下方的说明条款里（对照模板第 1 条），不在这里重复
  const packUnit = (doc.items[0]?.packUnit || D_UNIT.pack).toUpperCase();
  const sumRows = [
    [tpl.sum?.totalCtn || 'Total Cartons', tt.totalQty ? `${qty(tt.totalQty)} ${packUnit}` : ''],
    [tpl.sum?.totalQty || 'Total Quantity', totalPcs ? `${qty(totalPcs)} ${(tbl.pcs || 'PCS').toUpperCase()}` : ''],
    [tpl.sum?.totalNw || 'Total Net Weight', tt.totalNw ? `${num(tt.totalNw)} ${wUnit}` : ''],
    [tpl.sum?.totalGw || 'Total Gross Weight', tt.totalGw ? `${num(tt.totalGw)} ${wUnit}` : ''],
    [tpl.sum?.totalMeas || 'Total Measurement', tt.totalMeas ? `${num(tt.totalMeas)} ${mUnit}` : ''],
  ].filter(([, v]) => String(v || '').trim());

  // 显式列宽：以前装箱单的表头一个宽度都不给，全靠浏览器平分 —— 列一多就会被压扁
  //（规格/描述竖着一个字一行的坑就是这么来的）。这里和别的版式统一用 colWidth。
  const plColgroup = `<colgroup>${cols.map((c) => `<col style="${colWidth(c.key, 'pl', cols)}">`).join('')}</colgroup>`;

  return `<table class="doc-table pl-table">
    ${plColgroup}
    <thead>
      <tr>${head1.join('')}</tr>
      ${head2.length ? `<tr class="unit-tr">${head2.join('')}</tr>` : ''}
    </thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>${foot}</tr></tfoot>
  </table>
  ${doc.hideSumLine ? '' : `<div class="pl-sums">
    <div class="pl-sum total"><span class="k">${esc(tbl.total || 'Total')}:</span> <span class="v">${
      sumRows.map(([k, v]) => `${esc(k)} ${esc(v)}`).join(' &nbsp;·&nbsp; ')}</span></div>
  </div>`}
  ${doc.totalPackedText ? `<div class="pl-packed">${esc(labels.totalPackedIn || 'TOTAL PACKED IN')}: ${esc(doc.totalPackedText)}</div>` : ''}`;
}

/**
 * 装箱单说明条款（对照模板的 1~6 条）
 * 用单据里已有的字段自动拼，用户填过 doc.terms 时以用户内容为准。
 */
function renderPlTerms(doc, tpl) {
  const L = tpl.label;
  const P = tpl.plTerms || {};
  const b = doc.bank || {};
  const items = doc.items || [];

  const pay = doc.paymentTerms || '';
  const delivery = [doc.leadTime, doc.productionTime].filter(Boolean).join('; ');
  const packUnit = (items[0]?.packUnit || D_UNIT.pack).toUpperCase();
  const packing = doc.tradeTermsPlace
    ? `${doc.incoterms || ''} ${doc.tradeTermsPlace}`.trim()
    : [doc.incoterms, doc.deliveryPlace].filter(Boolean).join(' ');
  const marks = doc.marks || 'N/M';

  // 收款银行信息（模板第 6 条是整块缩进展示）
  const bankLines = [];
  if (b.beneficiary) bankLines.push(`${L.beneficiary || 'BENEFICIARY'}: ${b.beneficiary}`);
  if (b.bankAddress) bankLines.push(`${L.bankAddress || 'ADDRESS'}: ${b.bankAddress}`);
  if (b.bankName) bankLines.push(`${L.bankName || 'BENEFICIARY BANK'}: ${b.bankName}`);
  if (b.accountNo) bankLines.push(`${L.accountNo || 'ACCOUNT FOR USD'}: ${b.accountNo}`);
  if (b.swift) bankLines.push(`${L.swift || 'SWIFT'}: ${b.swift}`);
  if (b.iban) bankLines.push(`${L.iban || 'IBAN'}: ${b.iban}`);

  const rows = [
    [P.origin || 'COUNTRY OF ORIGIN', (doc.countryOfOrigin || '').toUpperCase()],
    [P.payment || 'TERMS OF PAYMENT', pay],
    [P.delivery || 'DELIVERY TIME', delivery],
    [P.packing || 'PACKAGING', packing ? `${packing} (${P.packingUnit || `${packUnit} pack`})` : `1 ${packUnit}`],
    [P.marks || 'SHIPPING MARK', marks],
    [P.beneficiary || 'SELLER (BENEFICIARY)’S SPECIFIC INFORMATION', ''],
  ].filter(([k, v], i) => i === 5 || String(v || '').trim());

  // ⚠️ 用户自己写的条款是**追加**在标准栏目后面，绝不能替换掉它们。
  //    之前写成「有 doc.terms 就整块返回用户条款」，结果在装箱单里一输入条款，
  //    原产国 / 付款方式 / 交货期 / 包装方式 / 唛头 / 卖方信息 这 6 条标准栏目就全没了
  //    （用户反馈：「我在装箱单页面一输入条款备注，结果这的数据就没了」）。
  const extraLines = String(doc.terms || '').split('\n').map((x) => x.trim()).filter(Boolean);

  return `<div class="pl-terms">
    ${rows.map(([k, v], i) => `<div class="pl-term">
      <span class="no">${i + 1}.</span>
      <span class="body"><b>${esc(k)}:</b>${v ? ` ${esc(v)}` : ''}${
    i === 5 && bankLines.length
      ? `<div class="pl-bank">${bankLines.map((x) => esc(x)).join('<br>')}</div>`
      : ''}</span>
    </div>`).join('')}
    ${extraLines.map((line, i) => {
    const m = /^\s*(\d+)[.、)]\s*(.*)$/.exec(line);
    const body = m ? m[2] : line;
    return `<div class="pl-term pl-term-extra"><span class="no">${rows.length + i + 1}.</span><span class="body">${esc(body)}</span></div>`;
  }).join('')}
  </div>`;
}

/** 装箱单页脚：买卖双方签字（对照模板底部） */
function renderPlSign(doc, tpl) {
  const L = tpl.label;
  const stamp = doc.seller?.stamp ? `<img class="sign-stamp" src="${doc.seller.stamp}" alt=""${stampInlineStyle(doc, 84)} />` : '';
  const signImg = doc.seller?.signature ? `<img class="sign-inline" src="${doc.seller.signature}" alt=""${signInlineStyle(doc)} />` : '';
  return `<div class="pl-sign2">
    <div class="pl-sign-col">
      <div class="ttl">${esc(L.theSeller || 'THE SELLER')}</div>
      <div class="box">${signImg}${stamp}</div>
    </div>
    <div class="pl-sign-col">
      <div class="ttl">${esc(L.theBuyer || 'THE BUYER')}</div>
      <div class="box"></div>
    </div>
  </div>`;
}

/** 产品明细表 */
function renderItems(doc, tpl) {
  if (docMeta(doc.type).mode === 'packing') return renderPlItems(doc, tpl);
  const tbl = tableLabels(doc.docLang);
  const labels = tpl.label;
  // 传 doc 才能应用「明细列显示」开关；再滤掉「所有行都不需要」的列（整列消失）
  const drop = columnsHiddenByRows(doc);
  const cols = itemColumns(doc.type, doc).filter((c) => !drop.has(c.key));
  const meta = docMeta(doc.type);

  // 单价 / 金额列在表头带上币种（如「单价 (USD)」）：
  // 客户一眼知道这列是什么货币，不用回头找单据头部的币种
  const cur = doc.currency || '';
  const withCur = (key, text) =>
    (cur && (key === 'unitPrice' || key === 'amount')) ? `${text} (${cur})` : text;

  const th = cols.map((c) =>
    `<th style="${colWidth(c.key, doc.type, cols)}">${esc(withCur(c.key, tbl[c.label] || c.label))}</th>`).join('');
  const shownCols = new Set(cols.map((c) => c.key));
  const rows = doc.items.map((it, i) => {
    const tds = cols.map((c) => {
      // 按行隐藏：这一行的这个格子留空（编号与品名不允许隐藏，否则整行没法看）
      if (c.key !== 'no' && c.key !== 'description' && cellHidden(it, c.key)) {
        return `<td class="num"></td>`;
      }
      switch (c.key) {
        case 'no':
          return `<td class="ctr">${i + 1}</td>`;
        case 'photo':
          return `<td class="ctr">${it.photo ? `<img class="line-photo" src="${it.photo}" alt="" />` : ''}</td>`;
        case 'description': {
          const parts = [escLines(it.description || '')];
          // 产品规格：真实报价单会为规格开很多列，A4 竖版放不下 → 按语义压成 3 组 + 1 行样品价
          const { groups, sample } = specLines(it, tbl, labels, { size: shownCols.has('size') });
          if (groups.length) {
            parts.push(`<div class="spec-lines">${groups.map((s) => esc(s)).join('<br>')}</div>`);
          }
          if (sample.length) {
            parts.push(`<div class="spec-lines sample">${sample.map((s) => esc(s)).join(' · ')}</div>`);
          }
          if (it.specNote) parts.push(`<div class="spec-note">${escLines(it.specNote)}</div>`);
          // 备注若已单独成列，就不在品名下面重复
          if (it.remark && !shownCols.has('remark')) parts.push(`<div class="spec-note">${escLines(it.remark)}</div>`);
          return `<td class="desc">${parts.join('')}</td>`;
        }
        case 'unit':
          return `<td class="ctr">${esc(it.unit || '')}</td>`;
        case 'qty':
          return `<td class="num">${meta.mode === 'packing' ? qty(it.ctns || it.qty) : qty(it.qty)}</td>`;
        case 'unitPrice':
          return `<td class="num">${money(it.unitPrice)}</td>`;
        case 'discount':
          return `<td class="num">${num(it.discount) ? money(it.discount) : ''}</td>`;
        case 'amount':
          return `<td class="num">${money(it.amount)}</td>`;
        case 'origin':
          // 明细没填就退回单据级的原产国（报关单常整单同一个原产国）
          return `<td class="ctr">${esc(it.origin || doc.countryOfOrigin || '')}</td>`;
        case 'dest':
          return `<td class="ctr">${esc(it.dest || doc.destinationCountry || doc.destination || '')}</td>`;
        case 'nw':
        case 'gw':
          return `<td class="num">${w3(it[c.key], it.weightUnit)}</td>`;
        case 'meas':
          return `<td class="num">${v4(it[c.key], it.measUnit)}</td>`;
        default:
          return `<td>${esc(it[c.key] || '')}</td>`;
      }
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');

  // 合计行：按列位置精确对齐。
  // ⚠️ 不能假设「金额列在最后一列」—— 报关单的金额后面还有原产国/目的国/备注列，
  //    所以这里按 key 找到锚点列（数量、金额），再逐段补空白。
  const wi = doc.items.find((it) => it.weightUnit) || {};
  const mi = doc.items.find((it) => it.measUnit) || {};
  const wUnit = wi.weightUnit || D_UNIT.weight;
  const mUnit = mi.measUnit || D_UNIT.meas;
  let footCols = '';
  if (meta.mode === 'packing') {
    const span = Math.max(1, cols.length - 5);
    footCols = `<td colspan="${span}" class="ctr">${esc(tbl.total)}</td>`
      + '<td></td>'
      + `<td class="num">${qty(doc.totals.totalQty)}</td>`
      + `<td class="num">${w3(doc.totals.totalNw, wUnit)}</td>`
      + `<td class="num">${w3(doc.totals.totalGw, wUnit)}</td>`
      + `<td class="num">${v4(doc.totals.totalMeas, mUnit)}</td>`;
  } else {
    // 收集要汇总的锚点列：数量（总是有）与金额（有金额列时）
    const anchors = [];
    const addAnchor = (key, val) => {
      const i = cols.findIndex((c) => c.key === key);
      if (i >= 0) anchors.push([i, val]);
    };
    addAnchor('qty', qty(doc.totals.totalQty));
    if (meta.mode !== 'plain' || meta.withMoney) addAnchor('amount', money(doc.totals.totalAmount));
    // 体积合计（Meas. 列）：以前只在装箱单里合计，商业发票/形式发票/合同看不到合计
    // 口径：单件体积 × 件数（用户反馈：合计应是总量，不是每行相加）
    const measSum = Number(doc.totals.totalMeasQty) || 0;
    addAnchor('meas', v4(measSum, mUnit));
    anchors.sort((a, b) => a[0] - b[0]);
    if (!anchors.length) {
      footCols = `<td colspan="${cols.length}" class="ctr">${esc(tbl.total)}</td>`;
    } else {
      const parts = [];
      const first = Math.min(...anchors.map(([i]) => i));
      parts.push(`<td colspan="${Math.max(1, first)}" class="ctr">${esc(tbl.total)}</td>`);
      let pos = Math.max(1, first);
      for (const [i, val] of anchors) {
        if (i > pos) parts.push(`<td colspan="${i - pos}"></td>`);
        parts.push(`<td class="num">${val}</td>`);
        pos = i + 1;
      }
      if (cols.length - pos > 0) parts.push(`<td colspan="${cols.length - pos}"></td>`);
      footCols = parts.join('');
    }
  }

  return `<table class="doc-table">
    <thead><tr>${th}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>${footCols}</tr></tfoot>
  </table>`;
}

/**
 * 各列宽度（px，用于 table-layout:fixed 的等比例分配）
 *
 * ⚠️ 表格是 `table-layout: fixed; width: 100%`，所以这里的宽度是**相对比例**：
 * 总和超出页面宽度时会等比压缩。因此：
 *   1. 描述列必须给足宽度 —— 早先它给的是空字符串，被压缩到几乎 0 宽，
 *      结果「Description」表头和一个字母一行，整张表崩掉；
 *   2. 能省的列就省（照片列窄、单位列窄），把宽度留给描述。
 */
function colWidth(key, type, cols = []) {
  const packing = type === 'pl';
  const has = (k) => cols.some((c) => c.key === k);
  // 新增列（规格 / HS 编码 / 备注）之后描述列要主动让宽，
  // 否则整表会超出 A4 纸宽（纸张正文宽约 700px @96dpi）
  let desc = packing ? 230 : (type === 'ci' ? 250 : 280);
  if (has('size')) desc -= 40;
  if (has('hsCode') && type !== 'ci') desc -= 34;
  if (has('remark')) desc -= 70;
  if (has('discount')) desc -= 24;
  if (has('origin')) desc -= 20;
  if (has('dest')) desc -= 20;
  desc = Math.max(120, desc);
  const map = {
    no: packing ? 'width:30px' : 'width:26px',
    photo: 'width:46px',
    // 描述列必须显式给宽度，否则 fixed 布局下会被压没
    description: `width:${desc}px`,
    // ⚠️ 列的 key 是 size（表头文案才是 spec）。以前这里写成 spec，
    //    结果规格列拿不到宽度 → fixed 布局下被压到十几像素，规格竖着一个字一行。
    size: 'width:78px',
    hsCode: 'width:88px',
    spec: 'width:78px',      // 兼容旧写法
    model: packing ? 'width:0px' : 'width:62px',
    hsCode: 'width:66px',
    discount: 'width:60px',
    origin: 'width:56px',
    dest: 'width:56px',
    remark: 'width:88px',
    unit: 'width:38px',
    qty: 'width:48px',
    unitPrice: 'width:74px',
    amount: 'width:78px',
    ctns: 'width:50px',
    pkgs: 'width:50px',
    ctnNo: packing ? 'width:70px' : 'width:56px',
    nw: 'width:50px',
    gw: 'width:50px',
    meas: 'width:52px',
  };
  // 兜底：没登记的列也要给个能看的宽度。
  // 返回 '' 会让该列在 table-layout:fixed 下只能分到"剩余空间"，
  // 一旦别的列把宽度占满，它就会被压成一条竖线（规格列踩过这个坑）。
  return map[key] || 'width:56px';
}

/** 底部汇总 + 金额大写 */
function renderSummary(doc, tpl) {
  const labels = tpl.label;
  const sum = tpl.sum;
  const meta = docMeta(doc.type);

  if (meta.mode === 'packing') {
    const wi = doc.items.find((it) => it.weightUnit) || {};
    const mi = doc.items.find((it) => it.measUnit) || {};
    return `<div class="doc-summary"><table class="summary-table">
      <tr><td class="k">${esc(sum.totalCtn)}</td><td class="v">${qty(doc.totals.totalQty)} ${esc(D_UNIT.pack)}</td></tr>
      <tr><td class="k">${esc(sum.totalNw)}</td><td class="v">${w3(doc.totals.totalNw, wi.weightUnit)}</td></tr>
      <tr><td class="k">${esc(sum.totalGw)}</td><td class="v">${w3(doc.totals.totalGw, wi.weightUnit)}</td></tr>
      <tr class="grand"><td class="k">${esc(sum.totalMeas)}</td><td class="v">${v4(doc.totals.totalMeas, mi.measUnit)}</td></tr>
    </table></div>`;
  }
  void labels;

  // 金额类单据：合计下面补一行「总件数 / 总毛重」（海关与货代要核对）
  const wi = doc.items.find((it) => it.weightUnit) || {};
  const wUnit = wi.weightUnit || D_UNIT.weight;
  // 勾选「隐藏底部汇总行」时不显示 Total Cartons / Total G.W. 这一行
  const pkgLine = (!doc.hideSumLine && doc.totals?.totalQty)
    ? `<div class="pkg-line">${esc(sum.totalCtn)}: <strong>${qty(doc.totals.totalQty)} ${esc(D_UNIT.pack)}</strong>
       &nbsp;·&nbsp; ${esc(sum.totalGw)}: <strong>${w3(doc.totals.totalGw, wUnit)}</strong></div>`
    : '';

  // 费用明细：只有填了折扣 / 税费 / 运费等才多显示这几行，否则版面保持简洁
  const tt = doc.totals || {};
  const rows = [`<tr><td class="k">${esc(sum.totalQty)}</td><td class="v">${qty(tt.totalQty)}</td></tr>`];
  const extra = hasExtraCharges(doc);
  if (extra) {
    rows.push(`<tr><td class="k">${esc(sum.subtotal || 'Subtotal')}</td><td class="v">${esc(amountText(tt.subtotal, doc.currency))}</td></tr>`);
    if (num(doc.discount)) {
      rows.push(`<tr><td class="k">${esc(sum.discount)}</td><td class="v">- ${esc(amountText(tt.discount, doc.currency))}</td></tr>`);
    }
    if (num(doc.taxRate)) {
      rows.push(`<tr><td class="k">${esc(sum.tax)} ${num(doc.taxRate)}%</td><td class="v">${esc(amountText(tt.taxAmount, doc.currency))}</td></tr>`);
    }
    if (num(doc.insuranceFee)) {
      rows.push(`<tr><td class="k">${esc(sum.insurance)}</td><td class="v">${esc(amountText(tt.insuranceFee, doc.currency))}</td></tr>`);
    }
    if (num(doc.shippingFee)) {
      rows.push(`<tr><td class="k">${esc(sum.freight || 'Freight')}</td><td class="v">${esc(amountText(tt.shippingFee, doc.currency))}</td></tr>`);
    }
    // 其它费用：每一项单独一行（保险费、离岸费… 分开显示，不挤在一起）
    for (const r of otherFeeRows(doc)) {
      rows.push(`<tr><td class="k">${esc(r.label || sum.other)}</td><td class="v">${esc(amountText(r.amount, doc.currency))}</td></tr>`);
    }
    if (num(doc.toolingFee)) {
      rows.push(`<tr><td class="k">${esc(sum.tooling || 'Tooling Fee')}</td><td class="v">${esc(amountText(tt.toolingFee, doc.currency))}</td></tr>`);
    }
    rows.push(`<tr class="grand"><td class="k">${esc(sum.grandTotal || 'TOTAL')}</td><td class="v">${esc(amountText(tt.grandTotal, doc.currency))}</td></tr>`);
  } else {
    rows.push(`<tr class="grand"><td class="k">${esc(sum.totalAmount)}</td><td class="v">${esc(amountText(tt.totalAmount, doc.currency))}</td></tr>`);
  }

  // 模具费退还说明单独一行（客户很在意这条）
  const refund = doc.toolingRefund
    ? `<div class="words-line"><span class="k">${esc(sum.tooling || 'Tooling Fee')}:</span> ${esc(doc.toolingRefund)}</div>`
    : '';

  return `<div class="doc-summary"><table class="summary-table">${rows.join('')}</table></div>${pkgLine}${refund}`;
}

/** 条款 / 备注 / 银行 */
function renderSections(doc, tpl) {
  const labels = tpl.label;
  const out = [];

  // 报价单 / 商业发票 / 形式发票 / 销售合同 不印唛头（用户要求；唛头只用于装箱单和提单）
  const MARKS_HIDDEN = ['quotation', 'ci', 'pi', 'contract'];
  if (doc.marks && !MARKS_HIDDEN.includes(doc.type)) {
    out.push(`<div class="doc-section"><div class="sttl">${esc(labels.marks)}</div><div class="marks-box">${escLines(doc.marks)}</div></div>`);
  }

  if (doc.countryOfOrigin && doc.type === 'ci') {
    out.push(`<div class="doc-section"><div class="meta-line"><span class="k">${esc(labels.countryOfOrigin)}</span><span class="v">${esc(doc.countryOfOrigin).toUpperCase()}</span></div></div>`);
  }

  // 合同条款：标准条款 + 保险 / 交货 / 违约这三项（对照 exradoc 合同的独立字段）
  if (docMeta(doc.type).withContract) {
    const extra = [
      [labels.deliveryTerms || 'Delivery Terms', doc.deliveryTerms],
      [labels.insuranceTerms || 'Insurance', doc.insuranceTerms],
      [labels.penaltyClause || 'Penalty', doc.penaltyClause],
    ].filter(([, v]) => String(v || '').trim());
    const clauses = (Array.isArray(doc.contractClauses) ? doc.contractClauses : [])
      .concat(extra.map(([title, body]) => ({ title, body })));
    if (clauses.length) {
      out.push(`<div class="doc-section"><div class="sttl">${esc(labels.terms)}</div>
      ${clauses.map((c) => `<div class="clause"><div class="ct">${esc(c.title || '')}</div><div class="cb">${escLines(c.body || '')}</div></div>`).join('')}
    </div>`);
    }
  } else if (doc.terms || (doc.type === 'quotation' && doc.deliveryTerms)) {
    // 报价单：交货条款单独一行（对照 exradoc 报价单的 Delivery Terms 字段）
    const extra = (doc.type === 'quotation' && doc.deliveryTerms)
      ? `<div class="clause"><div class="ct">${esc(labels.deliveryTerms || 'Delivery Terms')}</div><div class="cb">${escLines(doc.deliveryTerms)}</div></div>`
      : '';
    out.push(`<div class="doc-section"><div class="sttl">${esc(labels.terms)}</div>${extra}<div class="sbody">${escLines(doc.terms || '')}</div></div>`);
  }

  // 银行信息（装箱单只体现重量体积不显示；PI / CI 已在头部展示，这里不再重复）
  // 水单（bank）自己就有收款方/付款方/银行名，再印一块「收款银行」只会让人以为是重复信息
  const b = doc.bank || {};
  // 顶部「买方 + 银行」两栏里已经印过银行信息，文末就不再重复（全类型通用）
  const layoutNow = doc.partyLayout || DEFAULT_PARTY_LAYOUT[doc.type] || 'single';
  const bankShownOnTop = layoutNow === 'split';
  const mode = docMeta(doc.type).mode;
  const hasBank = !bankShownOnTop && mode !== 'packing' && mode !== 'bank'
    && [b.beneficiary, b.bankName, b.bankAddress, b.accountNo, b.swift, b.iban].some((v) => String(v || '').trim());
  if (hasBank) {
    out.push(`<div class="doc-section"><div class="sttl">${esc(labels.bankInfo)}</div>
      <div class="bank-box">
        ${b.beneficiary ? `<div class="row"><span class="k">${esc(labels.beneficiary)}</span><span class="v">${esc(b.beneficiary)}</span></div>` : ''}
        ${b.bankName ? `<div class="row"><span class="k">${esc(labels.bankName)}</span><span class="v">${esc(b.bankName)}</span></div>` : ''}
        ${b.bankAddress ? `<div class="row"><span class="k">${esc(labels.bankAddress)}</span><span class="v">${esc(b.bankAddress)}</span></div>` : ''}
        ${b.accountNo ? `<div class="row"><span class="k">${esc(labels.accountNo)}</span><span class="v">${esc(b.accountNo)}</span></div>` : ''}
        ${b.swift ? `<div class="row"><span class="k">${esc(labels.swift)}</span><span class="v">${esc(b.swift)}</span></div>` : ''}
        ${b.iban ? `<div class="row"><span class="k">${esc(labels.iban)}</span><span class="v">${esc(b.iban)}</span></div>` : ''}
      </div></div>`);
  }

  if (doc.remarks) {
    out.push(`<div class="doc-section"><div class="sttl">${esc(labels.remarks)}</div><div class="sbody">${escLines(doc.remarks)}</div></div>`);
  }

  // 交货与售后（报价单 / PI / 合同：交货地点、生产周期、保修、发票类型、样品说明）
  const logi = [
    [labels.deliveryPlace, doc.deliveryPlace],
    [labels.productionTime, doc.productionTime],
    [labels.warranty, doc.warranty],
    [labels.invoiceType, doc.invoiceType],
    [labels.sampleNote, doc.sampleNote],
  ].filter(([, v]) => String(v || '').trim());
  if (logi.length) {
    out.push(`<div class="doc-section"><div class="sttl">${esc(labels.logistics || 'DELIVERY & SERVICE')}</div>
      <div class="bank-box">${logi.map(([k, v]) =>
        `<div class="row"><span class="k">${esc(k)}</span><span>${escLines(v)}</span></div>`).join('')}</div></div>`);
  }

  return out.join('');
}

/** 签署区（合同 / PI / CI）：卖方一侧盖上已上传的印章 */
function renderSign(doc, tpl) {
  const labels = tpl.label;
  const stamp = doc.seller?.stamp
    ? `<img class="sign-stamp" src="${doc.seller.stamp}" alt=""${stampInlineStyle(doc, 96)} />`
    : '';
  // 手写签名图片（与印章同机制，位置在签字线上方）
  const signImg = doc.seller?.signature
    ? `<img class="sign-inline" src="${doc.seller.signature}" alt=""${signInlineStyle(doc)} />`
    : '';
  if (doc.type === 'contract') {
    // 签署区：对照 exradoc 的合同，双方各有「签署人 / 职务 / 签署日期」三行
    const sig = (who) => {
      const name = doc[`${who}Signer`];
      const title = doc[`${who}SignerTitle`];
      const date = doc[`${who}SignDate`];
      if (!name && !title && !date) return '';
      const line = (k, v) => `<div style="font-size:10.5px;margin-top:3px"><span style="color:var(--doc-ink-soft)">${esc(k)}:</span> ${esc(v)}</div>`;
      return (name ? line(labels.signer || 'Signer', name) : '')
        + (title ? line(labels.signerTitle || 'Title', title) : '')
        + (date ? line(labels.signDate || 'Date', formatDateDoc(date)) : '');
    };
    return `<div class="sign-area">
      <div class="sign-box"><div class="st">${esc(labels.seller)}</div>
        <div style="font-size:10.5px;margin-top:2px">${esc(doc.seller.companyName || '')}</div>
        ${sig('seller')}
        <div class="sl">${signImg}${esc(labels.signature)} / ${esc(labels.stamp)}</div>${stamp}</div>
      <div class="sign-box"><div class="st">${esc(labels.buyer)}</div>
        <div style="font-size:10.5px;margin-top:2px">${esc(doc.buyer.companyName || '')}</div>
        ${sig('buyer')}
        <div class="sl">${esc(labels.signature)} / ${esc(labels.stamp)}</div></div>
    </div>`;
  }
  if (doc.type === 'pi' || doc.type === 'ci') {
    return `<div class="sign-area">
      <div class="sign-box"><div class="st">${esc(labels.seller)}</div>
        <div style="font-size:10.5px;margin-top:2px">${esc(doc.seller.companyName || '')}</div>
        <div class="sl">${signImg}${esc(labels.signature)} / ${esc(labels.stamp)}</div>${stamp}</div>
      <div class="sign-box"><div class="st">${esc(labels.buyer)}</div>
        <div style="font-size:10.5px;margin-top:2px">${esc(doc.buyer.companyName || '')}</div>
        <div class="sl">${esc(labels.signature)}</div></div>
    </div>
    ${(doc.type === 'ci' && doc.preparedBy) ? `<div class="doc-prepared">${esc(labels.preparedBy)}: ${esc(doc.preparedBy)}</div>` : ''}`;
  }
  // 报价单：盖在右下角（报价单也常盖章发给客户），有签名信息就一并印上
  if (stamp || signImg || (doc.type === 'quotation' && (doc.signatureName || doc.signatureTitle || doc.signatureDate))) {
    const sign = doc.type === 'quotation' && (doc.signatureName || doc.signatureTitle || doc.signatureDate)
      ? `<div class="sign-inline">
          ${doc.signatureName ? `<div><span>${esc(labels.signatureName || 'Signed by')}:</span> ${esc(doc.signatureName)}</div>` : ''}
          ${doc.signatureTitle ? `<div><span>${esc(labels.signerTitle || 'Title')}:</span> ${esc(doc.signatureTitle)}</div>` : ''}
          ${doc.signatureDate ? `<div><span>${esc(labels.signDate || 'Date')}:</span> ${esc(formatDateDoc(doc.signatureDate))}</div>` : ''}
        </div>`
      : '';
    // 靠右显示：印章在上、签名在下；姓名/职务/日期填了才显示
    // 文字靠左、印章和签名靠右
    const info = sign ? `<div class="sig-text">${sign}</div>` : '';
    return `<div class="sign-block-right">${info}<div class="sig-mark-row">${stamp}${signImg}</div></div>`;
  }
  return '';
}

/** 页脚说明 */
function renderFoot(doc, tpl) {
  const f = tpl.footer || {};
  const noteMap = {
    quotation: f.offerNote,
    pi: f.piNote,
    contract: '',
    ci: f.ciNote,
    pl: f.plNote,
  };
  const note = noteMap[doc.type] || '';
  const validity = (doc.type === 'quotation' || doc.type === 'pi') && f.validityNote ? f.validityNote : '';
  return `<div class="doc-foot">
    <span>${esc([note, validity].filter(Boolean).join(' '))}</span>
    <span>${esc(doc.seller.companyName || '')} · ${esc(doc.docNo || '')}</span>
  </div>`;
}

/** 金额大写行 */
function renderWords(doc, tpl) {
  const meta = docMeta(doc.type);
  if (meta.mode === 'packing') return '';
  if (!doc.totals.totalAmount) return '';
  const words = amountInWords(doc.totals.totalAmount, doc.docLang, doc.currency);
  return `<div class="words-line"><span class="k">${esc(tpl.sum.sayTotal)}:</span> <strong>${esc(words)}</strong></div>`;
}

/**
 * 渲染完整单据 HTML
 * @param {object} doc 单据数据
 * @returns {string} HTML
 */
/**
 * 水单版式 —— 银行涉外收付凭证（对照国家外汇管理局《境内银行涉外及境内收付凭证标准样式》 + 汇丰英文水单实例）
 */
/** 水单字段标签（中英双语，按单据语言选择；不依赖报价单模板字典） */
const BS_LABEL = {
  en: {
    bank_slip_title: 'Bank Slip',
    bank_slip_date: 'Date',
    bank_slip_paymentTime: 'Payment Time',
    bank_slip_beneficiary: 'Beneficiary',
    bank_slip_beneficiaryName: 'Beneficiary Name',
    bank_slip_beneficiaryAccount: 'Account / IBAN',
    bank_slip_beneficiaryBank: 'Bank Name',
    bank_slip_beneficiaryBankCountry: 'Bank Country/Region',
    bank_slip_bankCode: 'Bank Code',
    bank_slip_branchCode: 'Branch Code',
    bank_slip_originator: 'Originator',
    bank_slip_originatorName: 'Originator Name',
    bank_slip_originatorAccount: 'Account No.',
    bank_slip_originatorBank: 'Instructing Bank',
    bank_slip_originatorSwift: 'SWIFT',
    bank_slip_amount: 'Amount',
    bank_slip_fee: 'Bank Charges',
    bank_slip_debit: 'Debit / Net Amount',
    bank_slip_status: 'Status',
    bank_slip_rate: 'Exchange Rate',
    bank_slip_instructed: 'Instructed Amount',
    bank_slip_valueDate: 'Value Date',
    bank_slip_settlement: 'Settlement',
    bank_slip_feeBearer: 'Charges (71A)',
    bank_slip_remittance: 'Remittance Information',
    bank_slip_remarks: 'Remittance Info',
    bank_slip_disclaimer: 'This slip is for reference only. Please verify actual bank receipt before shipment.',
  },
  zh: {
    bank_slip_title: '银行水单',
    bank_slip_date: '水单日期',
    bank_slip_paymentTime: '汇款时间',
    bank_slip_beneficiary: '收款方 Beneficiary',
    bank_slip_beneficiaryName: '收款方名称',
    bank_slip_beneficiaryAccount: '账号 / IBAN',
    bank_slip_beneficiaryBank: '开户银行',
    bank_slip_beneficiaryBankCountry: '银行国家/地区',
    bank_slip_bankCode: 'Bank Code',
    bank_slip_branchCode: 'Branch Code',
    bank_slip_originator: '付款方 Originator',
    bank_slip_originatorName: '付款方名称',
    bank_slip_originatorAccount: '付款账号',
    bank_slip_originatorBank: '汇款行',
    bank_slip_originatorSwift: 'SWIFT',
    bank_slip_amount: '汇款金额',
    bank_slip_fee: '手续费',
    bank_slip_debit: '到账金额',
    bank_slip_status: '状态',
    bank_slip_rate: '汇率',
    bank_slip_instructed: '执行金额',
    bank_slip_valueDate: '起息日',
    bank_slip_settlement: '结算方式',
    bank_slip_feeBearer: '费用承担 (71A)',
    bank_slip_remittance: '汇款附言',
    bank_slip_remarks: '附言',
    bank_slip_disclaimer: '本水单仅供参考，最终以银行实际到账为准。',
  },
};

function renderBankSlip(doc, tpl) {
  const en = doc.docLang !== 'zh';
  const BS = BS_LABEL[en ? 'en' : 'zh'];
  const L = (k) => BS[k] || k;
  const d = doc.bankSlip || {};
  const dir = (tpl && tpl.dir) || 'ltr';
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

  const amount = Number(d.amount || 0);
  const fee = Number(d.fee || 0);
  const debitAmount = (d.debitAmount !== undefined && d.debitAmount !== null && d.debitAmount !== '')
    ? Number(d.debitAmount) : (amount - fee);
  const rate = d.rate || '1.00000';
  const cur = d.amountCurrency || 'USD';

  const FEE_TXT = {
    OUR: 'OUR · 费用由付款方承担（付款人支付本金+手续费，收款人足额到账）',
    SHA: 'SHA · 费用由双方各自承担（付款人付发起费，收款人付到账费）',
    BEN: 'BEN · 费用由收款方承担（收款人收扣除费用后的金额）',
  };

  const val = (k, v, raw) => `<div class="bsv"><div class="bsk">${esc(k)}</div><div class="bsv-v">${raw ? v : esc(v)}</div></div>`;
  const row2 = (a, b) => `<div class="bs-row bs-row-2">${a}${b}</div>`;
  const row3 = (a, b, c) => `<div class="bs-row bs-row-3">${a}${b}${c}</div>`;

  const sections = [];
  sections.push(`<div class="bs-head">
    <div>
      <div class="bs-brand">${esc(d.bankName || (doc.seller && doc.seller.companyName) || '')}</div>
      <div class="bs-sub">${esc(L('bank_slip_title') || 'Bank Slip / 银行水单')} · ${esc(doc.docNo || '')}</div>
    </div>
    <div class="bs-head-right">
      ${val(L('bank_slip_date') || 'Date / 日期', d.date || formatDateDoc(new Date().toISOString().slice(0, 10)))}
      ${val(L('bank_slip_paymentTime') || 'Payment Time / 汇款时间', d.paymentTime || '')}
    </div>
  </div>`);

  // 收款方 Beneficiary
  sections.push(`<div class="bs-sec">${esc(L('bank_slip_beneficiary') || 'Beneficiary · 收款方')}</div>`);
  sections.push(row2(
    val(L('bank_slip_beneficiaryName') || '收款方名称', d.beneficiaryName || (doc.buyer && doc.buyer.companyName) || ''),
    val(L('bank_slip_beneficiaryAccount') || '账号 / IBAN', d.beneficiaryAccount || ''),
  ));
  sections.push(row2(
    // 开户银行 / SWIFT 只用水单自己的字段：以前会兜底去取「银行信息」块里的
    // doc.bank.bankName / doc.bank.swift，结果单据上印出了一个表单里根本找不到对应输入口的值
    val(L('bank_slip_beneficiaryBank') || '开户银行', d.beneficiaryBank || ''),
    val(L('bank_slip_beneficiaryBankCountry') || '银行国家/地区', d.beneficiaryBankCountry || ''),
  ));
  sections.push(row3(
    val('SWIFT Code', d.beneficiarySwift || ''),
    val(L('bank_slip_bankCode') || 'Bank Code', d.beneficiaryBankCode || ''),
    val(L('bank_slip_branchCode') || 'Branch Code', d.beneficiaryBranchCode || ''),
  ));

  // 付款方 Originator
  sections.push(`<div class="bs-sec">${esc(L('bank_slip_originator') || 'Originator · 付款方')}</div>`);
  sections.push(row2(
    val(L('bank_slip_originatorName') || '付款方名称', d.originatorName || (doc.seller && doc.seller.companyName) || ''),
    val(L('bank_slip_originatorAccount') || '付款账号', d.originatorAccount || ''),
  ));
  sections.push(row2(
    val(L('bank_slip_originatorBank') || '汇款行', d.originatorBank || ''),
    val(L('bank_slip_originatorSwift') || 'SWIFT', d.originatorSwift || ''),
  ));

  // 金额
  sections.push(`<div class="bs-amount">
    <div class="bs-amount-label">${esc(L('bank_slip_amount') || 'Amount · 汇款金额')}</div>
    <div class="bs-amount-val">${cur} ${amountText(amount, cur)}</div>
  </div>`);
  sections.push(row3(
    val(L('bank_slip_fee') || 'Bank Charges · 手续费', `${cur} ${amountText(fee, cur)}`),
    val(L('bank_slip_debit') || 'Debit · 到账金额', `${cur} ${amountText(debitAmount, cur)}`),
    val(L('bank_slip_status') || 'Status · 状态', `<span class="bs-status">${esc(d.status || 'COMPLETE')}</span>`, true),
  ));
  sections.push(row3(
    val(L('bank_slip_rate') || 'Exchange Rate · 汇率', esc(rate)),
    val(L('bank_slip_instructed') || 'Instructed · 执行金额', esc(d.instructedAmount || `${cur} ${amountText(debitAmount, cur)}`)),
    val(L('bank_slip_valueDate') || 'Value Date · 起息日', esc(d.valueDate || formatDateDoc(new Date().toISOString().slice(0, 10)))),
  ));
  sections.push(row2(
    val(L('bank_slip_settlement') || 'Settlement · 结算方式', esc(d.settlement || 'T/T · 电汇')),
    val(L('bank_slip_feeBearer') || 'Charges (71A) · 费用承担', `${esc(d.feeBearer || 'SHA')} — <span class="bs-fee-note">${esc(FEE_TXT[d.feeBearer] || '')}</span>`, true),
  ));

  // 附言
  if (has(d.remarks) || has(d.remittance)) {
    sections.push(`<div class="bs-sec">${esc(L('bank_slip_remittance') || 'Remittance Information · 汇款附言')}</div>`);
    sections.push(`<div class="bs-row bs-row-1"><div class="bsv bsv-wide"><div class="bsk">${esc(L('bank_slip_remarks') || '附言')}</div><div class="bsv-v">${escLines(d.remarks || d.remittance || '').replace(/\n/g, '<br>')}</div></div></div>`);
  }

  const foot = (doc.bankSlip && doc.bankSlip.disclaimer !== undefined)
    ? (doc.bankSlip.disclaimer || '')
    : (L('bank_slip_disclaimer') || '本水单仅供参考，最终以银行实际到账为准。');

  return `<div class="doc-root doc-bank" dir="${dir}" lang="${doc.docLang}">
    ${sections.join('')}
    <div class="bs-note">${esc(foot)}</div>
  </div>`;
}

/**
 * 报关单专用版式 —— 对照官方《中华人民共和国海关出口货物报关单》
 *
 * 结构（全部在一个带框线的表格里，边框连续）：
 *   标题（居中）+ 预录入编号 / 海关编号
 *   ┌ 境内发货人（前缀：公司名称 / 地址 / 统一社会信用代码）│ 出境关别 │ 出口日期 │ 申报日期 │ 备案号
 *   ├ 境外收货人（前缀：公司名称 / 地址）                  │ 运输方式 │ 运输工具名称及航次号 │ 提运单号
 *   ├ 生产销售单位（前缀：名称 / 代码）                    │ 监管方式 │ 征免性质 │ 许可证号
 *   ├ 合同协议号                                          │ 贸易国 │ 运抵国 │ 指运港 │ 离境口岸
 *   ├ 包装种类 │ 件数 │ 毛重 │ 净重 │ 成交方式 │ 运费 │ 保费 │ 杂费
 *   ├ 随附单证及编号
 *   ├ 标记唛码及备注
 *   ├ 项号 │ 商品编号 │ 商品名称及规格型号 │ 数量及单位 │ 单价/总价/币制 │ 原产国 │ 最终目的国 │ 境内货源地 │ 征免
 *   ├ 特殊关系确认 │ 价格影响确认 │ 支付特许权使用费确认 │ 自报自缴
 *   ├ 报关人员 │ 报关人员证号 │ 电话 │ 兹申明…
 *   ├ 申报单位 │ 申报单位（签章）
 *   └ 海关批注及签章
 *
 * ⚠️ 两个刻意的设计：
 *   1) 每个值都带前缀（公司名称：/ 地址：/ 统一社会信用代码：…）—— 用户反馈"只显示一串数字
 *      看不出是什么"；
 *   2) 页数不够时不缩字号，宁可换行，保持官方表格的观感。
 */
/**
 * 报关单「同类项合并」
 *
 * 客户需求（原话）：「报关单可以合并吗？同类项 —— HS编码、品名一样的，合并报关」
 * 后续又明确：「只要 HS 编码和品名一样就行，就合并」——所以判同类的键**只取这两项**。
 *
 * 规则：
 *   · 键 = HS 编码 + 品名（忽略大小写、多余空格）；
 *   · 合并后：数量、总价、净重相加，单价按「总价 ÷ 数量」重算；
 *   · 各组内的规格 / 型号 / 境内货源地不同时，用「、」拼在同一格里，不丢信息；
 *   · 单位 / 原产国 / 目的国 / 征免在同一组里不一致时：取第一行的值，
 *     并在表单里给出「⚠ 请核对」提醒（海关要求这些栏一致，不能悄悄吞掉）。
 *
 * 关掉：报关单表单里取消勾选「合并同类项申报」（doc.mergeSameItems = false）。
 */
function customsMergeKey(it) {
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  return [norm(it.hsCode), norm(it.description)].join('|');
}

/**
 * 合并结果 + 冲突提醒（表单里用来提示"单位/原产国不一致，已按第一行合并"）
 * @returns {{items:Array, conflicts:{unit:string[],origin:string[],dest:string[],duty:string[]}, mergedRows:number, groups:number}}
 */
export function analyzeCustomsMerge(items, doc) {
  const list = Array.isArray(items) ? items : [];
  const conflicts = { unit: [], origin: [], dest: [], duty: [] };
  if (!doc || doc.mergeSameItems === false || list.length < 2) {
    return { items: list, conflicts, mergedRows: list.length, groups: list.length };
  }
  const keys = [];
  const map = new Map();
  for (const it of list) {
    const k = customsMergeKey(it);
    const cur = map.get(k);
    if (!cur) {
      map.set(k, {
        ...it,
        qty: num(it.qty),
        amount: num(it.amount),
        nw: num(it.nw),
        _rows: 1,
        _sizes: new Set(it.size ? [String(it.size).trim()] : []),
        _models: new Set(it.model ? [String(it.model).trim()] : []),
        _sources: new Set(it.domesticSource ? [String(it.domesticSource).trim()] : []),
        _units: new Set(it.unit ? [String(it.unit).trim()] : []),
        _origins: new Set([String(it.origin || (doc && doc.countryOfOrigin) || '').trim()]),
        _dests: new Set([String(it.dest || (doc && doc.destinationCountry) || '').trim()]),
        _duties: new Set([String(it.lineDutyNature || (doc && doc.dutyNature) || '').trim()]),
      });
      keys.push(k);
      continue;
    }
    cur.qty += num(it.qty);
    cur.amount += num(it.amount);
    cur.nw += num(it.nw);
    cur._rows += 1;
    if (it.size) cur._sizes.add(String(it.size).trim());
    if (it.model) cur._models.add(String(it.model).trim());
    if (it.domesticSource) cur._sources.add(String(it.domesticSource).trim());
    if (it.unit) cur._units.add(String(it.unit).trim());
    cur._origins.add(String(it.origin || (doc && doc.countryOfOrigin) || '').trim());
    cur._dests.add(String(it.dest || (doc && doc.destinationCountry) || '').trim());
    cur._duties.add(String(it.lineDutyNature || (doc && doc.dutyNature) || '').trim());
  }
  const out = keys.map((k) => {
    const r = map.get(k);
    const label = String(r.description || r.hsCode || '').trim();
    if (r._units.size > 1) conflicts.unit.push(`${label}：${[...r._units].join(' / ')}`);
    if (r._origins.size > 1) conflicts.origin.push(`${label}：${[...r._origins].filter(Boolean).join(' / ')}`);
    if (r._dests.size > 1) conflicts.dest.push(`${label}：${[...r._dests].filter(Boolean).join(' / ')}`);
    if (r._duties.size > 1) conflicts.duty.push(`${label}：${[...r._duties].filter(Boolean).join(' / ')}`);
    const unitPrice = r.qty > 0 ? Math.round((r.amount / r.qty) * 10000) / 10000 : num(r.unitPrice);
    return {
      ...r,
      unitPrice,
      unit: [...r._units][0] || r.unit,             // 单位取第一行的（冲突会在表单里提醒）
      size: [...r._sizes].join('、'),
      model: [...r._models].join('、'),
      domesticSource: [...r._sources].join('、'),
      _sizes: undefined, _models: undefined, _sources: undefined,
      _units: undefined, _origins: undefined, _dests: undefined, _duties: undefined,
    };
  });
  return { items: out, conflicts, mergedRows: list.length, groups: out.length };
}

export function mergeCustomsItems(items, doc) {
  return analyzeCustomsMerge(items, doc).items;
}

function renderCustoms(doc, tpl) {
  const zh = doc.docLang === 'zh';
  const L = (z, e) => (zh ? z : e);
  const v = (x) => esc(String(x == null ? '' : x));
  const has = (x) => String(x == null ? '' : x).trim() !== '';
  const s = doc.seller || {};
  const b = doc.buyer || {};
  const rawItems = (doc.items || []).filter((it) => has(it.description) || has(it.hsCode));
  // 同类项合并（HS + 品名 + 单位 + 原产国 + 目的国 + 征免 相同的合并成一项）
  // 报关单专属：发票 / 装箱单仍按原样分行
  const items = mergeCustomsItems(rawItems, doc);
  const coins = doc.currency || '';
  const money = (x) => {
    if (!has(x) && !num(x)) return '';
    return num(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const moneyCur = (x) => {
    const t = money(x);
    if (!t) return '';
    return coins ? `${coins} ${t}` : t;
  };

  // 值都带前缀，避免"这是什么东西"
  const line = (label, value) => (has(value) ? `${v(label)}：${v(value)}` : '');
  const block = (...lines) => lines.filter(Boolean).map((x) => `<div class="cus-line">${x}</div>`).join('');

  const addrOf = (p) => [p.address, [p.city, p.state, p.zip].filter((x) => has(x)).join(' '), p.country]
    .filter((x) => has(x)).join(', ');
  const credit = has(doc.shipperCreditCode) ? doc.shipperCreditCode : (s.taxId || '');
  const vessel = has(doc.vesselVoyage) ? doc.vesselVoyage
    : [doc.vessel, doc.voyageNo].filter((x) => has(x)).join(' / ');
  const wUnit = (items.find((it) => has(it.weightUnit)) || {}).weightUnit || 'kg';
  const pkUnit = (items.find((it) => has(it.packUnit)) || {}).packUnit || 'ctns';
  const sum = (key) => items.reduce((a, it) => a + (num(it[key]) || 0), 0);
  const totalCtns = sum('ctns') || (doc.totals ? doc.totals.totalQty : 0);
  const totalNw = doc.totals ? doc.totals.totalNw : 0;
  const totalGw = doc.totals ? doc.totals.totalGw : 0;

  const COLS = 16;
  /** 标签在上、值在下的格子 */
  const cell = (span, label, value, cls = '') =>
    `<td colspan="${span}" class="cus-f ${cls}"><div class="cus-k">${v(label)}</div><div class="cus-v">${value || '&nbsp;'}</div></td>`;
  const row = (...cells) => `<tr>${cells.join('')}</tr>`;
  const fullRow = (label, value, cls = '') => row(cell(COLS, label, value, cls));

  // ---- 上半部：发货人 / 收货人 / 生产销售单位 / 合同 ----
  const headRows = [
    row(
      cell(6, L('境内发货人', 'Domestic shipper'), block(
        line(L('统一社会信用代码', 'Credit code'), credit),
        line(L('公司名称', 'Company'), s.companyName),
        line(L('地址', 'Address'), addrOf(s)),
        line(L('联系人 / 电话', 'Contact / Tel'), [s.contact, s.tel].filter((x) => has(x)).join(' / ')),
      ), 'cus-party-cell'),
      cell(3, L('出境关别', 'Exit customs'), v(doc.exitCustoms)),
      cell(2, L('出口日期', 'Export date'), v(formatDateDoc(doc.exportDate))),
      cell(2, L('申报日期', 'Declaration date'), v(formatDateDoc(doc.declarationDate || doc.date))),
      cell(3, L('备案号', 'Record no.'), v(doc.recordNo)),
    ),
    row(
      cell(6, L('境外收货人', 'Foreign consignee'), block(
        line(L('公司名称', 'Company'), b.companyName),
        line(L('地址', 'Address'), addrOf(b)),
        line(L('联系人 / 电话', 'Contact / Tel'), [b.contact, b.tel].filter((x) => has(x)).join(' / ')),
      ), 'cus-party-cell'),
      cell(2, L('运输方式', 'Transport'), v(doc.shippingMethod)),
      cell(5, L('运输工具名称及航次号', 'Vessel & Voyage'), v(vessel)),
      cell(3, L('提运单号', 'B/L No.'), v(doc.blNo || doc.awbNo)),
    ),
    row(
      cell(6, L('生产销售单位', 'Producer'), block(
        line(L('名称', 'Name'), doc.producerName || s.companyName),
        line(L('代码', 'Code'), doc.producerCode || credit),
      ), 'cus-party-cell'),
      cell(2, L('监管方式', 'Supervision mode'), v(doc.supervisionMode)),
      cell(3, L('征免性质', 'Duty nature'), v(doc.dutyNature)),
      cell(5, L('许可证号', 'License no.'), v(doc.licenseNo)),
    ),
    row(
      // 合同协议号：只印用户填的合同号（以前会拿自己的单号顶上，看着像填好了）
      cell(6, L('合同协议号', 'Contract no.'), block(has(doc.contractNo) ? line(L('合同号', 'Contract'), doc.contractNo) : '')),
      cell(2, L('贸易国（地区）', 'Trade country'), v(doc.tradeCountry)),
      cell(2, L('运抵国（地区）', 'Destination country'), v(doc.destinationCountry)),
      cell(3, L('指运港', 'Destination port'), v(doc.destPort || doc.destination)),
      cell(3, L('离境口岸', 'Exit port'), v(doc.exitPort)),
    ),
    row(
      cell(6, L('包装种类', 'Package type'), block(line(L('包装', 'Packing'), doc.packageType))),
      // 件数没有箱数就留空 —— 早先用「数量」顶替，看起来像 1500 件包装，是错的
      cell(2, L('件数', 'Packages'), sum('ctns') > 0 ? `${v(qty(sum('ctns')))}${has(pkUnit) ? ` ${v(pkUnit)}` : ''}` : ''),
      cell(2, L('毛重（千克）', 'Gross weight'), totalGw ? `${v(qty(totalGw))} ${v(wUnit)}` : ''),
      cell(2, L('净重（千克）', 'Net weight'), totalNw ? `${v(qty(totalNw))} ${v(wUnit)}` : ''),
      // ⚠️ 这一行的 colspan 之和必须正好等于 COLS，多一格就会把最后一列挤出表格
      cell(1, L('成交方式', 'Terms'), v(doc.incoterms)),
      cell(1, L('运费', 'Freight'), moneyCur(doc.shippingFee)),
      cell(1, L('保费', 'Insurance'), moneyCur(doc.insuranceFee)),
      cell(1, L('杂费', 'Misc. fee'), moneyCur(doc.otherFee)),
    ),
    fullRow(L('随附单证及编号', 'Attached documents'), v(doc.attachedDocs)),
    fullRow(L('标记唛码及备注', 'Marks & remarks'), escLines([doc.marks, doc.remarks].filter((x) => has(x)).join('\n')).replace(/\n/g, '<br>')),
  ].join('');

  // ---- 明细表（表头与数据都在同一张表里，边框连续） ----
  // 宽度分配刻意向「商品名称及规格型号」倾斜：这一列内容最长，早先给 3/14 时
  // 规格和型号会被挤成一行一个字（用户反馈"规格太乱了"）。
  const itemHead = [
    [1, L('项号', 'No.')],
    [2, L('商品编号', 'HS Code')],
    [5, L('商品名称及规格型号', 'Description / Spec / Model')],
    [2, L('数量及单位', 'Qty & Unit')],
    [2, L('单价/总价/币制', 'Unit price / Amount / Currency')],
    [1, L('原产国（地区）', 'Origin')],
    [1, L('最终目的国', 'Final destination')],
    [1, L('境内货源地', 'Domestic source')],
    [1, L('征免', 'Duty')],
  ];
  // 明细里没填、沿用单据级值的格子：淡一点 + 标「同单」，否则看起来像"输一个别处全冒出来"
  const inherit = (own, fallback) => (has(own)
    ? v(own)
    : (has(fallback) ? `<span class="cus-inherit">${v(fallback)}<span class="cus-inh-tag">${v(L('同单', 'same as header'))}</span></span>` : ''));

  const itemRows = items.length
    // ⚠️ 数据行的 colspan 必须和表头逐格对应（1/2/5/2/2/1/1/1/1），
    //    否则数据会落到别的列上（表头是 16 格而数据行只有 9 格时会整体错位）
    ? items.map((it, i) => `<tr class="cus-item-row">`
      + `<td>${i + 1}</td>`
      + `<td colspan="2">${v(it.hsCode)}</td>`
      + `<td colspan="5" class="l"><div class="cus-item-name">${v(it.description)}</div>`
      + (has(it.size) ? `<div class="cus-sub2">${v(L('规格', 'Spec'))}：${v(it.size)}</div>` : '')
      + (has(it.model) ? `<div class="cus-sub2">${v(L('型号', 'Model'))}：${v(it.model)}</div>` : '')
      + `</td>`
      + `<td colspan="2">${v(qty(it.qty))}${has(it.unit) ? ` ${v(it.unit)}` : ''}${num(it.nw) ? `<div class="cus-sub2">${v(L('净重', 'N.W.'))} ${v(qty(it.nw))} ${v(it.weightUnit || wUnit)}</div>` : ''}</td>`
      + `<td colspan="2">${v(money(it.unitPrice))}<div class="cus-sub2">${v(money(it.amount))}${coins ? ` ${v(coins)}` : ''}</div></td>`
      + `<td>${inherit(it.origin, doc.countryOfOrigin)}</td>`
      + `<td>${inherit(it.dest, doc.destinationCountry)}</td>`
      + `<td>${v(it.domesticSource || doc.domesticSource || '')}</td>`
      + `<td>${inherit(it.lineDutyNature, doc.dutyNature)}</td>`
      + `</tr>`).join('')
    : `<tr class="cus-item-row"><td colspan="${COLS}" style="text-align:center;padding:8px">—</td></tr>`;

  const itemTable = `<tr class="cus-items-h">${itemHead.map(([sp, label]) => `<th colspan="${sp}">${v(label)}</th>`).join('')}</tr>`
    + itemRows
    // 合计：8 格压在「项号+商品编号+名称」下面，数量和金额各自对齐到自己的列
    + `<tr class="cus-total"><td colspan="8">${v(L('合计', 'TOTAL'))}</td>`
    + `<td colspan="2">${v(qty(items.reduce((a, it) => a + (num(it.qty) || 0), 0)))}</td>`
    + `<td colspan="2">${v(moneyCur(doc.totals ? doc.totals.totalAmount : 0))}</td>`
    + `<td colspan="4"></td></tr>`;

  // ---- 下半部：确认栏 / 报关人员 / 申报单位 / 海关批注 ----
  const yesNo = (x) => (has(x) ? x : L('否', 'No'));
  const footRows = [
    row(
      cell(4, L('特殊关系确认', 'Related party'), v(yesNo(doc.relatedPartyConfirm))),
      cell(4, L('价格影响确认', 'Price impact'), v(yesNo(doc.priceImpactConfirm))),
      cell(4, L('支付特许权使用费确认', 'Royalty payment'), v(yesNo(doc.royaltyConfirm))),
      cell(4, L('自报自缴', 'Self-declared'), v(yesNo(doc.selfDeclaration))),
    ),
    row(
      cell(3, L('报关人员', 'Declarant'), v(doc.declarantName)),
      cell(3, L('报关人员证号', 'Declarant ID'), v(doc.declarantCode)),
      cell(2, L('电话', 'Tel'), v(doc.declarantPhone)),
      cell(8, L('兹申明', 'Declaration'), escLines(doc.declaration || L('对以上内容承担如实申报、依法纳税之法律责任。', 'The above information is declared truthfully; we accept the legal responsibility.')).replace(/\n/g, '<br>')),
    ),
    row(
      cell(8, L('申报单位', 'Declaring entity'), block(
        line(L('名称', 'Name'), doc.declareUnit || s.companyName),
        line(L('统一社会信用代码', 'Credit code'), doc.declareUnitCode || credit),
      )),
      cell(8, L('申报单位（签章）', 'Declaring entity (signature)'), `${v(doc.declarantSignature)}${v(doc.signatureDate ? `　${formatDateDoc(doc.signatureDate)}` : '')}${s.stamp ? `<img class="cus-stamp" src="${s.stamp}" alt="" />` : ''}`, 'cus-sign'),
    ),
    fullRow(L('海关批注及签章', 'Customs remarks & seal'), v(doc.customsRemark), 'cus-customs-remark'),
  ].join('');

  const dir = tpl.dir || 'ltr';
  // 横向 A4 的可用宽度 ≈ 1020px，按「哪个栏目内容最长」精确分配，不靠均分
  const COLS_PX = [30, 45, 45, 64, 64, 64, 64, 64, 60, 60, 65, 65, 80, 80, 100, 70];
  const colgroup = `<colgroup>${COLS_PX.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>`;
  return `<div class="doc-root doc-customs" dir="${dir}" lang="${doc.docLang}">
    <div class="cus-title">${v(L('中华人民共和国海关出口货物报关单', 'CUSTOMS DECLARATION OF EXPORT GOODS'))}</div>
    <div class="cus-top">
      <span>${v(L('预录入编号', 'Pre-entry no.'))}：${v(doc.preEntryNo)}</span>
      <span>${v(L('海关编号', 'Customs no.'))}：${v(doc.customsNo || doc.consignmentNo || doc.docNo)}</span>
    </div>
    <table class="cus cus-main">${colgroup}<tbody>${headRows}${itemTable}${footRows}</tbody></table>
  </div>`;
}

/**
 * 海运提单专用版式 —— 对照标准海运提单（样本 4-1）的 1~22 栏目
 *
 * 结构（一个连续边框的表格，COLS = 20 列）：
 *   标题：海运提单 / OCEAN BILL OF LADING
 *   1 SHIPPER 托运人        │ B/L NO. 提单号 + 承运人 + ORIGINAL + Combined Transport B/L（右栏跨 3 行）
 *   2 CONSIGNEE 收货人      │
 *   3 NOTIFY PARTY 通知人   │
 *   4 PRE-CARRIAGE BY      │ 5 PLACE OF RECEIPT
 *   6 OCEAN VESSEL, VOY.NO │ 7 PORT OF LOADING
 *   8 PORT OF DISCHARGE    │ 9 PLACE OF DELIVERY │ 10 FINAL DESTINATION
 *   11 MARKS │ 12 NOS.&KINDS OF PKGS │ 13 DESCRIPTION OF GOODS │ 14 G.W.(KG) │ 15 MEAS(M³)
 *   16 TOTAL NUMBER OF CONTAINERS OR PACKAGES (IN WORDS)
 *   17 FREIGHT & CHARGES │ REVENUE TONS │ RATE │ PER │ PREPAID │ COLLECT
 *   PREPAID AT │ PAYABLE AT │ 18 PLACE AND DATE OF ISSUE
 *   TOTAL PREPAID │ 19 NUMBER OF ORIGINAL B(s)L │ 22 SIGNED FOR THE CARRIER
 *   20 DATE（装船日期） │ 21 LOADING ON BOARD THE VESSEL BY
 *
 * ⚠️ 每行 colspan 之和必须正好 20（多一格会把最后一列挤出表格）。
 */
function renderBillOfLading(doc, tpl) {
  const zh = doc.docLang === 'zh';
  const L = (z, e) => (zh ? z : e);
  const v = (x) => esc(String(x == null ? '' : x));
  const has = (x) => String(x == null ? '' : x).trim() !== '';
  const s = doc.seller || {};
  const b = doc.buyer || {};
  const consignee = (doc.consignee && has(doc.consignee.companyName)) ? doc.consignee : b;
  const notify = (doc.notify && has(doc.notify.companyName)) ? doc.notify : null;
  const items = (doc.items || []).filter((it) => has(it.description) || has(it.marks));
  const tt = doc.totals || {};
  const COLS = 20;

  const addrOf = (p) => [p.address, [p.city, p.state, p.zip].filter((x) => has(x)).join(' '), p.country]
    .filter((x) => has(x)).join(', ');
  /**
   * 当事方：公司名 / 地址 / 联系人电话（都带前缀，避免"一串数字不知道是什么"）
   * ⚠️ extra 里的内容是**已经拼好的 HTML**（不再转义），前三行才转义
   */
  const partyBlock = (p, extra = []) => {
    if (!p) return '';
    const lines = [
      has(p.companyName) ? v(`${L('公司名称', 'Company')}：${p.companyName}`) : '',
      has(addrOf(p)) ? v(`${L('地址', 'Address')}：${addrOf(p)}`) : '',
      [p.contact, p.tel].filter((x) => has(x)).length
        ? v(`${L('联系人 / 电话', 'Contact / Tel')}：${[p.contact, p.tel].filter((x) => has(x)).join(' / ')}`) : '',
      has(p.whatsapp) ? v(`WhatsApp：${p.whatsapp}`) : '',
      ...extra.filter(Boolean),
    ].filter(Boolean);
    return lines.map((x) => `<div class="bl-line">${x}</div>`).join('');
  };

  /** 栏目格子：编号 + 中英文标题 + 值（标题在上、值在下，和提单一致） */
  const cell = (span, no, en, cn, value, cls = '') =>
    `<td colspan="${span}" class="bl-f ${cls}"><div class="bl-k"><b>${v(no)}</b> ${v(en)}<span class="bl-cn">${v(cn)}</span></div><div class="bl-v">${value || '&nbsp;'}</div></td>`;
  const row = (...cells) => `<tr>${cells.join('')}</tr>`;

  const vesselVoy = [doc.vessel, doc.voyageNo].filter((x) => has(x)).join(' / ');
  const gw = has(doc.totalGrossWeight) ? doc.totalGrossWeight : (tt.totalGw || '');
  const meas = has(doc.totalMeasurement) ? doc.totalMeasurement : (tt.totalMeas || '');
  const pkgs = has(doc.totalPkgs) ? doc.totalPkgs : items.reduce((a, it) => a + (num(it.qty) || num(it.ctns) || 0), 0);
  const pkUnit = (items.find((it) => has(it.unit)) || {}).unit || 'CTNS';
  const blTypes = { ORIGINAL: L('正本', 'Original'), 'TELEX RELEASE': L('电放', 'Telex release'), SEAWAYBILL: L('海运单', 'Sea waybill') };

  const headRows = [
    row(
      cell(8, '1.', 'SHIPPER', '托运人', partyBlock(s)),
      `<td colspan="12" rowspan="3" class="bl-f bl-blno">
        <div class="bl-k"><b>B/L NO.</b><span class="bl-cn">提单号</span></div>
        <div class="bl-v bl-no">${v(doc.docNo)}</div>
        ${has(doc.drNo) ? `<div class="bl-line">D/R No. <span class="bl-cn">编号</span>：${v(doc.drNo)}</div>` : ''}
        ${has(doc.bookingNo) ? `<div class="bl-line">${v(L('托运编号', 'Booking No.'))}：${v(doc.bookingNo)}</div>` : ''}
        ${has(doc.containerOwner) ? `<div class="bl-line">${v(L('箱属公司', 'Container owner'))}：${v(doc.containerOwner)}</div>` : ''}
        <div class="bl-carrier">
          ${has(doc.carrierName) ? `<div class="bl-carrier-nm">${v(doc.carrierName)}</div>` : ''}
          <div class="bl-type">${v(blTypes[String(doc.blType || '').toUpperCase()] ? `${doc.blType} · ${blTypes[String(doc.blType).toUpperCase()]}` : (doc.blType || 'ORIGINAL'))}</div>
          <div class="bl-sub">Combined Transport Bill of Lading</div>
        </div>
      </td>`,
    ),
    row(cell(8, '2.', 'CONSIGNEE', '收货人', partyBlock(consignee))),
    row(cell(8, '3.', 'NOTIFY PARTY', '通知人', partyBlock(notify || consignee, notify ? [] : [`<span class="bl-hint">${v(L('默认同收货人，可单独填', 'Defaults to consignee'))}</span>`]))),
    row(
      cell(10, '4.', 'PRE-CARRIAGE BY', '前程运输', v(doc.preCarriageBy)),
      cell(10, '5.', 'PLACE OF RECEIPT', '收货地', v(doc.placeOfReceipt)),
    ),
    row(
      cell(10, '6.', 'OCEAN VESSEL, VOY. NO.', '船名及航次', v(vesselVoy)),
      cell(10, '7.', 'PORT OF LOADING', '装货港', v(doc.portOfLoading)),
    ),
    row(
      cell(7, '8.', 'PORT OF DISCHARGE', '卸货港', v(doc.portOfDischarge)),
      cell(7, '9.', 'PLACE OF DELIVERY', '交货地', v(doc.placeOfDelivery)),
      cell(6, '10.', 'FINAL DESTINATION', '目的地', v(doc.finalDestination)),
    ),
  ].join('');

  const itemHead = [
    [4, '11.', 'MARKS', '唛头'],
    [3, '12.', 'NOS. & KINDS OF PKGS', '包装种类和数量'],
    [7, '13.', 'DESCRIPTION OF GOODS', '货物名称'],
    [3, '14.', 'G.W.(KG)', '毛重'],
    [3, '15.', 'MEAS(M³)', '体积'],
  ];
  // 唛头兜底：产品行没填时用单据「唛头」字段（装箱单填的内容，提单也显示）
  const fallbackMarks = doc.marks || '';
  const itemRows = items.length
    ? items.map((it, idx) => `<tr class="bl-item-row">
        <td colspan="4" class="l">${escLines(it.marks || (idx === 0 ? fallbackMarks : '')).replace(/\n/g, '<br>')}</td>
        <td colspan="3">${v(qty(num(it.qty) || num(it.ctns)))} ${v(it.unit || '')}</td>
        <td colspan="7" class="l">${v(it.description)}${has(it.size) ? `<div class="bl-sub2">${v(it.size)}</div>` : ''}</td>
        <td colspan="3">${v(qty(it.gw))} KG</td>
        <td colspan="3">${v(it.meas ? num(it.meas).toFixed(3) : '')} CBM</td>
      </tr>`).join('')
    : `<tr class="bl-item-row"><td colspan="${COLS}" style="text-align:center;padding:8px">—</td></tr>`;

  const itemTable = `<tr class="bl-items-h">${itemHead.map(([sp, no, en, cn]) => `<th colspan="${sp}"><b>${v(no)}</b> ${v(en)}<span class="bl-cn">${v(cn)}</span></th>`).join('')}</tr>`
    + itemRows
    + row(`<td colspan="10" class="bl-f"><div class="bl-k"><b>16.</b> TOTAL NUMBER OF CONTAINERS OR PACKAGES (IN WORDS)<span class="bl-cn">集装箱或件数合计（大写）</span></div>
        <div class="bl-v">${has(doc.totalInWords) ? v(doc.totalInWords) : `SAY ${v(qty(pkgs))} ${v(String(pkUnit).toUpperCase())} ONLY`}</div></td>`
      + `<td colspan="10" class="bl-f"><div class="bl-k">${v(L('装运条款 / 备注', 'Shipping clause / Remarks'))}</div>
        <div class="bl-v">${escLines([doc.shippingClause, doc.containerInfo, doc.remarks].filter((x) => has(x)).join('\n')).replace(/\n/g, '<br>') || '&nbsp;'}</div></td>`)
    + row(cell(8, '', 'ON BOARD', '已装船', has(doc.dateOfShipment) ? v(formatDateDoc(doc.dateOfShipment)) : '', 'bl-onboard')
      + cell(12, '', 'SHIPPER LOAD, COUNT & SEAL', '托运人装载、计数并封箱', escLines(doc.declaration || '').replace(/\n/g, '<br>')));

  const prepaidCell = cell(3, '', 'PREPAID', '运费预付', `${/PREPAID|预付/i.test(doc.freightTerms || '') ? '✔ ' : ''}${v(doc.prepayAmount)}`);
  const collectCell = cell(2, '', 'COLLECT', '运费到付', `${/COLLECT|到付/i.test(doc.freightTerms || '') ? '✔ ' : ''}${v(doc.collectAmount)}`);
  const footRows = [
    row(
      cell(6, '17.', 'FREIGHT & CHARGES', '运费', v(doc.freightTerms)),
      cell(3, '', 'REVENUE TONS', '运费吨', v(doc.revenueTons)),
      cell(3, '', 'RATE', '运费率', v(doc.rate)),
      cell(3, '', 'PER', '计费单位', v(doc.per)),
      prepaidCell, collectCell,
    ),
    row(
      cell(7, '', 'PREPAID AT', '预付地点', v(doc.prepaidAt)),
      cell(7, '', 'PAYABLE AT', '到付地点', v(doc.payableAt)),
      cell(6, '18.', 'PLACE AND DATE OF ISSUE', '出单地点和时间',
        [doc.placeOfIssue, doc.dateOfIssue ? formatDateDoc(doc.dateOfIssue) : ''].filter((x) => has(x)).join('　')),
    ),
    row(
      cell(7, '', 'TOTAL PREPAID', '预付总金额', v(doc.totalPrepaid)),
      cell(7, '19.', 'NUMBER OF ORIGINAL B(s)L', '正本提单份数', v(doc.numberOfOriginal || '3')),
      `<td colspan="6" class="bl-f bl-sign">
        <div class="bl-k"><b>22.</b> SIGNED FOR THE CARRIER<span class="bl-cn">承运人签章</span></div>
        <div class="bl-v">${v(doc.signingAgent || doc.carrierName)}${has(doc.carrierSignatureDate) ? `<div class="bl-sub2">${v(formatDateDoc(doc.carrierSignatureDate))}</div>` : ''}${s.stamp ? `<img class="bl-stamp" src="${s.stamp}" alt="" />` : ''}</div>
      </td>`,
    ),
    row(
      cell(10, '20.', 'DATE', '装船日期', v(formatDateDoc(doc.dateOfShipment))),
      cell(10, '21.', 'LOADING ON BOARD THE VESSEL BY', '装船船名', v(doc.loadingOnBoardBy || doc.vessel)),
    ),
  ].join('');

  // 20 列宽度：唛头列宽一点，其余均分（合计 ≈ A4 纵向可用宽度）
  const COLS_PX = [45, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35];
  const colgroup = `<colgroup>${COLS_PX.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>`;
  const dir = tpl.dir || 'ltr';
  return `<div class="doc-root doc-bl" dir="${dir}" lang="${doc.docLang}">
    <div class="bl-title">${v(L('海 运 提 单', 'OCEAN BILL OF LADING'))}<span class="bl-title-en">${v(L('OCEAN BILL OF LADING', ''))}</span></div>
    <table class="bl-main">${colgroup}<tbody>${headRows}${itemTable}${footRows}</tbody></table>
  </div>`;
}

/**
 * 装船指示（SI = Shipping Instruction，也叫「提单补料」）
 *
 * 用途：出货前发给货代/船公司，用来制作提单。截补料时间一过就要收改单费，所以
 * 「SI Cut-off」单独显著列出。
 * 必需信息（按客户给的资料）：
 *   SI NO./日期/订舱号/货代 → 船名航次 → POL/POD/交货地 → 三当事人（发货人/收货人/通知人）
 *   → 箱号/封号/件数/唛头 → 货物明细（品名/HS/数量/重量体积）→ 出单方式/运费条款 → 特别指示
 */
/**
 * 申报要素表（报关资料用）
 *
 * 客户给的参考：一张横向表格，列是
 *   HS code / 品牌类型 / 出口享惠情况 / 用途 / 材质 / 名称 / 型号 / 规格 / GTIN / CAS / 其他
 * 冷链类产品还会多「容积L / 最低温度℃」之类 —— 所以支持**自定义列**（doc.extraCols）。
 *
 * 数据来源：产品库里存过申报要素的产品，勾选后自动填到这张表；也可以手填。
 */
function renderDeclarationElements(doc, tpl) {
  const zh = doc.docLang === 'zh';
  const L = (z, e) => (zh ? z : e);
  const v = (x) => esc(String(x == null ? '' : x));
  const has = (x) => String(x == null ? '' : x).trim() !== '';
  const items = (doc.items || []).filter((it) => has(it.description) || has(it.hsCode));
  const extra = Array.isArray(doc.extraCols) ? doc.extraCols : [];

  // 列宽用「权重」算百分比：横向 A4 上 12 列也不会被切掉（固定列宽会被裁）
  const cols = [
    { key: 'hsCode', label: L('HS code', 'HS Code'), w: 9 },
    { key: 'brandType', label: L('品牌类型', 'Brand Type'), w: 7 },
    { key: 'preferential', label: L('出口享惠情况', 'Preferential'), w: 8 },
    { key: 'usagePurpose', label: L('用途', 'Use'), w: 15 },
    { key: 'material', label: L('材质', 'Material'), w: 6 },
    { key: 'description', label: L('名称', 'Name'), w: 14 },
    { key: 'model', label: L('型号', 'Model'), w: 9 },
    { key: 'specText', label: L('规格', 'Spec'), w: 10 },
    { key: 'gtin', label: 'GTIN', w: 5 },
    { key: 'cas', label: 'CAS', w: 4 },
    { key: 'remark', label: L('其他', 'Others'), w: 9 },
  ].filter((c) => !(doc.showCols && doc.showCols[c.key] === false))
    .concat(extra.map((c) => ({ key: `ext:${c.id}`, label: c.label, w: 7 }))
      .filter((c) => !(doc.showCols && doc.showCols[c.key] === false)));
  // 列顺序：用户在「表格列」里调过就按他的（如把"容积L"提到前面），没调过用默认
  if (Array.isArray(doc.colOrder) && doc.colOrder.length) {
    const rank = new Map(doc.colOrder.map((k, i) => [k, i]));
    cols.sort((a, b) => {
      const ra = rank.has(a.key) ? rank.get(a.key) : 999;
      const rb = rank.has(b.key) ? rank.get(b.key) : 999;
      return ra - rb;
    });
  }
  const wSum = cols.reduce((s, x) => s + x.w, 0) || 1;
  const pct = (w) => (Math.round((w / wSum) * 10000) / 100).toFixed(2) + '%';

  const cellText = (it, key) => {
    if (String(key).startsWith('ext:')) {
      const id = String(key).slice(4);
      return (it.ext && it.ext[id]) || '';
    }
    return it[key] || '';
  };

  const head = cols.map((c) => `<th style="width:${pct(c.w)}">${v(c.label)}</th>`).join('');
  const rows = items.length
    ? items.map((it, i) => `<tr>
        <td class="de-no">${i + 1}</td>
        ${cols.map((c) => `<td class="${['hsCode', 'gtin', 'cas'].includes(c.key) ? 'de-code' : 'de-txt'}">${v(cellText(it, c.key))}</td>`).join('')}
      </tr>`).join('')
    : `<tr><td colspan="${cols.length + 1}" class="de-empty">${v(L('（还没有产品：点左侧「📋 从产品库勾选」导入）', '(No rows yet — use "Pick from product library")'))}</td></tr>`;

  const dir = tpl.dir || 'ltr';
  return `<div class="doc-root doc-de" dir="${dir}" lang="${doc.docLang}">
    <div class="de-head">
      <div class="de-title">${v(L('申报要素表', 'DECLARATION ELEMENTS'))}</div>
      <div class="de-meta">
        ${v(L('单号', 'No.'))}：${v(doc.docNo || '')} &nbsp;·&nbsp;
        ${v(L('日期', 'Date'))}：${v(doc.date || '')} &nbsp;·&nbsp;
        ${L('共', 'Total')} ${v(String(items.length))} ${v(L('项', 'item(s)'))}
      </div>
    </div>
    <table class="de-table">
      <colgroup><col style="width:3%">${cols.map((c) => `<col style="width:${pct(c.w)}">`).join('')}</colgroup>
      <thead><tr><th class="de-no">${v(L('项号', 'No.'))}</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="de-foot">
      ${v(L('说明：品牌没有就写「无品牌」；享受优惠关税的如实填写，没有写「无出口享惠」。', 'Note: write "No brand" if unbranded; state preferential tariff honestly, otherwise "No preference".'))}
    </div>
  </div>`;
}

function renderShippingInstruction(doc, tpl) {
  const zh = doc.docLang === 'zh';
  const L = (z, e) => (zh ? z : e);
  const v = (x) => esc(String(x == null ? '' : x));
  const has = (x) => String(x == null ? '' : x).trim() !== '';
  const s = doc.seller || {};
  const b = doc.buyer || {};
  const consignee = (doc.consignee && has(doc.consignee.companyName)) ? doc.consignee : b;
  const notify = (doc.notify && has(doc.notify.companyName)) ? doc.notify : null;
  const items = (doc.items || []).filter((it) => has(it.description) || has(it.hsCode) || has(it.marks));
  const tt = doc.totals || {};

  const addrOf = (p) => [p.address, [p.city, p.state, p.zip].filter((x) => has(x)).join(' '), p.country]
    .filter((x) => has(x)).join(', ');

  /** 一个「标签 + 值」的小格 */
  const cell = (label, value, span = 1) =>
    `<td class="si-c" colspan="${span}"><div class="si-k">${v(label)}</div><div class="si-v">${has(value) ? v(value) : '&nbsp;'}</div></td>`;
  const row = (...cells) => `<tr>${cells.join('')}</tr>`;

  /** 当事人块 */
  const party = (title, p) => {
    if (!p) return '';
    const lines = [
      has(p.companyName) ? v(`${L('公司名称', 'Company')}：${p.companyName}`) : '',
      has(addrOf(p)) ? v(`${L('地址', 'Address')}：${addrOf(p)}`) : '',
      [p.contact, p.tel, p.email].filter((x) => has(x)).length
        ? v(`${L('联系人 / 电话 / 邮箱', 'Contact / Tel / Email')}：${[p.contact, p.tel, p.email].filter((x) => has(x)).join(' / ')}`) : '',
    ].filter(Boolean);
    return `<div class="si-party">
      <div class="si-party-t">${v(title)}</div>
      ${lines.map((x) => `<div class="si-line">${x}</div>`).join('') || '<div class="si-line">&nbsp;</div>'}
    </div>`;
  };

  const goodsRows = items.length
    ? items.map((it, i) => `<tr>
        <td>${i + 1}</td>
        <td class="l">${v(it.description)}${has(it.size) ? `<div class="si-sub">${v(L('规格', 'Spec'))}：${v(it.size)}</div>` : ''}${has(it.model) ? `<div class="si-sub">${v(L('型号', 'Model'))}：${v(it.model)}</div>` : ''}</td>
        <td>${v(it.hsCode)}</td>
        <td class="n">${has(it.qty) ? v(qty(it.qty)) : ''} ${v(it.unit || '')}</td>
        <td class="n">${has(it.ctns) ? v(qty(it.ctns)) : ''} ${v(it.packUnit || doc.packageType || 'CTNS')}</td>
        <td class="n">${has(it.gw) ? v(qty(it.gw)) : ''}</td>
        <td class="n">${has(it.meas) ? v(qty(it.meas)) : ''}</td>
      </tr>`).join('')
    : `<tr><td colspan="7" class="c">—</td></tr>`;

  const gw = has(doc.totalGrossWeight) ? doc.totalGrossWeight : (tt.totalGw || '');
  const meas = has(doc.totalMeasurement) ? doc.totalMeasurement : (tt.totalMeas || '');
  const pkgs = has(doc.totalPkgs) ? doc.totalPkgs : (tt.totalQty || '');

  const dir = tpl.dir || 'ltr';
  return `<div class="doc-root doc-si" dir="${dir}" lang="${doc.docLang}">
    <div class="si-head">
      <div class="si-title">${v(L('装船指示', 'SHIPPING INSTRUCTION'))}<span class="si-title-en">${v(L('SHIPPING INSTRUCTION（提单补料）', '提单补料 / 用于制作提单'))}</span></div>
      <div class="si-no">${v(L('SI 编号', 'SI No.'))}：${v(doc.siNo || doc.docNo || '')}<br />${v(L('日期', 'Date'))}：${v(doc.date || '')}</div>
    </div>

    ${has(doc.siCutoff)
      ? `<div class="si-cutoff">⏰ ${v(L('截补料时间（SI Cut-off）', 'SI Cut-off'))}：<b>${v(doc.siCutoff)}</b>
          <span class="si-cutoff-h">${v(L('超过这个时间再改，船公司会收改单费', 'Amendments after this time incur amendment fees'))}</span></div>`
      : ''}

    <table class="si-t"><tbody>
      ${row(cell(L('订舱号', 'Booking No.'), doc.bookingNo, 1), cell(L('货代 / 船公司', 'Forwarder / Carrier'), doc.forwarder, 1), cell(L('货代联系方式', 'Forwarder Contact'), doc.forwarderContact, 2))}
      ${row(cell(L('船名 Vessel', 'Vessel'), doc.vessel, 1), cell(L('航次 Voyage', 'Voyage No.'), doc.voyageNo, 1), cell(L('装运日期', 'Date of Shipment'), doc.dateOfShipment, 1), cell(L('运费条款', 'Freight Terms'), doc.freightTerms, 1))}
      ${row(cell(L('装运港 POL', 'Port of Loading'), doc.portOfLoading, 1), cell(L('目的港 POD', 'Port of Discharge'), doc.portOfDischarge, 1), cell(L('交货地', 'Place of Delivery'), doc.placeOfDelivery, 1), cell(L('出单方式', 'Release Type'), doc.releaseType, 1))}
    </tbody></table>

    <div class="si-parties">
      ${party(L('发货人 SHIPPER', 'SHIPPER'), s)}
      ${party(L('收货人 CONSIGNEE', 'CONSIGNEE'), consignee)}
      ${party(L('通知人 NOTIFY PARTY', 'NOTIFY PARTY'), notify)}
    </div>

    <table class="si-t"><tbody>
      ${row(cell(L('箱号 Container No.', 'Container No.'), doc.containerNo, 1), cell(L('封号 Seal No.', 'Seal No.'), doc.sealNo, 1), cell(L('件数 / 包装', 'Packages'), has(pkgs) ? String(pkgs) : (has(doc.packageType) ? `— ${doc.packageType}` : ''), 1), cell(L('总毛重 / 体积', 'G.W. / Meas.'), [gw, meas].filter((x) => has(x)).join(' / '), 1))}
    </tbody></table>

    <div class="si-marks"><span class="si-k">${v(L('唛头 Marks & Nos.', 'Marks & Nos.'))}</span>
      <div class="si-v">${has(doc.marks) ? escLines(doc.marks).replace(/\n/g, '<br>') : v(L('N/M', 'N/M'))}</div></div>

    <table class="si-items">
      <thead><tr>
        <th style="width:34px">${v(L('项号', 'No.'))}</th>
        <th>${v(L('货物描述', 'Description of Goods'))}</th>
        <th style="width:92px">${v(L('HS 编码', 'HS Code'))}</th>
        <th style="width:78px">${v(L('数量', 'Qty'))}</th>
        <th style="width:74px">${v(L('件数', 'Pkgs'))}</th>
        <th style="width:64px">${v(L('毛重', 'G.W.'))}</th>
        <th style="width:64px">${v(L('体积', 'Meas.'))}</th>
      </tr></thead>
      <tbody>${goodsRows}</tbody>
    </table>

    ${has(doc.specialInstructions) ? `<div class="si-block"><span class="si-k">${v(L('特殊指示', 'Special Instructions'))}</span><div class="si-v">${escLines(doc.specialInstructions).replace(/\n/g, '<br>')}</div></div>` : ''}
    ${has(doc.remarks) ? `<div class="si-block"><span class="si-k">${v(L('备注', 'Remarks'))}</span><div class="si-v">${escLines(doc.remarks).replace(/\n/g, '<br>')}</div></div>` : ''}

    <div class="si-sign">
      <div class="si-sign-l">${v(L('发货人签章', 'Shipper (signature / stamp)'))}</div>
      <div class="si-sign-r">${v(L('货代确认', 'Forwarder confirmed'))}</div>
    </div>
    <div class="si-foot">${v(L('本指示用于制作提单，请按以上信息填制 B/L；如需更改请及时通知。', 'This instruction is used to issue the B/L. Please notify us of any change as soon as possible.'))}</div>
  </div>`;
}

/**
 * 装船通知（SA = Shipping Advice）
 *
 * 用途：开船后发给国外客户，告知货已装船 + 船名航次 + ETD/ETA，方便客户投保、清关、提货。
 * CFR / FOB 条件下尤其重要（客户拿它去买保险）。
 * 必需信息：发货人 / 收货人 / 通知日期 / 装运信息（装运日期、装运港、目的港、船名航次、提单号）
 *           / 货物描述 / 运输方式 / 文件参考（提单号、合同号、发票号）/ 特殊说明
 */
function renderShippingAdvice(doc, tpl) {
  const zh = doc.docLang === 'zh';
  const L = (z, e) => (zh ? z : e);
  const v = (x) => esc(String(x == null ? '' : x));
  const has = (x) => String(x == null ? '' : x).trim() !== '';
  const s = doc.seller || {};
  const b = doc.buyer || {};
  const consignee = (doc.consignee && has(doc.consignee.companyName)) ? doc.consignee : b;
  const notify = (doc.notify && has(doc.notify.companyName)) ? doc.notify : null;
  const items = (doc.items || []).filter((it) => has(it.description));
  const tt = doc.totals || {};

  const addrOf = (p) => [p.address, [p.city, p.state, p.zip].filter((x) => has(x)).join(' '), p.country]
    .filter((x) => has(x)).join(', ');

  const kv = (label, value) =>
    `<tr><td class="sa-k">${v(label)}</td><td class="sa-v">${has(value) ? v(value) : '&nbsp;'}</td></tr>`;

  const goodsRows = items.length
    ? items.map((it, i) => `<tr>
        <td>${i + 1}</td>
        <td class="l">${v(it.description)}${has(it.model) ? ` (${v(it.model)})` : ''}</td>
        <td>${v(it.hsCode)}</td>
        <td class="n">${has(it.qty) ? v(qty(it.qty)) : ''} ${v(it.unit || '')}</td>
        <td class="n">${has(it.ctns) ? v(qty(it.ctns)) : ''} ${v(it.packUnit || 'CTNS')}</td>
        <td class="n">${has(it.gw) ? v(qty(it.gw)) : (has(it.nw) ? v(qty(it.nw)) : '')}</td>
      </tr>`).join('')
    : `<tr><td colspan="6" class="c">—</td></tr>`;

  const dir = tpl.dir || 'ltr';
  return `<div class="doc-root doc-sa" dir="${dir}" lang="${doc.docLang}">
    <div class="sa-head">
      <div class="sa-from">
        <div class="sa-co">${v(s.companyName || '')}</div>
        ${has(addrOf(s)) ? `<div class="sa-line">${v(addrOf(s))}</div>` : ''}
        ${[s.tel, s.email].filter((x) => has(x)).length ? `<div class="sa-line">${v(L('电话 / 邮箱', 'Tel / Email'))}：${v([s.tel, s.email].filter((x) => has(x)).join(' / '))}</div>` : ''}
      </div>
      <div class="sa-title-wrap">
        <div class="sa-title">${v(L('装 船 通 知', 'SHIPPING ADVICE'))}</div>
        <div class="sa-meta">
          ${v(L('编号', 'Our Ref.'))}：${v(doc.docNo || '')}<br />
          ${v(L('通知日期', 'Date of Advice'))}：${v(doc.date || '')}
        </div>
      </div>
    </div>

    <div class="sa-to">
      <div class="sa-k">${v(L('致（收货人）', 'To (Consignee)'))}</div>
      <div class="sa-co">${v(consignee.companyName || '')}</div>
      ${has(addrOf(consignee)) ? `<div class="sa-line">${v(addrOf(consignee))}</div>` : ''}
      ${[consignee.contact, consignee.tel, consignee.email].filter((x) => has(x)).length
        ? `<div class="sa-line">${v([consignee.contact, consignee.tel, consignee.email].filter((x) => has(x)).join(' / '))}</div>` : ''}
      ${notify ? `<div class="sa-line sa-notify">${v(L('通知人', 'Notify Party'))}：${v([notify.companyName, addrOf(notify)].filter((x) => has(x)).join('，'))}</div>` : ''}
    </div>

    <p class="sa-p">${v(L(
      '兹通知，下列货物已于下述时间装船出运，请查收并安排后续投保 / 清关 / 提货事宜。',
      'We hereby advise you that the following goods have been shipped as below. Please arrange insurance / customs clearance / delivery accordingly.',
    ))}</p>

    <div class="sa-grid">
      <table class="sa-t"><tbody>
        <tr><td class="sa-th" colspan="2">${v(L('一、装运信息', '1. Shipping Information'))}</td></tr>
        ${kv(L('装运日期 Date of Shipment', 'Date of Shipment'), doc.dateOfShipment)}
        ${kv(L('船名 Vessel', 'Vessel'), doc.vessel)}
        ${kv(L('航次 Voyage No.', 'Voyage No.'), doc.voyageNo)}
        ${kv(L('装运港 Port of Loading', 'Port of Loading'), doc.portOfLoading)}
        ${kv(L('目的港 Port of Discharge', 'Port of Discharge'), doc.portOfDischarge)}
        ${kv(L('交货地 Place of Delivery', 'Place of Delivery'), doc.placeOfDelivery)}
      </tbody></table>
      <table class="sa-t"><tbody>
        <tr><td class="sa-th" colspan="2">${v(L('二、船期与运输方式', '2. Schedule & Mode'))}</td></tr>
        ${kv(L('预计开船 ETD', 'ETD'), doc.etd)}
        ${kv(L('预计到港 ETA', 'ETA'), doc.eta)}
        ${kv(L('运输方式', 'Mode of Transport'), doc.modeOfTransport)}
        ${kv(L('提（运）单号', 'B/L No.'), doc.blNo)}
        ${kv(L('订舱号', 'Booking No.'), doc.bookingNo)}
        ${kv(L('集装箱号', 'Container No.'), doc.containerNo)}
      </tbody></table>
    </div>

    <div class="sa-sec">${v(L('三、货物描述', '3. Description of Goods'))}</div>
    <table class="sa-items">
      <thead><tr>
        <th style="width:34px">${v(L('项号', 'No.'))}</th>
        <th>${v(L('品名 / 型号', 'Description / Model'))}</th>
        <th style="width:92px">${v(L('HS 编码', 'HS Code'))}</th>
        <th style="width:88px">${v(L('数量', 'Qty'))}</th>
        <th style="width:80px">${v(L('件数', 'Pkgs'))}</th>
        <th style="width:72px">${v(L('毛重', 'G.W.'))}</th>
      </tr></thead>
      <tbody>${goodsRows}</tbody>
      <tfoot><tr>
        <td colspan="3" class="r">${v(L('合计', 'TOTAL'))}</td>
        <td class="n">${v(qty(tt.totalQty || 0))}</td>
        <td class="n">${v(has(doc.totalPkgs) ? doc.totalPkgs : '')}</td>
        <td class="n">${v(has(doc.totalGrossWeight) ? doc.totalGrossWeight : (tt.totalGw || ''))}</td>
      </tr></tfoot>
    </table>

    <div class="sa-grid">
      <table class="sa-t"><tbody>
        <tr><td class="sa-th" colspan="2">${v(L('四、文件参考', '4. Document Reference'))}</td></tr>
        ${kv(L('合同号 Contract No.', 'Contract No.'), doc.contractNo)}
        ${kv(L('发票号 Invoice No.', 'Invoice No.'), doc.invoiceNo)}
        ${kv(L('提单号 B/L No.', 'B/L No.'), doc.blNo)}
      </tbody></table>
      <table class="sa-t"><tbody>
        <tr><td class="sa-th" colspan="2">${v(L('五、保险与说明', '5. Insurance & Instructions'))}</td></tr>
        ${kv(L('投保提示', 'Insurance'), doc.insuranceNote || L('CFR / FOB 条款下请买方自行投保', 'Under CFR / FOB the buyer is to cover insurance'))}
        <tr><td class="sa-k">${v(L('唛头', 'Marks & Nos.'))}</td><td class="sa-v sa-marks">${has(doc.marks) ? escLines(doc.marks).replace(/\n/g, '<br>') : '&nbsp;'}</td></tr>
      </tbody></table>
    </div>

    ${has(doc.specialInstructions) ? `<div class="sa-sec">${v(L('六、特殊说明', '6. Special Instructions'))}</div>
      <div class="sa-note">${escLines(doc.specialInstructions).replace(/\n/g, '<br>')}</div>` : ''}

    <div class="sa-sign">
      <div class="sa-sign-l">${v(L('发货人（签章）', 'Shipper (signature / stamp)'))}</div>
      <div class="sa-sign-r">${v(s.companyName || '')}</div>
    </div>
  </div>`;
}

/**
 * 融合 TradeKit 新增单据的特有字段区（提单 / 原产地证明 / 报关单 / 证书类 / 保险单）
 * 按类型读取 extraDocFields 中非空的字段，以「标签 → 值」表格呈现。
 * block 字段（声明类）整段换行显示，其余单行。
 */
export const EXTENDED_FIELDS = {
  shipping_instruction: [
    { key: 'siNo', en: 'SI No.', zh: 'SI 编号' },
    { key: 'siCutoff', en: 'SI Cut-off', zh: '截补料时间' },
    { key: 'bookingNo', en: 'Booking No.', zh: '订舱号' },
    { key: 'forwarder', en: 'Forwarder', zh: '货代 / 船公司' },
    { key: 'forwarderContact', en: 'Forwarder Contact', zh: '货代联系方式' },
    { key: 'vessel', en: 'Vessel', zh: '船名' },
    { key: 'voyageNo', en: 'Voyage No.', zh: '航次' },
    { key: 'portOfLoading', en: 'Port of Loading', zh: '装运港 POL' },
    { key: 'portOfDischarge', en: 'Port of Discharge', zh: '目的港 POD' },
    { key: 'placeOfDelivery', en: 'Place of Delivery', zh: '交货地' },
    { key: 'dateOfShipment', en: 'Date of Shipment', zh: '装运日期' },
    { key: 'containerNo', en: 'Container No.', zh: '集装箱号' },
    { key: 'sealNo', en: 'Seal No.', zh: '铅封号' },
    { key: 'packageType', en: 'Package Type', zh: '包装种类（CTNS/PLTS）' },
    { key: 'totalPkgs', en: 'Total Packages', zh: '总件数' },
    { key: 'totalGrossWeight', en: 'Total G.W.', zh: '总毛重' },
    { key: 'totalMeasurement', en: 'Total Meas.', zh: '总体积' },
    { key: 'marks', en: 'Marks & Nos.', zh: '唛头（没有写 N/M）' },
    { key: 'goodsDescription', en: 'Description of Goods', zh: '货物描述' },
    { key: 'hsCode', en: 'HS Code', zh: 'HS 编码' },
    { key: 'releaseType', en: 'Release Type', zh: '出单方式（电放/SWB/正本）' },
    { key: 'freightTerms', en: 'Freight Terms', zh: '运费条款（PREPAID/COLLECT）' },
    { key: 'specialInstructions', en: 'Special Instructions', zh: '特殊指示' },
    { key: 'remarks', en: 'Remarks', zh: '备注' },
  ],
  shipping_advice: [
    { key: 'bookingNo', en: 'Booking No.', zh: '订舱号' },
    { key: 'vessel', en: 'Vessel', zh: '船名' },
    { key: 'voyageNo', en: 'Voyage No.', zh: '航次' },
    { key: 'portOfLoading', en: 'Port of Loading', zh: '装运港' },
    { key: 'portOfDischarge', en: 'Port of Discharge', zh: '目的港' },
    { key: 'placeOfDelivery', en: 'Place of Delivery', zh: '交货地' },
    { key: 'etd', en: 'ETD', zh: '预计开船 ETD' },
    { key: 'eta', en: 'ETA', zh: '预计到港 ETA' },
    { key: 'dateOfShipment', en: 'Date of Shipment', zh: '装运日期' },
    { key: 'modeOfTransport', en: 'Mode of Transport', zh: '运输方式（海运/空运/陆运）' },
    { key: 'blNo', en: 'B/L No.', zh: '提单号' },
    { key: 'containerNo', en: 'Container No.', zh: '集装箱号' },
    { key: 'totalPkgs', en: 'Total Packages', zh: '总件数' },
    { key: 'totalGrossWeight', en: 'Total G.W.', zh: '总毛重' },
    { key: 'contractNo', en: 'Contract No.', zh: '合同号' },
    { key: 'invoiceNo', en: 'Invoice No.', zh: '发票号' },
    { key: 'insuranceNote', en: 'Insurance', zh: '投保提示' },
    { key: 'marks', en: 'Marks & Nos.', zh: '唛头' },
    { key: 'specialInstructions', en: 'Special Instructions', zh: '特殊说明' },
    { key: 'remarks', en: 'Remarks', zh: '备注' },
  ],
  bill_of_lading: [
    { key: 'shipperRef', en: 'Shipper Ref', zh: '发货人参考' },
    { key: 'bookingNo', en: 'Booking No.', zh: '订舱号 / 托运编号' },
    { key: 'drNo', en: 'D/R No.', zh: '场站收据编号' },
    { key: 'containerOwner', en: 'Container Owner', zh: '箱属公司' },
    { key: 'blType', en: 'B/L Type', zh: '提单类型（ORIGINAL 正本 / TELEX RELEASE 电放 / SEAWAYBILL）' },
    { key: 'preCarriageBy', en: 'Pre-Carriage By', zh: '4. 前程运输（驳船名）' },
    { key: 'placeOfReceipt', en: 'Place of Receipt', zh: '5. 收货地' },
    { key: 'vessel', en: 'Ocean Vessel', zh: '6. 船名' },
    { key: 'voyageNo', en: 'Voyage No.', zh: '6. 航次' },
    { key: 'portOfLoading', en: 'Port of Loading', zh: '7. 装货港' },
    { key: 'portOfDischarge', en: 'Port of Discharge', zh: '8. 卸货港' },
    { key: 'placeOfDelivery', en: 'Place of Delivery', zh: '9. 交货地' },
    { key: 'finalDestination', en: 'Final Destination', zh: '10. 目的地' },
    { key: 'totalInWords', en: 'Total in Words', zh: '16. 总件数（大写）' },
    { key: 'freightTerms', en: 'Freight Terms', zh: '17. 运费条款（PREPAID / COLLECT）' },
    { key: 'revenueTons', en: 'Revenue Tons', zh: '17. 运费吨' },
    { key: 'rate', en: 'Rate', zh: '17. 运费率' },
    { key: 'per', en: 'Per', zh: '17. 计费单位' },
    { key: 'prepayAmount', en: 'Prepaid Amount', zh: '17. 运费预付金额' },
    { key: 'collectAmount', en: 'Collect Amount', zh: '17. 运费到付金额' },
    { key: 'prepaidAt', en: 'Prepaid At', zh: '预付地点' },
    { key: 'payableAt', en: 'Payable At', zh: '到付地点' },
    { key: 'placeOfIssue', en: 'Place of Issue', zh: '18. 出单地点' },
    { key: 'dateOfIssue', en: 'Date of Issue', zh: '18. 出单日期', date: true },
    { key: 'totalPrepaid', en: 'Total Prepaid', zh: '预付总金额' },
    { key: 'numberOfOriginal', en: 'No. of Original B(s)L', zh: '19. 正本提单份数（标准 3 份）' },
    { key: 'dateOfShipment', en: 'Date of Shipment', zh: '20. 装船日期', date: true },
    { key: 'loadingOnBoardBy', en: 'Loading on Board by', zh: '21. 装船船名' },
    { key: 'containerInfo', en: 'Container Info', zh: '集装箱/箱型（如 CY-CY 45G1*1）' },
    { key: 'shippingClause', en: 'Shipping Clause', zh: '装运条款（如 SHIPPER LOAD, COUNT & SEAL.）' },
    { key: 'carrierName', en: 'Carrier', zh: '承运人' },
    { key: 'carrierSignatureDate', en: 'Carrier Date', zh: '22. 承运人签发日期', date: true },
    { key: 'signingAgent', en: 'Signed by', zh: '22. 签章人 / 代理' },
    { key: 'declaration', en: 'Declaration', zh: '声明', block: true },
  ],
  certificate_of_origin: [
    { key: 'issuingAuthority', en: 'Issuing Authority', zh: '签发机构' },
    { key: 'originCountry', en: 'Country of Origin', zh: '原产国' },
    { key: 'goodsReferenceNo', en: 'Goods Reference No.', zh: '商品参考号' },
    { key: 'transportRoute', en: 'Transport Route', zh: '运输路线' },
    { key: 'declaration', en: 'Declaration', zh: '产地声明', block: true },
  ],
  /* 报关单：对照 exradoc 的「报关单 / 报关资料工具」两页补齐
   * 境内发货人取卖方、境外收货人取买方、合同号/发票号/币制/成交方式/唛头等走通用字段，
   * 这里只列它专有的那些（空值不打印） */
  customs_declaration: [
    { key: 'declarationType', en: 'Declaration Type', zh: '申报类型' },
    { key: 'consignmentNo', en: 'Consignment No.', zh: '报关单号' },
    { key: 'recordNo', en: 'Record No.', zh: '备案号' },
    { key: 'licenseNo', en: 'License No.', zh: '许可证号' },
    { key: 'supervisionMode', en: 'Supervision Mode', zh: '监管方式' },
    { key: 'tradeMode', en: 'Trade Mode', zh: '贸易方式' },
    { key: 'dutyNature', en: 'Duty Nature', zh: '征免性质' },
    { key: 'tradeCountry', en: 'Trade Country', zh: '贸易国' },
    { key: 'destinationCountry', en: 'Destination Country', zh: '运抵国' },
    { key: 'exitCustoms', en: 'Exit Customs', zh: '出境关别' },
    { key: 'exitPort', en: 'Exit Port', zh: '离境口岸' },
    { key: 'destPort', en: 'Destination Port', zh: '指运港' },
    { key: 'shippingMethod', en: 'Transport Mode', zh: '运输方式' },
    { key: 'vesselVoyage', en: 'Vessel / Voyage', zh: '运输工具' },
    { key: 'blNo', en: 'B/L No.', zh: '提运单号' },
    { key: 'packageType', en: 'Package Type', zh: '包装种类' },
    { key: 'shippingFee', en: 'Freight', zh: '运费' },
    { key: 'otherFee', en: 'Misc. Fee', zh: '杂费' },
    { key: 'declarationDate', en: 'Declaration Date', zh: '申报日期', date: true },
    { key: 'exportDate', en: 'Export Date', zh: '出口日期', date: true },
    { key: 'declarantName', en: 'Declarant', zh: '申报人' },
    { key: 'declarantCode', en: 'Declarant Code', zh: '申报人代码' },
    { key: 'declarantPhone', en: 'Declarant Tel', zh: '申报人电话' },
    { key: 'producerName', en: 'Producer', zh: '生产销售单位' },
    { key: 'producerCode', en: 'Producer Code', zh: '生产销售单位代码' },
    { key: 'shipperCreditCode', en: 'Shipper Credit Code', zh: '发货人统一社会信用代码' },
    { key: 'attachedDocs', en: 'Attached Documents', zh: '随附单证' },
    { key: 'declarantSignature', en: 'Declarant Signature', zh: '申报人签章' },
    { key: 'signatureDate', en: 'Signature Date', zh: '签章日期', date: true },
    { key: 'declaration', en: 'Declaration', zh: '声明内容', block: true },
  ],
  inspection_certificate: [
    { key: 'inspectionOrg', en: 'Inspection Org', zh: '检验机构' },
    { key: 'inspectionDate', en: 'Inspection Date', zh: '检验日期', date: true },
    { key: 'inspectionStandard', en: 'Standard', zh: '检验标准' },
    { key: 'inspectionResult', en: 'Result', zh: '检验结果', block: true },
  ],
  fumigation_certificate: [
    { key: 'treatmentType', en: 'Treatment', zh: '处理类型' },
    { key: 'fumigationDate', en: 'Fumigation Date', zh: '熏蒸日期', date: true },
    { key: 'fumigationMethod', en: 'Method', zh: '熏蒸方法' },
    { key: 'chemicalUsed', en: 'Chemical', zh: '药剂' },
    { key: 'duration', en: 'Duration', zh: '熏蒸时长' },
  ],
  beneficiary_certificate: [
    { key: 'certificateType', en: 'Certificate Type', zh: '证明类型' },
    { key: 'certificateDate', en: 'Date', zh: '证明日期', date: true },
    { key: 'beneficiaryName', en: 'Beneficiary', zh: '受益人' },
    { key: 'declaration', en: 'Declaration', zh: '受益人声明', block: true },
  ],
  shipper_letter_instruction: [
    { key: 'bookingNo', en: 'Booking No.', zh: '订舱号' },
    { key: 'vessel', en: 'Vessel', zh: '船名' },
    { key: 'voyageNo', en: 'Voyage No.', zh: '航次' },
    { key: 'portOfLoading', en: 'Port of Loading', zh: '装货港' },
    { key: 'portOfDischarge', en: 'Port of Discharge', zh: '卸货港' },
    { key: 'cargoReadyDate', en: 'Cargo Ready Date', zh: '备货日期', date: true },
    { key: 'containerNo', en: 'Container No.', zh: '集装箱号' },
    { key: 'cargoDescription', en: 'Cargo Description', zh: '货物描述', block: true },
  ],
  insurance_policy: [
    { key: 'policyNo', en: 'Policy No.', zh: '保单号' },
    { key: 'insurer', en: 'Insurer', zh: '保险人' },
    { key: 'coverage', en: 'Coverage', zh: '险别' },
    { key: 'insuredAmount', en: 'Insured Amount', zh: '投保金额' },
    { key: 'premium', en: 'Premium', zh: '保费' },
    { key: 'totalInsuredValue', en: 'Total Insured Value', zh: '保险总值' },
    { key: 'claimPayableAt', en: 'Claim Payable At', zh: '索赔地点' },
    { key: 'issuedDate', en: 'Issue Date', zh: '出单日期', date: true },
  ],
};

function renderExtendedFields(doc, tpl) {
  const list = EXTENDED_FIELDS[doc.type];
  if (!list) return '';
  const zh = doc.docLang === 'zh';
  let cells = '';
  for (const f of list) {
    const v = doc[f.key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    const label = esc(zh ? f.zh : f.en);
    const value = f.block
      ? `<td style="line-height:1.5">${escLines(String(v))}</td>`
      : `<td>${esc(String(v))}</td>`;
    cells += `<tr><th style="width:140px">${label}</th>${value}</tr>`;
  }
  if (!cells) return '';
  return `<table class="doc-table doc-plain-info" style="margin-top:6px"><tbody>${cells}</tbody></table>`;
}

/**
 * 无金额名称类单据（融合 TradeKit）统一版式：
 * 提单 / 原产地证明 / 报关单 / 检验证书 / 熏蒸证书 / 受益人证明 / 发货人委托书 / 保险单
 * 复用通用块（头部 / 买卖双方 / 明细表 / 特有字段 / 备注签署 / 页脚），无金额合计与金额大写。
 */
function renderPlainDoc(doc, tpl) {
  const dir = tpl.dir || 'ltr';
  return `<div class="doc-root" dir="${dir}" lang="${doc.docLang}">
    ${renderHead(doc, tpl)}
    ${renderPartiesBlock(doc, tpl)}
    ${renderItems(doc, tpl)}
    ${renderExtendedFields(doc, tpl)}
    ${renderSections(doc, tpl)}
    ${renderSign(doc, tpl)}
    ${renderFoot(doc, tpl)}
  </div>`;
}

/**
 * 公司名自动适配：先按「一行」显示，量一下有没有超出，超了就一点点缩字号；
 * 缩到 7.5px 还放不下，才允许折行（避免长名字压到右边的单据标题上）。
 * 预览和打印都调用它。
 */

export function renderDocument(doc) {
  // 定制版三号：Sales Invoice Duplicate 走专用版式
  if (doc && doc.type === 'sales_invoice') return renderSalesInvoice(doc);
  if (!doc) return '<div class="empty-state"><div class="ico"></div><div class="msg">暂无单据</div></div>';
  const tpl = getTemplate(doc.docLang);
  const dir = tpl.dir || 'ltr';
  const packing = docMeta(doc.type).mode === 'packing';

  // 水单走专用版式（银行收付凭证：收款方 / 付款方 / 金额 / 手续费 / 附言）
  if (docMeta(doc.type).mode === 'bank') {
    return renderBankSlip(doc, tpl);
  }

  // 报关单走专用版式（对照「中华人民共和国海关出口货物报关单」的表格式样）
  if (doc.type === 'customs_declaration') {
    return renderCustoms(doc, tpl);
  }

  // 申报要素表（报关资料）：横向表格，列对齐客户给的参考表（支持自定义列）
  if (doc.type === 'declaration_elements') {
    return renderDeclarationElements(doc, tpl);
  }

  // 装船指示（SI = 提单补料）：出货前发给货代/船公司，用来制作提单
  if (doc.type === 'shipping_instruction') {
    return renderShippingInstruction(doc, tpl);
  }

  // 装船通知（SA）：开船后发给国外客户，告知已装船 + 船名航次 + ETD/ETA，便于投保和清关
  if (doc.type === 'shipping_advice') {
    return renderShippingAdvice(doc, tpl);
  }

  // 海运提单走专用版式（对照标准海运提单样本 4-1 的 1~22 栏目）
  if (doc.type === 'bill_of_lading') {
    return renderBillOfLading(doc, tpl);
  }

  // 装箱单走专用版式（对照真实 PL 模板：居中标题 + 明细信息表 +
  // 明细表带单位行 + 说明条款 1~6 条 + 买卖双方签字）
  if (packing) {
    // 装箱单默认走自己的版式（pl-info 表格：TO/Attn/Add/Tel 与 Date/INV/PO… 左右分栏，
    // 跟真实装箱单模板一致）。但**用户显式选了「两栏（含银行信息）」时改用通用块渲染器** ——
    // 否则这个开关在装箱单上点了没反应（用户诉求：每个单据都要能选）。
    const plLayout = doc.partyLayout || DEFAULT_PARTY_LAYOUT.pl;
    const plCustomer = (plLayout === 'split' && renderBeneficiaryBox(doc, tpl))
      ? renderPartiesBlock(doc, tpl)
      : renderPlCustomer(doc, tpl);
    return `<div class="doc-root doc-pl" dir="${dir}" lang="${doc.docLang}">
      ${renderPlHead(doc, tpl)}
      ${plCustomer}
      ${renderPlItems(doc, tpl)}
      ${renderPlTerms(doc, tpl)}
      ${renderPlSign(doc, tpl)}
    </div>`;
  }

  // PI / CI 头部多一排「清关参考信息」（PO / L/C / AWB / 出口国 / 贸易术语…）
  const withRefs = doc.type === 'pi' || doc.type === 'ci';

  // 无金额名称类单据（融合 TradeKit 新增：提单 / 原产地证明 / 报关单 / 证书类等）
  if (docMeta(doc.type).mode === 'plain') {
    return renderPlainDoc(doc, tpl);
  }

  return `<div class="doc-root" dir="${dir}" lang="${doc.docLang}">
    ${renderHead(doc, tpl)}
    ${withRefs ? renderExportRefs(doc, tpl) : ''}
    ${renderPartiesBlock(doc, tpl)}
    ${renderItems(doc, tpl)}
    ${renderSummary(doc, tpl)}
    ${renderWords(doc, tpl)}
    ${renderSections(doc, tpl)}
    ${renderSign(doc, tpl)}
    ${renderFoot(doc, tpl)}
  </div>`;
}

/** 单据配色（与 app.css 的主题一一对应，导出独立 HTML 时注入） */
export const THEME_DOC_VARS = {
  blue: { ink: '#16233a', ink2: '#242b36', soft: '#363c45', line: '#c8d1de', accent: '#1f5fd6', band: '#f2f5f9', headBg: '#dce4f0' },
  red: { ink: '#8c1c22', ink2: '#332022', soft: '#4c3739', line: '#e3c4c6', accent: '#c8232c', band: '#fdf2f2', headBg: '#f7dede' },
  green: { ink: '#14523f', ink2: '#22352f', soft: '#323f3b', line: '#bfd8cf', accent: '#16785f', band: '#f0f7f4', headBg: '#dbebe3' },
  purple: { ink: '#452a68', ink2: '#2d2439', soft: '#3f384a', line: '#d6c9e6', accent: '#6b3fa0', band: '#f6f2fb', headBg: '#e8dff5' },
  graphite: { ink: '#26262a', ink2: '#2d2d30', soft: '#3c3c3f', line: '#cfcac0', accent: '#9b6e24', band: '#f7f5f1', headBg: '#e9e4da' },
  navy: { ink: '#123253', ink2: '#213143', soft: '#323d49', line: '#c3d2e0', accent: '#1c4e80', band: '#f1f5f9', headBg: '#dbe5f1' },
  orange: { ink: '#854112', ink2: '#3a291e', soft: '#483a30', line: '#e6cdb6', accent: '#b95d1a', band: '#fdf5ee', headBg: '#fcf5ee' },
};

/* =============================================================
 * 单据字体
 *
 * ⚠️ 为什么把 Arial / Helvetica 放在 Segoe UI 前面：
 *   用户反馈「导出的单据里字母 l 是粗体，和其他字母完全不同」。
 *   机制：Segoe UI 的小写 l 是一条**无衬线的直竖**，而周围都是圆弧字母
 *   （o / e / a / c / s），在 10.5px 这种小字号下它的笔画密度最突出，
 *   看上去就像被单独加粗；它还被设计成「类似大写 I」，更显突兀。
 *   Arial / Helvetica 的 l 带一个右下小弯，字形辨识度和视觉重量都跟
 *   周围字母一致，小字号下不会跳出来。
 *   而且 Arial 跨平台（Windows / macOS / 移动端）都有，PDF 嵌入也更可控。
 *
 * 中日泰文仍排在后面做回退：英文字母会优先命中 Arial。
 * ============================================================= */
export const DOC_FONT = '"Helvetica Neue", Helvetica, Arial, "Segoe UI", '
  + '"Microsoft YaHei", "PingFang SC", "Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif';

/** 生成某主题的 :root 变量块（standalone 导出用，保证打印颜色与预览一致） */
export function themeVarsCss(theme = 'blue') {
  const t = THEME_DOC_VARS[theme] || THEME_DOC_VARS.blue;
  return `:root {
  --doc-ink: ${t.ink};
  --doc-ink-2: ${t.ink2};
  --doc-ink-soft: ${t.soft};
  --doc-line: ${t.line};
  --doc-accent: ${t.accent};
  --doc-band: ${t.band};
  --doc-head-bg: ${t.headBg || t.band};
}`;
}

/** 用于导出 PDF 的独立完整 HTML 文档（内嵌样式，方便打印 / 离线保存） */
export function renderStandaloneHtml(doc, extraCss = '', theme = 'blue') {
  const body = renderDocument(doc);
  const title = `${doc.docNo || doc.type}`;
  const standLand = !!docMeta(doc.type).landscape;
  return `<!DOCTYPE html>
<html lang="${doc.docLang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  @page { size: ${standLand ? 'A4 landscape' : 'A4'}; margin: 12mm; }
  * { box-sizing: border-box; }
  /* 打印/导出时保留背景色（Chrome 默认丢弃，见 css/app.css 里 @media print 的说明） */
  .doc-root, .doc-root * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { margin: 0; padding: 0; background: #fff; color: #101418;
    font-family: ${DOC_FONT}; font-size: 11px; line-height: 1.45; }
  .paper { width: auto; min-height: 0; box-shadow: none; padding: 0; }
  ${themeVarsCss(theme)}
  ${PAPER_CSS}
  ${extraCss}
</style>
</head>
<body><div class="paper">${body}</div></body>
</html>`;
}

/** 单据版式 CSS（预览与打印共用一份，保证一致） */
export const PAPER_CSS = `
${SI_CSS}

.doc-prepared { margin-top: 10px; font-size: 10.5px; color: var(--doc-ink-soft); text-align: right; }
.sign-block-right .sig-text { margin: 0; text-align: left; font-size: 10.5px; line-height: 1.55; color: var(--doc-ink); }


/* 报价单签署块：靠右，印章在上、签名在下 */
.sign-block-right { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-top: 12px; }
.sign-block-right .sig-mark-row { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.sign-block-right .sign-stamp { position: static; display: block; width: auto; height: auto; max-height: 66px; max-width: 120px; object-fit: contain; margin: 0; }
.sign-block-right .sign-inline { display: block; max-height: 52px; max-width: 180px; object-fit: contain; margin: 0; }


/* 报价单签署块：靠左，签名/印章在上、姓名职务日期在下 */
.sign-block-left { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 12px; text-align: left; }
.sign-block-left .sig-mark-row { display: flex; align-items: flex-end; gap: 12px; }
.sign-block-left .sign-stamp { position: static; display: block; width: auto; height: auto; max-height: 62px; max-width: 190px; object-fit: contain; margin: 0; }
.sign-block-left .sig-text { font-size: 10.5px; line-height: 1.6; color: var(--doc-ink); }

.doc-root { color: #101418; }
/* ==================== 装箱单专用版式（对照真实 PL 模板） ====================
   刻意与发票区分开：
     · 标题居中（发票是右上角）
     · 头部是 L/C NO. / INV NO. / CONTRACT NO. / INV DATE 四栏键值
     · 客户 TO 块与 ROUTE 行用表格边框包起来
     · 明细表表头带单位行（PCS / KGS / M3）
     · 底部逐行汇总（含原产国）+ 右下角盖章签字
   ========================================================================= */
.doc-pl .pl-head { display: flex; gap: 12px; align-items: flex-start; }
.doc-pl .pl-seller { flex: 1; min-width: 0; text-align: center; }
.doc-pl .pl-seller .cn { font-size: 14px; font-weight: 700; letter-spacing: .3px; }
.doc-pl .pl-seller .ln { font-size: 9.5px; color: var(--doc-ink-2); margin-top: 3px; line-height: 1.45; }
/* 装箱单卖方框里的「标签:」加粗（b 标签）—— 用深色而非粗体区分层次 */
.doc-pl .pl-seller .ln b { color: var(--doc-ink); font-weight: 400; }
.doc-pl .pl-title {
  text-align: center; font-size: 20px; font-weight: 700; letter-spacing: 2px;
  color: var(--doc-ink); margin: 11px 0 1px; text-transform: uppercase;
}
.doc-pl .pl-subtitle { text-align: center; font-size: 11px; letter-spacing: 2px; color: var(--doc-ink-2); margin-bottom: 9px; }
.doc-pl .pl-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 24px; margin: 9px 0 11px; padding: 0 10px; }
.doc-pl .pl-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: 7px; font-size: 10.5px; line-height: 1.55; }
.doc-pl .pl-meta .k { font-size: 9.5px; color: var(--doc-ink); font-weight: 400; white-space: nowrap; }
.doc-pl .pl-meta .v { font-weight: 400; border-bottom: 1px solid var(--doc-line); min-height: 1.55em; }
/* 装箱单明细信息表（TO/Attn/Add/Tel | Date/INV/PO…）
   ⚠️ 这几条必须和 css/app.css 里的同名规则保持一致，否则屏幕预览和导出的 HTML 版式不同。
   ⚠️ 「值」列要给 width:100%：空字段行被过滤掉后只剩一两条时，
      table-layout:auto 会把空行压到最小宽度，整张表只有 605px（纸面内宽 794px），
      右半边空着 —— 让值列吃掉剩余宽度，表才横跨整行。 */
.doc-pl table.pl-info { width: 100%; border-collapse: collapse; margin: 2px 0 8px; }
.doc-pl table.pl-info td { padding: 3px 6px; font-size: 10.5px; vertical-align: top; }
.doc-pl table.pl-info td.pl-lbl { width: 1%; white-space: nowrap; color: var(--doc-ink); font-weight: 400; }
.doc-pl table.pl-info td.pl-val { width: 100%; border-bottom: 1px solid var(--doc-line); min-width: 120px; }
/* ============ 海运提单（对照标准海运提单样本 4-1 的 1~22 栏目）
 * ⚠️ 必须和 css/app.css 里的 .doc-bl 规则保持一致（预览用那份，打印用这份） ============ */
.doc-bl { font-size: 9px; color: var(--doc-ink); }
.doc-bl .bl-title {
  text-align: center; font-weight: 800; font-size: 16px; letter-spacing: 3px;
  margin: 0 0 5px; color: var(--doc-ink);
}
.doc-bl .bl-title .bl-title-en { display: block; font-size: 10px; letter-spacing: 1px; font-weight: 400; color: var(--doc-ink-soft); }
.doc-bl table.bl-main { width: 100%; border-collapse: collapse; table-layout: fixed; }
.doc-bl table.bl-main th,
.doc-bl table.bl-main td {
  border: 1px solid var(--doc-line); padding: 2px 4px; vertical-align: top;
  text-align: left; line-height: 1.45; overflow-wrap: anywhere;
}
.doc-bl table.bl-main th {
  background: var(--doc-band); text-align: center; font-weight: 600; font-size: 8px;
  padding: 2px; vertical-align: middle;
}
.doc-bl .bl-k { font-size: 8px; color: var(--doc-ink); line-height: 1.3; }
.doc-bl .bl-k b { font-weight: 700; }
.doc-bl .bl-cn { color: var(--doc-ink-soft); font-size: 7.5px; margin-left: 3px; }
.doc-bl .bl-v { font-size: 9px; min-height: 13px; margin-top: 1px; }
.doc-bl .bl-line { font-size: 8.5px; line-height: 1.55; }
.doc-bl .bl-sub2 { font-size: 8px; color: var(--doc-ink-soft); }
.doc-bl .bl-hint { font-size: 7.5px; color: var(--doc-ink-soft); font-style: italic; }
.doc-bl .bl-blno { text-align: left; }
.doc-bl .bl-no { font-size: 12px; font-weight: 700; letter-spacing: .3px; }
.doc-bl .bl-carrier { margin-top: 5px; border-top: 1px dashed var(--doc-line); padding-top: 4px; }
.doc-bl .bl-carrier-nm { font-size: 11px; font-weight: 700; }
.doc-bl .bl-type { font-size: 9px; font-weight: 600; margin-top: 1px; }
.doc-bl .bl-sub { font-size: 8px; color: var(--doc-ink-soft); }
.doc-bl tr.bl-item-row td { text-align: center; vertical-align: middle; }
.doc-bl tr.bl-item-row td.l { text-align: left; }
.doc-bl .bl-onboard .bl-v { font-weight: 700; }
.doc-bl .bl-sign { text-align: center; }
.doc-bl .bl-stamp { max-height: 44px; max-width: 92px; display: block; margin: 3px auto 0; }

/* ============ 报关单（对照《中华人民共和国海关出口货物报关单》）
 * ⚠️ 必须和 css/app.css 里的 .doc-customs 规则保持一致（预览用那份，打印用这份） ============ */
.doc-customs { font-size: 9px; }
.doc-customs .cus-title {
  text-align: center; font-weight: 800; letter-spacing: 1px;
  font-size: 15px; margin: 0 0 4px; color: var(--doc-ink);
}
.doc-customs .cus-top {
  display: flex; justify-content: space-between; gap: 10px;
  font-size: 9px; margin: 0 0 3px; color: var(--doc-ink-soft);
}
.doc-customs table.cus-main { width: 100%; border-collapse: collapse; table-layout: fixed; }
.doc-customs table.cus-main th,
.doc-customs table.cus-main td {
  border: 1px solid var(--doc-line); padding: 2px 4px; vertical-align: top;
  text-align: left; line-height: 1.45;
  /* 必须能断行：HS 编码这种长串数字不能换行时会溢出到隔壁格子 */
  overflow-wrap: anywhere;
}
.doc-customs table.cus-main th {
  background: var(--doc-band); text-align: center; font-weight: 600;
  font-size: 8.5px; padding: 2px; white-space: normal;
}
.doc-customs .cus-k { font-size: 7.5px; color: var(--doc-ink-soft); line-height: 1.25; margin-bottom: 1px; }
.doc-customs .cus-v { font-size: 9px; min-height: 13px; overflow-wrap: anywhere; }
.doc-customs .cus-line { line-height: 1.55; overflow-wrap: anywhere; }
.doc-customs .cus-sub2 { font-size: 8px; color: var(--doc-ink-soft); margin-top: 1px; line-height: 1.4; }
/* 明细：商品名称加粗一点，规格/型号分成带前缀的小行，别挤成一坨 */
.doc-customs .cus-item-name { font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
/* 沿用单据级值的格子：淡色 + 「同单」标记 */
.doc-customs .cus-inherit { color: var(--doc-ink-soft); font-style: italic; }
.doc-customs .cus-inh-tag { font-size: 6.5px; font-style: normal; border: 1px solid var(--doc-line); border-radius: 2px; padding: 0 1px; margin-left: 2px; vertical-align: 1px; }
.doc-customs tr.cus-item-row td, .doc-customs tr.cus-total td { text-align: center; }
.doc-customs tr.cus-item-row td.l { text-align: left; }
.doc-customs tr.cus-item-row td { padding: 3px 4px; }
.doc-customs tr.cus-total td { font-weight: 700; background: var(--doc-band); }
.doc-customs .cus-sign { text-align: center; }
.doc-customs .cus-customs-remark .cus-v { min-height: 34px; }
.doc-customs .cus-stamp { max-height: 46px; max-width: 96px; display: block; margin: 3px auto 0; }

/* 客户 TO 块 / ROUTE 路由行 */
.doc-pl table.pl-box { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
.doc-pl table.pl-box td { border: 1px solid var(--doc-line); padding: 4px 7px; font-size: 10.5px; vertical-align: top; }
.doc-pl table.pl-box td.pl-lbl {
  width: 1%; white-space: nowrap; background: var(--doc-band);
  color: var(--doc-ink); font-size: 9.5px; font-weight: 400; vertical-align: middle;
}
.doc-pl table.pl-box td.pl-val { line-height: 1.5; }
/* 明细表：表头第二行是单位行 */
.doc-pl table.pl-table th { vertical-align: middle; }
.doc-pl table.pl-table tr.unit-tr th { font-size: 8.5px; font-weight: 400; padding: 2px 3px; opacity: .92; }
/* 底部汇总逐行列出 */
.doc-pl .pl-sums { margin-top: 8px; font-size: 10.5px; line-height: 1.8; }
.doc-pl .pl-sum .k { color: var(--doc-ink-soft); }
.doc-pl .pl-sum .v { font-weight: 400; }
.doc-pl .pl-packed { margin-top: 7px; font-size: 10.5px; font-weight: 400; }
/* 盖章与签字 */
.doc-pl .pl-sign {
  margin-top: 36px; display: flex; justify-content: flex-end; align-items: flex-end;
  gap: 10px; font-size: 10.5px; position: relative;
}
.doc-pl .pl-sign .lbl { color: var(--doc-ink-2); }
/* 买卖双方签字（底部两栏）—— 与 css/app.css 保持完全一致 */
.doc-pl .pl-sign2 { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; }
.doc-pl .pl-sign-col .ttl { font-size: 9.5px; font-weight: 400; color: var(--doc-ink); }
.doc-pl .pl-sign-col .box {
  height: 62px; margin-top: 4px; border-bottom: 1px solid var(--doc-ink); position: relative;
}
.doc-pl .pl-sign-col .sign-stamp {
  position: absolute; left: 6px; bottom: 0; width: 78px; height: 78px; object-fit: contain; opacity: .92;
}
.doc-pl .pl-sign .line {
  display: inline-block; min-width: 180px; border-bottom: 1px solid var(--doc-ink);
  height: 34px; position: relative;
}
.doc-pl .pl-sign .sign-stamp { position: absolute; left: 40px; bottom: 0; width: 84px; height: 84px; object-fit: contain; opacity: .92; }
.doc-head { display: flex; gap: 14px; align-items: flex-start; border-bottom: 2px solid var(--doc-ink); padding-bottom: 9px; }
.doc-logo { width: 74px; height: 74px; object-fit: contain; flex: 0 0 auto; }
.doc-logo.placeholder { border: 1px dashed var(--doc-line); border-radius: 3px; }
.doc-seller { flex: 1; min-width: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: 6px; align-content: start; }
.doc-seller .cn { grid-column: 1 / -1; font-size: 15px; font-weight: 700; }
.doc-seller .ln { display: contents; }
.doc-seller .ln .k { font-size: 9.5px; color: var(--doc-ink); font-weight: 400; line-height: 1.4; }
.doc-seller .ln .v { font-size: 10.5px; color: var(--doc-ink-2); line-height: 1.4; min-width: 0; }
.doc-title-box { text-align: right; flex: 0 0 auto; }
.doc-title { font-size: 19px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; color: var(--doc-ink); }
.doc-title-zh { font-size: 16px; letter-spacing: 2px; }
.doc-subtitle { font-size: 10px; color: var(--doc-ink-soft); margin-top: 2px; }
.doc-meta { display: flex; gap: 10px; margin-top: 8px; }
.doc-meta-col { flex: 1; }
.meta-line { display: flex; gap: 6px; font-size: 10.5px; padding: 1.5px 0; }
.meta-line .k { color: var(--doc-ink); font-weight: 400; min-width: 74px; }
.meta-line .v { font-weight: 400; }
.party-box { border: 1px solid var(--doc-line); border-radius: 3px; padding: 7px 9px; display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: 7px; align-content: start; }
.party-box .ttl, .party-box .nm { grid-column: 1 / -1; }
.party-box .ttl { font-size: 9.5px; font-weight: 700; letter-spacing: 1px; color: var(--doc-accent); text-transform: uppercase; margin-bottom: 3px; }
.party-box .nm { font-size: 11.5px; font-weight: 700; }
.party-box .ln { display: contents; }
.party-box .ln .k { font-size: 9.5px; color: var(--doc-ink); font-weight: 400; line-height: 1.4; }
.party-box .ln .v { font-size: 10.5px; color: var(--doc-ink-2); line-height: 1.4; min-width: 0; }
/* ⚠️ 这份 CSS 与 css/app.css 里的 .parties 规则必须保持一致，
   否则屏幕预览和导出的 PDF 版式会不一样。
   （单栏必须占满整行，否则只有一个框时右边空半张纸） */
.parties { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; margin-top: 9px; }
.parties.parties-1 { grid-template-columns: minmax(0, 1fr); }
.parties.parties-narrow { grid-template-columns: minmax(0, 62%); }
.parties.parties-2split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.parties.parties-3 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr); }
table.ref-table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
table.ref-table > tbody > tr > td.ref-col { border: none; padding: 0; vertical-align: top; width: 50%; }
table.ref-inner { width: 100%; border-collapse: collapse; }
table.ref-inner td { border: 1px solid var(--doc-line); padding: 3px 7px; font-size: 10px; vertical-align: middle; }
table.ref-inner td.k { background: var(--doc-band); color: var(--doc-ink); white-space: nowrap; width: 1%; font-weight: 400; }
table.ref-inner td.v { font-weight: 400; color: var(--doc-ink-2); word-break: break-word; }
.pkg-line { margin-top: 6px; font-size: 10.5px; color: var(--doc-ink-2); text-align: right; }
.pkg-line strong { color: var(--doc-ink); }
table.doc-table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: auto; }
/* ⚠️ 表头为什么用「浅底深字」而不是「深底白字」：
 *   Chrome 打印/导出 PDF 时**默认丢弃背景色**（打印对话框的「背景图形」默认不勾）。
 *   深底一丢，原本的白字就落在白纸上。实测 Chrome 会把这种白字改成 **#ababab**，
 *   对白底只有 2.30:1 —— 用户看到的就是「表头文字太浅、看不清」。
 *   实测数据（同一份单据打印两次对比）：
 *     不带背景 → #ababab 用了 62 次；带背景 → #ababab 0 次、#ffffff 62 次。
 *   改成浅底深字后，有没有背景都清楚，且不依赖用户的打印设置。
 *   （另外 @media print 里加了 print-color-adjust: exact 兜底，见下方）
 */
table.doc-table th { background: var(--doc-head-bg); color: var(--doc-ink); font-size: 9.5px; font-weight: 700; letter-spacing: .2px;
  padding: 5px 3px; border: 1px solid var(--doc-ink); text-align: center; word-break: normal;
  overflow-wrap: break-word; line-height: 1.25; }
table.doc-table td { border: 1px solid var(--doc-line); padding: 4px 5px; font-size: 10.5px; vertical-align: top; word-break: break-word; }
table.doc-table tbody tr:nth-child(even) td { background: #fafbfd; }
table.doc-table td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.doc-table td.ctr { text-align: center; }
table.doc-table td.desc { white-space: pre-wrap; }
table.doc-table .spec-lines { margin-top: 2px; font-size: 9.5px; color: var(--doc-ink-soft); line-height: 1.45; }
table.doc-table .spec-lines.sample { margin-top: 3px; padding-top: 2px; border-top: 1px dotted var(--doc-line); color: var(--doc-ink); }
table.doc-table .spec-note { margin-top: 2px; font-size: 9.5px; color: var(--doc-ink-2); font-style: italic; }
table.doc-table img.line-photo { width: 100%; max-height: 62px; object-fit: contain; display: block; }
table.doc-table tfoot td { background: var(--doc-head-bg); color: var(--doc-ink); font-weight: 700; font-size: 10.5px; }
.doc-summary { display: flex; justify-content: flex-end; margin-top: 9px; }
.summary-table { border-collapse: collapse; min-width: 230px; }
.summary-table td { border: 1px solid var(--doc-line); padding: 4px 9px; font-size: 10.5px; }
.summary-table td.k { background: var(--doc-band); color: var(--doc-ink); }
.summary-table td.v { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--doc-ink); }
/* 合计行同理：浅底 + 深字 + 上加粗线保持「这是总额」的视觉重量 */
.summary-table tr.grand td { background: var(--doc-head-bg); color: var(--doc-ink); font-size: 11.5px;
  font-weight: 700; border-top: 2px solid var(--doc-ink); }
.words-line { margin-top: 7px; font-size: 10.5px; }
.words-line .k { color: var(--doc-ink-soft); }
.doc-section { margin-top: 10px; }
.doc-section .sttl { font-size: 10.5px; font-weight: 700; letter-spacing: .6px; color: var(--doc-ink);
  border-bottom: 1px solid var(--doc-line); padding-bottom: 2px; margin-bottom: 5px; text-transform: uppercase; }
.doc-section .sbody { font-size: 10.5px; white-space: pre-wrap; color: #232b38; }
.clause { margin-bottom: 6px; }
.clause .ct { font-weight: 700; font-size: 10.5px; }
.clause .cb { font-size: 10.5px; white-space: pre-wrap; color: #2b3441; }
.bank-box { border: 1px solid var(--doc-line); border-radius: 3px; padding: 7px 9px; font-size: 10.5px; background: #fafbfd; }
.bank-box .row { display: flex; gap: 8px; padding: 1px 0; line-height: 1.42; }
.bank-box .row .k { flex: 0 0 92px; color: var(--doc-ink); font-weight: 400; overflow-wrap: anywhere; }
.bank-box .row .v { flex: 1 1 auto; min-width: 0; }
.sign-area { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 22px; }
.sign-box { border-top: 1px solid var(--doc-ink); padding-top: 4px; font-size: 10.5px; position: relative; }
.sign-box .st { font-weight: 700; }
.sign-box .sl { margin-top: 34px; color: var(--doc-ink-soft); }
/* 印章：压在签字/盖章位置上（透明底 PNG，不会挡字） */
.sign-stamp { position: absolute; left: 8px; bottom: -6px; width: 96px; height: 96px; object-fit: contain; opacity: .92; }
.stamp-corner { display: flex; justify-content: flex-end; margin-top: 6px; }
.stamp-corner .sign-stamp { position: static; width: 100px; height: 100px; }
.doc-foot { margin-top: 12px; border-top: 1px solid var(--doc-line); padding-top: 5px; font-size: 9.5px; color: var(--doc-ink-soft); display: flex; justify-content: space-between; gap: 10px; }
.marks-box { border: 1px solid var(--doc-line); border-radius: 3px; padding: 5px 7px; font-size: 10px; white-space: pre-wrap; min-height: 34px; }
/* 阿拉伯语等 RTL 单据镜像排版 */
.doc-root[dir="rtl"] { direction: rtl; }
.doc-root[dir="rtl"] .doc-title-box { text-align: left; }
.doc-root[dir="rtl"] .party-box .ttl,
.doc-root[dir="rtl"] .doc-section .sttl,
.doc-root[dir="rtl"] .meta-line .k { text-align: right; }
.doc-root[dir="rtl"] .doc-summary { justify-content: flex-start; }
.doc-root[dir="rtl"] .summary-table td.v { text-align: left; }
.doc-root[dir="rtl"] table.doc-table td.num { text-align: left; }
/* 阿语单据里的英文公司名/地址：保持可读的从左到右排版 */
.doc-root[dir="rtl"] .doc-seller,
.doc-root[dir="rtl"] .party-box .nm,
.doc-root[dir="rtl"] .party-box .ln { unicode-bidi: plaintext; }

/* ===================== 装船指示 SI / 装船通知 SA ===================== */
.doc-si, .doc-sa { font-size: 10.5px; color: #111; }
.doc-si .si-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
.doc-si .si-title { font-size: 15px; font-weight: 700; letter-spacing: .5px; }
.doc-si .si-title-en { display: block; font-size: 10px; font-weight: 400; color: #555; letter-spacing: 0; }
.doc-si .si-no { font-size: 10px; text-align: right; line-height: 1.6; white-space: nowrap; }
.doc-si .si-cutoff { border: 1px solid #b45309; background: #fffbeb; color: #7c2d12; border-radius: 4px; padding: 4px 8px; margin-bottom: 8px; font-size: 10.5px; }
.doc-si .si-cutoff-h { color: #92400e; font-size: 9.5px; margin-left: 6px; }
.doc-si table.si-t, .doc-sa table.sa-t { width: 100%; border-collapse: collapse; margin-bottom: 8px; table-layout: fixed; }
.doc-si .si-c { border: 1px solid #333; padding: 3px 6px; vertical-align: top; }
.doc-si .si-k { font-size: 9px; color: #444; }
.doc-si .si-v { font-size: 10.5px; word-break: break-word; }
.doc-si .si-parties { display: flex; gap: 6px; margin-bottom: 8px; }
.doc-si .si-party { flex: 1; border: 1px solid #333; padding: 5px 7px; min-height: 64px; }
.doc-si .si-party-t { font-size: 9.5px; font-weight: 700; border-bottom: 1px solid #999; padding-bottom: 2px; margin-bottom: 3px; }
.doc-si .si-line { font-size: 10px; line-height: 1.55; word-break: break-word; }
.doc-si .si-marks, .doc-si .si-block { border: 1px solid #333; padding: 4px 7px; margin-bottom: 8px; }
.doc-si .si-marks .si-v, .doc-si .si-block .si-v { margin-top: 2px; white-space: pre-wrap; }
.doc-si table.si-items, .doc-sa table.sa-items { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
.doc-si table.si-items th, .doc-si table.si-items td,
.doc-sa table.sa-items th, .doc-sa table.sa-items td { border: 1px solid #333; padding: 3px 5px; font-size: 10px; vertical-align: top; }
.doc-si table.si-items th, .doc-sa table.sa-items th { background: #eef1f5; font-weight: 600; }
.doc-si .si-sub { font-size: 9px; color: #555; }
.doc-si td.n, .doc-sa td.n { text-align: right; white-space: nowrap; }
.doc-si td.l, .doc-sa td.l, .doc-sa td.r { text-align: left; }
.doc-si td.c, .doc-sa td.c, .doc-sa td.r { text-align: center; }
.doc-si .si-sign { display: flex; justify-content: space-between; margin-top: 14px; gap: 20px; }
.doc-si .si-sign-l, .doc-si .si-sign-r { flex: 1; border-top: 1px solid #333; padding-top: 3px; font-size: 9.5px; color: #444; }
.doc-si .si-foot { margin-top: 8px; font-size: 9px; color: #666; }

.doc-sa .sa-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 10px; }
.doc-sa .sa-co { font-size: 12px; font-weight: 700; }
.doc-sa .sa-line { font-size: 9.5px; color: #333; line-height: 1.5; }
.doc-sa .sa-title-wrap { flex: 0 0 auto; }
.doc-sa .sa-title { font-size: 16px; font-weight: 700; letter-spacing: 1px; text-align: right; white-space: nowrap; }
.doc-sa .sa-marks { line-height: 1.5; }
.doc-sa .sa-meta { font-size: 9.5px; text-align: right; line-height: 1.6; margin-top: 2px; }
.doc-sa .sa-to { border: 1px solid #333; padding: 5px 8px; margin-bottom: 8px; }
.doc-sa .sa-to .sa-k { font-size: 9px; color: #444; }
.doc-sa .sa-notify { margin-top: 3px; color: #333; }
.doc-sa .sa-p { font-size: 10.5px; line-height: 1.6; margin: 6px 0 8px; }
.doc-sa .sa-grid { display: flex; gap: 8px; }
.doc-sa .sa-grid > table { flex: 1; }
.doc-sa .sa-th { background: #eef1f5; font-weight: 600; font-size: 10px; padding: 3px 6px; border: 1px solid #333; }
.doc-sa td.sa-k { border: 1px solid #333; padding: 3px 6px; font-size: 9.5px; color: #444; width: 44%; background: #fafbfc; }
.doc-sa td.sa-v { border: 1px solid #333; padding: 3px 6px; font-size: 10px; word-break: break-word; }
.doc-sa .sa-sec { font-size: 10px; font-weight: 600; margin: 8px 0 4px; }
.doc-sa .sa-note { border: 1px solid #333; padding: 5px 8px; font-size: 10px; line-height: 1.6; white-space: pre-wrap; margin-bottom: 8px; }
.doc-sa .sa-sign { display: flex; justify-content: space-between; margin-top: 16px; gap: 20px; }
.doc-sa .sa-sign-l { border-top: 1px solid #333; padding-top: 3px; font-size: 9.5px; color: #444; min-width: 42%; }
.doc-sa .sa-sign-r { font-size: 10px; align-self: flex-end; }

/* ===== 装箱单：多柜分组 ===== */
.doc-pl .pl-ctn-h td, .pl-table .pl-ctn-h td {
  background: #eef1f5; font-weight: 600; color: #1f2937;
  padding: 4px 6px; border: 1px solid #cbd5e1;
}
.doc-pl .pl-ctn-sum td, .pl-table .pl-ctn-sum td {
  background: #f8fafc; font-weight: 600; border-top: 1px dashed #94a3b8;
}


/* ===== 申报要素表 ===== */
.doc-de { font-size: 9.5px; color: #111; }
.doc-de .de-head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 5px; margin-bottom: 7px; }
.doc-de .de-title { font-size: 15px; font-weight: 700; letter-spacing: 1px; }
.doc-de .de-meta { font-size: 9.5px; color: #333; }
.doc-de table.de-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.doc-de table.de-table th, .doc-de table.de-table td { border: 1px solid #333; padding: 3px 4px; vertical-align: top; word-break: break-word; }
.doc-de table.de-table th { background: #eef1f5; font-weight: 600; text-align: center; font-size: 9.5px; }
.doc-de .de-no { text-align: center; color: #444; }
.doc-de .de-code { text-align: center; font-variant-numeric: tabular-nums; }
.doc-de .de-txt { text-align: left; }
.doc-de .de-empty { text-align: center; color: #888; padding: 16px; }
.doc-de .de-foot { margin-top: 7px; font-size: 8.5px; color: #555; }

/* 单据字号（每个单据可单独调）*/
.paper .doc-root { zoom: var(--doc-fs, 1); }

/* 长名字分档缩字号（render 里按长度加 nm-long / nm-xlong 类） */
.doc-seller .cn.nm-long { font-size: 13px; }
.doc-seller .cn.nm-xlong { font-size: 11px; }
.party-box .nm.nm-long { font-size: 10.5px; }
.party-box .nm.nm-xlong { font-size: 9.5px; }

/* 头部其余元素仍在同一行（logo + 卖方明细 + 标题） */
.doc-head { align-items: flex-start; }

.sign-inline { display: block; max-height: 46px; max-width: 170px; object-fit: contain; margin-bottom: 2px; }

`;

export { amountText, amountPlain };
