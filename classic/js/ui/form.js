/* =============================================================
 * 左侧编辑表单 —— 按单据类型动态生成
 * 特点：字段声明式定义 / 双向绑定 / 自动计算 / 行拖动排序 / 图片上传
 * ============================================================= */

import { esc, num, round, money, qty, clone, uid, compressImage, compressStamp } from '../core/util.js';
import {
  state, persistDoc, scheduleAutosave, saveCompany, saveCustomer, saveProduct, saveClause,
  saveRates, currentTpl, historyOf, historyValues, rememberValue, HISTORY_FIELDS,
  saveProfile, saveCurrentSellerAsProfile, removeCustomer, removeProduct, removeClause,
  moveProduct, togglePinProduct,
  saveBank, removeBank, saveCurrentBankAsProfile,
  saveStampToLibrary, saveLogoToLibrary,
} from '../core/store.js';
import { docMeta, itemColumns, columnsHiddenByRows, emptyItem, emptyParty, incotermsList, DOC_TYPES, DOC_HINTS, COL_SWITCHES, columnDefault, visibleDocTypes, usesTermsField, docLangChoices, CONTAINER_TYPES } from '../core/schema.js';
import { recalcDoc, costToPrice, otherFeeRows, rawOtherFeeRows } from '../core/calc.js';
import {
  CURRENCIES, CURRENCY_SYMBOL, CURRENCY_CN, INCOTERMS_CN, UNITS, UNIT_CN,
  WEIGHT_UNITS, MEAS_UNITS, PACK_UNITS,
  DEFAULT_WEIGHT_UNIT, DEFAULT_MEAS_UNIT, DEFAULT_PACK_UNIT, unitOptions,
  TEMPLATES, DOC_LANGS, getTemplate, tableLabels, langOptionLabel,
} from '../core/templates.js';
import { t } from '../core/i18n.js';
import * as toast from './toast.js';
import { openModal, confirmModal, promptModal } from './modal.js';
import { openSuggest, closeSuggest, bindSuggestKeys } from './autofill.js';
import { EXTENDED_FIELDS, analyzeCustomsMerge } from '../doc/render.js';

/* ============================ 字段定义 ============================ */

/** 基础信息字段（tip 会显示成输入框悬停提示，降低理解成本） */
const BASE_FIELDS = [
  { key: 'docNo', label: 'f.docNo', type: 'text', span: 1, tip: 'tip.docNo', attrs: { placeholder: 'QT-001' } },
  { key: 'date', label: 'f.date', type: 'date', span: 1 },
  { key: 'validUntil', label: 'f.validUntil', type: 'date', span: 1, show: (d) => d.type === 'quotation' || d.type === 'pi' },
  // 固定格式单据（报关单 / 提单 / 水单）只给中文 / 英文 —— 栏目名是中英对照，切别的语言没用
  { key: 'docLang', label: 'f.lang', type: 'select', span: 1, tip: 'tip.docLang', options: () => docLangChoices(state.doc && state.doc.type).map((l) => ({ value: l.code, label: langOptionLabel(l) })), rerender: true },
  { key: 'incoterms', label: 'f.incoterms', type: 'select', span: 1, tip: 'tip.incoterms', show: (d) => d.type !== 'declaration_elements', options: () => incotermsList().map((v) => ({ value: v, label: INCOTERMS_CN[v] ? `${v} — ${INCOTERMS_CN[v]}` : v })) },
  { key: 'destination', label: 'f.destination', type: 'text', span: 1, tip: 'tip.destination', list: true, show: (d) => d.type !== 'declaration_elements' },
  { key: 'loadingPort', label: 'f.loadingPort', type: 'text', span: 1, list: true, show: (d) => d.type !== 'declaration_elements' },
  { key: 'leadTime', label: 'f.leadTime', type: 'text', span: 1, tip: 'tip.leadTime', list: true, show: (d) => d.type !== 'declaration_elements' },
  { key: 'currency', label: 'f.currency', type: 'select', span: 1, tip: 'tip.currency', show: (d) => d.type !== 'declaration_elements', options: () => CURRENCIES.map((c) => ({ value: c, label: CURRENCY_CN[c] ? `${c} ${CURRENCY_SYMBOL[c] || ''}（${CURRENCY_CN[c]}）` : c })), rerender: true, show: (d) => docMeta(d.type).mode === 'money' || d.type === 'customs_declaration' },
  // 汇率不再单独显示：换算助手（💱）打开时自己填，平时不占位
  { key: 'exchangeRate', label: 'f.exchangeRate', type: 'number', span: 1, step: '0.0001', show: () => false },
  // 装箱单第 3 栏 DELIVERY TIME 会把生产周期一起印出来
  { key: 'productionTime', label: 'f.productionTime', type: 'text', span: 1, show: (d) => d.type === 'pl' },
  { key: 'paymentTerms', label: 'f.paymentTerms', type: 'text', span: 2, tip: 'tip.paymentTerms', list: true, show: (d) => d.type !== 'declaration_elements', placeholder: 'T/T 30% deposit, 70% before shipment' },
  { key: 'priceTerms', label: 'f.priceTerms', type: 'text', span: 1, show: (d) => d.type !== 'declaration_elements' },
  // 整单最小起订量：和价格条款同属基础信息，放一起填
  { key: 'minOrderQty', label: 'f.minOrderQty', type: 'text', span: 1, placeholder: '如 500 sets', show: (d) => d.type === 'quotation' },
  // 单据上会印「原产国」的类型都要能填（ci / pi / pl / 报价单 / 报关单）
  // 原产国：只有报关单 / 产地证会把它印到单据上，其它单据不再摆空格
  { key: 'countryOfOrigin', label: 'f.origin', type: 'text', span: 1, show: (d) => ['customs_declaration', 'certificate_of_origin', 'declaration_elements'].includes(d.type) },
  { key: 'titleOverride', label: 'f.title', type: 'text', span: 2, placeholder: () => '', show: (d) => d.type !== 'declaration_elements' },
  // 报关单第「合同协议号」栏
  { key: 'contractNo', label: 'f.contractNo', type: 'text', span: 1, show: (d) => d.type === 'customs_declaration' },
  // 装箱单第 3 栏 DELIVERY TIME 会带生产周期
  { key: 'productionTime', label: 'f.productionTime', type: 'text', span: 1, show: (d) => d.type === 'pl' },
];

const MARKS_FIELD = { key: 'marks', label: 'f.marks', type: 'textarea', span: 4, rows: 2, show: (d) => d.type !== 'bank' && d.type !== 'declaration_elements' && !['quotation', 'ci', 'pi', 'contract'].includes(d.type) };
const REMARKS_FIELD = { key: 'remarks', label: 'f.remarks', type: 'textarea', span: 4, rows: 2 };

const PARTY_FIELDS = [
  { key: 'companyName', label: 'f.companyName', span: 2, list: true },
  // 地址可能是两行（门牌 + 城市/国家），用多行框
  { key: 'address', label: 'f.address', span: 2, type: 'textarea', rows: 3 },
  { key: 'city', label: 'f.city', span: 1 },
  { key: 'state', label: 'f.state', span: 1 },
  { key: 'zip', label: 'f.zip', span: 1 },
  { key: 'country', label: 'f.country', span: 1 },
  { key: 'contact', label: 'f.contact', span: 1, list: true },
  { key: 'tel', label: 'f.tel', span: 1, list: true },
  // 传真 / 网站：装箱单等单据会印（THE SELLER 块带的 FAX / WEB），必须有地方填
  { key: 'fax', label: 'f.fax', span: 1, list: true },
  { key: 'website', label: 'f.website', span: 1 },
  // WhatsApp：客户常用，填了会印在单据联系方式里
  { key: 'whatsapp', label: 'WhatsApp', span: 1 },
  { key: 'email', label: 'f.email', span: 1, list: true },
  { key: 'taxId', label: 'f.taxId', span: 1 },
];

/**
 * 当事人区块里**印不到**的字段就别摆输入框（用户反馈：不需要的不要有填写入口）。
 * 提单/报关单的当事方框只印「公司名称 / 地址 / 联系人电话」，没有传真、邮箱、税号、网站。
 */
const PARTY_FIELD_HIDE = {
  bill_of_lading: ['fax', 'website', 'email', 'taxId'],
  customs_declaration: ['fax', 'website', 'email', 'taxId'],
  bank: ['fax', 'website', 'taxId'],
};
const partyFieldsFor = (type) => PARTY_FIELDS.filter((f) => !(PARTY_FIELD_HIDE[type] || []).includes(f.key));

/** 会记录输入历史的字段（用于下拉候选 + 提交时写入历史） */
const HISTORY_PARTY_KEYS = ['companyName', 'contact', 'tel', 'email'];

/* ============================ 历史值下拉（自动补全） ============================ */

/** 每个字段最多给几个候选（太多反而更难选） */
const MAX_SUGGESTIONS = 12;

/* 报关单「报关信息」区块里的全部字段（用于一键清空；不含确认栏，确认栏清空后恢复默认「否」） */
const CUSTOMS_FIELDS = [
  'preEntryNo', 'customsNo', 'declarationType', 'consignmentNo', 'recordNo', 'licenseNo',
  'supervisionMode', 'tradeMode', 'dutyNature', 'tradeCountry', 'destinationCountry',
  'exitCustoms', 'exitPort', 'destPort', 'shippingMethod', 'vesselVoyage', 'blNo',
  'packageType', 'declarationDate', 'exportDate',
  'producerName', 'producerCode', 'shipperCreditCode',
  'attachedDocs', 'declarantName', 'declarantCode', 'declarantPhone',
  'declarantSignature', 'signatureDate', 'declareUnit', 'declareUnitCode',
  'declaration', 'customsRemark',
];

/**
 * 固定候选（常用选项）：和「输入历史」合并后一起进 datalist。
 * 报关单这类单据很多格子是全国统一的几套说法，直接给出来比让人手打强。
 */
const EXTRA_SUGGESTIONS = {
  supervisionMode: ['一般贸易', '进料对口', '来料加工', '出料加工', '保税仓库货物', '保税区仓储转口', '其他'],
  dutyNature: ['一般征税', '全免', '特定减免', '其他法定', '保税'],
  declarationType: ['出口报关', '出口转关', '进口报关', '进口转关', '其他'],
  tradeCountry: ['美国', '德国', '英国', '法国', '日本', '韩国', '越南', '泰国', '印度', '阿联酋', '澳大利亚', '巴西', '俄罗斯'],
  destinationCountry: ['美国', '德国', '英国', '法国', '日本', '韩国', '越南', '泰国', '印度', '阿联酋', '澳大利亚', '巴西', '俄罗斯'],
  exitCustoms: ['上海海关', '深圳海关', '宁波海关', '青岛海关', '广州海关', '天津海关', '厦门海关'],
  exitPort: ['上海洋山港', '深圳蛇口港', '宁波北仑港', '青岛前湾港', '广州南沙港', '天津新港', '厦门海沧港'],
  destPort: ['LOS ANGELES', 'HAMBURG', 'ROTTERDAM', 'SINGAPORE', 'BUSAN', 'TOKYO', 'DUBAI', 'SYDNEY'],
  packageType: ['纸箱', '木箱', '托盘', '桶装', '袋装', '散装'],
  attachedDocs: ['合同', '发票', '装箱单', '报关委托书', '核销单', '许可证', '合同/发票/装箱单'],
  declarantName: ['报关行', '自理报关'],
  shipperCreditCode: [],
};

/** datalist 的 id：按字段路径生成 */
function histListId(path) {
  return `hist_${String(path).replace(/[.\-]/g, '_')}`;
}

/**
 * 收集某字段的候选值：优先「输入历史」，再补「资料库」
 * · buyer.companyName → 追加客户库公司名
 * · items.N.description → 追加产品库品名
 */
function suggestionsFor(path) {
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const s = String(v ?? '').trim();
    if (!s || s.length > 160 || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  historyValues(path).forEach(push);
  // 常用选项（固定候选）排在历史之后，用户自己填过的优先
  (EXTRA_SUGGESTIONS[path] || []).forEach(push);

  if (path === 'buyer.companyName' || path === 'consignee.companyName' || path === 'notify.companyName') {
    state.customers.forEach((c) => push(c.name || c.companyName));
  }
  if (/^items\.\d+\.description$/.test(path)) {
    state.products.forEach((p) => push(p.name || p.description));
  }
  return out.slice(0, MAX_SUGGESTIONS);
}

/** 发票类型下拉建议（用户也可以自己输入别的） */
const INVOICE_TYPE_SUGGESTIONS = [
  '增值税专用发票',
  '增值税普通发票',
  'Commercial Invoice',
  'Proforma Invoice',
  'Formal Invoice',
  'Receipt',
  '收据',
];

/** 为表单里所有可补全字段生成 <datalist> */
function renderDatalists() {
  const paths = new Set(HISTORY_FIELDS);
  paths.add('buyer.companyName');
  (state.doc?.items || []).forEach((_, i) => paths.add(`items.${i}.description`));

  const blocks = [];
  for (const p of paths) {
    const list = suggestionsFor(p);
    if (!list.length) continue;
    blocks.push(`<datalist id="${histListId(p)}">${
      list.map((v) => `<option value="${esc(v)}"></option>`).join('')
    }</datalist>`);
  }

  // 发票类型：用户以前填过的自定义值（按最近使用排序）+ 固定建议，合并去重。
  // historyValues 读的是 state.history 快照，与同函数里的 suggestionsFor 用法一致。
  const seen = new Set();
  const inv = [];
  const pushInv = (v) => {
    const s = String(v || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    inv.push(s);
  };
  for (const v of historyValues('invoiceType')) pushInv(v);
  for (const v of INVOICE_TYPE_SUGGESTIONS) pushInv(v);
  blocks.push(`<datalist id="invoiceTypeList">${
    inv.map((v) => `<option value="${esc(v)}"></option>`).join('')
  }</datalist>`);

  return blocks.join('');
}

/**
 * 其它费用明细（可多项）
 * 用户要的是「保险费一行、离岸费一行」这样分开，而不是全挤在一个「其它费用」里。
 * 每一项两个输入框：名称 + 金额，右侧可删除；底部「＋ 添加一项」。
 */
function renderOtherFees(doc) {
  // 用 rawOtherFeeRows（保留空行）—— 空行是「刚添加还没填」的正常状态，
  // 用参与计算的 otherFeeRows 会把新行也滤掉，导致点了添加却看不到行
  const list = rawOtherFeeRows(doc);
  const items = list.map((r, i) => `
    <div class="fee-row" data-fee-row="${i}">
      <input type="text" data-fee="label" value="${esc(r.label || '')}"
             placeholder="${esc(t('f.otherFeeLabelPh'))}" aria-label="${esc(t('f.otherFeeLabel'))}" />
      <input type="text" inputmode="decimal" autocomplete="off" data-num="1" min="0" data-fee="amount" value="${r.amount ? esc(r.amount) : ''}"
             inputmode="decimal" placeholder="0.00" aria-label="${esc(t('f.otherFee'))}" />
      <button type="button" class="btn btn-sm" data-fee-del="${i}" title="${esc(t('btn.delFeeRow'))}">✕</button>
    </div>`).join('');

  return `<div class="other-fees" data-section="otherfees">
    <div class="of-head">
      <span class="of-ttl">${esc(t('f.otherFeesTitle'))}</span>
      <button type="button" class="btn btn-sm" data-fee-add>＋ ${esc(t('btn.addFeeRow'))}</button>
    </div>
    <div class="of-rows">${items || `<div class="of-empty">${esc(t('f.otherFeesEmpty'))}</div>`}</div>
  </div>`;
}

/** 把表单里的其它费用读回单据
 *  注意：**空行要保留** —— 刚点「添加一项」时名和额都是空的，那是正常的中间状态；
 *  过滤掉的话新行会立刻消失（踩过这个坑）。金额非数字的按 0 处理，
 *  真正参与计算的过滤在 calc.otherFeeRows() 里做。 */
function syncOtherFeesFromDom() {
  const host = document.getElementById('formHost');
  if (!host || !state.doc) return;
  const wrap = host.querySelector('[data-section="otherfees"]');
  if (!wrap) return;
  state.doc.otherFees = [...wrap.querySelectorAll('.fee-row')].map((r) => ({
    label: (r.querySelector('[data-fee="label"]') || {}).value || '',
    amount: Number((r.querySelector('[data-fee="amount"]') || {}).value) || 0,
  }));
  // 清掉旧字段，避免和新数组叠加算两次
  state.doc.otherFee = 0;
  state.doc.otherFeeLabel = '';
}

/* ============================ 小工具 ============================ */

/**
 * 数字框的非法字符拦截
 *
 * 单独靠 input[type=number] 不够：中文输入法、粘贴、以及某些浏览器会把
 * 非法内容留在输入框里（甚至 page 上看起来是空的但 value 已经是脏的）。
 * 这里在 input 事件里把非法字符剔掉，只在「剔完和原文不同」时才回写，
 * 避免打断正常输入（尤其是小数点的输入过程）。
 */
const NUM_ALLOWED = /^-?\d*\.?\d*$/;

function guardNumberInput(el) {
  if (!el || el.dataset.numGuard) return;
  el.dataset.numGuard = '1';
  const clean = () => {
    const raw = String(el.value ?? '');
    if (raw === '' || NUM_ALLOWED.test(raw)) return;
    // 去掉所有不是数字 / 小数点 / 负号开头的内容
    let s = raw.replace(/[^\d.\-]/g, '');
    s = (s.startsWith('-') ? '-' : '') + s.replace(/-/g, '');       // 负号只能在最前
    const firstDot = s.indexOf('.');
    if (firstDot >= 0) {
      const head = s.slice(0, firstDot + 1);
      s = head + s.slice(firstDot + 1).replace(/\./g, '');          // 只留一个小数点
    }
    if (s !== raw) el.value = s;
  };
  el.addEventListener('input', clean);
  el.addEventListener('blur', clean);
  el.addEventListener('paste', () => setTimeout(clean, 0));
}

/** 给范围内所有数字框装上限流 */
function guardNumberInputs(scope) {
  if (!scope) return;
  scope.querySelectorAll('input[type="number"], [data-cast="number"]').forEach(guardNumberInput);
}

/** 只刷新「费用合计」区，不重绘输入框（避免打断正在输入的费用名称） */
function refreshFeeSummary() {
  const host = document.getElementById('formHost');
  if (!host || !state.doc) return;
  const box = host.querySelector('.fee-summary');
  if (!box) return;
  const doc = state.doc;
  const tt = doc.totals || {};
  const money0 = (v) => `${esc(doc.currency)} ${money(v)}`;
  box.innerHTML = `
    <div><span>${t('sum.subtotal')}</span><b>${money0(tt.subtotal || 0)}</b></div>
    ${num(doc.discount) ? `<div><span>${t('sum.discount')}</span><b>- ${money0(tt.discount)}</b></div>` : ''}
    ${num(doc.taxRate) ? `<div><span>${t('sum.tax')} ${num(doc.taxRate)}%</span><b>${money0(tt.taxAmount)}</b></div>` : ''}
    ${num(doc.insuranceFee) ? `<div><span>${t('sum.insurance')}</span><b>${money0(tt.insuranceFee)}</b></div>` : ''}
    ${num(doc.shippingFee) ? `<div><span>${t('sum.shipping')}</span><b>${money0(tt.shippingFee)}</b></div>` : ''}
    ${otherFeeRows(doc).map((r) => `<div><span>${esc(r.label || t('sum.other'))}</span><b>${money0(r.amount)}</b></div>`).join('')}
    ${num(doc.toolingFee) ? `<div><span>${t('sum.tooling')}</span><b>${money0(tt.toolingFee)}</b></div>` : ''}
    <div class="gt"><span>${t('sum.grandTotal')}</span><b>${money0(tt.grandTotal || 0)}</b></div>`;
}

function val(path) {
  const parts = String(path).split('.');
  let cur = state.doc;
  for (const p of parts) {
    if (cur === null || cur === undefined) return '';
    cur = cur[p];
  }
  return cur === undefined || cur === null ? '' : cur;
}

function setVal(path, value) {
  const parts = String(path).split('.');
  let cur = state.doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] === null || cur[p] === undefined || typeof cur[p] !== 'object') {
      cur[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function fieldHtml(field, path) {
  const id = `fld_${path.replace(/[.\-]/g, '_')}`;
  const v = val(path);
  const label = t(field.label);
  const tip = field.tip ? t(field.tip) : '';
  const req = field.required ? ' req' : '';
  const spanCls = field.span === 4 ? 'span-4' : field.span === 3 ? 'span-3' : field.span === 2 ? 'span-2' : '';
  const bind = `data-bind="${esc(path)}"`;
  const rerender = field.rerender ? ' data-rerender="1"' : '';
  const change = field.rerender ? ' data-change="1"' : '';
  const tipAttr = tip ? ` title="${esc(tip)}"` : '';
  const tipMark = tip ? `<span class="tip-mark" title="${esc(tip)}">?</span>` : '';
  // field.list 可以给字符串（直接指定 datalist id）或 true（用该字段的历史候选）
  const listAttr = field.list === true
    ? ` list="${histListId(path)}"`
    : (typeof field.list === 'string' ? ` list="${esc(field.list)}"` : '');
  let control = '';

  switch (field.type) {
    case 'select': {
      const opts = (typeof field.options === 'function' ? field.options() : field.options) || [];
      let list = opts
        .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`)
        .join('');
      // 当前值是空的、选项里又没有空值 → 补一个「未选」，否则浏览器会默认选中第一项，
      // 看起来像"新建单据已经填好了贸易术语"（用户反馈）
      if (String(v) === '' && !opts.some((o) => String(o.value) === '')) {
        list = `<option value="" selected>— 未选 —</option>` + list;
      }
      control = `<select id="${id}" ${bind}${rerender}${change}${tipAttr}>${list}</select>`;
      break;
    }
    case 'textarea':
      control = `<textarea id="${id}" ${bind} rows="${field.rows || 3}" placeholder="${esc(placeholderOf(field))}"${tipAttr}>${esc(v)}</textarea>`;
      break;
    case 'number':
      // 用 text + inputmode=decimal 而不是 type=number：
      // type=number 下浏览器会自己把非法内容清成空串，我们拿不到原文也就谈不上「净化」，
      // 而且各浏览器行为不一致（中文输入法、粘贴时尤其明显）。
      // 改成受控文本框后，guardNumberInput 能只看数字/小数点/负号，行为可预期。
      control = `<input id="${id}" type="text" inputmode="decimal" autocomplete="off" ${bind} data-cast="number" data-num="1" value="${esc(v)}" placeholder="${esc(placeholderOf(field))}"${tipAttr} />`;
      break;
    case 'date':
      control = `<input id="${id}" type="date" ${bind} value="${esc(v)}"${tipAttr} />`;
      break;
    case 'readonly':
      control = `<input id="${id}" type="text" value="${esc(v)}" readonly />`;
      break;
    default:
      control = `<input id="${id}" type="text" ${bind}${listAttr} value="${esc(v)}" placeholder="${esc(placeholderOf(field))}" autocomplete="off"${tipAttr} />`;
  }
  return `<div class="field ${spanCls}"><label for="${id}">${esc(label)}${req}${tipMark}</label>${control}</div>`;
}

/** 区块标题上的小按钮：在右侧预览里定位并高亮这一块 */
// 定位功能已移除（跳转不准确，用户要求去掉）
const LOCATE_BTN = () => '';

function section(key, title, bodyHtml, extraHead = '') {
  const collapsed = state._collapsed && state._collapsed[key];
  return `<section class="card${collapsed ? ' collapsed' : ''}" data-section="${key}" data-sec="${key}">
    <div class="card-head">
      <button class="collapse-btn" data-collapse="${key}" title="折叠/展开">${collapsed ? '▸' : '▾'}</button>
      <span>${title}</span>
      <div class="spacer"></div>${LOCATE_BTN(key)}${extraHead}
    </div>
    <div class="card-body">${bodyHtml}</div>
  </section>`;
}

/**
 * 输入框里的**灰色填写示例**（placeholder）。
 *
 * 为什么要有：新建出来的单据是**空白**的（不再预填假数据），
 * 每个格子用浅灰字告诉你"这里该填什么、长什么样"，例如 `如 HAMBURG, GERMANY`。
 * 按字段 key 匹配，当事方（卖方/买方/收货人/通知人）、基础信息、银行、明细通用。
 */
const PH = {
  // 当事方
  companyName: '如 ACME Import Co., Ltd.',
  address: '如 123 Harbor Blvd, Suite 500',
  city: '如 Los Angeles',
  state: '如 CA',
  zip: '如 90802',
  country: '如 United States',
  contact: '如 Ms. Emily Carter',
  tel: '如 +1 310 555 0182',
  fax: '如 +1 310 555 0183',
  email: '如 purchase@acme-demo.com',
  website: '如 www.acme-demo.com',
  taxId: '如 91440300MA5XXXXXX0K',
  // 基础信息
  docNo: '如 QT-001（自动生成，可改）',
  destination: '如 HAMBURG, GERMANY',
  loadingPort: '如 SHENZHEN, CHINA',
  leadTime: '如 25-30 days after receipt of deposit',
  paymentTerms: '如 T/T 30% deposit, 70% before shipment',
  exchangeRate: '如 7.15（1 外币 = ? 人民币）',
  priceTerms: '如 CIF HAMBURG',
  countryOfOrigin: '如 CHINA',
  poNo: '如 PO-2026-0088',
  piNo: '如 PI-2026-001',
  lcNo: '如 LC-2026-0088',
  awbNo: '如 999-12345678',
  countryOfExport: '如 China',
  reasonForExport: '如 Commercial sale',
  payingBank: '如 Bank of China, Shenzhen Branch',
  sampleNote: '如 样品费可在正式下单后全额退还',
  tradeTermsPlace: '如 HAMBURG, GERMANY',
  shippingMethod: 'BY SEA / BY AIR',
  deliveryPlace: '如 Hamburg, Germany',
  warranty: '如 12 months against manufacturing defects',
  invoiceType: '如 Commercial Invoice',
  contractNo: '如 SC-2026-001',
  invoiceNo: '如 INV-2026-001',
  marks: '如 SUNVL\nHAMBURG\nC/NO. 1-100',
  remarks: '如 货物无木质包装，免熏蒸',
  preparedBy: '如 Chen Wei',
  minOrderQty: '如 500 sets',
  deliveryTerms: '如 收到定金后 25-30 天交货',
  titleOverride: '',
  beneficiaryAccount: '如 7654 3210 9876 5432 100',
  // 收款银行
  beneficiary: '如 SUNVL TECH CO., LTD.（收款人）',
  bankName: '如 BANK OF CHINA, SHENZHEN BRANCH',
  bankAddress: '如 No. 2022 Jianshe Road, Luohu District, Shenzhen',
  accountNo: '如 7654 3210 9876 5432 100',
  swift: '如 BKCHCNBJ45A',
  iban: '如 DE89 3704 0044 0532 0130 00',
  // 明细行
  description: '如 Automatic Pet Feeder',
  model: '如 APF-2000',
  hsCode: '如 8436800000',
  size: '如 28×24×20 cm',
  qty: '如 500',
  unitPrice: '如 18.50',
  ctnNo: '如 C/NO. 1-50',
  nw: '如 105',
  gw: '如 132',
  meas: '如 1.5',
  packUnit: 'ctn',
  remark: '如 CE / RoHS',
};

/** 取某字段的填写示例（字段自己声明了就优先用它） */
function placeholderOf(field) {
  if (field.placeholder !== undefined) {
    return typeof field.placeholder === 'function' ? field.placeholder() : field.placeholder;
  }
  return PH[field.key] || '';
}

/**
 * 给明细格子补上灰色填写示例
 * （空白单据里每一格都告诉用户"该填什么、长什么样"，不用去猜）
 */
function applyItemPlaceholders(root) {
  if (!root) return;
  root.querySelectorAll('input[data-bind^="items."], textarea[data-bind^="items."]').forEach((el) => {
    const key = String(el.getAttribute('data-bind')).split('.')[2];
    if (PH[key]) el.setAttribute('placeholder', PH[key]);
  });
}

/* ============================ 表单渲染 ============================ */

/** 水单专用表单（银行收付凭证）：收款方 / 付款方 / 金额 / 手续费 / 结算方式 / 附言 */
function renderBankSlipForm(host, doc, onRefreshPreview) {
  const F = (key, label, type = 'text', extra = {}) => ({ key: `bankSlip.${key}`, label, type, ...extra });

  // 收款方字段
  const beneFields = [
    F('beneficiaryName', 'f.bankBeneficiaryName'),
    F('beneficiaryAccount', 'f.bankBeneficiaryAccount'),
    F('beneficiaryBank', 'f.bankBeneficiaryBank'),
    F('beneficiaryBankCountry', 'f.bankBeneficiaryBankCountry'),
    F('beneficiarySwift', 'f.bankBeneficiarySwift', 'text', { placeholder: 'e.g. HSBCHKHH' }),
    F('beneficiaryBankCode', 'f.bankBeneficiaryBankCode'),
    F('beneficiaryBranchCode', 'f.bankBeneficiaryBranchCode'),
  ];
  // 付款方字段
  const origFields = [
    F('originatorName', 'f.bankOriginatorName'),
    F('originatorAccount', 'f.bankOriginatorAccount'),
    F('originatorBank', 'f.bankOriginatorBank'),
    F('originatorSwift', 'f.bankOriginatorSwift', 'text', { placeholder: 'e.g. HSBCUS33' }),
  ];
  // 金额 / 结算字段
  const moneyFields = [
    F('amountCurrency', 'f.bankAmountCurrency', 'select', { span: 1, options: () => CURRENCIES.map((c) => ({ value: c, label: `${c} ${CURRENCY_CN[c] ? `（${CURRENCY_CN[c]}）` : ''}` })) }),
    F('amount', 'f.bankAmount', 'number', { span: 1, step: '0.01' }),
    F('fee', 'f.bankFee', 'number', { span: 1, step: '0.01' }),
    F('debitAmount', 'f.bankDebitAmount', 'number', { span: 1, step: '0.01', tip: 'tip.bankDebitAuto' }),
    F('rate', 'f.bankRate', 'number', { span: 1, step: '0.0001' }),
    F('instructedAmount', 'f.bankInstructedAmount', 'text', { span: 1 }),
    F('status', 'f.bankStatus', 'select', { span: 1, options: () => ['COMPLETE', 'PROCESSING', 'PENDING'].map((s) => ({ value: s, label: s })) }),
    F('settlement', 'f.bankSettlement', 'select', { span: 1, options: () => ['T/T · 电汇', 'D/D · 票汇', 'M/T · 信汇'].map((s) => ({ value: s, label: s })) }),
    F('feeBearer', 'f.bankFeeBearer', 'select', { span: 2, options: () => ['OUR', 'SHA', 'BEN'].map((s) => ({ value: s, label: `${s} — ${{ OUR: '付款方承担', SHA: '双方各自承担', BEN: '收款方承担' }[s]}` })) }),
  ];
  // 其他 / 附言
  const otherFields = [
    F('reference', 'f.bankReference', 'text', { span: 1 }),
    F('date', 'f.bankDate', 'date', { span: 1 }),
    F('paymentTime', 'f.bankPaymentTime', 'text', { span: 1, placeholder: 'e.g. 10:38 AM CT' }),
    F('valueDate', 'f.bankValueDate', 'text', { span: 1, placeholder: 'e.g. 2026-10-15' }),
  ];
  const remarksFields = [
    F('remarks', 'f.bankRemarks', 'textarea', { span: 4, rows: 3, placeholder: '附言 / Remittance Information（汇款用途、合同号、发票号等）' }),
    F('disclaimer', 'f.bankDisclaimer', 'textarea', { span: 4, rows: 2 }),
  ];

  const grid = (fs) => `<div class="grid grid-2">${fs.map((f) => fieldHtml(f, f.key)).join('')}</div>`;

  const sections = [];
  sections.push(section('basic', `📋 ${t('tab.basic')} <span class="hint">${esc(t('doc.bank'))}</span>`,
    `<div class="grid grid-2">${fieldHtml(F('bankName', 'f.bankName'), 'bankSlip.bankName')}${fieldHtml({ key: 'docNo', label: 'f.docNo', span: 1 }, 'docNo')}${fieldHtml({ key: 'docLang', label: 'f.lang', type: 'select', span: 1, rerender: true, options: () => docLangChoices('bank').map((l) => ({ value: l.code, label: langOptionLabel(l) })) }, 'docLang')}</div>`));
  sections.push(section('beneficiary', `🏦 ${t('f.bankBeneficiary')}`, grid(beneFields)));
  sections.push(section('originator', `💸 ${t('f.bankOriginator')}`, grid(origFields)));
  sections.push(section('money', `💰 ${t('tab.pricing')}`, grid(moneyFields)));
  sections.push(section('others', `📅 ${t('tab.others')}`, grid(otherFields)));
  sections.push(section('remarks', `📝 ${t('f.bankRemarks')}`, grid(remarksFields)));

  host.innerHTML = sections.join('');

  // 绑定输入 → 写回 state + 刷新预览（与主流程 renderForm 的绑定一致）
  const commit = () => {
    recalcDoc(state.doc);
    scheduleAutosave();
    if (onRefreshPreview) onRefreshPreview();
  };
  /* 列顺序前移：把该列在自己前面那列之前 */
  host.querySelectorAll('[data-colup]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const doc = state.doc;
      if (!doc) return;
      const key = b.getAttribute('data-colup');
      const cur = (itemColumns(doc.type, doc) || []).map((c) => c.key);
      const order = Array.isArray(doc.colOrder) && doc.colOrder.length
        ? doc.colOrder.slice()
        : cur.slice();
      // 补齐缺失的列
      for (const k of cur) if (!order.includes(k)) order.push(k);
      const i = order.indexOf(key);
      if (i > 1) {                       // 第 0 位是 No. 固定不动
        [order[i - 1], order[i]] = [order[i], order[i - 1]];
        doc.colOrder = order;
        try { scheduleAutosave(); } catch (err) { /* 忽略 */ }
        // 重渲染表单（芯片顺序）并刷新预览
        renderForm(host, state._refreshPreview);
        if (state._refreshPreview) state._refreshPreview();
      }
    };
  });
  /* 签名复位：一键回默认位置 */
  host.querySelectorAll('[data-sign-move]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const doc = state.doc;
      if (!doc) return;
      doc.signDX = 0; doc.signDY = 0;
      try { scheduleAutosave(); } catch (err) { /* 忽略 */ }
      const label = document.querySelector('#signOffsetLabel');
      if (label) label.textContent = '0, 0';
      if (state._refreshPreview) state._refreshPreview();
    };
  });
  /* 印章位置微调：每次 4px（Shift 10px），存到单据上并立即刷新预览 */
  host.querySelectorAll('[data-stamp-move]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const doc = state.doc;
      if (!doc) return;
      const step = e.shiftKey ? 10 : 4;
      const dir = b.getAttribute('data-stamp-move');
      if (dir === 'reset') { doc.stampDX = 0; doc.stampDY = 0; }
      else if (dir === 'up') doc.stampDY = (Number(doc.stampDY) || 0) - step;
      else if (dir === 'down') doc.stampDY = (Number(doc.stampDY) || 0) + step;
      else if (dir === 'left') doc.stampDX = (Number(doc.stampDX) || 0) - step;
      else if (dir === 'right') doc.stampDX = (Number(doc.stampDX) || 0) + step;
      try { scheduleAutosave(); } catch (err) { /* 忽略 */ }
      // 只更新坐标数字 + 刷新预览，避免整表重渲染导致页面跳回顶部
      const label = document.querySelector('#stampOffsetLabel');
      if (label) label.textContent = `${Number(doc.stampDX) || 0}, ${Number(doc.stampDY) || 0}`;
      if (state._refreshPreview) state._refreshPreview();
    };
  });
  host.querySelectorAll('[data-bind]').forEach((el) => {
    const path = el.getAttribute('data-bind');
    const cast = el.getAttribute('data-cast');
    const handler = () => {
      let v = el.value;
      if (cast === 'number') v = v === '' ? 0 : num(v);
      setVal(path, v);
      // 金额 / 手续费 → 自动算到账金额（除非用户手动填过 debitAmount）
      if (path === 'bankSlip.amount' || path === 'bankSlip.fee') {
        const bs = state.doc.bankSlip || {};
        if (!bs._debitManual) {
          const auto = round((Number(bs.amount || 0)) - (Number(bs.fee || 0)));
          setVal('bankSlip.debitAmount', auto);
          const deb = host.querySelector('[data-bind="bankSlip.debitAmount"]');
          if (deb && deb.value !== String(auto)) deb.value = auto;
        }
      }
      // 手动编辑到账金额 → 标记为手动，停止自动覆盖
      if (path === 'bankSlip.debitAmount') setVal('bankSlip._debitManual', true);
      commit();
    };
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', handler);
  });
  guardNumberInputs(host);
  commit();
  return;
}

export function renderForm(host, onRefreshPreview) {
  // 先注册刷新回调：即使当前没有单据（空态）也要能刷新右侧预览
  state._refreshPreview = onRefreshPreview;
  const doc = state.doc;  if (!doc) {
    // 空态：说明当前所在类型是干嘛的，并提供「只新建这一类」的入口
    const tp = (state.lastType && DOC_TYPES.some((d) => d.type === state.lastType)) ? state.lastType : 'quotation';
    const meta = DOC_TYPES.find((d) => d.type === tp) || DOC_TYPES[0];
    const hasAny = state.docs.some((d) => d.type === tp);
    host.innerHTML = `<div class="empty-state">
      <div class="ico">${meta.icon}</div>
      <div class="msg" style="line-height:1.9">
        <b>${esc(t(`doc.${tp}`))}</b> · ${esc(DOC_HINTS[tp] || '')}<br>
        ${hasAny ? '左侧还没有打开的单据，从「草稿与单据」里选一份，或新建一份' : '这个类型还没有单据，点下面新建一份'}
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" data-newtype="${tp}">＋ 新建${esc(t(`doc.${tp}`))}</button>
      </div>
      <div class="hint" style="margin-top:14px;font-size:12px;color:var(--c-text-mute);line-height:1.8">
        要建别的单据，请点上方对应页签：${
          visibleDocTypes().map((d) => `<button class="btn btn-sm" data-newtype="${d.type}" style="margin:2px">${d.icon} ${esc(t(`doc.${d.type}`))}</button>`).join('')
        }
      </div></div>`;
    host.querySelectorAll('[data-newtype]').forEach((b) => {
      b.onclick = () => { if (state._handleNew) state._handleNew(b.getAttribute('data-newtype')); };
    });
    return;
  }
  const meta = docMeta(doc.type);
  if (!state._collapsed) state._collapsed = {};

  // 水单（bank）走专用表单：收款方 / 付款方 / 金额 / 手续费 / 附言，无买卖双方与产品明细
  if (meta.mode === 'bank') {
    return renderBankSlipForm(host, doc, onRefreshPreview);
  }

  const html = [];

  /* --- 单据基础信息 --- */
  const baseBody = `<div class="grid grid-2">
    ${BASE_FIELDS.filter((f) => !f.show || f.show(doc)).map((f) => fieldHtml(f, f.key)).join('')}
  </div>
  ${(!MARKS_FIELD.show || MARKS_FIELD.show(doc))
    ? `<div class="grid grid-2" style="margin-top:8px">${fieldHtml(MARKS_FIELD, 'marks')}</div>` : ''}
`;
  html.push(section('basic', `📋 ${t('tab.basic')} <span class="hint">${esc(t(`doc.${doc.type}`))} · ${esc(doc.docNo || '')}</span>`, baseBody));

  /* --- 卖方 ---
   * 申报要素表只列产品要素，不印卖方抬头 → 这块不摆（不需要的别摆） */
  const showParties = doc.type !== 'declaration_elements';
  const stampSaved = !!(state.company && state.company.stamp);
  const logoSaved = !!(state.companyLogo || (state.company && state.company.logo));
  const sellerBody = `<div class="inline-row" style="margin-bottom:10px;align-items:center;flex-wrap:wrap">
      <div class="photo-thumb" id="logoThumb" style="${doc.seller.logo ? `background-image:url('${doc.seller.logo}')` : ''}" title="${t('btn.uploadLogo')}">
        ${doc.seller.logo ? '' : '🏢'}
      </div>
      <div style="display:flex;flex-direction:column;gap:5px">
        <button class="btn btn-sm" data-act="upload-logo">🖼 ${t('btn.uploadLogo')}</button>
        ${doc.seller.logo ? `<button class="btn btn-sm btn-danger" data-act="clear-logo">${t('btn.remove')}</button>` : ''}
      </div>
      <!-- LOGO 也要能存起来复用，否则每张新单据都得重新上传（和印章同一套逻辑） -->
      <button class="btn btn-sm${logoSaved ? '' : ' btn-accent'}" data-act="save-logo" ${doc.seller.logo ? '' : 'disabled'}
              title="${t('logo.saveHint')}">💾 ${logoSaved ? t('logo.updateLib') : t('logo.saveToLib')}</button>

      <div class="stamp-thumb" id="stampThumb" data-act="upload-stamp" title="${t('btn.uploadStamp')}"
           style="--stamp-img:${doc.seller.stamp ? `url('${doc.seller.stamp}')` : 'none'}">
        <span>${doc.seller.stamp ? '' : '🔏'}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px">
        <button class="btn btn-sm" data-act="upload-stamp">🔏 ${doc.seller.stamp ? t('btn.changeStamp') : t('btn.uploadStamp')}</button>
        ${doc.seller.stamp ? `<button class="btn btn-sm btn-danger" data-act="clear-stamp">${t('btn.remove')}</button>` : ''}
      </div>
      <button class="btn btn-sm${stampSaved ? '' : ' btn-accent'}" data-act="save-stamp" ${doc.seller.stamp ? '' : 'disabled'}
              title="${t('stamp.saveHint')}">💾 ${stampSaved ? t('stamp.updateLib') : t('stamp.saveToLib')}</button>

      ${doc.seller.stamp ? `<label class="stamp-size" style="display:inline-flex;align-items:center;gap:5px;font-size:12px">
        印章大小
        <select data-bind="stampScale" style="width:auto;padding:3px 8px;font-size:12px">
          ${[[0.6, '60%'], [0.8, '80%'], [1, '100% 标准'], [1.2, '120%'], [1.4, '140%'], [1.7, '170%']]
            .map(([v, label]) => `<option value="${v}"${String(Number(doc.stampScale) || 1) === String(v) ? ' selected' : ''}>${label}</option>`).join('')}
        </select></label>` : ''}
      ${doc.seller.stamp ? `<span class="stamp-move" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;margin-left:6px">
        位置 <span class="hint" style="margin-right:2px">（右边预览里直接拖印章）</span>
        <span class="hint" id="stampOffsetLabel" style="color:var(--c-text-mute);min-width:56px;display:inline-block">${Number(doc.stampDX) || 0}, ${Number(doc.stampDY) || 0}</span>
        <button type="button" class="btn btn-sm btn-quiet" data-stamp-move="reset" title="回到默认位置">⟲</button>
      </span>` : ''}
      <!-- 签名图片：和印章一样，上传后印在单据签名位 -->
      <div class="stamp-thumb" id="signThumb" data-act="upload-sign" title="上传签名图片"
           style="--stamp-img:${doc.seller.signature ? `url('${doc.seller.signature}')` : 'none'}">
        <span>${doc.seller.signature ? '' : '✍️'}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px">
        <button class="btn btn-sm" data-act="upload-sign">✍️ ${doc.seller.signature ? '更换签名' : '上传签名'}</button>
        ${doc.seller.signature ? `<button class="btn btn-sm btn-danger" data-act="clear-sign">移除签名</button>` : ''}
      </div>
      ${doc.seller.signature ? `<span class="sign-move" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;margin-left:6px">
        位置 <span class="hint" style="margin-right:2px">（右边预览里直接拖签名）</span>
        <span class="hint" id="signOffsetLabel" style="color:var(--c-text-mute);min-width:56px;display:inline-block">${Number(doc.signDX) || 0}, ${Number(doc.signDY) || 0}</span>
        <button type="button" class="btn btn-sm btn-quiet" data-sign-move="reset" title="回到默认位置">⟲</button>
      </span>` : ''}

      <div class="spacer" style="flex:1"></div>
      <button class="btn btn-sm${state.profiles.length ? ' btn-primary' : ''}" data-act="pick-company">🏢 ${t('lib.selectCompany')}${state.profiles.length ? `（${state.profiles.length}）` : ''}</button>
      <button class="btn btn-sm" data-act="save-company">💾 ${t('btn.saveAsCompany')}</button>
    </div>
    <div class="hint" style="margin-bottom:8px;font-size:12px;color:var(--c-text-mute)">
      ${t('stamp.hint')}
    </div>
    <div class="grid grid-2">${partyFieldsFor(doc.type).map((f) => fieldHtml(f, `seller.${f.key}`)).join('')}</div>`;
  if (showParties) html.push(section('seller', `🏢 ${t('f.seller')}`, sellerBody));

  /* --- 买方 ---
   * 提单印的是「2 收货人 / 3 通知人」，根本不看买方 → 提单页不摆买方区块（用户反馈：不需要的别摆） */
  const buyerHead = `<button class="btn btn-sm${state.customers.length ? ' btn-primary' : ''}" data-act="pick-customer">👥 ${t('lib.selectCustomer')}${state.customers.length ? `（${state.customers.length}）` : ''}</button>
    <button class="btn btn-sm" data-act="add-customer">＋ ${t('btn.add')}</button>
    <button class="btn btn-sm" data-act="save-customer">💾 ${t('lib.saveCurrentCustomer')}</button>`;
  const buyerBody = `<div class="grid grid-2">${partyFieldsFor(doc.type).map((f) => fieldHtml(f, `buyer.${f.key}`)).join('')}</div>
    <div class="hint" style="margin-top:8px;font-size:12px;color:var(--c-text-mute)">
      提示：客户名称填过一次就会记住，下次点输入框会弹出候选；<b>与客户库同名时，地址电话会自动补齐</b>。
    </div>`;
  if (doc.type !== 'bill_of_lading' && showParties) html.push(section('buyer', `👤 ${t('f.buyer')}`, buyerBody, buyerHead));

  /* --- 融合 TradeKit：新增单据的特有字段（提单/原产地证明/报关单/证书类/保险单） --- */
  const extFields = EXTENDED_FIELDS[doc.type];
  if (extFields && extFields.length) {
    const extZh = state.uiLang === 'zh' || doc.docLang === 'zh';
    const extBody = `<div class="grid grid-2">${extFields.map((f) => fieldHtml({
      key: f.key,
      label: extZh ? f.zh : f.en,        // t() 查不到该 key 时原样返回，实现直接中/英标签
      type: f.date ? 'date' : 'text',
      span: f.block ? 2 : 1,
    }, f.key)).join('')}</div>`;
    html.push(section('ext', extZh ? '📎 单证特有信息' : '📎 Document Specific', extBody));
  }

  /* --- 收货人 / 通知方（CI / PL 需要；提单第 2、3 栏印的就是这两块） --- */
  if (['ci', 'pl', 'bill_of_lading', 'shipping_instruction', 'shipping_advice'].includes(doc.type)) {
    const sameChecked = doc.sameAsBuyerConsignee !== false;
    const extra = `<label class="hint" style="display:flex;align-items:center;gap:5px;font-weight:400;font-size:11.5px">
      <input type="checkbox" data-bind-flag="sameAsBuyerConsignee" ${sameChecked ? 'checked' : ''} style="width:auto" /> ${t('f.sameAsBuyer')}</label>`;
    const consigneeBody = `<div class="grid grid-2">${PARTY_FIELDS.map((f) => fieldHtml(f, `consignee.${f.key}`)).join('')}</div>`;
    html.push(section('consignee', `📦 ${t('f.consignee')} / ${t('f.notify')}`, consigneeBody, extra));
    // 提单第 3 栏「通知人」是独立一块（不填就默认同收货人）
    if (['bill_of_lading', 'shipping_instruction', 'shipping_advice'].includes(doc.type)) {
      const notifyBody = `<div class="grid grid-2">${PARTY_FIELDS.map((f) => fieldHtml(f, `notify.${f.key}`)).join('')}</div>`;
      html.push(section('notify', `📣 ${t('f.notify')}`, notifyBody,
        `<span class="hint" style="font-size:11.5px;font-weight:400">${t('f.notifyHint')}</span>`));
    }
  }

  /* --- 出口与清关信息（PI / CI / PL 常用，按类型显示字段） --- */
  if (doc.type === 'ci' || doc.type === 'pl' || doc.type === 'pi') {
    const exportFields = [
      { key: 'poNo', label: 'f.poNo', span: 1, tip: '客户订单号，清关与对账都要对得上' },
      { key: 'lcNo', label: 'f.lcNo', span: 1, show: (d) => d.type !== 'pl' },
      { key: 'awbNo', label: 'f.awbNo', span: 1 },
      { key: 'shippingMethod', label: 'f.shippingMethod', type: 'select', span: 1, options: () => [
        { value: '', label: '（未指定）' },
        { value: 'Sea', label: 'Sea 海运' },
        { value: 'Air', label: 'Air 空运' },
        { value: 'Express', label: 'Express 快递' },
        { value: 'Land', label: 'Land 陆运' },
        { value: 'Multimodal', label: 'Multimodal 多式联运' },
      ] },
      { key: 'countryOfExport', label: 'f.countryOfExport', span: 1, tip: '留空会自动用卖方所在国家' },
      { key: 'reasonForExport', label: 'f.reasonForExport', type: 'select', span: 1, options: () => [
        { value: 'Commercial', label: 'Commercial 商业销售' },
        { value: 'Sample', label: 'Sample 样品' },
        { value: 'Gift', label: 'Gift 礼品' },
        { value: 'Repair', label: 'Repair 返修' },
        { value: 'Return', label: 'Return 退货' },
        { value: 'Personal Effects', label: 'Personal Effects 个人物品' },
      ] },
      { key: 'tradeTermsPlace', label: 'f.tradeTermsPlace', span: 2, tip: '贸易术语后面的交货地，如 Shenzhen, China；留空会自动拼' },
      { key: 'beneficiaryAccount', label: 'f.beneficiaryAccount', span: 2, show: (d) => d.type === 'ci' },
    ].filter((f) => !f.show || f.show(doc));

    const exportBody = `<div class="grid grid-2">
      ${exportFields.map((f) => fieldHtml(f, f.key)).join('')}
    </div>
    <div class="hint" style="margin-top:8px;font-size:12px;color:var(--c-text-mute)">
      这些是清关与银行要核对的信息：单据上会排成「参考号行」显示（PO 号、L/C 号、空运单号、出口国、原产国、贸易术语与交货地）。
    </div>`;
    html.push(section('export', `🛃 ${t('tab.export')}`, exportBody));
  }

  /* --- 价格与费用（报价单 / PI / CI：小计 → 折扣 → 增值税 → 保险 → 运费 → 总计） --- */
  if (docMeta(doc.type).mode === 'money') {
    const priceFields = [
      { key: 'discount', label: 'f.discount', type: 'number', span: 1, tip: '整单折扣金额，会从小计里扣掉；不能为负数' },
      { key: 'taxRate', label: 'f.taxRate', type: 'number', span: 1, tip: '如 13；不需要增值税就填 0；不能超过 100' },
      { key: 'insuranceFee', label: 'f.insuranceFee', type: 'number', span: 1 },
      { key: 'shippingFee', label: 'f.shippingFee', type: 'number', span: 1 },
      { key: 'toolingFee', label: 'f.toolingFee', type: 'number', span: 1 },
      { key: 'toolingRefund', label: 'f.toolingRefund', type: 'text', span: 1, placeholder: '如 满 5000 件全额退还' },
    ];
    const totals = doc.totals || {};
    const money0 = (v) => `${esc(doc.currency)} ${money(v)}`;
    const feeRows = otherFeeRows(doc);
    const priceBody = `<div class="grid grid-2">
      ${priceFields.map((f) => fieldHtml(f, f.key)).join('')}
    </div>
    ${renderOtherFees(doc)}
    <div class="fee-summary">
      <div><span>${t('sum.subtotal')}</span><b>${money0(totals.subtotal || 0)}</b></div>
      ${num(doc.discount) ? `<div><span>${t('sum.discount')}</span><b>- ${money0(totals.discount)}</b></div>` : ''}
      ${num(doc.taxRate) ? `<div><span>${t('sum.tax')} ${num(doc.taxRate)}%</span><b>${money0(totals.taxAmount)}</b></div>` : ''}
      ${num(doc.insuranceFee) ? `<div><span>${t('sum.insurance')}</span><b>${money0(totals.insuranceFee)}</b></div>` : ''}
      ${num(doc.shippingFee) ? `<div><span>${t('sum.shipping')}</span><b>${money0(totals.shippingFee)}</b></div>` : ''}
      ${feeRows.map((r) => `<div><span>${esc(r.label || t('sum.other'))}</span><b>${money0(r.amount)}</b></div>`).join('')}
      ${num(doc.toolingFee) ? `<div><span>${t('sum.tooling')}</span><b>${money0(totals.toolingFee)}</b></div>` : ''}
      <div class="gt"><span>${t('sum.grandTotal')}</span><b>${money0(totals.grandTotal || 0)}</b></div>
    </div>
    <div class="hint" style="margin-top:8px;font-size:12px;color:var(--c-text-mute)">
      不填折扣 / 税费 / 运费时，总计就等于总金额，单据上也不会多出空行。
    </div>`;
    html.push(section('pricing', `💰 ${t('tab.pricing')}`, priceBody));
  }

  /* --- 装箱单专用：单据参考信息 + 运输路线 --- */
  if (meta.mode === 'packing') {
    const plFields = [
      { key: 'invoiceNo', label: 'f.invoiceNo', span: 1, tip: '必须和商业发票号码一致（报关要单证相符）' },
      { key: 'invoiceDate', label: 'f.invoiceDate', span: 1, type: 'date', tip: '发票日期，默认跟单据日期一致' },
      { key: 'piNo', label: 'f.piNo', span: 1, tip: '形式发票号；装箱单上引用它便于对单' },
      { key: 'poNo', label: 'f.poNo', span: 1, tip: '客户的订单号' },
      { key: 'lcNo', label: 'f.lcNo', span: 1, tip: '信用证号；没有就留空' },
      { key: 'contractNo', label: 'f.contractNo', span: 1, tip: '合同号；和销售合同一致' },
      { key: 'routeFrom', label: 'f.routeFrom', span: 1, placeholder: '如 NINGBO', tip: '起运港 / 起运地' },
      { key: 'routeTo', label: 'f.routeTo', span: 1, placeholder: '如 SEATTLE', tip: '目的港 / 目的地' },
      { key: 'routeBy', label: 'f.routeBy', span: 1, placeholder: 'BY SEA / BY AIR', tip: '运输方式（英文），单据上会拼成 FROM A TO B BY SEA' },
      { key: 'countryOfOrigin', label: 'f.countryOfOrigin', span: 1, placeholder: '如 CHINA', tip: '原产国，报关要用；会填进底部第 1 条说明' },
      { key: 'totalPackedText', label: 'f.totalPackedText', span: 2, placeholder: '如 TOTAL 15 CARTONS ONLY', tip: '底部「合计包装」说明' },
      { key: 'marks', label: 'f.marks', span: 2, type: 'textarea', rows: 2, placeholder: '如 SMITH/NYC\nC/NO. 1-15\nMADE IN CHINA', tip: '唛头；显示在明细表第一列与底部第 5 条说明' },
    ];
    html.push(section('plref', `📋 ${t('tab.plRef')}`,
      `<div class="grid grid-2">${plFields.map((f) => fieldHtml(f, f.key)).join('')}</div>`));
  }

  /* --- 显示开关：明细表要显示哪些列 --- */
  {
    const packing = meta.mode === 'packing';
    // 装箱单默认显示，开关是「隐藏」；名称类单据默认看类型（CI 显示，其余藏），开关是「显示」
    const toggles = packing
      ? [
        { key: 'hideCtns', label: t('opt.showCtnsPk') },
        { key: 'hideWeight', label: t('opt.showWeightPk') },
        { key: 'hideMeas', label: t('opt.showMeasPk') },
        // 报关/清关常要 HS 编码：勾上才印（默认不印，保持装箱单清爽）
        { key: 'showHs', label: t('opt.showHs') },
        { key: 'showEmptyRows', label: t('opt.showEmptyRows') },
        // 底部汇总行（Total Cartons / Quantity / Net / Gross / Meas）可选
        { key: 'hideSumLine', label: '隐藏底部汇总行（件数/重量/体积）' },
      ]
      : [
        // 可选列（规格 / 型号 / HS 编码 / 备注）：默认值按单据类型给，
        // 用户勾过之后就按用户的；对照 exradoc 同类单据的表头，他有的列我们都能有
        ...COL_SWITCHES.map((sw) => ({ key: sw.docKey, col: sw.key, label: t(sw.i18n) })),
        { key: 'showPhoto', label: t('opt.showPhoto') },
        { key: 'showCtns', label: t('opt.showCtns') },
        { key: 'showWeight', label: t('opt.showWeight') },
        { key: 'showMeas', label: t('opt.showMeas') },
        { key: 'showEmptyRows', label: t('opt.showEmptyRows') },
        // 底部汇总行（件数/重量/体积）可选：勾上=隐藏
        { key: 'hideSumLine', label: '隐藏底部汇总行（件数/重量/体积）' },
      ];
    // 装箱单的开关语义是「反的」：勾上=隐藏，所以用 !值 表示选中
    // 图片列特殊：showPhoto 为 undefined 时，只要有一行填了图就算「显示中」
    // （和 itemColumns() 的自动逻辑保持一致，避免"没勾选但列却出现了"的矛盾）
    const anyPhoto = (doc.items || []).some((x) => x && x.photo);
    // 隐藏类开关：勾上表示隐藏（与列开关相反）
    const HIDE_LIKE = ['hideCtns', 'hideWeight', 'hideMeas', 'hideSumLine'];
    const checked = (k) => {
      if (HIDE_LIKE.includes(k)) return !!doc[k];
      if (k === 'showPhoto' && doc[k] === undefined) return anyPhoto;
      // 可选列：没设置过就显示「该单据类型的默认值」，和单据渲染用的是同一份判断
      const sw = COL_SWITCHES.find((s) => s.docKey === k);
      if (sw) return typeof doc[k] === 'boolean' ? doc[k] : columnDefault(doc.type, sw.key);
      // showEmptyRows / showHs 语义与装箱单其它「隐藏开关」相反（勾上=显示），取值直接看 true
      if (k === 'showEmptyRows' || k === 'showHs') return !!doc[k];
      return packing ? !doc[k] : !!doc[k];
    };

    /* 「买卖双方区」的显示方式：单栏（只买方框）/ 两栏（买方框 + 银行信息）
       默认值按单据类型给（报价单/装箱单单栏，PI/合同/CI 两栏），用户可覆盖。 */
    // 与 render.js 的 DEFAULT_PARTY_LAYOUT 保持一致：报价单/PI/CI/合同 默认两栏（买方 + 银行）
const DEFAULT_LAYOUT = { quotation: 'split', pi: 'split', contract: 'split', ci: 'split', pl: 'single' };
    const layoutNow = doc.partyLayout || DEFAULT_LAYOUT[doc.type] || 'single';
    const hasBankInfo = [doc.bank?.bankName, doc.bank?.accountNo, doc.bank?.swift,
      doc.bank?.iban, doc.bank?.bankAddress, doc.beneficiaryAccount].some((v) => String(v || '').trim());
    const layoutPicker = `
      <div class="field" style="margin-top:12px">
        <label>${t('opt.partyLayout')}</label>
        <div class="col-toggles radios">
          <label class="chk"><input type="radio" name="partyLayout" data-layout="single"${
            layoutNow === 'single' ? ' checked' : ''}> <span>${t('opt.layoutSingle')}</span></label>
          <label class="chk"><input type="radio" name="partyLayout" data-layout="split"${
            layoutNow === 'split' ? ' checked' : ''}> <span>${t('opt.layoutSplit')}</span></label>
        </div>
        <div class="hint" style="margin-top:6px;font-size:12px;color:var(--c-text-mute)">
          ${hasBankInfo
            ? t('opt.partyLayoutTip')
            : `${t('opt.partyLayoutTip')} <b style="color:#b45309">⚠ 银行信息还没填，选了两栏单据上的银行框会是空的（可以先选，之后再填）。</b>`}
        </div>
      </div>`;
    // 分成「显示哪些列」和「其它选项」两组，避免一长串勾选框糊在一起
    const OTHER_KEYS = ['showEmptyRows', 'hideSumLine'];
    const colToggles = toggles.filter((tg) => !OTHER_KEYS.includes(tg.key));
    const otherToggles = toggles.filter((tg) => OTHER_KEYS.includes(tg.key));
    const chkRow = (list) => list.map((tg) => `<label class="chk"><input type="checkbox" data-toggle="${tg.key}"${
      checked(tg.key) ? ' checked' : ''}> <span>${esc(tg.label)}</span></label>`).join('');
    const body = `<div class="cols-sec">
      <div class="cols-sec-h">在单据上显示哪些列</div>
      <div class="col-toggles">${chkRow(colToggles)}</div>
    </div>
    <div class="cols-sec">
      <div class="cols-sec-h">其它选项</div>
      <div class="col-toggles one-col">${chkRow(otherToggles)}</div>
    </div>
    <div class="hint cols-tip">
      <b>没填的内容不会印在单据上</b>；想让空白行也占位（方便手写补填），勾「空字段也保留位置」。
      ${packing ? '装箱单默认显示件数 / 毛净重 / 体积。' : '勾「显示图片列」后每行可上传产品图，传了图会自动勾上。'}
    </div>
    ${layoutPicker}
    ${doc.type === 'bank' || doc.type === 'declaration_elements' ? '' : `
    <div class="field" style="margin-top:14px">
      <label>列顺序 <span class="hint" style="font-weight:400">（点 ◀ 把该列往前移）</span></label>
      <div class="col-order-chips">
        ${(itemColumns(doc.type, doc) || []).map((col, i) => `
          <span class="col-chip${i === 0 ? ' fixed' : ''}">
            ${esc(String(col.label || '').startsWith('extra:') ? String(col.label).slice(6) : (tableLabels(doc.docLang)[col.label] || col.label))}
            ${i === 0 ? '' : `<button type="button" class="chip-move" data-colup="${col.key}" title="往前移一位">◀</button>`}
          </span>`).join('')}
      </div>
    </div>`}`;
    if (!['declaration_elements', 'bill_of_lading', 'customs_declaration'].includes(doc.type)) html.push(section('cols', `🧱 ${t('tab.columns')}`, body));
  }


  /* 集装箱（柜）/ 多柜拆分 功能已移除（用户要求去掉） */

  /* --- 申报要素表：列设置（显示哪些列 + 自定义列） --- */
  if (doc.type === 'declaration_elements') {
    html.push(renderDeclColsSection(doc));
  }

  /* --- 产品明细 --- */
  html.push(renderItemsSection(doc));

  /* --- 交货与售后（报价单 / PI / 合同 常用） --- */
  if (docMeta(doc.type).mode === 'money' && doc.type !== 'pl') {
    const logiFields = [
      { key: 'deliveryPlace', label: 'f.deliveryPlace', span: 1, tip: '如 客户指定处 / 上海港' },
      { key: 'productionTime', label: 'f.productionTime', span: 1, tip: '如 30 天 / 30 working days' },
      { key: 'warranty', label: 'f.warranty', span: 1, tip: '如 保修期 12 个月' },
      { key: 'invoiceType', label: 'f.invoiceType', type: 'text', span: 1, list: 'invoiceTypeList',
        placeholder: '可下拉选，也可自己输入',
        tip: '下拉里是常见的几种，也可以直接输入自己的（如「形式发票」「收据」）' },
      { key: 'sampleNote', label: 'f.sampleNote', type: 'textarea', span: 4, rows: 2, placeholder: '如 样品费可在正式下单后全额退还；样品 5-7 天可出' },
    ].filter((f) => !f.show || f.show(doc));
    const logiBody = `<div class="grid grid-2">${logiFields.map((f) => fieldHtml(f, f.key)).join('')}</div>`;
    html.push(section('logistics', `🚚 ${t('tab.logistics')}`, logiBody));
  }

  /* --- 逐行字段：只给真正需要的单据（提单→唛头，报关单→境内货源地） --- */
  {
    const rowField = doc.type === 'bill_of_lading' ? 'marks'
      : (doc.type === 'customs_declaration' ? 'domesticSource' : null);
    if (false && rowField && (doc.items || []).length) {   // 已并入商品行
      const isMarks = rowField === 'marks';
      const head = isMarks ? '唛头 Marks' : '境内货源地';
      const tip = isMarks
        ? '每行可填各自的唛头（可多行）；留空则用上面「唛头」的统一值。'
        : '每行可填各自的境内货源地；留空则用「报关信息」里的统一值。';
      const rows = (doc.items || []).map((it, i) => {
        const cell = isMarks
          ? `<textarea data-bind="items.${i}.marks" class="ie-marks" placeholder="如 SUNVL / HAMBURG / CTN NO. 1-50">${esc(it.marks || '')}</textarea>`
          : `<input type="text" data-bind="items.${i}.domesticSource" value="${esc(it.domesticSource || '')}" placeholder="如 SHENZHEN" />`;
        return `<tr><td class="ie-no">${i + 1}</td><td>${cell}</td></tr>`;
      }).join('');
      html.push(section('itemextra', `🏷️ 逐行${head}`,
        `<div class="hint" style="font-size:12px;color:var(--c-text-mute);margin-bottom:6px">${tip}</div>
         <table class="wsa-form-table item-extra-table">
           <thead><tr><th style="width:36px">行</th><th>${head}</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>`));
    }
  }


  /* --- 条款与备注 ---
   * ⚠️ 只在**用得上条款**的单据上出现：水单 / 报关单 / 提单 都是专用版式，不渲染条款区，
   *    给它们摆一个「条款与条件」输入框只会让人白填（用户反馈：用不到就隐藏）。
   *    备注框（remarks）这些单据照样要用，所以那一格保留。 */
  const termsHead = `<button class="btn btn-sm" data-act="pick-clause">📑 ${t('lib.selectClause')}</button>
    <button class="btn btn-sm" data-act="save-clause">💾 ${t('btn.saveToLibrary')}</button>`;
  const tpl = getTemplate(doc.docLang);
  const termsField = {
    key: 'terms',
    label: 'f.terms',
    type: 'textarea',
    span: 4,
    rows: 6,
    placeholder: tpl.defaults?.[doc.type === 'quotation' ? 'quotationTerms' : 'piTerms'] || '',
  };
  const withTerms = usesTermsField(doc.type);
  let termsBody = withTerms
    ? `<div class="grid grid-4">${fieldHtml(termsField, 'terms')}${fieldHtml(REMARKS_FIELD, 'remarks')}</div>`
    : `<div class="grid grid-4">${fieldHtml(REMARKS_FIELD, 'remarks')}</div>`;
  if (meta.withContract) {
    termsBody = `${renderClauseEditor(doc)}<div class="grid grid-4">${fieldHtml(REMARKS_FIELD, 'remarks')}</div>`;
    termsBody += `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-sm" data-act="load-contract-clauses">📄 ${t('btn.loadTemplate')}</button>
      <button class="btn btn-sm" data-act="pick-clause">📑 ${t('lib.selectClause')}</button>
      <button class="btn btn-sm" data-act="save-clause">💾 ${t('btn.saveToLibrary')}</button></div>`;
  }
  /* 交货条款：跟条款填在一起（报价单 / 合同 用得上） */
  if (doc.type === 'quotation' || meta.withContract) {
    termsBody += `<div class="grid grid-4" style="margin-top:10px">${fieldHtml({ key: 'deliveryTerms', label: 'f.deliveryTerms', span: 4, type: 'textarea', rows: 2 }, 'deliveryTerms')}</div>`;
  }

  html.push(section('terms', `📝 ${t('tab.terms')}`, termsBody, meta.withContract ? '' : termsHead));


  /* --- 报关单专有：报关信息（对照官方《中华人民共和国海关出口货物报关单》补齐） ---
   * 排列顺序**刻意跟单据上的格子一致**，分 4 组，找字段时不用来回扫。
   * 大部分格子每票都差不多（申报人 / 监管方式 / 关别 / 口岸…），所以都开了「输入历史 + 常用选项」，
   * 填过一次以后下拉里就能直接选。 */
  if (doc.type === 'customs_declaration') {
    const YESNO = [{ value: '否', label: '否' }, { value: '是', label: '是' }];
    const F = (key, label, span = 1, extra = {}) => ({ key, label, span, list: true, ...extra });
    const groups = [
      { title: t('f.grpBasic'), fields: [
        F('preEntryNo', 'f.preEntryNo', 2, { tip: 'f.tipPreEntryNo' }),
        F('customsNo', 'f.customsNo', 2, { tip: 'f.tipCustomsNo' }),
        // 官方表格里只有「监管方式」，没有单独的申报类型 / 贸易方式 → 不再摆这两个输入口
        F('consignmentNo', 'f.consignmentNo'),
        F('recordNo', 'f.recordNo'),
        F('licenseNo', 'f.licenseNo'),
        { key: 'declarationDate', label: 'f.declarationDate', type: 'date', span: 1 },
        { key: 'exportDate', label: 'f.exportDate', type: 'date', span: 1 },
        F('supervisionMode', 'f.supervisionMode'),
        // 境内货源地：整单默认值（产品行没填时用它），报关单第 8 栏必填
        F('domesticSource', '境内货源地 Domestic source', 2),
      ] },
      { title: t('f.grpParties'), fields: [
        F('shipperCreditCode', 'f.shipperCreditCode', 2, { tip: 'f.tipShipperCredit' }),
        F('producerName', 'f.producerName', 1, { tip: 'f.tipProducer' }),
        F('producerCode', 'f.producerCode'),
        F('declareUnit', 'f.declareUnit', 2, { tip: 'f.tipDeclareUnit' }),
        F('declareUnitCode', 'f.declareUnitCode'),
        F('declarantName', 'f.declarantName'),
        F('declarantCode', 'f.declarantCode', 1, { tip: 'f.tipDeclarantCode' }),
        F('declarantPhone', 'f.declarantPhone'),
      ] },
      { title: t('f.grpTransport'), fields: [
        F('tradeCountry', 'f.tradeCountry'),
        F('destinationCountry', 'f.destinationCountry', 1, { tip: 'f.tipDestCountry' }),
        F('exitCustoms', 'f.exitCustoms'),
        F('exitPort', 'f.exitPort'),
        F('destPort', 'f.destPort'),
        F('dutyNature', 'f.dutyNature'),
        F('shippingMethod', 'f.shippingMethod', 1, { tip: 'f.tipShippingMethod' }),
        F('vesselVoyage', 'f.vesselVoyage'),
        F('blNo', 'f.blNo'),
        F('packageType', 'f.packageType', 1, { tip: 'f.tipPackageType' }),
        F('attachedDocs', 'f.attachedDocs', 2),
      ] },
      { title: t('f.grpSign'), fields: [
        { key: 'relatedPartyConfirm', label: 'f.relatedPartyConfirm', type: 'select', options: YESNO, span: 1 },
        { key: 'priceImpactConfirm', label: 'f.priceImpactConfirm', type: 'select', options: YESNO, span: 1 },
        { key: 'royaltyConfirm', label: 'f.royaltyConfirm', type: 'select', options: YESNO, span: 1 },
        { key: 'selfDeclaration', label: 'f.selfDeclaration', type: 'select', options: YESNO, span: 1 },
        F('declarantSignature', 'f.declarantSignature'),
        { key: 'signatureDate', label: 'f.signatureDate', type: 'date', span: 1 },
        { key: 'declaration', label: 'f.declaration', span: 2, type: 'textarea', rows: 2 },
        { key: 'customsRemark', label: 'f.customsRemark', span: 2, type: 'textarea', rows: 2, tip: 'f.tipCustomsRemark' },
      ] },
    ];
    const subHead = (txt) => `<div style="grid-column:1/-1;font-size:12px;font-weight:600;color:var(--c-text);margin:10px 0 0;padding-top:9px;border-top:1px dashed var(--c-border)">${esc(txt)}</div>`;
    const body = groups.map((g) => subHead(g.title)
      + `<div class="grid grid-4">${g.fields.map((f) => fieldHtml(f, f.key)).join('')}</div>`).join('');
    html.push(section('customsInfo', `🛃 ${t('tab.customsInfo')}`,
      `<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:4px">
         <div class="hint" style="flex:1;font-size:12px;color:var(--c-text-mute);line-height:1.6">${t('f.customsHint')}</div>
         <button class="btn btn-sm" data-act="clear-customs" title="${t('msg.confirmClearCustoms')}">🧹 ${t('btn.clearCustoms')}</button>
       </div>` + body));
  }

  /* --- 报价单专有：整单最小起订量 / 交货条款 / 签名 --- */
  if (doc.type === 'quotation') {
    const qFields = [
      { key: 'signatureName', label: 'f.signatureName', span: 1 },
      { key: 'signatureTitle', label: 'f.signatureTitle', span: 1 },
      { key: 'signatureDate', label: 'f.signatureDate', type: 'date', span: 1 },
    ];
    html.push(section('quotationSign', `✍️ ${t('tab.contractSign')}`,
      `<div class="grid grid-4">${qFields.map((f) => fieldHtml(f, f.key)).join('')}</div>`));
  }

  /* --- 合同专有：签署与装运（对照 exradoc 的 Trade Contract 字段补齐） --- */
  if (meta.withContract) {
    const signFields = [
      { key: 'placeOfSigning', label: 'f.placeOfSigning', span: 1, tip: 'tip.placeOfSigning' },
      { key: 'shipmentDate', label: 'f.shipmentDate', span: 1, type: 'date', tip: 'tip.shipmentDate' },
      { key: 'insuranceTerms', label: 'f.insuranceTerms', span: 2, type: 'textarea', rows: 2 },
      { key: 'penaltyClause', label: 'f.penaltyClause', span: 2, type: 'textarea', rows: 2 },
      { key: 'sellerSigner', label: 'f.sellerSigner', span: 1, tip: 'tip.signer' },
      { key: 'sellerSignerTitle', label: 'f.sellerSignerTitle', span: 1 },
      { key: 'sellerSignDate', label: 'f.signDate', span: 1, type: 'date' },
      { key: 'buyerSigner', label: 'f.buyerSigner', span: 1 },
      { key: 'buyerSignerTitle', label: 'f.buyerSignerTitle', span: 1 },
      { key: 'buyerSignDate', label: 'f.signDate', span: 1, type: 'date' },
    ];
    html.push(section('contractSign', `✍️ ${t('tab.contractSign')}`,
      `<div class="grid grid-4">${signFields.map((f) => fieldHtml(f, f.key)).join('')}</div>`));
  }

  /* --- 银行信息（PI / CI / 合同：单据上会渲染，所以都要能编辑）
   * 报价单（两栏版式带银行块）与装箱单（第 6 条卖方信息带银行明细）也会印银行，必须能填 --- */
  if (meta.withBank || doc.type === 'quotation' || doc.type === 'pl') {
    const bankFields = [
      { key: 'beneficiary', label: 'f.beneficiary', span: 2 },
      { key: 'bankName', label: 'f.bankName', span: 2 },
      { key: 'bankAddress', label: 'f.bankAddress', span: 2 },
      { key: 'accountNo', label: 'f.accountNo', span: 2 },
      { key: 'swift', label: 'f.swift', span: 1 },
      { key: 'iban', label: 'f.iban', span: 1 },
    ];
    // 单据级的付款银行字段（不在 doc.bank 里，是顶层字段）
    // 开证行只在信用证付款时才用得上，按单据类型显示
    const docBankFields = [
      { key: 'beneficiaryAccount', label: 'f.beneficiaryAccount', span: 1, tip: 'f.beneficiaryAccountTip' },
    ];
    if (doc.type === 'contract' || doc.type === 'pi' || doc.type === 'ci' || doc.type === 'quotation') {
      docBankFields.push({ key: 'payingBank', label: 'f.payingBank', span: 1, tip: 'f.payingBankTip' });
    }
    const hasBankLib = (state.banks || []).length > 0;
    const bankBody = `<div class="lib-pick-bar">
        <button type="button" class="btn btn-sm" data-act="pick-bank" title="从收款银行库选一个，整栏填好">🏦 从银行库选择${hasBankLib ? `（${(state.banks || []).length}）` : ''}</button>
        <button type="button" class="btn btn-sm" data-act="save-bank" title="把当前填的银行信息存进银行库，下次一键套用">💾 存为常用银行</button>
        <span class="hint">${hasBankLib ? '存一次，以后所有单据通用' : '存一次，以后所有单据一键套用'}</span>
      </div>
    <div class="grid grid-2">
      ${bankFields.map((f) => fieldHtml(f, `bank.${f.key}`)).join('')}
      ${docBankFields.map((f) => fieldHtml(f, f.key)).join('')}
      <div class="field span-2"><label>${t('f.preparedBy')}</label><input type="text" data-bind="preparedBy" value="${esc(doc.preparedBy || '')}" /></div>
    </div>`;
    html.push(section('bank', `🏦 ${t('tab.bank')}`, bankBody));
  }

  host.innerHTML = html.join('') + renderDatalists();

  /* 商品明细独立视图：商品多时单独一页填，不再和单据信息挤在一起 */
  if (doc) {
    const view = ['items', 'party'].includes(state._formView) ? state._formView : 'doc';
    // 商品明细容器是 section.items-wrap[data-section="items"]（不是 .card）
    const itemsCard = host.querySelector('[data-section="items"]');
    const bar = document.createElement('div');
    bar.className = 'form-view-bar';
    bar.innerHTML = `
      <button type="button" class="fv-btn${view === 'doc' ? ' active' : ''}" data-formview="doc">📋 单据信息</button>
      <button type="button" class="fv-btn${view === 'party' ? ' active' : ''}" data-formview="party">👤 买卖双方与银行</button>
      <button type="button" class="fv-btn${view === 'items' ? ' active' : ''}" data-formview="items">📦 商品明细 <span class="fv-n">${(doc.items || []).length}</span></button>`;
    host.insertBefore(bar, host.firstChild);
    // 三个视图：单据信息 / 买卖双方与银行 / 商品明细
    const PARTY_KEYS = ['seller', 'buyer', 'bank'];
    const partyCards = [...host.querySelectorAll('section.card')].filter((c) => PARTY_KEYS.includes(c.getAttribute('data-section')));
    const hideAll = (keep) => {
      [...host.children].forEach((el) => {
        if (el === bar) return;
        if (el === itemsCard) { el.style.display = keep.includes(itemsCard) ? '' : 'none'; return; }
        if (el.tagName === 'SECTION' || el.classList.contains('card')) {
          el.style.display = keep.includes(el) ? '' : 'none';
        }
      });
    };
    if (view === 'items') hideAll([itemsCard].filter(Boolean));
    else if (view === 'party') hideAll(partyCards);
    else {
      // 单据信息页：卖方 / 买方 / 银行 已有独立页面，这里不再重复
      if (itemsCard) itemsCard.style.display = 'none';
      partyCards.forEach((c) => { c.style.display = 'none'; });
    }
    bar.querySelectorAll('[data-formview]').forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault();
        state._formView = b.getAttribute('data-formview');
        renderForm(host, onRefreshPreview);
      };
    });
  }
  applyItemPlaceholders(host);      // 空白单据：明细格子也要有灰色填写示例
  bindFormEvents(host, onRefreshPreview);
}

/* ============================ 产品明细区 ============================ */

/** 哪些单据支持"集装箱（柜）"清单 */
const CONTAINER_DOC_TYPES = ['bill_of_lading', 'shipping_instruction'];

/**
 * 集装箱（柜）区块
 *
 * 用途：一票货装 2~3 个柜时，把柜号/封号/柜型记在这里；明细行选「装柜」，
 * 装箱单就能**按柜分组小计**，并可一键**按柜拆分成多张箱单**。
 * 只在装箱单 / 提单 / 装船指示 上出现。
 */
/**
 * 申报要素表 —— 列设置
 *
 * 用户要求：可以自己选择显示哪些列、添加哪些、隐藏哪些。
 * 内置 11 列是勾选框（取消勾选 = 这张单不印该列）；自定义列可以新增/改名/删除。
 */
/** 品牌类型 / 出口享惠情况的标准选项（下拉，避免手打出差异） */
const DE_BRAND_TYPES = [
  { value: '', label: '— 未选 —' },
  { value: '无品牌', label: '无品牌' },
  { value: '境内自主品牌', label: '境内自主品牌' },
  { value: '境外品牌（贴牌生产）', label: '境外品牌（贴牌生产）' },
  { value: '境外品牌（其他）', label: '境外品牌（其他）' },
];
const DE_PREFERENTIALS = [
  { value: '', label: '— 未选 —' },
  { value: '无出口享惠', label: '无出口享惠' },
  { value: '不确定', label: '不确定' },
  { value: '享受优惠', label: '享受优惠（如协定税率）' },
];

let deColsReorder = false;   // 「调整顺序」模式开关（不存进单据，纯 UI 状态）

const DE_COLUMNS = [
  { key: 'hsCode', label: 'HS code' },
  { key: 'brandType', label: '品牌类型' },
  { key: 'preferential', label: '出口享惠情况' },
  { key: 'usagePurpose', label: '用途' },
  { key: 'material', label: '材质' },
  { key: 'description', label: '名称' },
  { key: 'model', label: '型号' },
  { key: 'specText', label: '规格' },
  { key: 'gtin', label: 'GTIN' },
  { key: 'cas', label: 'CAS' },
  { key: 'remark', label: '其他' },
];

function renderDeclColsSection(doc) {
  const show = doc.showCols || {};
  const on = (k) => show[k] !== false;
  const extra = Array.isArray(doc.extraCols) ? doc.extraCols : [];
  /* 当前列顺序：doc.colOrder 优先，其余按默认顺序补在后面 */
  const allKeys = DE_COLUMNS.map((c) => c.key).concat(extra.map((c) => `ext:${c.id}`));
  const order = (Array.isArray(doc.colOrder) && doc.colOrder.length ? doc.colOrder : [])
    .filter((k) => allKeys.includes(k))
    .concat(allKeys.filter((k) => !(doc.colOrder || []).includes(k)));
  const labelOf = (k) => {
    if (String(k).startsWith('ext:')) {
      const c = extra.find((x) => x.id === String(k).slice(4));
      return c ? c.label : k;
    }
    return (DE_COLUMNS.find((c) => c.key === k) || {}).label || k;
  };
  /* 顺序表：每列一个 ↑↓（只在"调整顺序"模式下显示） */
  const orderRows = order.map((k, i) => `<div class="lib-row" style="margin:0 0 4px">
      <div class="info"><div class="nm" style="font-weight:500">
        <label class="chk" style="display:inline-flex;font-weight:400">
          <input type="checkbox" data-decol="${k}"${on(k) ? ' checked' : ''} style="width:auto"> <span>${esc(labelOf(k))}</span>
        </label>
      </div></div>
      <button class="mini-btn" data-decol-up="${k}" title="往前移" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="mini-btn" data-decol-down="${k}" title="往后移" ${i === order.length - 1 ? 'disabled' : ''}>↓</button>
      ${String(k).startsWith('ext:') ? `<button class="mini-btn danger" data-decol-del="${String(k).slice(4)}" title="删除这一列">✕</button>` : ''}
    </div>`).join('');
  /* 普通模式：只有一行行的勾选框，紧凑；排序/改名/删除收进「调整顺序」里 */
  const compactBoxes = order.map((k) => `<label class="chk"><input type="checkbox" data-decol="${k}"${on(k) ? ' checked' : ''}> <span>${esc(labelOf(k))}</span></label>`).join('');
  const extraRows = extra.length
    ? order.filter((k) => String(k).startsWith('ext:')).map((k) => {
      const c = extra.find((x) => x.id === String(k).slice(4));
      return `<div class="lib-row" style="margin:0 0 6px">
        <div class="info"><div class="nm">
          <input type="text" data-decol-rename="${c.id}" value="${esc(c.label)}" style="width:160px" />
        </div></div>
        <button class="mini-btn danger" data-decol-del="${c.id}" title="删除这一列">✕</button>
      </div>`;
    }).join('')
    : '';
  const body = deColsReorder
    ? `
    <div class="hint" style="font-size:12px;margin-bottom:8px">
      用 <b>↑ ↓</b> 调整列的先后顺序（比如把「容积L」移到最前面）；勾掉 = 这张表不印该列。
    </div>
    ${orderRows}
    <div style="margin-top:12px;border-top:1px dashed var(--c-line,#e5e7eb);padding-top:10px">
      <div class="hint" style="font-size:12px;margin-bottom:6px"><b>自定义列</b>（如 容积L / 最低温度℃ / 结构）——可改名、可删除</div>
      ${extraRows || `<div class="hint" style="font-size:12px">还没有自定义列。</div>`}
      <button class="btn btn-sm btn-accent" data-decol-add="1" ${extra.length >= 5 ? 'disabled' : ''}>
        ＋ 添加自定义列${extra.length >= 5 ? '（已达上限 5 个）' : ''}
      </button>
    </div>
    <div style="margin-top:10px"><button class="btn btn-sm btn-primary" data-deorder-toggle="1">✓ 完成</button></div>`
    : `
    <div class="hint" style="font-size:12px;margin-bottom:8px">勾掉 = 这张表不印该列（数据不会丢，随时勾回来）。</div>
    <div class="col-toggles">${compactBoxes}</div>
    <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-sm" data-deorder-toggle="1">⇅ 调整顺序 / 自定义列</button>
      <span class="hint" style="font-size:12px">需要把某一列挪位置、改名或删除时点这里</span>
    </div>`;
  return section('decols', `🧱 表格列 ${deColsReorder ? '（调整中）' : ''} <span class="hint">${order.filter((k) => on(k)).length} 列</span>`, body);
}

function renderContainersSection(doc) {
  const list = Array.isArray(doc.containers) ? doc.containers : [];
  const typeOpts = CONTAINER_TYPES.map((x) => `<option value="${x}">${x}</option>`).join('');
  const rowHtml = (c, i) => `<tr data-ctn-row="${i}">
    <td class="col-no">${i + 1}</td>
    <td><input type="text" data-bind="containers.${i}.no" value="${esc(c.no || '')}" placeholder="如 MSKU1234567" /></td>
    <td><input type="text" data-bind="containers.${i}.seal" value="${esc(c.seal || '')}" placeholder="如 SL-88990011" /></td>
    <td><select data-bind="containers.${i}.type">${
      CONTAINER_TYPES.map((x) => `<option value="${x}"${(c.type || '40HQ') === x ? ' selected' : ''}>${x}</option>`).join('')
    }</select></td>
    <td class="col-tools"><button type="button" class="btn btn-sm" data-ctn-del="${i}" title="删除这个柜">✕</button></td>
  </tr>`;
  const rows = list.length
    ? list.map((c, i) => rowHtml(c, i)).join('')
    : `<tr><td colspan="5" class="hint" style="padding:10px;text-align:center">还没有柜。一票货装 2~3 个柜时在这里加；只有一个柜可以不加。</td></tr>`;
  const used = (doc.items || []).filter((it) => it.containerId).length;
  const body = `<table class="ctn-table"><thead><tr>
      <th class="col-no">#</th><th>柜号</th><th>封号</th><th style="width:96px">柜型</th><th class="col-tools"></th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="ctn-actions">
      <button class="btn btn-sm btn-accent" data-ctn-add="1">＋ 添加柜</button>
      ${list.length > 1 ? `<button class="btn btn-sm" data-ctn-split="1" style="display:none" title="每柜生成一张装箱单">🚢 按柜拆分生成箱单</button>` : ''}
      <span class="hint">${
        list.length
          ? `共 ${list.length} 个柜，明细里已分配 ${used} 行${used ? '' : '（还没选柜，箱单会按整票打印）'}`
          : '只装一个柜时不用加，箱单照旧'
      }</span>
    </div>`;
  return section('containers', `🚢 集装箱（柜） <span class="hint">多柜时用</span>`, body);
}

function renderItemsSection(doc) {
  // 必须把 doc 传进去，否则 hideWeight / showWeight 这类显示开关不生效（表单会和预览不一致）
  // 再滤掉「所有行都不需要」的列，和单据预览保持一致
  const drop = columnsHiddenByRows(doc);
  const cols = itemColumns(doc.type, doc).filter((c) => !drop.has(c.key));
  const labels = tableLabels(doc.docLang);
  const meta = docMeta(doc.type);

  const head = `<div class="items-head">
    <span>🧾 ${t('tab.items')}</span>
    <span class="hint">${doc.items.length} ${t('sum.items')}</span>
    <div class="spacer"></div>
    <button class="btn btn-sm" data-act="pick-product">📦 ${t('lib.selectProduct')}</button>
    ${doc.type === 'declaration_elements'
      ? `<button class="btn btn-sm btn-primary" data-act="pick-decl">📋 从产品库勾选</button>`
      : ''}
    <button class="btn btn-sm btn-accent" data-act="add-row">${t('btn.addRow')}</button>
  </div>`;

  const th = cols.map((c) => {
    const tipMap = {
      photo: 'tip.photo', description: 'f.description', model: 'f.model', hsCode: 'tip.hsCode',
      unit: 'f.unit', qty: 'tip.qty', unitPrice: 'tip.unitPrice', amount: 'tip.amount',
      ctns: 'tip.ctns', nw: 'tip.nw', gw: 'tip.gw', meas: 'tip.meas',
    };
    const tip = tipMap[c.key] ? ` title="${esc(t(tipMap[c.key]))}"` : '';
    // 自定义列（申报要素）标签是 "extra:容积L"，别再查表
    const raw = String(c.label || '');
    const lbText = raw.startsWith('extra:') ? raw.slice(6) : (labels[raw] || raw);
    return `<th class="${c.cls}"${tip}>${esc(lbText)}</th>`;
  }).join('') + `<th class="col-tools">${t('items.tools')}</th>`;

  const rows = doc.items.map((it, i) => itemRowHtml(it, i, doc, cols)).join('');

  const totals = meta.mode === 'packing'
    ? `<div class="items-total">
        <div class="kv"><span>${t('sum.totalQty')}</span><strong>${qty(doc.totals.totalQty)} ${esc(doc.items[0]?.packUnit || DEFAULT_PACK_UNIT)}</strong></div>
        <div class="kv"><span>${t('f.totalNw')}</span><strong>${qty(doc.totals.totalNw)} ${esc(doc.items[0]?.weightUnit || DEFAULT_WEIGHT_UNIT)}</strong></div>
        <div class="kv"><span>${t('f.totalGw')}</span><strong>${qty(doc.totals.totalGw)} ${esc(doc.items[0]?.weightUnit || DEFAULT_WEIGHT_UNIT)}</strong></div>
        <div class="kv"><span>${t('f.totalMeas')}</span><strong>${qty(doc.totals.totalMeas)} ${esc(doc.items[0]?.measUnit || DEFAULT_MEAS_UNIT)}</strong></div>
      </div>`
    : `<div class="items-total">
        <div class="kv"><span>${t('sum.totalQty')}</span><strong data-total="qty">${qty(doc.totals.totalQty)}</strong></div>
        <div class="kv"><span>${t('sum.totalAmount')}</span><strong data-total="amount">${esc(doc.currency)} ${money(doc.totals.totalAmount)}</strong></div>
      </div>`;

  // 报关单专属：同类项合并开关 + 实时合并结果提示
  // （客户需求：只要 HS 编码 + 品名一样就合并成一项申报，别重复列项）
  let mergeBar = '';
  if (doc.type === 'customs_declaration') {
    const on = doc.mergeSameItems !== false;
    const rows = doc.items.filter((it) => (it.description || '').trim() || (it.hsCode || '').trim());
    let mergedCount = rows.length;
    let conflicts = null;
    if (on && rows.length > 1) {
      try {
        const r = analyzeCustomsMerge(rows, doc);
        mergedCount = r.items.length;
        conflicts = r.conflicts;
      } catch { mergedCount = rows.length; }
    }
    const saved = rows.length - mergedCount;
    // 单位 / 原产国 / 目的国 / 征免 在同一组里不一致时，海关要求这些栏一致 —— 明确提醒，不能悄悄吞掉
    const warnBits = [];
    if (conflicts) {
      if (conflicts.unit.length) warnBits.push(`单位不一致：${conflicts.unit.slice(0, 3).join('；')}`);
      if (conflicts.origin.length) warnBits.push(`原产国不一致：${conflicts.origin.slice(0, 3).join('；')}`);
      if (conflicts.dest.length) warnBits.push(`目的国不一致：${conflicts.dest.slice(0, 3).join('；')}`);
      if (conflicts.duty.length) warnBits.push(`征免不一致：${conflicts.duty.slice(0, 3).join('；')}`);
    }
    mergeBar = `<div class="merge-bar">
      <label class="hint" style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:12.5px;cursor:pointer">
        <input type="checkbox" data-bind-flag="mergeSameItems" ${on ? 'checked' : ''} style="width:auto" />
        <b>合并同类项申报</b>（只要 <b>HS 编码 + 品名</b> 一样就合并成一项，数量、金额相加）
      </label>
      ${on && saved > 0
        ? `<span class="merge-tip ok">已合并：${rows.length} 行 → <b>${mergedCount} 项</b>（数量、总价合计不变）</span>`
        : on ? '<span class="merge-tip">当前没有可合并的同类项（HS 编码 + 品名 都相同才会合并）</span>'
          : '<span class="merge-tip">已关闭：明细按行逐项申报</span>'}
      ${warnBits.length ? `<div class="merge-warn">⚠ ${warnBits.join('；')} —— 已按第一行取值，报关前请核对</div>` : ''}
    </div>`;
  }

  return `<section class="items-wrap${state.itemsCompact ? ' compact' : ''}" data-section="items">${head}
    ${mergeBar}
    <div class="items-scroll"><table class="item-table"><thead><tr>${th}</tr></thead>
    <tbody id="itemBody">${rows}</tbody></table></div>${totals}</section>`;
}

/**
 * 明细表在「表格模式」与「窄栏卡片模式」之间自动切换
 * 依据：编辑区可用宽度能否放下所有列
 * 被拖窄时切卡片模式，字段一行一个、带标签，不会再出现几十像素的输入框
 */
export function syncItemsLayout() {
  const host = document.getElementById('formHost');
  if (!host) return;
  const wrap = host.querySelector('.items-wrap');
  if (!wrap) return;
  const pane = document.getElementById('paneLeft');
  if (!pane) return;

  const avail = pane.clientWidth - 24;              // 减去 items-wrap 的左右外边距
  // 表格模式放得下所有列所需的最小宽度：
  // 序号34 + 图片58 + 描述200 + 型号88 + HS92 + 单位84 + 数量74 + 单价84 + 操作104 ≈ 818
  // 放不下就切卡片模式（宁可纵向排，也不要几十像素的输入框）
  const need = 820;
  const compact = avail < need;
  const isCompact = wrap.classList.contains('compact');
  state.itemsCompact = compact;
  if (compact !== isCompact) wrap.classList.toggle('compact', compact);
}

function itemRowHtml(it, i, doc, cols) {
  const L = tableLabels(doc.docLang);
  const labels = L;                 // 与表头共用同一份列名，窄栏模式当字段标签用
  const tipFor = (key) => {
    const map = {
      photo: 'tip.photo', description: 'f.description', model: 'f.model',
      hsCode: 'tip.hsCode', unit: 'f.unit', qty: 'tip.qty',
      unitPrice: 'tip.unitPrice', amount: 'tip.amount',
      ctns: 'tip.ctns', nw: 'tip.nw', gw: 'tip.gw', meas: 'tip.meas',
    };
    return map[key] ? t(map[key]) : '';
  };
  const cells = cols.map((c) => {
    // 每个字段包一层 .fld：表格模式只显示控件，窄栏（卡片）模式会显示左侧标签
    const field = (label, inner, extraCls = '') =>
      `<div class="fld${extraCls}"><span class="lb">${esc(label)}</span><span class="fc">${inner}</span></div>`;
    const lb = labels[c.label] || c.label;

    // 申报要素的「自定义列」：值存在 items.N.ext[列id]
    if (String(c.key).startsWith('ext.')) {
      const colId = String(c.key).slice(4);
      const cur = (it.ext && it.ext[colId]) || '';
      const colLabel = String(c.label || '').startsWith('extra:') ? String(c.label).slice(6) : colId;
      return `<td class="${c.cls}">${field(colLabel,
        `<input type="text" data-bind="items.${i}.ext.${colId}" value="${esc(cur)}" />`)}</td>`;
    }

    // 品牌类型 / 出口享惠情况：只有几种标准说法 → 下拉（避免手打出差异）
    if (c.key === 'brandType' || c.key === 'preferential') {
      const opts = c.key === 'brandType' ? DE_BRAND_TYPES : DE_PREFERENTIALS;
      const cur = String(it[c.key] || '');
      const has = opts.some((o) => o.value === cur);
      const list = (has ? opts : opts.concat([{ value: cur, label: cur || '— 未选 —' }]))
        .map((o) => `<option value="${esc(o.value)}"${o.value === cur ? ' selected' : ''}>${esc(o.label)}</option>`)
        .join('');
      return `<td class="${c.cls}">${field(lb, `<select data-bind="items.${i}.${c.key}">${list}</select>`)}</td>`;
    }

    switch (c.key) {
      case 'ext': {
        // 不该出现（自定义列走下面 startsWith('ext.') 的分支）
        return '<td></td>';
      }
      case 'containerId': {
        // 装柜：从单据的柜清单里选（未分配 = 空）
        const ctnList = Array.isArray(doc.containers) ? doc.containers : [];
        const ctnOpts = [`<option value="">未分配</option>`]
          .concat(ctnList.map((x) => `<option value="${esc(x.id)}"${x.id === it.containerId ? ' selected' : ''}>${esc(x.no || '(未填柜号)')}</option>`))
          .join('');
        return `<td class="col-ctn-sel">${field(lb, `<select data-bind="items.${i}.containerId" title="这一行装哪个柜">${ctnOpts}</select>`)}</td>`;
      }
      case 'no':
        return `<td class="col-no">
          <div class="row-num"><span class="drag-handle" draggable="true" title="按住拖动可调整顺序">⠿</span> ${i + 1}</div></td>`;
      case 'photo':
        return `<td class="photo-cell col-photo">${field(lb, `<div class="photo-thumb" data-photo-row="${i}" data-act="photo" title="${esc(tipFor('photo'))}" style="${it.photo ? `background-image:url('${it.photo}')` : ''}">${it.photo ? '' : '＋'}</div>`)}</td>`;
      case 'amount':
        return `<td class="amount-cell col-money" data-row-amount="${i}">${money(it.amount)}</td>`;
      case 'description': {
        const listId = histListId(`items.${i}.description`);
        const hasList = suggestionsFor(`items.${i}.description`).length ? ` list="${listId}"` : '';
        return `<td class="col-desc desc-cell">${field(lb,
          `<textarea data-bind="items.${i}.description" rows="2" title="${esc(tipFor('description'))}"${hasList} placeholder="${esc(L.description)}">${esc(it.description)}</textarea>`)}</td>`;
      }
      case 'unit':
        return `<td class="col-unit">${field(lb,
          `<select data-bind="items.${i}.unit" title="${esc(tipFor('unit'))}">${UNITS.map((u) => `<option value="${u}"${u === it.unit ? ' selected' : ''}>${esc(UNIT_CN[u] ? `${u}（${UNIT_CN[u]}）` : u)}</option>`).join('')}</select>`)}</td>`;
      case 'qty': {
        // 装箱单：这一列是「件数（箱数）」，和包装单位配对，绑定到 ctns
        if (docMeta(doc.type).mode === 'packing') {
          return `<td class="col-qty">${field(lb,
            `<div class="unit-pair">
              <input type="text" inputmode="decimal" autocomplete="off" data-num="1" data-bind="items.${i}.ctns" data-cast="number" title="${esc(tipFor('ctns'))}" value="${esc(it.ctns ?? '')}" />
              <select data-bind="items.${i}.packUnit" title="包装单位">${PACK_UNITS.map((u) => `<option value="${u}"${u === (it.packUnit || DEFAULT_PACK_UNIT) ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
            </div>`)}</td>`;
        }
        return `<td class="col-qty">${field(lb,
          `<input type="text" inputmode="decimal" autocomplete="off" data-num="1" data-bind="items.${i}.qty" data-cast="number" title="${esc(tipFor('qty'))}" value="${esc(it.qty ?? '')}" />`)}</td>`;
      }
      case 'unitPrice':
        return `<td class="col-money">${field(lb,
          `<input type="text" inputmode="decimal" autocomplete="off" data-num="1" data-bind="items.${i}.unitPrice" data-cast="number" title="${esc(tipFor('unitPrice'))}" value="${esc(it.unitPrice ?? '')}" />`)}</td>`;
      case 'ctns':
        return `<td class="col-qty">${field(lb,
          `<div class="unit-pair">
            <input type="text" inputmode="decimal" autocomplete="off" data-num="1" data-bind="items.${i}.ctns" data-cast="number" title="${esc(tipFor('ctns'))}" value="${esc(it.ctns ?? '')}" />
            <select data-bind="items.${i}.packUnit" title="包装单位">${PACK_UNITS.map((u) => `<option value="${u}"${u === (it.packUnit || DEFAULT_PACK_UNIT) ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
          </div>`)}</td>`;
      case 'nw':
      case 'gw':
        // 重量 + 重量单位（默认 kg）
        return `<td class="col-num">${field(lb,
          `<div class="unit-pair">
            <input type="text" inputmode="decimal" autocomplete="off" data-num="1" data-bind="items.${i}.${c.key}" data-cast="number" title="${esc(tipFor(c.key))}" value="${esc(it[c.key] ?? '')}" />
            <select data-bind="items.${i}.weightUnit" title="重量单位">${WEIGHT_UNITS.map((u) => `<option value="${u}"${u === (it.weightUnit || DEFAULT_WEIGHT_UNIT) ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
          </div>`)}</td>`;
      case 'marks':
      case 'domesticSource':
        // 唛头 / 境内货源地：直接做在商品行里，商品有几行就有几个输入框
        return `<td class="${c.cls || 'col-mid'}">${field(lb,
          c.key === 'marks'
            ? `<textarea data-bind="items.${i}.marks" rows="2" style="width:100%">${esc(it.marks || '')}</textarea>`
            : `<input type="text" data-bind="items.${i}.domesticSource" value="${esc(it.domesticSource || '')}" />`)}</td>`;
      case 'meas':
        // 体积 + 体积单位（默认 m³）
        return `<td class="col-num">${field(lb,
          `<div class="unit-pair">
            <input type="text" inputmode="decimal" autocomplete="off" data-num="1" data-bind="items.${i}.meas" data-cast="number" title="${esc(tipFor('meas'))}" value="${esc(it.meas ?? '')}" />
            <select data-bind="items.${i}.measUnit" title="体积单位">${MEAS_UNITS.map((u) => `<option value="${u}"${u === (it.measUnit || DEFAULT_MEAS_UNIT) ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
          </div>`)}</td>`;
      default:
        return `<td class="${c.cls}">${field(lb,
          `<input type="text" data-bind="items.${i}.${c.key}" title="${esc(tipFor(c.key))}" value="${esc(it[c.key] || '')}" />`)}</td>`;
    }
  }).join('');

  const hiddenCount = Object.values(it.hide || {}).filter(Boolean).length;
  const tools = `<td class="col-tools"><div class="row-tools">
      <button class="mini-btn${hiddenCount ? ' active' : ''}" data-act="row-show" data-row="${i}" title="${t('btn.itemShow')}">${hiddenCount ? '🙈' : '👁'}</button>
      <button class="mini-btn" data-act="row-spec" data-row="${i}" title="${t('btn.itemDetail')}：${t('f.size')} / ${t('f.color')} / ${t('f.material')} / ${t('f.moq')} / ${t('f.sampleFee')}">📋</button>
      <button class="mini-btn" data-act="row-up" data-row="${i}" title="${t('btn.moveUp')}">↑</button>
      <button class="mini-btn" data-act="row-down" data-row="${i}" title="${t('btn.moveDown')}">↓</button>
      <button class="mini-btn danger" data-act="row-del" data-row="${i}" title="${t('btn.removeRow')}">✕</button>
    </div></td>`;

  return `<tr data-row="${i}">${cells}${tools}</tr>`;
}

/**
 * 「显示哪些列」弹层（每行一个入口）
 *
 * 用户语义：取消勾选 = **整列不显示**（不是这一行留空）。
 * 所以取消勾选会把**所有行**都标记为不需要该列，那一列就从单据上整列消失；
 * 只要还有一行需要它，列就保留 —— 避免「某行有净重、某行没有」的断列。
 * 弹层里会标出「所有行都不需要 → 整列消失」的列，让用户看得见结果。
 */
export function openRowShowEditor(rowIndex, onDone) {
  const doc = state.doc;
  if (!doc) return;
  const it = doc.items[rowIndex];
  if (!it) return;
  if (!it.hide || typeof it.hide !== 'object') it.hide = {};
  const packing = docMeta(doc.type).mode === 'packing';

  // 可隐藏的列（编号与品名不参与，否则整行没法看）
  const keys = packing
    ? ['ctnNo', 'ctns', 'qty', 'gw', 'nw', 'meas']
    : ['photo', 'model', 'hsCode', 'unit', 'qty', 'unitPrice', 'amount', 'nw', 'gw', 'meas'];
  const labels = tableLabels(doc.docLang);
  const nameOf = (k) => ({ ctns: labels.pkgs || t('f.ctns'), qty: labels.qty || t('f.qty'),
    gw: labels.gw || t('f.gw'), nw: labels.nw || t('f.nw'), meas: labels.meas || t('f.meas'),
    model: labels.model || t('f.model'), hsCode: labels.hsCode || 'HS Code',
    unit: labels.unit || t('f.unit'), unitPrice: labels.unitPrice || t('f.unitPrice'),
    amount: labels.amount || t('f.amount'), photo: labels.photo || t('f.photo'),
    ctnNo: 'Ctn No.' }[k] || k);

  /** 这一列是不是「所有行都不需要」→ 会整列消失 */
  const allRowsHide = (k) => {
    const items = doc.items || [];
    return items.length > 0 && items.every((x) => x && x.hide && x.hide[k]);
  };

  const body = document.createElement('div');
  body.className = 'row-show';
  body.innerHTML = `
    <div class="rs-tip">${esc(t('rowShow.tip'))}</div>
    <div class="rs-list">${keys.map((k) => `
      <label class="chk">
        <input type="checkbox" data-rs="${k}"${it.hide[k] ? '' : ' checked'}>
        <span data-rs-label="${k}">${esc(nameOf(k))}</span>
      </label>`).join('')}</div>
    <div class="rs-actions">
      <button type="button" class="btn btn-sm" data-rs-all>${esc(t('rowShow.all'))}</button>
      <button type="button" class="btn btn-sm" data-rs-none>${esc(t('rowShow.none'))}</button>
    </div>`;

  /** 标出哪些列已经整列消失 */
  const markGone = () => {
    body.querySelectorAll('[data-rs-label]').forEach((span) => {
      const k = span.getAttribute('data-rs-label');
      span.innerHTML = `${esc(nameOf(k))}${allRowsHide(k) ? ` <b class="rs-gone">${esc(t('rowShow.gone'))}</b>` : ''}`;
    });
  };

  // 取消勾选 → 所有行都不需要该列（整列消失）；勾上 → 所有行都恢复该列
  const apply = (one, checked) => {
    for (const b of body.querySelectorAll('[data-rs]')) {
      if (one && b !== one) continue;
      const k = b.getAttribute('data-rs');
      for (const x of doc.items) {
        if (!x.hide || typeof x.hide !== 'object') x.hide = {};
        if (checked) delete x.hide[k];
        else x.hide[k] = true;
        if (!Object.keys(x.hide).length) x.hide = {};
      }
    }
    scheduleAutosave();
    refreshFormView();
    markGone();
  };

  const ref = openModal({
    title: `👁 ${t('rowShow.title')} · ${it.description || `#${rowIndex + 1}`}`,
    body,
    width: '460px',
    onClose: () => { if (onDone) onDone(); },
  });

  body.querySelectorAll('[data-rs]').forEach((b) => {
    b.addEventListener('change', () => apply(b, b.checked));
  });
  const all = body.querySelector('[data-rs-all]');
  const none = body.querySelector('[data-rs-none]');
  if (all) all.onclick = () => {
    apply(null, true);
    body.querySelectorAll('[data-rs]').forEach((b) => { b.checked = true; });
  };
  if (none) none.onclick = () => {
    apply(null, false);
    body.querySelectorAll('[data-rs]').forEach((b) => { b.checked = false; });
  };
  markGone();
  return ref;
}

/* ============================ 产品规格弹层（每行一个） ============================ */

/**
 * 单行产品规格：规格/尺寸、颜色、材质、款号、起订量、样品价与大货价、
 * 每箱数量、外箱尺寸、单件重量、该行模具费、规格补充说明
 * 对应真实报价单里的 Style / Size / Color / Material / MOQ / Sample / Bulk price 等列
 */
/* 行详情（📋）弹层里可编辑的字段 key —— 单据上会印、但不在明细表列里的字段就靠它编辑。
 * 导出给「表单覆盖核查」（tests/verify-form-coverage.cjs）用：那张表要确认
 * 「单据上印出来的字段，表单里一定有地方填」。 */
const ITEM_DETAIL_BASE = [
  'photo', 'styleName', 'model', 'size', 'color', 'material', 'moq', 'leadTime',
  'sampleQty', 'sampleFee', 'bulkPrice', 'unitsPerCtn', 'netWeight', 'toolingCost',
  'ctnL', 'ctnW', 'ctnH', 'specNote', 'remark', 'marks', 'weightUnit', 'packUnit', 'measUnit',
];
export function itemDetailKeys(type) {
  if (type === 'customs_declaration') {
    return ITEM_DETAIL_BASE.concat(['origin', 'dest', 'domesticSource', 'lineDutyNature', 'ctns', 'nw', 'gw']);
  }
  if (type === 'bill_of_lading') {
    return ITEM_DETAIL_BASE.concat(['qty', 'unit', 'gw', 'meas']);
  }
  return ITEM_DETAIL_BASE.slice();
}

export function openItemSpecEditor(rowIndex, onDone) {
  const doc = state.doc;
  if (!doc) return;
  const it = doc.items[rowIndex];
  if (!it) return;
  const itemName = it.description || `${t('tab.items')} #${rowIndex + 1}`;

  const fields = [
    // 产品图就放在规格弹层里 —— 这是「单据页面上直接加图」的入口。
    // （表单里的缩略图列要勾了「显示图片列」才出现，很多人根本找不到，
    //   所以这里必须有一个不依赖任何开关的入口。）
    { key: 'photo', label: 'f.photo', type: 'photo', value: it.photo || '', span: 2,
      tip: '产品图会出现在明细表的图片列；勾「显示图片列」才印在单据上' },
    { key: 'styleName', label: 'f.styleName', value: it.styleName || '', placeholder: '如 KH001 / A-102' },
    { key: 'model', label: 'f.model', value: it.model || '' },
    { key: 'size', label: 'f.size', value: it.size || '', span: 2, placeholder: '如 standard / 2000mm×1200mm' },
    { key: 'color', label: 'f.color', value: it.color || '', placeholder: '如 yellow / 米白' },
    { key: 'material', label: 'f.material', value: it.material || '', placeholder: '如 ceramic / SPCC T=1.0' },
    { key: 'moq', label: 'f.moq', value: it.moq ?? '', type: 'number', placeholder: '如 500' },
    { key: 'leadTime', label: 'f.leadTime', value: it.leadTime || '', placeholder: '如 45 days' },
    { key: 'sampleQty', label: 'f.sampleQty', value: it.sampleQty ?? '', type: 'number' },
    { key: 'sampleFee', label: 'f.sampleFee', value: it.sampleFee ?? '', type: 'number', tip: '单个样品收费；可在大货中退还' },
    { key: 'bulkPrice', label: 'f.bulkPrice', value: it.bulkPrice ?? '', type: 'number', tip: '大货单价，与上面的正式单价可分开记录' },
    { key: 'unitsPerCtn', label: 'f.unitsPerCtn', value: it.unitsPerCtn ?? '', type: 'number' },
    { key: 'netWeight', label: 'f.netWeight', value: it.netWeight ?? '', type: 'number', tip: '单件重量（g 或 kg，按你的习惯填数字）' },
    { key: 'toolingCost', label: 'f.toolingCost', value: it.toolingCost ?? '', type: 'number' },
    { key: 'ctnL', label: '外箱长 cm', value: it.ctnL ?? '', type: 'number' },
    { key: 'ctnW', label: '外箱宽 cm', value: it.ctnW ?? '', type: 'number' },
    { key: 'ctnH', label: '外箱高 cm', value: it.ctnH ?? '', type: 'number' },
    { key: 'specNote', label: 'f.specNote', value: it.specNote || '', type: 'textarea', span: 2, placeholder: '补充说明，如：颜色可按 Pantone 定制' },
    // 行备注：明细列没勾「备注列」时，备注是印在描述格里的 → 必须有地方填
    { key: 'remark', label: 'f.remark', value: it.remark || '', type: 'textarea', span: 2, rows: 2 },
    // 行唛头：提单第 11 栏 / 装箱单唛头都按行印
    { key: 'marks', label: 'f.marks', value: it.marks || '', type: 'textarea', span: 2, rows: 2, tip: 'f.tipItemMarks' },
    // 报关单专属的明细字段（放在行详情里，不占明细表列宽）
    ...(doc.type === 'customs_declaration' ? [
      { key: 'origin', label: 'f.origin', value: it.origin || '', list: true, tip: 'f.tipOrigin' },
      { key: 'dest', label: 'f.destCountry', value: it.dest || '', list: true, tip: 'f.tipDestCountry' },
      { key: 'domesticSource', label: 'f.domesticSource', value: it.domesticSource || '', list: true, tip: 'f.tipDomesticSource' },
      { key: 'lineDutyNature', label: 'f.lineDutyNature', value: it.lineDutyNature || '', list: true, tip: 'f.tipLineDuty' },
      // 报关单表头的「件数 / 毛重 / 净重」是按明细汇总的，所以这里必须能填
      { key: 'ctns', label: 'f.pkgs', value: it.ctns ?? '', type: 'number', tip: 'f.tipPkgs' },
      { key: 'nw', label: 'f.totalNw', value: it.nw ?? '', type: 'number', tip: 'f.tipNwGw' },
      { key: 'gw', label: 'f.totalGw', value: it.gw ?? '', type: 'number' },
    ] : []),
    // 提单专属：11 唛头 / 12 件数单位 / 14 毛重 / 15 体积（提单明细就这几栏）
    ...(doc.type === 'bill_of_lading' ? [
      { key: 'qty', label: 'f.qty', value: it.qty ?? '', type: 'number' },
      { key: 'unit', label: 'f.unit', value: it.unit || '' },
      { key: 'gw', label: 'f.totalGw', value: it.gw ?? '', type: 'number', tip: 'f.tipGwMeas' },
      { key: 'meas', label: 'f.meas', value: it.meas ?? '', type: 'number' },
    ] : []),
    // 重量单位：单据上毛净重后面跟的 kg/lb 就是这个
    { key: 'weightUnit', label: 'f.weightUnit', type: 'select', value: it.weightUnit || 'kg',
      options: [{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }, { value: 'g', label: 'g' }, { value: 'ton', label: 'ton' }],
      tip: 'f.tipWeightUnit' },
    // 包装单位 / 体积单位：报关单「件数」列的单位、装箱单体积列的单位就是这两个
    { key: 'packUnit', label: 'f.packUnit', type: 'select', value: it.packUnit || 'ctn',
      options: ['ctn', 'carton', 'pallet', 'bag', 'case', 'set'].map((v) => ({ value: v, label: v })),
      tip: 'f.tipPackUnit' },
    { key: 'measUnit', label: 'f.measUnit', type: 'select', value: it.measUnit || 'm³',
      options: ['m³', 'cbm', 'cft'].map((v) => ({ value: v, label: v })),
      tip: 'f.tipMeasUnit' },
  ];

  const { ref } = buildEditor({
    title: `📋 ${t('tab.spec')} — ${itemName}`,
    hint: '这些规格会印在产品明细的描述栏里（Size / Color / Material / MOQ / Sample / Bulk price / Carton）。留空的不显示。',
    fields,
    onSubmit: async (d) => {
      Object.assign(it, {
        photo: d.photo || '',
        styleName: d.styleName.trim(),
        model: d.model.trim(),
        size: d.size.trim(),
        color: d.color.trim(),
        material: d.material.trim(),
        moq: num(d.moq),
        leadTime: d.leadTime.trim(),
        sampleQty: num(d.sampleQty),
        sampleFee: num(d.sampleFee),
        bulkPrice: num(d.bulkPrice),
        unitsPerCtn: num(d.unitsPerCtn),
        netWeight: num(d.netWeight),
        toolingCost: num(d.toolingCost),
        ctnL: num(d.ctnL), ctnW: num(d.ctnW), ctnH: num(d.ctnH),
        specNote: d.specNote.trim(),
        remark: String(d.remark || ''),
        marks: String(d.marks || ''),
        // 报关单专属明细字段（其它单据这个弹层里没有这些输入框，值会是 undefined → 不覆盖）
        ...(doc.type === 'customs_declaration' ? {
          origin: String(d.origin || '').trim(),
          dest: String(d.dest || '').trim(),
          domesticSource: String(d.domesticSource || '').trim(),
          lineDutyNature: String(d.lineDutyNature || '').trim(),
          ctns: num(d.ctns), nw: num(d.nw), gw: num(d.gw),
        } : {}),
        // 提单专属明细字段
        ...(doc.type === 'bill_of_lading' ? {
          marks: String(d.marks || ''),
          qty: num(d.qty), unit: String(d.unit || '').trim(),
          gw: num(d.gw), meas: num(d.meas),
        } : {}),
        weightUnit: String(d.weightUnit || 'kg'),
        packUnit: String(d.packUnit || 'ctn'),
        measUnit: String(d.measUnit || 'm³'),
      });
      // 传了图就自动打开图片列。
      // 否则用户上传完图片，单据上什么都不变 —— 他得先猜到要去「明细列显示」里勾一下，
      // 这一步没人猜得到（用户反馈原话：「明明已经点击保存图片了还是不显示」）。
      const photoNow = !!it.photo;
      let justEnabled = false;
      if (photoNow && !doc.showPhoto) {
        doc.showPhoto = true;
        justEnabled = true;
      }
      recalcDoc(doc);
      if (justEnabled) {
        // 列集合变了 → 必须重渲染整个表单：
        // refreshItemsTable() 只重画明细表，「明细列显示」那个勾选框在别的区块里，
        // 不一起重画就会出现「列出来了、勾选框却没勾」的自相矛盾状态。
        renderForm(document.getElementById('formHost'), state._refreshPreview);
      } else {
        refreshItemsTable();
      }
      scheduleAutosave();
      if (state._refreshPreview) state._refreshPreview();
      toast.ok(t(justEnabled ? 'msg.photoShown' : 'msg.specSaved'));
      if (onDone) onDone();
    },
  });
  return ref;
}

/* ============================ 合同条款编辑器 ============================ */

function renderClauseEditor(doc) {
  const list = doc.contractClauses || [];
  const items = list.map((c, i) => `
    <div class="card" style="margin:0 0 8px" data-clause="${i}">
      <div class="card-head" style="font-size:12px">
        <span>${i + 1}.</span>
        <input type="text" data-bind="contractClauses.${i}.title" value="${esc(c.title || '')}" style="flex:1;font-weight:600" />
        <button class="mini-btn danger" data-act="clause-del" data-clause="${i}" title="${t('btn.remove')}">✕</button>
      </div>
      <div class="card-body" style="padding:8px">
        <textarea data-bind="contractClauses.${i}.body" rows="3">${esc(c.body || '')}</textarea>
      </div>
    </div>`).join('');
  return `<div style="margin-bottom:9px">${items || `<div class="hint" style="font-size:12px;color:var(--c-text-mute);margin-bottom:8px">${t('msg.noData')}</div>`}</div>
    <div style="display:flex;gap:6px;margin-bottom:6px">
      <button class="btn btn-sm" data-act="clause-add">＋ ${t('btn.add')}</button>
    </div>`;
}

/* ============================ 事件绑定 ============================ */

let photoRowIndex = -1;

function bindFormEvents(host, onRefreshPreview) {
  const commit = (rebuildItems = false, rebuildForm = false) => {
    recalcDoc(state.doc);
    if (rebuildItems) refreshItemsTable();
    if (rebuildForm) { renderForm(host, onRefreshPreview); return; }
    scheduleAutosave();
    if (onRefreshPreview) onRefreshPreview();
  };

  /* 左边一聚焦，右边就闪一下对应的块 —— 用户反馈「不知道左边对应右边哪儿」。
     只在「换了个区块」时才闪+滚动，避免同一个区块里连点几个框就来回滚。 */
  // 聚焦自动定位已移除（对应关系不准，用户要求去掉）
  // 点区块标题上的 👁 也能手动定位
  host.querySelectorAll('[data-locate]').forEach((b) => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const key = b.getAttribute('data-locate');
      state._lastFlashed = key;
      if (typeof state._flashPreview === 'function') state._flashPreview(key);
    });
  });

  /* 输入绑定 */
  /* 数字框限流：把非法字符（中文、字母、多个小数点…）挡在输入阶段 */
  guardNumberInputs(host);

  /* 列顺序前移：把该列在自己前面那列之前 */
  host.querySelectorAll('[data-colup]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const doc = state.doc;
      if (!doc) return;
      const key = b.getAttribute('data-colup');
      const cur = (itemColumns(doc.type, doc) || []).map((c) => c.key);
      const order = Array.isArray(doc.colOrder) && doc.colOrder.length
        ? doc.colOrder.slice()
        : cur.slice();
      // 补齐缺失的列
      for (const k of cur) if (!order.includes(k)) order.push(k);
      const i = order.indexOf(key);
      if (i > 1) {                       // 第 0 位是 No. 固定不动
        [order[i - 1], order[i]] = [order[i], order[i - 1]];
        doc.colOrder = order;
        try { scheduleAutosave(); } catch (err) { /* 忽略 */ }
        // 重渲染表单（芯片顺序）并刷新预览
        renderForm(host, state._refreshPreview);
        if (state._refreshPreview) state._refreshPreview();
      }
    };
  });
  /* 签名复位：一键回默认位置 */
  host.querySelectorAll('[data-sign-move]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const doc = state.doc;
      if (!doc) return;
      doc.signDX = 0; doc.signDY = 0;
      try { scheduleAutosave(); } catch (err) { /* 忽略 */ }
      const label = document.querySelector('#signOffsetLabel');
      if (label) label.textContent = '0, 0';
      if (state._refreshPreview) state._refreshPreview();
    };
  });
  /* 印章位置微调：每次 4px（Shift 10px），存到单据上并立即刷新预览 */
  host.querySelectorAll('[data-stamp-move]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const doc = state.doc;
      if (!doc) return;
      const step = e.shiftKey ? 10 : 4;
      const dir = b.getAttribute('data-stamp-move');
      if (dir === 'reset') { doc.stampDX = 0; doc.stampDY = 0; }
      else if (dir === 'up') doc.stampDY = (Number(doc.stampDY) || 0) - step;
      else if (dir === 'down') doc.stampDY = (Number(doc.stampDY) || 0) + step;
      else if (dir === 'left') doc.stampDX = (Number(doc.stampDX) || 0) - step;
      else if (dir === 'right') doc.stampDX = (Number(doc.stampDX) || 0) + step;
      try { scheduleAutosave(); } catch (err) { /* 忽略 */ }
      // 只更新坐标数字 + 刷新预览，避免整表重渲染导致页面跳回顶部
      const label = document.querySelector('#stampOffsetLabel');
      if (label) label.textContent = `${Number(doc.stampDX) || 0}, ${Number(doc.stampDY) || 0}`;
      if (state._refreshPreview) state._refreshPreview();
    };
  });
  host.querySelectorAll('[data-bind]').forEach((el) => {
    const path = el.getAttribute('data-bind');
    const cast = el.getAttribute('data-cast');
    const handler = () => {
      let v = el.value;
      if (cast === 'number') v = v === '' ? 0 : num(v);
      setVal(path, v);
      const isItem = path.startsWith('items.');
      recalcDoc(state.doc);
      if (isItem) {
        const parts = path.split('.');
        const idx = Number(parts[1]);
        const key = parts[2];
        const row = host.querySelector(`tr[data-row="${idx}"]`);
        if (row && (key === 'qty' || key === 'unitPrice')) {
          const cell = row.querySelector('[data-row-amount]');
          if (cell) cell.textContent = money(state.doc.items[idx].amount);
        }
        updateTotalsDisplay();
      }
      scheduleAutosave();
      if (onRefreshPreview) onRefreshPreview();

      // 客户 / 产品名称输入后自动补全其余字段（只在完全匹配时触发）
      if (path === 'buyer.companyName') {
        applyCustomerAutofill(v, host, onRefreshPreview);
        suggestCustomer(v, el, host, onRefreshPreview);
      }
      if (/^items\.\d+\.description$/.test(path)) {
        applyProductAutofill(path, v, host, onRefreshPreview);
        suggestProduct(v, el, path, host, onRefreshPreview);
      }
    };
    // select 用 change（部分浏览器不派发 input 事件，否则选了不生效）
    const evt = (el.getAttribute('data-change') || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(evt, () => {
      handler();
      if (el.getAttribute('data-rerender')) {
        renderForm(host, onRefreshPreview);
        if (onRefreshPreview) onRefreshPreview();
        scheduleAutosave();
      }
    });

    // 记录输入历史：失焦时写入，避免每敲一个字符都落库
    if (isHistoryField(path)) {
      el.addEventListener('blur', () => {
        const v = String(el.value || '').trim();
        if (v.length >= 2) rememberValue(path, v).catch(() => null);
      });
      el.addEventListener('change', () => {
        const v = String(el.value || '').trim();
        if (v.length >= 2) rememberValue(path, v).catch(() => null);
      });
    }
  });

  /* 复选框标志 */
  /* 申报要素：列显示开关 / 自定义列 */
  host.querySelectorAll('[data-decol]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.getAttribute('data-decol');
      state.doc.showCols = state.doc.showCols || {};
      // 勾上 = 删掉这条（默认就是显示），勾掉 = 记 false
      if (el.checked) delete state.doc.showCols[key];
      else state.doc.showCols[key] = false;
      scheduleAutosave();
      renderForm(host, onRefreshPreview);
      if (onRefreshPreview) onRefreshPreview();
    });
  });
  host.querySelectorAll('[data-deorder-toggle]').forEach((b) => {
    b.onclick = () => {
      deColsReorder = !deColsReorder;
      renderForm(host, onRefreshPreview);
      if (onRefreshPreview) onRefreshPreview();
    };
  });
  host.querySelectorAll('[data-decol-up], [data-decol-down]').forEach((b) => {
    b.onclick = () => {
      const key = b.getAttribute('data-decol-up') || b.getAttribute('data-decol-down');
      const dir = b.hasAttribute('data-decol-up') ? -1 : 1;
      const doc0 = state.doc;
      const extra = Array.isArray(doc0.extraCols) ? doc0.extraCols : [];
      const allKeys = DE_COLUMNS.map((x) => x.key).concat(extra.map((x) => `ext:${x.id}`));
      const order = (Array.isArray(doc0.colOrder) && doc0.colOrder.length ? doc0.colOrder : [])
        .filter((k) => allKeys.includes(k))
        .concat(allKeys.filter((k) => !(doc0.colOrder || []).includes(k)));
      const i = order.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      doc0.colOrder = order;          // 存整份顺序，渲染层按它排
      scheduleAutosave();
      renderForm(host, onRefreshPreview);
      if (onRefreshPreview) onRefreshPreview();
    };
  });
  host.querySelectorAll('[data-decol-add]').forEach((b) => {
    b.onclick = async () => {
      const label = await promptModal('新列名称（如 容积L / 最低温度℃ / 结构）', { title: '添加自定义列', placeholder: '如 容积L' });
      if (label === null) return;                      // 点了取消
      if (!String(label).trim()) { toast.warn('请先输入列名，再点确定', 2800); return; }
      state.doc.extraCols = Array.isArray(state.doc.extraCols) ? state.doc.extraCols : [];
      if (state.doc.extraCols.length >= 5) { toast.warn('自定义列最多 5 个', 2600); return; }
      const newCol = { id: uid('col'), label: String(label).trim() };
      state.doc.extraCols.push(newCol);
      // 顺序表里也加上（放最后，可再用 ↑ 往前移）
      state.doc.colOrder = (Array.isArray(state.doc.colOrder) && state.doc.colOrder.length ? state.doc.colOrder : [])
        .concat([`ext:${newCol.id}`]);
      scheduleAutosave();
      renderForm(host, onRefreshPreview);
      if (onRefreshPreview) onRefreshPreview();
      toast.ok('已加列：' + String(label).trim());
    };
  });
  host.querySelectorAll('[data-decol-del]').forEach((b) => {
    b.onclick = () => {
      const id = b.getAttribute('data-decol-del');
      const col = (state.doc.extraCols || []).find((x) => x.id === id);
      state.doc.extraCols = (state.doc.extraCols || []).filter((x) => x.id !== id);
      // 顺带把这列的值从明细里清掉，避免残留
      for (const it of state.doc.items || []) { if (it.ext) delete it.ext[id]; }
      scheduleAutosave();
      renderForm(host, onRefreshPreview);
      if (onRefreshPreview) onRefreshPreview();
      toast.ok('已删除列：' + ((col && col.label) || ''));
    };
  });
  host.querySelectorAll('[data-decol-rename]').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.getAttribute('data-decol-rename');
      const col = (state.doc.extraCols || []).find((x) => x.id === id);
      if (col) col.label = el.value.trim() || col.label;
      scheduleAutosave();
      if (onRefreshPreview) onRefreshPreview();
    });
  });

  /* 集装箱：添加 / 删除 / 改柜号后重绘（明细里的「装柜」下拉要跟着变） */
  host.querySelectorAll('[data-ctn-split]').forEach((b) => {
    b.onclick = () => window.dispatchEvent(new CustomEvent('td:split-by-container'));
  });
  host.querySelectorAll('[data-ctn-add]').forEach((b) => {
    b.onclick = () => {
      state.doc.containers = Array.isArray(state.doc.containers) ? state.doc.containers : [];
      state.doc.containers.push({ id: uid('ct'), no: '', seal: '', type: '40HQ' });
      scheduleAutosave();
      renderForm(host, onRefreshPreview);
      if (onRefreshPreview) onRefreshPreview();
    };
  });
  host.querySelectorAll('[data-ctn-del]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.getAttribute('data-ctn-del'));
      const removed = (state.doc.containers || [])[i];
      state.doc.containers.splice(i, 1);
      // 这一柜上的明细行 → 变回"未分配"
      for (const it of state.doc.items || []) if (removed && it.containerId === removed.id) it.containerId = '';
      scheduleAutosave();
      renderForm(host, onRefreshPreview);
      if (onRefreshPreview) onRefreshPreview();
    };
  });
  /* 改柜号 / 柜型后，同步明细里「装柜」下拉的文字与选项（不整页重绘，避免丢焦点） */
  host.querySelectorAll('[data-bind^="containers."]').forEach((el) => {
    el.addEventListener('change', () => {
      const path = el.getAttribute('data-bind');
      const parts = String(path).split('.');
      const idx = Number(parts[1]);
      const key = parts[2];
      const ctn = (state.doc.containers || [])[idx];
      if (ctn) ctn[key] = el.value;
      scheduleAutosave();
      // 同步明细下拉
      host.querySelectorAll('select[data-bind$=".containerId"]').forEach((sel) => {
        for (const opt of sel.options) {
          const c = (state.doc.containers || []).find((x) => x.id === opt.value);
          if (c) opt.textContent = c.no || '(未填柜号)';
        }
      });
      if (onRefreshPreview) onRefreshPreview();
    });
  });

  host.querySelectorAll('[data-bind-flag]').forEach((el) => {
    el.addEventListener('change', () => {
      const flag = el.getAttribute('data-bind-flag');
      state.doc[flag] = el.checked;
      scheduleAutosave();
      if (onRefreshPreview) onRefreshPreview();
      // 「合并同类项」要连带更新表单里的合并结果提示（3 行 → 2 项 / 已关闭），
      // 只刷预览的话提示文字会停在旧状态，用户会以为没生效
      if (flag === 'mergeSameItems') { renderForm(host, onRefreshPreview); return; }
    });
  });

  /* 明细表列显示开关（装箱单是「勾上=隐藏」，语义反过来） */
  host.querySelectorAll('[data-toggle]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.getAttribute('data-toggle');
      const packing = docMeta(state.doc.type).mode === 'packing';
      // showEmptyRows / showHs 不吃装箱单那套取反（勾上=显示/保留，跟其它开关方向一致）
      const invert = packing && key !== 'showEmptyRows' && key !== 'showHs';
      state.doc[key] = invert ? !el.checked : el.checked;
      scheduleAutosave();
      // 列变了要整表重绘
      refreshFormView();
      if (onRefreshPreview) onRefreshPreview();
    });
  });

  /* 买卖双方区显示方式：单栏 / 两栏（含银行信息） */
  host.querySelectorAll('[data-layout]').forEach((el) => {
    el.addEventListener('change', () => {
      if (!el.checked) return;
      state.doc.partyLayout = el.getAttribute('data-layout');
      // 选了「两栏」但银行信息还空着 → 不拦着，只提醒一句
      //（单据上会先按单栏印，等填了银行信息自动变两栏）
      if (state.doc.partyLayout === 'split') {
        const b = state.doc.bank || {};
        const filled = [b.bankName, b.accountNo, b.swift, b.iban, b.bankAddress, state.doc.beneficiaryAccount]
          .some((x) => String(x || '').trim());
        if (!filled) toast.warn('银行信息还没填：单据上暂时按单栏印，填好银行信息后会自动显示两栏', 4200);
      }
      scheduleAutosave();
      // 版式变了要重绘表单（单选框状态跟着更新）+ 预览
      renderForm(host, onRefreshPreview);
      if (onRefreshPreview) onRefreshPreview();
    });
  });

  /* 其它费用明细：输入即时写回单据（不重绘，避免丢焦点）；增删才重绘 */
  {
    const wrap = host.querySelector('[data-section="otherfees"]');
    if (wrap) {
      const commit = () => {
        syncOtherFeesFromDom();
        recalcDoc(state.doc);
        scheduleAutosave();
        if (onRefreshPreview) onRefreshPreview();
        // 只更新合计区，不动输入框
        refreshFeeSummary();
      };
      wrap.querySelectorAll('[data-fee]').forEach((el) => {
        el.addEventListener('input', commit);
        el.addEventListener('change', commit);
      });
      wrap.querySelectorAll('[data-fee-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          syncOtherFeesFromDom();
          const i = Number(btn.getAttribute('data-fee-del'));
          (state.doc.otherFees || []).splice(i, 1);
          recalcDoc(state.doc);
          scheduleAutosave();
          refreshFormView();
        });
      });
      const addBtn = wrap.querySelector('[data-fee-add]');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          syncOtherFeesFromDom();
          state.doc.otherFees = [...(state.doc.otherFees || []), { label: '', amount: 0 }];
          scheduleAutosave();
          refreshFormView();
          // 聚焦到新加那行的名称框
          const rows = document.querySelectorAll('#formHost .fee-row');
          const last = rows[rows.length - 1];
          if (last) last.querySelector('[data-fee="label"]').focus();
        });
      }
    }
  }

  /* 折叠 */
  host.querySelectorAll('[data-collapse]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-collapse');
      state._collapsed[key] = !state._collapsed[key];
      const card = host.querySelector(`[data-section="${key}"]`);
      if (card) {
        card.classList.toggle('collapsed', !!state._collapsed[key]);
        btn.textContent = state._collapsed[key] ? '▸' : '▾';
      }
    });
  });

  /* 动作按钮 */
  host.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const act = el.getAttribute('data-act');
      handleAction(act, el, e, host, onRefreshPreview);
    });
  });

  /* 行拖动排序 */
  bindRowDrag(host, onRefreshPreview);
}

function updateTotalsDisplay() {
  const doc = state.doc;
  const t1 = document.querySelector('[data-total="qty"]');
  const t2 = document.querySelector('[data-total="amount"]');
  if (t1) t1.textContent = qty(doc.totals.totalQty);
  if (t2) t2.textContent = `${doc.currency} ${money(doc.totals.totalAmount)}`;
}

/** 只刷新产品表格（保持输入焦点） */
export function refreshItemsTable() {
  const doc = state.doc;
  if (!doc) return;
  const body = document.getElementById('itemBody');
  if (!body) return;
  const drop = columnsHiddenByRows(doc);        // 和预览保持一致：整列消失
  const cols = itemColumns(doc.type, doc).filter((c) => !drop.has(c.key));
  body.innerHTML = doc.items.map((it, i) => itemRowHtml(it, i, doc, cols)).join('');
  applyItemPlaceholders(body);
  const host = body.closest('#formHost') || document.getElementById('formHost');
  const onRefresh = state._refreshPreview;
  // 重新只绑定表格内事件
  body.querySelectorAll('[data-bind]').forEach((el) => {
    const path = el.getAttribute('data-bind');
    const cast = el.getAttribute('data-cast');
    const handler = () => {
      const raw = el.value;
      setVal(path, cast === 'number' ? (raw === '' ? 0 : num(raw)) : raw);
      recalcDoc(state.doc);
      const parts = path.split('.');
      const idx = Number(parts[1]);
      const key = parts[2];
      const row = body.querySelector(`tr[data-row="${idx}"]`);
      if (row && (key === 'qty' || key === 'unitPrice' || key === 'ctns')) {
        const cell = row.querySelector('[data-row-amount]');
        if (cell) cell.textContent = money(state.doc.items[idx].amount);
      }
      updateTotalsDisplay();
      scheduleAutosave();
      if (onRefresh) onRefresh();
    };
    // select 用 change，input 用 input
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', handler);
  });
  body.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', (e) => handleAction(el.getAttribute('data-act'), el, e, host, onRefresh));
  });
  bindRowDrag(body, onRefresh);
  guardNumberInputs(body);
  updateTotalsDisplay();
}

/* ============================ 行拖动 ============================ */

function bindRowDrag(scope, onRefreshPreview) {
  const body = scope.querySelector('#itemBody') || scope;
  let dragIndex = -1;

  body.querySelectorAll('.drag-handle').forEach((handle) => {
    const tr = handle.closest('tr');
    const idx = Number(tr.getAttribute('data-row'));

    handle.addEventListener('dragstart', (e) => {
      dragIndex = idx;
      tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(idx)); } catch { /* 忽略 */ }
    });
    handle.addEventListener('dragend', () => {
      tr.classList.remove('dragging');
      body.querySelectorAll('tr').forEach((r) => r.classList.remove('drop-target'));
      dragIndex = -1;
    });
  });

  body.querySelectorAll('tr[data-row]').forEach((tr) => {
    tr.addEventListener('dragover', (e) => {
      if (dragIndex < 0) return;
      e.preventDefault();
      tr.classList.add('drop-target');
    });
    tr.addEventListener('dragleave', () => tr.classList.remove('drop-target'));
    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      tr.classList.remove('drop-target');
      const target = Number(tr.getAttribute('data-row'));
      if (dragIndex < 0 || dragIndex === target) return;
      const items = state.doc.items;
      const [moved] = items.splice(dragIndex, 1);
      items.splice(target, 0, moved);
      items.forEach((it, i) => { it.order = i; });
      recalcDoc(state.doc);
      refreshItemsTable();
      scheduleAutosave();
      if (onRefreshPreview) onRefreshPreview();
    });
  });
}

/** 判断某字段是否记录输入历史 */
function isHistoryField(path) {
  if (HISTORY_FIELDS.includes(path)) return true;
  const m = /^(seller|buyer|consignee|notify)\.(\w+)$/.exec(path);
  return !!(m && HISTORY_PARTY_KEYS.includes(m[2]));
}

/**
 * 买方公司名匹配到客户库时，自动补全其余空字段
 * 只填空着的，已填内容不覆盖，避免把用户输入冲掉
 */
function applyCustomerAutofill(rawName, host, onRefreshPreview) {
  const name = String(rawName || '').trim().toLowerCase();
  if (name.length < 2) return;
  const row = state.customers.find((c) => String(c.name || c.companyName || '').trim().toLowerCase() === name);
  if (!row) return;
  // 已经补过一次就不重复弹提示
  if (state._lastAutofillCustomer === row.id && state.doc?.buyer?.city === row.city) return;

  const target = { ...state.doc.buyer };
  const fillKeys = ['address', 'city', 'state', 'zip', 'country', 'contact', 'tel', 'email', 'taxId'];
  fillKeys.forEach((k) => {
    if (row[k] && !String(target[k] || '').trim()) target[k] = row[k];
  });
  target.companyName = row.companyName || row.name;
  state.doc.buyer = target;
  if (state.doc.sameAsBuyerConsignee !== false) {
    state.doc.consignee = clone(target);
    state.doc.notify = clone(target);
  }
  state._lastAutofillCustomer = row.id;

  // 只更新对应输入框，不整块重画，避免打断输入
  fillKeys.forEach((k) => {
    const input = host.querySelector(`[data-bind="buyer.${k}"]`);
    if (input && input.value !== target[k]) input.value = target[k] || '';
  });
  recalcDoc(state.doc);
  scheduleAutosave();
  if (onRefreshPreview) onRefreshPreview();
  toast.ok('已按客户库自动填好买方信息', 1800);
}

/** 产品品名匹配到产品库时，自动补全型号 / HS 编码 / 单位 / 单价 */
function applyProductAutofill(path, rawName, host, onRefreshPreview) {
  const name = String(rawName || '').trim().toLowerCase();
  if (name.length < 2) return;
  const row = state.products.find((p) => String(p.name || p.description || '').trim().toLowerCase() === name);
  if (!row) return;
  const idx = Number(path.split('.')[1]);
  const item = state.doc.items[idx];
  if (!item) return;
  const map = { model: row.model, hsCode: row.hsCode, unit: row.unit };
  Object.entries(map).forEach(([k, v]) => {
    if (v && !String(item[k] || '').trim()) item[k] = v;
  });
  if (!num(item.unitPrice) && num(row.unitPrice)) item.unitPrice = num(row.unitPrice);
  if (!item.photo && row.photo) item.photo = row.photo;

  recalcDoc(state.doc);
  refreshItemsTable();
  scheduleAutosave();
  if (onRefreshPreview) onRefreshPreview();
}

/* ============================ 智能联想（填一个 → 自动带出） ============================ */

/** 模糊匹配得分：命中前缀/包含/全等给不同分数，供联想排序 */
function fuzzyScore(query, text) {
  const q = String(query || '').trim().toLowerCase();
  const s = String(text || '').trim().toLowerCase();
  if (!q || !s) return -1;
  if (q === s) return 100;
  if (s.startsWith(q)) return 80 - Math.min(20, (s.length - q.length) / 2);
  if (s.includes(q)) return 55;
  // 逐字符子序列匹配（「ABC」匹配「AXBYC」）
  let qi = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 30;
  return -1;
}

/** 输入客户名：模糊联想客户库，选中后自动带出整栏买方信息（含收货人/通知方/常用公司/银行） */
function suggestCustomer(rawName, inputEl, host, onRefreshPreview) {
  const q = String(rawName || '').trim();
  if (q.length < 2) { closeSuggest(); return; }
  const matches = state.customers
    .map((c) => ({ c, score: Math.max(fuzzyScore(q, c.name || c.companyName), fuzzyScore(q, c.contact)) }))
    .filter((m) => m.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (!matches.length) { closeSuggest(); return; }

  const items = matches.map((m) => ({
    label: m.c.name || m.c.companyName,
    sub: [m.c.city, m.c.country, m.c.taxId ? `税号 ${m.c.taxId}` : ''].filter(Boolean).join(' · ') || '点击自动填好买方信息',
    meta: m.c,
  }));

  openSuggest(inputEl, items, (it) => {
    const c = it.meta;
    const target = { ...state.doc.buyer };
    ['address', 'city', 'state', 'zip', 'country', 'contact', 'tel', 'email', 'taxId'].forEach((k) => {
      if (c[k]) target[k] = c[k];
    });
    target.companyName = c.companyName || c.name;
    state.doc.buyer = target;
    // 收货人 / 通知方默认同步买方
    if (state.doc.sameAsBuyerConsignee !== false) {
      state.doc.consignee = clone(target);
      state.doc.notify = clone(target);
    }
    // 若该客户有常用公司档案，一并带出卖方公司 + 银行
    const comp = c.profileId ? (state.profiles || []).find((p) => p.id === c.profileId) : null;
    if (comp) {
      state.doc.seller = clone(comp.seller || comp.party || {});
      if (comp.bank) state.doc.bank = clone(comp.bank);
    }
    // 把输入框的值更新为选中项（避免残留输入的一半名字）
    inputEl.value = c.companyName || c.name;
    setVal('buyer.companyName', inputEl.value);
    recalcDoc(state.doc);
    // 重画整个买方区，让所有带出字段一次性显示
    renderForm(host, onRefreshPreview);
    if (onRefreshPreview) onRefreshPreview();
    scheduleAutosave();
    toast.ok(`已自动带出「${c.companyName || c.name}」的客户信息`, 2000);
    return true;
  });
}

/** 输入产品品名：模糊联想产品库，选中后自动带出型号 / HS / 单位 / 单价 / 图片 */
function suggestProduct(rawName, inputEl, path, host, onRefreshPreview) {
  const q = String(rawName || '').trim();
  if (q.length < 2) { closeSuggest(); return; }
  const matches = state.products
    .map((p) => ({ p, score: Math.max(fuzzyScore(q, p.name || p.description), fuzzyScore(q, p.model)) }))
    .filter((m) => m.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (!matches.length) { closeSuggest(); return; }

  const idx = Number(path.split('.')[1]);
  const items = matches.map((m) => ({
    label: m.p.name || m.p.description,
    sub: [m.p.model, m.p.hsCode ? `HS ${m.p.hsCode}` : '', m.p.unitPrice ? `${m.p.unitPrice} ${state.doc.currency || ''}` : ''].filter(Boolean).join(' · ') || '点击自动填好型号 / HS / 单价',
    meta: m.p,
  }));

  openSuggest(inputEl, items, (it) => {
    const p = it.meta;
    const item = state.doc.items[idx];
    if (!item) return true;
    // 覆盖式带出产品库信息（用户主动点选，理应听产品库的）
    item.description = p.name || p.description;
    if (p.model) item.model = p.model;
    if (p.hsCode) item.hsCode = p.hsCode;
    if (p.unit) item.unit = p.unit;
    if (num(p.unitPrice)) item.unitPrice = num(p.unitPrice);
    if (p.photo) item.photo = p.photo;
    inputEl.value = item.description;
    setVal(path, item.description);
    recalcDoc(state.doc);
    refreshItemsTable();
    scheduleAutosave();
    if (onRefreshPreview) onRefreshPreview();
    toast.ok(`已带出产品「${p.name || p.description}」的参数`, 1600);
    return true;
  });
}

/* ============================ 动作处理 ============================ */

async function handleAction(act, el, e, host, onRefreshPreview) {
  const doc = state.doc;
  if (!doc) return;
  const rerender = () => { renderForm(host, onRefreshPreview); if (onRefreshPreview) onRefreshPreview(); };

  switch (act) {
    case 'pick-bank': {
      // 从收款银行库挑一个，整栏填好
      openBankPicker((row) => {
        doc.bank = { ...(doc.bank || {}), ...row };
        rerender();
        scheduleAutosave();
        toast.ok('已填入银行：' + (row.bankName || ''));
      });
      break;
    }
    case 'save-bank': {
      // 把当前单据的银行信息存进银行库
      try {
        const row = await saveCurrentBankAsProfile(doc);
        rerender();
        toast.ok('已存入银行库：' + (row.bankName || ''), 2600);
      } catch (err) {
        toast.warn(String(err && err.message || err), 3000);
      }
      break;
    }
    case 'add-row': {
      doc.items.push(emptyItem(doc.items.length));
      recalcDoc(doc);
      refreshItemsTable();
      scheduleAutosave();
      if (onRefreshPreview) onRefreshPreview();
      toast.ok(t('msg.itemAdded'), 1200);
      break;
    }
    case 'row-del': {
      const i = Number(el.getAttribute('data-row'));
      if (doc.items.length <= 1) { doc.items[0] = emptyItem(0); }
      else doc.items.splice(i, 1);
      doc.items.forEach((it, k) => { it.order = k; });
      recalcDoc(doc);
      refreshItemsTable();
      scheduleAutosave();
      if (onRefreshPreview) onRefreshPreview();
      break;
    }
    case 'row-up': {
      const i = Number(el.getAttribute('data-row'));
      if (i <= 0) break;
      const items = doc.items;
      [items[i - 1], items[i]] = [items[i], items[i - 1]];
      items.forEach((it, k) => { it.order = k; });
      recalcDoc(doc); refreshItemsTable(); scheduleAutosave();
      if (onRefreshPreview) onRefreshPreview();
      break;
    }
    case 'row-down': {
      const i = Number(el.getAttribute('data-row'));
      const items = doc.items;
      if (i >= items.length - 1) break;
      [items[i + 1], items[i]] = [items[i], items[i + 1]];
      items.forEach((it, k) => { it.order = k; });
      recalcDoc(doc); refreshItemsTable(); scheduleAutosave();
      if (onRefreshPreview) onRefreshPreview();
      break;
    }
    case 'photo': {
      photoRowIndex = Number(el.getAttribute('data-photo-row'));
      if (doc.items[photoRowIndex] && doc.items[photoRowIndex].photo && e && e.shiftKey) {
        doc.items[photoRowIndex].photo = '';
        recalcDoc(doc); refreshItemsTable(); scheduleAutosave();
        if (onRefreshPreview) onRefreshPreview();
        break;
      }
      document.getElementById('filePhoto').click();
      break;
    }
    case 'upload-logo': {
      document.getElementById('fileLogo').click();
      break;
    }
    case 'upload-stamp': {
      document.getElementById('fileStamp').click();
      break;
    }
    case 'clear-stamp': {
      doc.seller.stamp = '';
      recalcDoc(doc); rerender(); scheduleAutosave();
      toast.info(t('stamp.removed'));
      break;
    }
    case 'save-stamp': {
      try {
        const r = await saveStampToLibrary(doc.seller.stamp);
        toast.ok(t('stamp.savedMsg', { n: r.updatedProfiles }), 2600);
      } catch (err) {
        toast.err(err.message || t('stamp.saveFailed'));
      }
      rerender();
      break;
    }
    case 'clear-logo': {
      doc.seller.logo = '';
      recalcDoc(doc); rerender(); scheduleAutosave();
      break;
    }
    case 'save-logo': {
      // 与「保存印章」同一套逻辑：存进默认公司 + 同名常用公司档案，
      // 之后新建单据会自动带上（见 store.createDoc）
      try {
        const r = await saveLogoToLibrary(doc.seller.logo);
        toast.ok(t('logo.savedMsg', { n: r.updatedProfiles }), 2600);
      } catch (err) {
        toast.err(err.message || t('logo.saveFailed'));
      }
      rerender();
      break;
    }
    case 'save-company': {
      await saveSellerAsProfile();
      rerender();
      break;
    }
    case 'clear-customs': {
      // 报关信息填乱了想重来？一键清空这一整块（明细里的报关字段也一起清）
      if (!window.confirm(t('msg.confirmClearCustoms'))) break;
      for (const k of CUSTOMS_FIELDS) doc[k] = '';
      for (const k of ['relatedPartyConfirm', 'priceImpactConfirm', 'royaltyConfirm', 'selfDeclaration']) doc[k] = '否';
      (doc.items || []).forEach((it) => {
        it.origin = ''; it.dest = ''; it.domesticSource = ''; it.lineDutyNature = '';
      });
      recalcDoc(doc);
      rerender();
      scheduleAutosave();
      toast.ok(t('msg.clearedCustoms'));
      break;
    }
    case 'save-customer': {
      openCustomerEditor(null, doc.buyer, () => rerender());
      break;
    }
    case 'add-customer': {
      openCustomerEditor(null, null, () => rerender());
      break;
    }
    case 'pick-customer': {
      openCustomerPicker((row) => {
        doc.buyer = { ...emptyParty(), ...row };
        if (doc.sameAsBuyerConsignee !== false) {
          doc.consignee = clone(doc.buyer);
          doc.notify = clone(doc.buyer);
        }
        recalcDoc(doc); rerender(); scheduleAutosave();
        toast.ok(t('msg.filled'));
      });
      break;
    }
    case 'pick-company': {
      openProfilePicker((p) => {
        const merged = { ...emptyParty(), ...doc.seller, ...p };
        doc.seller = merged;
        recalcDoc(doc); rerender(); scheduleAutosave();
        toast.ok('已填入：' + p.companyName, 2400);
      });
      break;
    }
    case 'row-spec': {
      openItemSpecEditor(Number(el.getAttribute('data-row')));
      break;
    }
    case 'row-show': {
      openRowShowEditor(Number(el.getAttribute('data-row')), () => refreshFormView());
      break;
    }
    case 'pick-decl': {
      // 申报要素：从产品库勾选，把预先存好的申报要素整行带进来
      openProductPicker((rows) => {
        rows.forEach((r) => {
          doc.items.push({
            ...emptyItem(doc.items.length),
            description: r.name || r.description || '',
            hsCode: r.hsCode || '',
            model: r.model || '',
            material: r.material || '',
            usagePurpose: r.usagePurpose || r.usage || '',
            brandName: r.brandName || r.brand || '',
            brandType: r.brandType || (r.brandName ? '' : '无品牌'),
            preferential: r.preferential || '不确定',
            specText: r.specText || r.size || '',
            size: r.size || r.specText || '',
            gtin: r.gtin || '',
            cas: r.cas || '',
            remark: r.remark || '',
          });
        });
        recalcDoc(doc);
        refreshItemsTable();
        scheduleAutosave();
        if (onRefreshPreview) onRefreshPreview();
        toast.ok(`已从产品库导入 ${rows.length} 项申报要素`);
      });
      break;
    }
    case 'add-extra-col': {
      // 自定义列：如「容积L」「最低温度℃」「结构」
      const label = await promptModal('新列名称（如 容积L / 最低温度℃ / 结构）', { title: '加一列' });
      if (!label || !String(label).trim()) break;
      doc.extraCols = Array.isArray(doc.extraCols) ? doc.extraCols : [];
      if (doc.extraCols.length >= 5) { toast.warn('自定义列最多 5 个', 2600); break; }
      doc.extraCols.push({ id: uid('col'), label: String(label).trim() });
      rerender();
      scheduleAutosave();
      toast.ok('已加列：' + String(label).trim());
      break;
    }
    case 'pick-product': {
      openProductPicker((rows) => {
        rows.forEach((r) => {
          doc.items.push({
            ...emptyItem(doc.items.length),
            description: r.name || r.description || '',
            model: r.model || '',
            hsCode: r.hsCode || '',
            unit: r.unit || 'pc',
            unitPrice: num(r.unitPrice) || 0,
            qty: 0,
            photo: r.photo || '',
            // 规格/尺寸：产品库里存过就带过来（以前漏了，用户反馈"选完还得手打"）
            size: r.size || r.specText || '',
            specText: r.specText || r.size || '',
            material: r.material || '',
            nw: num(r.nw) || 0,
            gw: num(r.gw) || 0,
            meas: num(r.meas) || 0,
          });
        });
        recalcDoc(doc);
        refreshItemsTable();
        scheduleAutosave();
        if (onRefreshPreview) onRefreshPreview();
        toast.ok(t('msg.filled'));
      });
      break;
    }
    case 'pick-clause': {
      openClausePicker((row) => {
        if (row.category === 'contract' && docMeta(doc.type).withContract) {
          try {
            const parsed = JSON.parse(row.body);
            if (Array.isArray(parsed)) doc.contractClauses = parsed;
          } catch {
            doc.contractClauses.push({ title: row.name, body: row.body });
          }
        } else {
          doc.terms = doc.terms ? `${doc.terms}\n${row.body}` : row.body;
        }
        recalcDoc(doc); rerender(); scheduleAutosave();
        toast.ok(t('msg.filled'));
      });
      break;
    }
    case 'save-clause': {
      const name = await promptModal('条款名称', { title: t('btn.saveToLibrary'), value: `${t(`doc.${doc.type}`)} ${doc.docNo}` });
      if (!name) break;
      const isContract = docMeta(doc.type).withContract;
      await saveClause({
        name,
        category: isContract ? 'contract' : doc.type,
        body: isContract ? JSON.stringify(doc.contractClauses || []) : doc.terms,
      });
      toast.ok(t('msg.savedToLib'));
      rerender();
      break;
    }
    case 'clause-add': {
      doc.contractClauses.push({ title: `${(doc.contractClauses || []).length + 1}. `, body: '' });
      rerender(); scheduleAutosave();
      break;
    }
    case 'clause-del': {
      const i = Number(el.getAttribute('data-clause'));
      doc.contractClauses.splice(i, 1);
      rerender(); scheduleAutosave();
      break;
    }
    case 'load-contract-clauses': {
      const tpl = getTemplate(doc.docLang);
      doc.contractClauses = clone(tpl.defaults?.contractClauses || []);
      rerender(); scheduleAutosave();
      toast.ok(t('msg.filled'));
      break;
    }
    case 'fx-helper':
      openRateHelper();
      break;
    default:
      break;
  }
}

/* ============================ 汇率换算助手 ============================ */

function openRateHelper() {
  const doc = state.doc;
  const wrap = document.createElement('div');
  const rates = state.rates || {};
  wrap.innerHTML = `
    <div class="grid grid-2">
      <div class="field"><label>人民币成本（元）</label>
        <input type="text" inputmode="decimal" autocomplete="off" data-num="1" id="fxCost" value="100" /></div>
      <div class="field"><label>报价币种</label>
        <input type="text" value="${esc(doc.currency)}" readonly /></div>
      <div class="field"><label>汇率（1 ${esc(doc.currency)} = ? 元人民币）</label>
        <input type="text" inputmode="decimal" autocomplete="off" data-num="1" id="fxRate" value="${esc(doc.exchangeRate || rates[doc.currency] || 1)}" /></div>
      <div class="field"><label>预期利润率（%）</label>
        <input type="text" inputmode="decimal" autocomplete="off" data-num="1" id="fxMargin" value="0" /></div>
      <div class="field span-2"><label>建议单价（${esc(doc.currency)}）</label>
        <input type="text" id="fxOut" readonly style="font-weight:700;font-size:16px;color:#12467f" /></div>
    </div>
    <div class="hint" style="margin-top:10px;font-size:12px;color:var(--c-text-mute)" id="fxNote"></div>`;

  const footer = document.createElement('div');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn';
  closeBtn.textContent = t('btn.close');
  const useRate = document.createElement('button');
  useRate.className = 'btn';
  useRate.textContent = '把该汇率写入单据';
  const apply = document.createElement('button');
  apply.className = 'btn btn-primary';
  apply.textContent = '应用到所有空单价的行';
  footer.append(closeBtn, useRate, apply);

  const ref = openModal({ title: '💱 汇率换算助手', body: wrap, footer, width: '560px' });

  const calc = () => {
    const cost = num(wrap.querySelector('#fxCost').value);
    const rate = num(wrap.querySelector('#fxRate').value);
    const margin = num(wrap.querySelector('#fxMargin').value);
    const price = costToPrice({ cost, rate, marginPercent: margin });
    const raw = costToPrice({ cost, rate, marginPercent: 0 });
    wrap.querySelector('#fxOut').value = `${doc.currency} ${money(price)}`;
    wrap.querySelector('#fxNote').textContent = rate
      ? `${money(cost)} 元 ÷ ${rate} = ${money(raw)} ${doc.currency}`
        + (margin ? `，加 ${margin}% 利润后 = ${money(price)} ${doc.currency}` : '')
      : '请填写有效汇率（1 单位外币 = 多少人民币）';
    return price;
  };
  ['#fxCost', '#fxRate', '#fxMargin'].forEach((sel) => {
    wrap.querySelector(sel).addEventListener('input', calc);
  });
  calc();

  closeBtn.onclick = () => ref.close();
  useRate.onclick = () => {
    doc.exchangeRate = num(wrap.querySelector('#fxRate').value) || 1;
    state.rates = { ...state.rates, [doc.currency]: doc.exchangeRate };
    saveRates({ [doc.currency]: doc.exchangeRate });
    ref.close();
    rerenderForm();
    scheduleAutosave();
    toast.ok('汇率已写入单据');
  };
  apply.onclick = () => {
    const price = calc();
    let n = 0;
    doc.items.forEach((it) => {
      if (!num(it.unitPrice)) { it.unitPrice = price; n += 1; }
    });
    doc.exchangeRate = num(wrap.querySelector('#fxRate').value) || doc.exchangeRate;
    recalcDoc(doc);
    ref.close();
    rerenderForm();
    refreshItemsTable();
    scheduleAutosave();
    if (state._refreshPreview) state._refreshPreview();
    toast.ok(n ? `已为 ${n} 行填入单价` : '所有行都已有单价，未修改');
  };

  function rerenderForm() {
    renderForm(document.getElementById('formHost'), state._refreshPreview);
  }
}

/* ============================ 图片上传处理 ============================ */

export function initPhotoInputs(onRefreshPreview) {
  const logoInput = document.getElementById('fileLogo');
  const photoInput = document.getElementById('filePhoto');
  const stampInput = document.getElementById('fileStamp');

  logoInput.addEventListener('change', async () => {
    const file = logoInput.files && logoInput.files[0];
    logoInput.value = '';
    if (!file || !state.doc) return;
    const dataUrl = await compressImage(file, 600, 0.92);
    state.doc.seller.logo = dataUrl;
    recalcDoc(state.doc);
    renderForm(document.getElementById('formHost'), onRefreshPreview);
    scheduleAutosave();
    if (onRefreshPreview) onRefreshPreview();
    toast.ok(t('logo.uploaded'));
  });

  if (stampInput) {
    stampInput.addEventListener('change', async () => {
      const file = stampInput.files && stampInput.files[0];
      stampInput.value = '';
      if (!file || !state.doc) return;
      // 印章用专用压缩：保留透明底、不铺白
      const dataUrl = await compressStamp(file, 520);
      state.doc.seller.stamp = dataUrl;
      recalcDoc(state.doc);
      renderForm(document.getElementById('formHost'), onRefreshPreview);
      scheduleAutosave();
      if (onRefreshPreview) onRefreshPreview();
      toast.ok(t('stamp.uploaded'));
    });
  }

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    photoInput.value = '';
    if (!file || !state.doc || photoRowIndex < 0) return;
    const dataUrl = await compressImage(file, 700, 0.82);
    if (state.doc.items[photoRowIndex]) {
      state.doc.items[photoRowIndex].photo = dataUrl;
      // 同理：传了图就自动打开图片列，别让用户传完看不到任何反应
      const turnedOn = !state.doc.showPhoto;
      state.doc.showPhoto = true;
      recalcDoc(state.doc);
      refreshItemsTable();
      scheduleAutosave();
      if (onRefreshPreview) onRefreshPreview();
      if (turnedOn) toast.ok(t('msg.photoShown'));
    }
    photoRowIndex = -1;
  });
}

/* ============================ 通用：表单字段构建 ============================ */

/** 弹层里的一行输入 */
function editorField({ key, label, value = '', type = 'text', span = 1, options, placeholder = '', tip = '' }) {
  const spanCls = span === 2 ? 'span-2' : '';
  const tipAttr = tip ? ` title="${esc(tip)}"` : '';
  let control;
  if (type === 'select') {
    control = `<select data-f="${key}"${tipAttr}>${
      (options || []).map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const lab = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(val)}"${String(val) === String(value) ? ' selected' : ''}>${esc(lab)}</option>`;
      }).join('')
    }</select>`;
  } else if (type === 'photo') {
    control = `<div class="photo-pick" data-photo-pick>
        <div class="photo-pick-preview" data-photo-preview style="${value ? `background-image:url('${value}')` : ''}">${value ? '' : '📷 点击上传'}</div>
        <div class="photo-pick-actions">
          <button type="button" class="btn btn-sm" data-photo-choose>${value ? '更换图片' : '选择图片'}</button>
          <button type="button" class="btn btn-sm btn-danger" data-photo-clear ${value ? '' : 'hidden'}>移除</button>
        </div>
        <input type="file" accept="image/*" class="hidden" data-photo-file />
        <input type="hidden" data-f="${key}" value="${esc(value)}" />
      </div>`;
  } else if (type === 'textarea') {
    control = `<textarea data-f="${key}" rows="4" style="min-height:96px" placeholder="${esc(placeholder)}"${tipAttr}>${esc(value)}</textarea>`;
  } else {
    control = `<input type="${type}" data-f="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}"${tipAttr} />`;
  }
  // ⚠️ label 要过一遍 t()：
  //    规格弹层的 fields 传的是 i18n key（如 'f.styleName'），早先直接 esc(label)
  //    会把 key 原样打印到界面上（弹层里显示 "f.styleName" 而不是"款号"）。
  //    t() 对没命中的纯文本（如 '外箱长 cm'）原样返回，所以两种写法都安全。
  return `<div class="field ${spanCls}"><label>${esc(t(label))}</label>${control}</div>`;
}

/** 给弹层里的图片字段接上选择 / 移除行为 */
function bindPhotoFields(container) {
  container.querySelectorAll('[data-photo-pick]').forEach((box) => {
    const preview = box.querySelector('[data-photo-preview]');
    const file = box.querySelector('[data-photo-file]');
    const hidden = box.querySelector('[data-f]');
    const clearBtn = box.querySelector('[data-photo-clear]');
    const chooseBtn = box.querySelector('[data-photo-choose]');

    const paint = (url) => {
      if (url) {
        preview.style.backgroundImage = `url('${url}')`;
        preview.textContent = '';
        clearBtn.hidden = false;
        chooseBtn.textContent = '更换图片';
      } else {
        preview.style.backgroundImage = '';
        preview.textContent = '📷 点击上传';
        clearBtn.hidden = true;
        chooseBtn.textContent = '选择图片';
      }
    };

    const open = () => file.click();
    preview.onclick = open;
    chooseBtn.onclick = open;
    clearBtn.onclick = () => { hidden.value = ''; file.value = ''; paint(''); };

    file.onchange = async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      preview.textContent = '压缩中…';
      try {
        const url = await compressImage(f, 700, 0.82);
        hidden.value = url;
        paint(url);
      } catch (err) {
        console.error(err);
        preview.textContent = '图片读取失败';
      }
    };
  });
}

/** 读取弹层里的所有 [data-f] 字段 */
function readEditor(container) {
  const out = {};
  container.querySelectorAll('[data-f]').forEach((el) => {
    const k = el.getAttribute('data-f');
    out[k] = el.value;
  });
  return out;
}

/** 弹层里的错误提示条 */
function editorError(container, msg) {
  let bar = container.querySelector('.editor-error');
  if (!msg) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'editor-error';
    container.insertBefore(bar, container.firstChild);
  }
  bar.textContent = '⚠ ' + msg;
  bar.scrollIntoView({ block: 'nearest' });
}

/** 构建一个带「保存/取消」的编辑弹层 */
function buildEditor({ title, fields, onSubmit, width = '640px', hint = '', validate }) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `${hint ? `<div class="editor-hint">${hint}</div>` : ''}
    <div class="grid grid-2">${fields.map(editorField).join('')}</div>`;

  const footer = document.createElement('div');
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-lg';
  cancel.textContent = t('btn.cancel');
  const save = document.createElement('button');
  save.className = 'btn btn-primary btn-lg';
  save.textContent = t('btn.saveItem');   // 资料库条目用「保存」，不要用「保存草稿」
  footer.append(cancel, save);

  const ref = openModal({ title, body: wrap, footer, width });
  cancel.onclick = () => ref.close();
  bindPhotoFields(wrap);

  save.onclick = async () => {
    const data = readEditor(wrap);
    const problem = validate ? validate(data) : null;
    if (problem) { editorError(wrap, problem); return; }
    editorError(wrap, null);
    save.disabled = true;
    save.textContent = '保存中…';
    try {
      await onSubmit(data);
      ref.close();
    } catch (err) {
      console.error(err);
      editorError(wrap, err && err.message ? err.message : '保存失败');
    } finally {
      save.disabled = false;
      save.textContent = t('btn.saveItem');
    }
  };

  // 回车即保存（多行文本框除外）
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save.click(); }
  });
  setTimeout(() => { const first = wrap.querySelector('[data-f]'); if (first) first.focus(); }, 60);

  return { ref, wrap };
}

/* ============================ 客户编辑（新增 / 修改） ============================ */

export function openCustomerEditor(id, seed, onDone) {
  const existing = id ? state.customers.find((c) => c.id === id) || null : null;
  const data = existing || { ...(seed || {}) };

  const fields = [
    { key: 'name', label: `${t('lib.name')}（必填）`, value: data.name || data.companyName || '', span: 2, placeholder: '例如 ACME TRADING CO., LTD.' },
    { key: 'companyName', label: t('f.companyName'), value: data.companyName || data.name || '', span: 2 },
    { key: 'address', label: t('f.address'), value: data.address || '', span: 2 },
    { key: 'city', label: t('f.city'), value: data.city || '' },
    { key: 'state', label: t('f.state'), value: data.state || '' },
    { key: 'zip', label: t('f.zip'), value: data.zip || '' },
    { key: 'country', label: t('f.country'), value: data.country || '' },
    { key: 'contact', label: t('f.contact'), value: data.contact || '' },
    { key: 'tel', label: t('f.tel'), value: data.tel || '' },
    { key: 'email', label: t('f.email'), value: data.email || '' },
    { key: 'taxId', label: t('f.taxId'), value: data.taxId || '' },
  ];

  const { ref } = buildEditor({
    title: existing ? `✏️ ${t('lib.customers')} — 修改` : `➕ ${t('lib.customers')} — 新增`,
    hint: '填好后可在单据里点「👥 从客户库选择」一键带入买方信息。',
    fields,
    validate: (d) => (String(d.name || '').trim() ? null : '请填写客户名称（必填）'),
    onSubmit: async (d) => {
      const name = String(d.name).trim();
      const row = await saveCustomer({
        ...(existing ? { id: existing.id } : {}),
        ...d,
        name,
        companyName: String(d.companyName || '').trim() || name,
      });
      toast.ok(t('msg.savedToLib'));
      if (onDone) onDone(row);
    },
  });
  return ref;
}

/* ============================ 产品编辑（新增 / 修改） ============================ */

export function openProductEditor(id, seed, onDone) {
  const existing = id ? state.products.find((p) => p.id === id) || null : null;
  const data = existing || { ...(seed || {}) };

  const fields = [
    { key: 'photo', label: `${t('f.photo')}（可上传产品图，会出现在单据上）`, type: 'photo', value: data.photo || '', span: 2 },
    { key: 'name', label: `${t('f.description')}（必填）`, value: data.name || data.description || '', span: 2, placeholder: '例如 Stainless Steel Ball Valve 1/2 inch' },
    { key: 'model', label: t('f.model'), value: data.model || '' },
    { key: 'hsCode', label: t('f.hsCode'), value: data.hsCode || '', tip: '清关用的海关编码，填一次以后复用' },
    { key: 'unit', label: t('f.unit'), type: 'select', value: data.unit || 'pc', options: unitOptions(UNITS) },
    { key: 'unitPrice', label: t('f.unitPrice'), type: 'number', value: data.unitPrice ?? '' },
    { key: 'packUnit', label: '包装单位', type: 'select', value: data.packUnit || DEFAULT_PACK_UNIT, options: unitOptions(PACK_UNITS), tip: '装箱单「件数」用的单位' },
    { key: 'weightUnit', label: '重量单位', type: 'select', value: data.weightUnit || DEFAULT_WEIGHT_UNIT, options: unitOptions(WEIGHT_UNITS) },
    { key: 'gw', label: t('f.gw'), type: 'number', value: data.gw ?? '' },
    { key: 'nw', label: t('f.nw'), type: 'number', value: data.nw ?? '' },
    { key: 'measUnit', label: '体积单位', type: 'select', value: data.measUnit || DEFAULT_MEAS_UNIT, options: unitOptions(MEAS_UNITS) },
    { key: 'meas', label: t('f.meas'), type: 'number', value: data.meas ?? '' },
    /* ---- 申报要素（报关资料用；存一次，做申报要素表时勾选自动带出来）---- */
    { key: 'material', label: '材质（申报要素）', value: data.material || '', placeholder: '如 不锈钢' },
    { key: 'usagePurpose', label: '用途（申报要素）', value: data.usagePurpose || '', placeholder: '如 用于酒店或超市陈列展示' },
    { key: 'brandName', label: '品牌（没有就写"无"）', value: data.brandName || '', placeholder: '如 无' },
    // 品牌类型 / 出口享惠：只有这几种标准说法，做成下拉，避免手打出差异
    { key: 'brandType', label: '品牌类型', type: 'select', value: data.brandType || '', options: DE_BRAND_TYPES },
    { key: 'preferential', label: '出口享惠情况', type: 'select', value: data.preferential || '', options: DE_PREFERENTIALS },
    // 规格：单据上的「规格」列和申报要素表的「规格」用的是同一个值
    { key: 'specText', label: '规格 / 尺寸（如 1200*700*800）', value: data.specText || data.size || '', placeholder: '如 1200*700*800' },
    { key: 'gtin', label: 'GTIN', value: data.gtin || '' },
    { key: 'cas', label: 'CAS', value: data.cas || '' },
    { key: 'remark', label: '其他要素', value: data.remark || '', span: 2, placeholder: '如 结构：立式' },
  ];

  const { ref } = buildEditor({
    title: existing ? `✏️ ${t('lib.products')} — 修改` : `➕ ${t('lib.products')} — 新增`,
    hint: '存好后在单据的产品行点「📦 从产品库选择」可多选批量插入；在品名里输入同名产品会自动补型号、HS 编码与单位。',
    fields,
    validate: (d) => (String(d.name || '').trim() ? null : '请填写产品名称（必填）'),
    onSubmit: async (d) => {
      // 规格同时写进 size：单据的「规格」列读 size，申报要素表读 specText
      const spec = String(d.specText || '').trim();
      const row = await saveProduct({
        ...(existing ? { id: existing.id } : {}),
        ...d,
        specText: spec,
        size: spec,
        name: String(d.name).trim(),
        unitPrice: num(d.unitPrice),
        nw: num(d.nw), gw: num(d.gw), meas: num(d.meas),
      });
      toast.ok(t('msg.savedToLib'));
      if (onDone) onDone(row);
    },
  });
  return ref;
}

/* ============================ 条款编辑（新增 / 修改） ============================ */

export function openClauseEditor(id, seed, onDone) {
  const existing = id ? state.clauses.find((c) => c.id === id) || null : null;
  const data = existing || { ...(seed || {}) };

  const CATEGORIES = [
    { value: 'general', label: '通用条款' },
    { value: 'quotation', label: '报价单条款' },
    { value: 'pi', label: '形式发票条款' },
    { value: 'contract', label: '销售合同条款（整组）' },
  ];

  const fields = [
    { key: 'name', label: `${t('lib.name')}（必填）`, value: data.name || '', span: 2, placeholder: '例如 标准付款条款' },
    { key: 'category', label: t('lib.category'), type: 'select', value: data.category || 'general', options: CATEGORIES, span: 2 },
    { key: 'body', label: '条款内容', type: 'textarea', value: data.body || '', span: 2, placeholder: '例如 1. Payment Terms: 30% T/T deposit, 70% balance before shipment.' },
  ];

  const { ref } = buildEditor({
    title: existing ? `✏️ ${t('lib.clauses')} — 修改` : `➕ ${t('lib.clauses')} — 新增`,
    hint: '选「销售合同条款（整组）」时，内容可填整组条款的 JSON（由「载入模板」保存下来的格式）。',
    fields,
    validate: (d) => {
      if (!String(d.name || '').trim()) return '请填写条款名称（必填）';
      if (!String(d.body || '').trim()) return '请填写条款内容';
      if (d.category === 'contract') {
        try {
          const parsed = JSON.parse(d.body);
          if (!Array.isArray(parsed)) return '合同条款内容应为 JSON 数组（含 title / body）';
        } catch (e) {
          return '合同条款内容不是合法 JSON：' + e.message;
        }
      }
      return null;
    },
    onSubmit: async (d) => {
      const row = await saveClause({
        ...(existing ? { id: existing.id } : {}),
        ...d,
        name: String(d.name).trim(),
        body: String(d.body).trim(),
      });
      toast.ok(t('msg.savedToLib'));
      if (onDone) onDone(row);
    },
  });
  return ref;
}

/* ============================ 常用公司档案（卖方抬头） ============================ */

/** 新增 / 修改一份公司档案 */
export function openProfileEditor(id, seed, onDone) {
  const existing = id ? state.profiles.find((p) => p.id === id) || null : null;
  const data = existing || { ...(seed || {}) };

  const fields = [
    { key: 'companyName', label: `${t('f.companyName')}（必填）`, value: data.companyName || '', span: 2 },
    { key: 'address', label: t('f.address'), value: data.address || '', span: 2 },
    { key: 'city', label: t('f.city'), value: data.city || '' },
    { key: 'state', label: t('f.state'), value: data.state || '' },
    { key: 'zip', label: t('f.zip'), value: data.zip || '' },
    { key: 'country', label: t('f.country'), value: data.country || '' },
    { key: 'contact', label: t('f.contact'), value: data.contact || '' },
    { key: 'tel', label: t('f.tel'), value: data.tel || '' },
    { key: 'email', label: t('f.email'), value: data.email || '' },
    { key: 'taxId', label: t('f.taxId'), value: data.taxId || '' },
  ];

  const { ref } = buildEditor({
    title: existing ? '✏️ 常用公司 — 修改' : '➕ 常用公司 — 新增',
    hint: '存好后在单据的「卖方」区点「🏢 从常用公司选择」，一键填好整栏（含 LOGO）。',
    fields,
    validate: (d) => (String(d.companyName || '').trim() ? null : '请填写公司名称（必填）'),
    onSubmit: async (d) => {
      const row = await saveProfile({ ...(existing ? { id: existing.id } : {}), ...d, companyName: String(d.companyName).trim() });
      toast.ok(t('msg.savedToLib'));
      if (onDone) onDone(row);
    },
  });
  return ref;
}

/**
 * 收款银行档案编辑器（和常用公司一样：新增/修改/删除）
 * 字段对应单据里的「银行信息」区：收款人 / 开户银行 / 银行地址 / 账号 / SWIFT / IBAN / 账户名
 */
export function openBankEditor(id, seed, onDone) {
  const existing = id ? (state.banks || []).find((p) => p.id === id) || null : null;
  const data = existing || { ...(seed || {}) };
  const fields = [
    { key: 'bankName', label: '开户银行（必填）', value: data.bankName || '', span: 2 },
    { key: 'beneficiary', label: '收款人', value: data.beneficiary || '', span: 2 },
    { key: 'bankAddress', label: '银行地址', value: data.bankAddress || '', span: 2 },
    { key: 'accountNo', label: '银行账号', value: data.accountNo || '' },
    { key: 'accountName', label: '账户名', value: data.accountName || '' },
    { key: 'swiftCode', label: 'SWIFT 代码', value: data.swiftCode || '' },
    { key: 'iban', label: 'IBAN / 其他', value: data.iban || '' },
    { key: 'payeeRef', label: '制单人 / 附言', value: data.payeeRef || '', span: 2 },
  ];
  const { ref } = buildEditor({
    title: existing ? '✏️ 收款银行 — 修改' : '➕ 收款银行 — 新增',
    hint: '存好后在单据「银行信息」区点「🏦 从银行库选择」，一键填好整栏。',
    fields,
    validate: (d) => (String(d.bankName || '').trim() ? null : '请填写开户银行（必填）'),
    onSubmit: async (d) => {
      const row = await saveBank({ ...(existing ? { id: existing.id } : {}), ...d, bankName: String(d.bankName).trim() });
      toast.ok(t('msg.savedToLib'));
      if (onDone) onDone(row);
    },
  });
  return ref;
}

/** 从收款银行库挑一个，一键填好银行信息整栏 */
export function openBankPicker(onPick) {
  const wrap = document.createElement('div');
  const list = state.banks || [];
  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="ico">🏦</div>
      <div class="msg" style="line-height:1.8">还没有收款银行。<br>
      在「📚 模板库 → 🏦 银行」里点「＋」新增，<br>
      或在银行信息区填好后点「💾 存为常用银行」。</div></div>`;
  } else {
    wrap.innerHTML = `<div class="editor-hint">点「用这个」就会把收款人 / 开户行 / 账号 / SWIFT 整栏填好。</div>
      <div style="display:flex;flex-direction:column;gap:7px;margin-top:8px">
      ${list.map((b) => `<div class="lib-row" style="margin:0">
        <div class="info"><div class="nm">${esc(b.bankName || '')}</div>
        <div class="sub">${esc([b.beneficiary, b.accountNo, b.swiftCode].filter(Boolean).join(' · '))}</div></div>
        <button class="btn btn-sm btn-primary" data-pickbank="${b.id}">用这个</button>
      </div>`).join('')}</div>`;
  }
  const ref = openModal({ title: '🏦 选择收款银行', body: wrap, width: '520px' });
  wrap.querySelectorAll('[data-pickbank]').forEach((b) => b.addEventListener('click', () => {
    const row = (state.banks || []).find((x) => x.id === b.getAttribute('data-pickbank'));
    if (row) { onPick(row); ref.close(); }
  }));
  return ref;
}

/** 从常用公司里挑一个，一键填好卖方整栏 */
export function openProfilePicker(onPick) {
  const wrap = document.createElement('div');
  const list = state.profiles;

  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="ico">🏢</div>
      <div class="msg" style="line-height:1.8">还没有常用公司。<br>
      在「📚 模板库 → 🏢 常用公司」里点「＋」新增，<br>
      或在卖方区填好后点「💾 存为常用公司」。</div></div>`;
  } else {
    wrap.innerHTML = `<div class="editor-hint">点「用这个」就会把卖方信息整栏填好（含 LOGO）。</div>
      ${list.map((p) => `
      <div class="lib-row">
        <div class="info">
          <div class="nm">${esc(p.companyName)}</div>
          <div class="sub">${esc([p.address, p.city, p.country, p.contact, p.tel].filter(Boolean).join(' · ') || '（仅有公司名）')}</div>
        </div>
        <button class="btn btn-sm btn-primary" data-use="${p.id}">用这个</button>
      </div>`).join('')}`;
  }

  const footer = document.createElement('div');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-accent';
  addBtn.textContent = '＋ 新增常用公司';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn';
  closeBtn.textContent = t('btn.close');
  footer.append(addBtn, closeBtn);

  const ref = openModal({ title: `🏢 常用公司（${list.length}）`, body: wrap, footer, width: '620px' });
  closeBtn.onclick = () => ref.close();
  addBtn.onclick = () => { ref.close(); openProfileEditor(null, state.doc?.seller, () => onPick && openProfilePicker(onPick)); };

  wrap.querySelectorAll('[data-use]').forEach((b) => {
    b.onclick = () => {
      const p = list.find((x) => x.id === b.getAttribute('data-use'));
      ref.close();
      if (p && onPick) onPick(p);
    };
  });
}

/** 把当前卖方信息存为常用公司 */
export async function saveSellerAsProfile() {
  const doc = state.doc;
  if (!doc) { toast.warn(t('msg.needDoc')); return null; }
  try {
    const row = await saveCurrentSellerAsProfile(doc);
    toast.ok(`已存为常用公司：${row.companyName}`, 2600);
    return row;
  } catch (err) {
    toast.err(err.message || '保存失败');
    return null;
  }
}

/* ============================ 历史公司选择器 ============================ */

/**
 * 从「填过的卖方公司」里选一个，自动填好整栏
 * 数据来源：输入历史（公司名 / 联系人 / 电话 / 邮箱）+ 当前单据里存过的完整卖方信息
 */
export function openCompanyPicker() {
  const doc = state.doc;
  if (!doc) return;

  // 1) 当前单据的卖方信息 = 一份完整档案
  const profiles = [];
  const seen = new Set();
  const addProfile = (name, data) => {
    const key = String(name || '').trim();
    if (!key || seen.has(key.toLowerCase())) return;
    seen.add(key.toLowerCase());
    profiles.push({ name: key, data: data || {} });
  };

  if (doc.seller.companyName) addProfile(doc.seller.companyName, doc.seller);
  if (state.company.companyName) addProfile(state.company.companyName, state.company);

  // 2) 输入历史里的公司名（可能没有完整地址，只补能补的字段）
  historyValues('seller.companyName').forEach((name) => {
    addProfile(name, {
      companyName: name,
      contact: historyValues('seller.contact')[0] || '',
      tel: historyValues('seller.tel')[0] || '',
      email: historyValues('seller.email')[0] || '',
    });
  });

  const wrap = document.createElement('div');
  if (!profiles.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="msg">还没有历史公司。<br>先填好「卖方」信息，点「把当前卖方信息存为默认公司」，下次就能一键带出。</div></div>`;
  } else {
    wrap.innerHTML = `
      <div class="hint" style="font-size:12.5px;color:var(--c-text-mute);margin-bottom:10px">
        下面是你填过的公司，点「用这个」就会把卖方信息整栏填好。
      </div>
      ${profiles.map((p, i) => `
        <div class="lib-row">
          <div class="info">
            <div class="nm">${esc(p.name)}</div>
            <div class="sub">${esc([p.data.address, p.data.city, p.data.country, p.data.contact, p.data.tel].filter(Boolean).join(' · ') || '（仅有公司名）')}</div>
          </div>
          <button class="btn btn-sm btn-primary" data-use="${i}">用这个</button>
        </div>`).join('')}`;
  }

  const ref = openModal({ title: `📋 历史公司（${profiles.length}）`, body: wrap, width: '600px' });

  wrap.querySelectorAll('[data-use]').forEach((b) => {
    b.onclick = () => {
      const p = profiles[Number(b.getAttribute('data-use'))];
      const merged = { ...emptyParty(), ...doc.seller };
      // 公司名一定覆盖；其余字段有值才覆盖，没值保留原样
      merged.companyName = p.name;
      ['address', 'city', 'state', 'zip', 'country', 'contact', 'tel', 'fax', 'email', 'website', 'taxId']
        .forEach((k) => { if (String(p.data[k] || '').trim()) merged[k] = p.data[k]; });
      if (p.data.logo) merged.logo = p.data.logo;
      doc.seller = merged;
      recalcDoc(doc);
      ref.close();
      renderForm(document.getElementById('formHost'), state._refreshPreview);
      scheduleAutosave();
      if (state._refreshPreview) state._refreshPreview();
      toast.ok('已填入：' + p.name, 2200);
    };
  });
}

/* ============================ 客户 / 产品 / 条款 选择器 ============================ */
function partyToForm(container, party) {
  container.innerHTML = `<div class="grid grid-2">${PARTY_FIELDS.map((f) => `
    <div class="field ${f.span === 2 ? 'span-2' : ''}">
      <label>${esc(t(f.label))}</label>
      <input type="text" data-p="${f.key}" value="${esc(party[f.key] || '')}" />
    </div>`).join('')}</div>`;
}

function readPartyForm(container, base = {}) {
  const out = { ...base };
  container.querySelectorAll('[data-p]').forEach((el) => { out[el.getAttribute('data-p')] = el.value; });
  return out;
}

export function openCustomerPicker(onPick) {
  const wrap = document.createElement('div');
  const render = () => {
    if (!state.customers.length) {
      wrap.innerHTML = `<div class="empty-state">
        <div class="ico">👥</div>
        <div class="msg" style="line-height:1.8">客户库还是空的。<br>点下面的「＋ 新增客户」，以后就能一键带入买方信息。</div></div>`;
      return;
    }
    wrap.innerHTML = `<input type="search" id="pickSearch" placeholder="${t('drafts.search')}" style="margin-bottom:9px" />
      <div id="pickList">${state.customers.map((c) => `
      <div class="lib-row" data-id="${c.id}">
        <div class="info"><div class="nm">${esc(c.name || c.companyName || '')}</div>
        <div class="sub">${esc([c.country, c.city, c.contact, c.tel, c.email].filter(Boolean).join(' · '))}</div></div>
        <button class="btn btn-sm btn-primary" data-pick="${c.id}">${t('btn.apply')}</button>
        <button class="mini-btn" data-edit="${c.id}" title="修改">✏️</button>
        <button class="mini-btn danger" data-del="${c.id}" title="删除">✕</button>
      </div>`).join('')}</div>`;
    wrap.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => {
        const row = state.customers.find((c) => c.id === b.getAttribute('data-pick'));
        ref.close();
        if (row && onPick) onPick(row);
      };
    });

    wrap.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        openCustomerEditor(b.getAttribute('data-edit'), null, () => render());
      };
    });
    wrap.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const row = state.customers.find((c) => c.id === b.getAttribute('data-del'));
        const yes = await confirmModal(`确定删除客户「${row?.name || ''}」吗？`);
        if (!yes) return;
        await removeCustomer(b.getAttribute('data-del'));
        toast.ok(t('msg.deleted'));
        render();
      };
    });
    const s = wrap.querySelector('#pickSearch');
    s.oninput = () => {
      const q = s.value.trim().toLowerCase();
      wrap.querySelectorAll('.lib-row').forEach((r) => {
        r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };
  };
  render();

  const footer = document.createElement('div');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-accent';
  addBtn.textContent = '＋ 新增客户';
  footer.appendChild(addBtn);

  const ref = openModal({ title: `${t('lib.customers')}`, body: wrap, footer, width: '620px' });
  addBtn.onclick = () => openCustomerEditor(null, null, () => render());
}

export function openProductPicker(onPickMulti) {
  const selected = new Set();
  const wrap = document.createElement('div');

  const render = () => {
    if (!state.products.length) {
      wrap.innerHTML = `<div class="empty-state">
        <div class="ico">📦</div>
        <div class="msg" style="line-height:1.8">产品库还是空的。<br>点下面的「＋ 新增产品」，或在单据产品行填好后点「存入产品库」。</div></div>`;
      return;
    }
    wrap.innerHTML = `<div class="pk-hint" style="font-size:12px;color:var(--c-text-mute);margin:0 0 8px">📌 置顶常用产品 · ⬆⬇ 调整顺序（自动保存）· 也可以直接在搜索框里按名称/编号找</div>
      <input type="search" id="pkSearch" placeholder="${t('drafts.search')}" style="margin-bottom:9px" />
      <div>${state.products.map((p) => `
      <label class="lib-row${p.pinned ? ' is-pinned' : ''}" data-id="${p.id}" style="cursor:pointer">
        <input type="checkbox" data-check="${p.id}" style="width:auto" ${selected.has(p.id) ? 'checked' : ''} />
        <div class="info"><div class="nm">${esc(p.name || p.description || '')}</div>
        <div class="sub">${esc([p.model, p.hsCode, p.unit, p.unitPrice !== undefined && p.unitPrice !== '' ? p.unitPrice : ''].filter(Boolean).join(' · '))}</div></div>
        <button class="mini-btn" data-pin="${p.id}" title="${p.pinned ? '取消置顶' : '置顶（常用放最前）'}">${p.pinned ? '📌' : '📍'}</button>
        <button class="mini-btn" data-up="${p.id}" title="上移一位">⬆</button>
        <button class="mini-btn" data-down="${p.id}" title="下移一位">⬇</button>
        <button class="mini-btn" data-edit="${p.id}" title="修改">✏️</button>
        <button class="mini-btn danger" data-del="${p.id}" title="删除">✕</button>
      </label>`).join('')}</div>`;
    // 置顶 / 上移 / 下移（产品库手动排序）
    wrap.querySelectorAll('[data-up]').forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        const ok = await moveProduct(b.getAttribute('data-up'), -1);
        if (ok) render();
      };
    });
    wrap.querySelectorAll('[data-down]').forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        const ok = await moveProduct(b.getAttribute('data-down'), 1);
        if (ok) render();
      };
    });
    wrap.querySelectorAll('[data-pin]').forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        await togglePinProduct(b.getAttribute('data-pin'));
        render();
      };
    });

    wrap.querySelectorAll('[data-check]').forEach((cb) => {
      cb.onchange = () => {
        const id = cb.getAttribute('data-check');
        if (cb.checked) selected.add(id); else selected.delete(id);
      };
    });
    wrap.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        openProductEditor(b.getAttribute('data-edit'), null, () => render());
      };
    });
    wrap.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        const row = state.products.find((p) => p.id === b.getAttribute('data-del'));
        const yes = await confirmModal(`确定删除产品「${row?.name || ''}」吗？`);
        if (!yes) return;
        await removeProduct(b.getAttribute('data-del'));
        selected.delete(b.getAttribute('data-del'));
        toast.ok(t('msg.deleted'));
        render();
      };
    });
    const s = wrap.querySelector('#pkSearch');
    s.oninput = () => {
      const q = s.value.trim().toLowerCase();
      wrap.querySelectorAll('.lib-row').forEach((r) => {
        r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };
  };
  render();

  const footer = document.createElement('div');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-accent';
  addBtn.textContent = '＋ 新增产品';
  const cancel = document.createElement('button');
  cancel.className = 'btn'; cancel.textContent = t('btn.cancel');
  const apply = document.createElement('button');
  apply.className = 'btn btn-primary'; apply.textContent = t('btn.apply');
  footer.append(addBtn, cancel, apply);

  const ref = openModal({ title: `📦 ${t('lib.products')}`, body: wrap, footer, width: '620px' });
  addBtn.onclick = () => openProductEditor(null, null, () => render());
  cancel.onclick = () => ref.close();
  apply.onclick = () => {
    const rows = state.products.filter((p) => selected.has(p.id));
    if (!rows.length) { toast.warn('请先勾选要插入的产品'); return; }
    ref.close();
    if (onPickMulti) onPickMulti(rows);
  };
}

export function openClausePicker(onPick) {
  const wrap = document.createElement('div');
  const render = () => {
    if (!state.clauses.length) {
      wrap.innerHTML = `<div class="empty-state">
        <div class="ico">📑</div>
        <div class="msg" style="line-height:1.8">条款库还是空的。<br>点下面的「＋ 新增条款」，或在单据条款框写好内容后点「存入资料库」。</div></div>`;
      return;
    }
    wrap.innerHTML = state.clauses.map((c) => `
      <div class="lib-row">
        <div class="info"><div class="nm">${esc(c.name)}</div>
        <div class="sub">${esc(c.category || '')} · ${esc(String(c.body || '').replace(/\s+/g, ' ').slice(0, 60))}…</div></div>
        <button class="btn btn-sm btn-primary" data-pick="${c.id}">${t('btn.apply')}</button>
        <button class="mini-btn" data-edit="${c.id}" title="修改">✏️</button>
        <button class="mini-btn danger" data-del="${c.id}" title="删除">✕</button>
      </div>`).join('');
    wrap.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => {
        const row = state.clauses.find((c) => c.id === b.getAttribute('data-pick'));
        ref.close();
        if (row && onPick) onPick(row);
      };
    });
    wrap.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => openClauseEditor(b.getAttribute('data-edit'), null, () => render());
    });
    wrap.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const row = state.clauses.find((c) => c.id === b.getAttribute('data-del'));
        const yes = await confirmModal(`确定删除条款「${row?.name || ''}」吗？`);
        if (!yes) return;
        await removeClause(b.getAttribute('data-del'));
        toast.ok(t('msg.deleted'));
        render();
      };
    });
  };
  render();

  const footer = document.createElement('div');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-accent';
  addBtn.textContent = '＋ 新增条款';
  footer.appendChild(addBtn);

  const ref = openModal({ title: `📑 ${t('lib.clauses')}`, body: wrap, footer, width: '620px' });
  addBtn.onclick = () => openClauseEditor(null, null, () => render());
}

/* 供自测 / 调试脚本驱动：刷新表单与预览 */
export function refreshFormView() {
  renderForm(document.getElementById('formHost'), state._refreshPreview || (() => {}));
  if (state._refreshPreview) state._refreshPreview();
}

/* 供调试脚本切换当前单据（仅自测模式暴露在 window 上） */
export function mountDoc(doc) {
  state.doc = doc;
  refreshFormView();
}

/* ============================ 供应商 / 客户 快捷新增入口 ============================ */

export function bindEmptyStateNew(handler) {
  state._handleNew = handler;
}

export { itemColumns };
