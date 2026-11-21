/* =============================================================
 * 金额 / 数量 / 重量体积 计算引擎
 * 所有合计实时计算，避免手工算错
 * ============================================================= */

import { num, round } from './util.js';
import { docMeta } from './schema.js';

/** 单行金额：数量 × 单价 − 行折扣（折扣可选，报给客户的报价单常用这一列） */
export function lineAmount(item) {
  const gross = num(item.qty) * num(item.unitPrice);
  const off = num(item.discount);
  return round(off ? Math.max(0, gross - off) : gross, 2);
}

/**
 * 重算单据所有行与合计（原地修改并返回）
 * 报价单/PI/合同/CI：金额 = 数量 × 单价
 * 装箱单：总净重 = 箱数 × 每箱净重 等
 */
export function recalcDoc(doc) {
  if (!doc) return doc;
  const meta = docMeta(doc.type);
  const mode = meta.mode;
  // 报关单也要按「箱数 × 每箱重量」汇总毛净重（表头填的是整票的件数 / 毛重 / 净重）
  const weightByCtns = mode === 'packing' || meta.weightByCtns === true;
  const items = Array.isArray(doc.items) ? doc.items : [];
  let totalQty = 0;
  let totalAmount = 0;
  let totalNw = 0;
  let totalGw = 0;
  let totalMeas = 0;
  let totalMeasQty = 0;   // 单件体积 × 件数（金额类单据的合计口径）

  items.forEach((it, i) => {
    it.order = i;
    it.qty = num(it.qty);
    it.unitPrice = num(it.unitPrice);
    it.ctns = num(it.ctns);
    it.nw = num(it.nw);
    it.gw = num(it.gw);
    it.meas = num(it.meas);

    const ctns = it.ctns || 0;
    const mult = ctns || 1;   // 箱数留空时该行按「每箱值 × 1」计

    if (mode === 'packing') {
      // 件数按箱数统计
      it.amount = 0;
      totalQty += ctns || it.qty || 0;
    } else {
      it.amount = lineAmount(it);
      totalQty += it.qty;
      totalAmount += it.amount;
    }

    // 毛净重 / 体积的口径：
    //   · 装箱单、报关单 → 箱数 × 每箱值（报关单表头要的是整票件数/毛净重）
    //   · 其它单据       → 每行的值直接相加（历史上就是这样，不动）
    if (weightByCtns) {
      totalNw += round(mult * it.nw, 3);
      totalGw += round(mult * it.gw, 3);
      totalMeas += round(mult * it.meas, 4);
    } else {
      totalNw += it.nw;
      totalGw += it.gw;
      totalMeas += it.meas;
    }
    // 单件体积 × 件数：发票/合同/报价单的「Meas. 合计」用这个口径
    totalMeasQty += round(it.meas * (it.qty || 0), 4);
  });

  // 装箱单的口径修正：总件数用 ctns 汇总
  if (mode === 'packing') {
    totalQty = items.reduce((s, it) => s + (num(it.ctns) || num(it.qty) || 0), 0);
  }

  doc.totals = {
    totalQty: round(totalQty, 3),
    totalAmount: round(totalAmount, 2),
    totalNw: round(totalNw, 3),
    totalGw: round(totalGw, 3),
    totalMeas: round(totalMeas, 4),
    totalMeasQty: round(totalMeasQty, 4),
  };

  /* ---- 费用与总计（报价单 / PI / CI 常见：小计 → 折扣 → 增值税 → 保险 → 运费 → 总计） ---- */
  const subtotal = doc.totals.totalAmount;
  const discount = num(doc.discount);
  const taxable = round(subtotal - discount, 2);
  const taxRate = num(doc.taxRate);
  const taxAmount = round(taxable * taxRate / 100, 2);
  const insurance = num(doc.insuranceFee);
  const shipping = num(doc.shippingFee);
  const tooling = num(doc.toolingFee);
  const others = otherFeeRows(doc);

  doc.totals.subtotal = subtotal;
  doc.totals.discount = round(discount, 2);
  doc.totals.taxable = taxable;
  doc.totals.taxRate = taxRate;
  doc.totals.taxAmount = taxAmount;
  doc.totals.insuranceFee = round(insurance, 2);
  doc.totals.shippingFee = round(shipping, 2);
  doc.totals.otherFee = round(others.reduce((s, r) => s + r.amount, 0), 2);
  doc.totals.otherFeeList = others.map((r) => ({ label: r.label, amount: r.amount }));
  doc.totals.toolingFee = round(tooling, 2);
  doc.totals.grandTotal = round(taxable + taxAmount + insurance + shipping + doc.totals.otherFee + tooling, 2);
  doc.grandTotal = doc.totals.grandTotal;

  return doc;
}

/**
 * 编辑器用的「原始」其它费用行：保留空行
 * 计算与单据渲染用 otherFeeRows()（会滤掉空行），
 * 但编辑界面必须保留空行 —— 用户刚点「添加一项」时那行就是空的，
 * 滤掉就会让新行立刻消失（踩过这个坑）。
 */
export function rawOtherFeeRows(doc) {
  if (!doc) return [];
  if (Array.isArray(doc.otherFees)) {
    return doc.otherFees.map((r) => ({
      label: String((r && r.label) || ''),
      amount: num(r && r.amount),
    }));
  }
  // 老数据：单个 otherFee → 一行
  if (num(doc.otherFee) || String(doc.otherFeeLabel || '').trim()) {
    return [{ label: String(doc.otherFeeLabel || ''), amount: num(doc.otherFee) }];
  }
  return [];
}

/**
 * 其它费用明细（可多项）—— 参与计算 / 渲染的版本
 *
 * 用户要的是「保险费一行、离岸费一行」这样分开显示，而不是全挤在一个「其它费用」里。
 * 这里统一整理成 [{label, amount}]：
 *   · 以 doc.otherFees 数组为准
 *   · 老数据（单个 otherFee + otherFeeLabel）自动当成一项，向后兼容
 *   · 名和额都为空的空行去掉（避免单据上出现空行 / 0 元行）
 */
export function otherFeeRows(doc) {
  if (!doc) return [];
  const list = [];
  const push = (label, amount) => {
    const a = num(amount);
    const raw = String(label || '').trim();
    if (!a && !raw) return;          // 名和额都空 → 整行不算
    list.push({ label: raw, amount: round(a, 2) });
  };

  // 数组里有内容就以数组为准；否则回退到旧字段（兼容老数据）
  if (Array.isArray(doc.otherFees) && doc.otherFees.length) {
    for (const r of doc.otherFees) push(r && r.label, r && r.amount);
  } else if (num(doc.otherFee) || String(doc.otherFeeLabel || '').trim()) {
    push(doc.otherFeeLabel, doc.otherFee);
  }
  return list;
}

/** 是否启用了额外费用（决定单据上要不要多显示那几行） */
export function hasExtraCharges(doc) {
  if (!doc) return false;
  return [doc.discount, doc.taxRate, doc.insuranceFee, doc.shippingFee, doc.toolingFee]
    .some((v) => num(v) !== 0) || otherFeeRows(doc).length > 0;
}

/* ---------------- 金额大写（英文 / 中文） ---------------- */

const ONES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function threeDigitsEn(n) {
  let s = '';
  if (n >= 100) {
    s += `${ONES[Math.floor(n / 100)]} HUNDRED`;
    n %= 100;
    if (n) s += ' AND ';
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)];
    if (n % 10) s += `-${ONES[n % 10]}`;
  } else if (n > 0) {
    s += ONES[n];
  }
  return s;
}

export function amountInWordsEn(amount) {
  const value = round(Math.abs(num(amount)), 2);
  let intPart = Math.floor(value);
  const cents = Math.round((value - intPart) * 100);
  if (intPart === 0 && cents === 0) return 'ZERO ONLY';

  const groups = [];
  while (intPart > 0) {
    groups.push(intPart % 1000);
    intPart = Math.floor(intPart / 1000);
  }
  const scale = ['', ' THOUSAND', ' MILLION', ' BILLION', ' TRILLION'];
  let words = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    words += (words ? ' ' : '') + threeDigitsEn(groups[i]) + scale[i];
  }
  if (!words) words = 'ZERO';
  let out = words.trim();
  if (cents) out += ` AND ${threeDigitsEn(cents)} CENTS`;
  return `${out} ONLY`;
}

const CN_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const CN_UNITS = ['', '拾', '佰', '仟'];
const CN_SCALE = ['', '万', '亿', '万亿'];

function fourDigitsCn(n) {
  let s = '';
  let zero = false;
  const str = String(n).padStart(4, '0');
  for (let i = 0; i < 4; i++) {
    const d = Number(str[i]);
    const unit = CN_UNITS[3 - i];
    if (d === 0) {
      zero = true;
    } else {
      if (zero && s) s += CN_DIGITS[0];
      zero = false;
      s += CN_DIGITS[d] + unit;
    }
  }
  return s;
}

export function amountInWordsZh(amount) {
  const value = round(Math.abs(num(amount)), 2);
  let intPart = Math.floor(value);
  const cents = Math.round((value - intPart) * 100);
  if (intPart === 0 && cents === 0) return '零元整';
  const groups = [];
  while (intPart > 0) {
    groups.push(intPart % 10000);
    intPart = Math.floor(intPart / 10000);
  }
  let s = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) {
      if (s && !s.endsWith(CN_DIGITS[0])) s += CN_DIGITS[0];
      continue;
    }
    s += fourDigitsCn(g) + CN_SCALE[i];
  }
  s = s.replace(/零+$/, '').replace(/零{2,}/g, '零');
  let out = `${s || '零'}元`;
  if (cents === 0) {
    out += '整';
  } else {
    const jiao = Math.floor(cents / 10);
    const fen = cents % 10;
    if (jiao) out += `${CN_DIGITS[jiao]}角`;
    if (fen) out += `${!jiao ? '零' : ''}${CN_DIGITS[fen]}分`;
  }
  return out;
}

/** 按单据语言输出金额大写 */
export function amountInWords(amount, lang, currency = '') {
  if (lang === 'zh') {
    const prefix = currency === 'CNY' ? '人民币' : '';
    return `${prefix}${amountInWordsZh(amount)}`;
  }
  const cur = currency ? `${currency} ` : '';
  return `${cur}${amountInWordsEn(amount)}`.trim();
}

/* ---------------- 汇率换算 ----------------
 * 约定：rate 表示「1 单位外币 = 多少人民币」（如 1 USD = 7.15 CNY）
 * 人民币成本 → 外币报价：外币 = 人民币成本 ÷ rate ×(1 + 利润率)
 */

/** 人民币成本 -> 外币报价（可加利润率） */
export function costToPrice({ cost, rate, marginPercent = 0, digits = 2 }) {
  const r = num(rate);
  if (!r) return 0;
  const base = num(cost) / r;
  const withMargin = base * (1 + num(marginPercent) / 100);
  return round(withMargin, digits);
}

/** 外币售价 -> 人民币收入 */
export function priceToCost({ price, rate, digits = 2 }) {
  return round(num(price) * num(rate), digits);
}
