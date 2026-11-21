/**
 * 单据校验规则引擎
 *
 * 设计要点：
 *  1. 纯函数、零依赖 —— 可以单独用 Node 跑测试，不碰 DOM
 *  2. 规则返回 { level, field, msg }：level = 'error' | 'warn' | 'info'
 *     - error：违反硬性规则，保存/导出时应拦住（如折扣为负、编号重复）
 *     - warn：可疑但不一定错（如没有目的港、单价为 0）
 *     - info：提示性（如发票日期早于单据日期）
 *  3. 中文提示 + 可定位到字段，方便点一下就跳到出问题的地方
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const has = (v) => String(v ?? '').trim().length > 0;

/**
 * 值是否是「干净的数字」
 * 页面上的数字框靠 type=number 拦非法字符，但导入的 JSON、老数据、
 * 或脚本直接写进来的值可能带中文/字母/多个小数点，那些都会让 Number() 变 NaN
 * 而被 num() 悄悄当成 0 —— 看起来就是「脏值被接受了」。这里显式挑出来。
 * 空值算干净（允许留空）。
 */
function badNumber(v) {
  if (v === '' || v === null || v === undefined) return false;
  if (typeof v === 'number') return !Number.isFinite(v);
  const s = String(v).trim();
  if (!s) return false;
  return !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s);
}

const isDate = (v) => {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !Number.isNaN(d.getTime());
};
const dayDiff = (a, b) => {
  const da = new Date(String(a) + 'T00:00:00');
  const db = new Date(String(b) + 'T00:00:00');
  return Math.round((da - db) / 86400000);
};

/** 金额小数位（按币种给合理上限） */
const DECIMALS = { JPY: 0, KRW: 0, VND: 0, IDR: 0, CLP: 0, USD: 2, EUR: 2, CNY: 2, GBP: 2 };
const maxDecimals = (cur) => (cur in DECIMALS ? DECIMALS[cur] : 2);

/** 常见邮箱 / 电话的宽松校验 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TEL_RE = /^[+()\-\s\d]{6,25}$/;

/**
 * 单张单据的校验
 * @param {object} doc
 * @param {object} [ctx] 上下文：{ otherDocs: [{id,docNo,type}], today: 'YYYY-MM-DD' }
 * @returns {Array<{level:string, field:string, msg:string, code:string}>}
 */
export function validateDoc(doc, ctx = {}) {
  const out = [];
  if (!doc) return out;
  const packing = doc.type === 'pl';
  const money = !packing;
  const cur = doc.currency || 'USD';
  const today = ctx.today || new Date().toISOString().slice(0, 10);

  const err = (field, msg, code) => out.push({ level: 'error', field, msg, code });
  const warn = (field, msg, code) => out.push({ level: 'warn', field, msg, code });
  const info = (field, msg, code) => out.push({ level: 'info', field, msg, code });

  /* ---------------- 1. 单据编号 ---------------- */
  if (!has(doc.docNo)) {
    err('docNo', '单据编号不能为空', 'docNo.empty');
  } else {
    const no = String(doc.docNo).trim();
    if (no.length > 40) err('docNo', '单据编号过长（最多 40 个字符）', 'docNo.long');
    if (/[\s]{2,}/.test(no)) warn('docNo', '单据编号里有连续空格，建议去掉', 'docNo.spaces');
    if (/[\\/:*?"<>|]/.test(no)) err('docNo', '单据编号不能包含 \\ / : * ? " < > | 这些符号（导出文件名会出错）', 'docNo.illegal');
    // 同一类型内编号不能重复
    const dup = (ctx.otherDocs || []).filter((d) =>
      d && d.id !== doc.id && d.type === doc.type && String(d.docNo || '').trim() === no);
    if (dup.length) {
      err('docNo', `编号「${no}」在本类单据里已存在（重复 ${dup.length} 张），编号必须唯一`, 'docNo.duplicate');
    }
  }

  /* ---------------- 2. 日期 ---------------- */
  if (has(doc.date) && !isDate(doc.date)) err('date', '单据日期格式不对，应为 YYYY-MM-DD', 'date.format');
  if (has(doc.validUntil)) {
    if (!isDate(doc.validUntil)) err('validUntil', '有效期格式不对，应为 YYYY-MM-DD', 'validUntil.format');
    else if (isDate(doc.date) && dayDiff(doc.validUntil, doc.date) < 0) {
      err('validUntil', '有效期不能早于单据日期', 'validUntil.before');
    } else if (isDate(doc.validUntil) && dayDiff(doc.validUntil, today) < 0) {
      info('validUntil', '有效期已经过去了，报给客户前确认一下', 'validUntil.past');
    }
  }
  if (isDate(doc.date) && dayDiff(doc.date, today) > 1) {
    info('date', '单据日期是未来日期，确认是否填错', 'date.future');
  }
  // 装箱单：发票日期
  if (packing && has(doc.invoiceDate)) {
    if (!isDate(doc.invoiceDate)) err('invoiceDate', '发票日期格式不对，应为 YYYY-MM-DD', 'invoiceDate.format');
    else if (isDate(doc.date) && dayDiff(doc.invoiceDate, doc.date) > 0) {
      warn('invoiceDate', '发票日期晚于装箱单日期，通常是先开发票再装箱', 'invoiceDate.afterDoc');
    }
  }

  /* ---------------- 3. 双方信息 ---------------- */
  const partyRules = [
    ['seller', '卖方'],
    ['buyer', '买方'],
  ];
  if (!packing && doc.sameAsBuyerConsignee === false) partyRules.push(['consignee', '收货人']);
  if (has(doc.notify?.companyName)) partyRules.push(['notify', '通知方']);

  for (const [key, cn] of partyRules) {
    const p = doc[key] || {};
    if (!has(p.companyName)) {
      (key === 'seller' || key === 'buyer') ? err(`${key}.companyName`, `${cn}名称不能为空`, `${key}.nameEmpty`)
        : warn(`${key}.companyName`, `${cn}名称是空的`, `${key}.nameEmpty`);
    } else if (String(p.companyName).trim().length < 2) {
      warn(`${key}.companyName`, `${cn}名称太短，确认一下`, `${key}.nameShort`);
    }
    if (!has(p.country) && (key === 'seller' || key === 'buyer')) {
      warn(`${key}.country`, `${cn}没填国家，国外单据上建议填上`, `${key}.noCountry`);
    }
    if (has(p.email) && !EMAIL_RE.test(String(p.email).trim())) {
      err(`${key}.email`, `${cn}邮箱格式不对：${p.email}`, `${key}.emailBad`);
    }
    if (has(p.tel) && !TEL_RE.test(String(p.tel).trim())) {
      warn(`${key}.tel`, `${cn}电话号码里有异常字符，确认能否拨通`, `${key}.telOdd`);
    }
    if (has(p.taxId) && String(p.taxId).trim().length < 6) {
      warn(`${key}.taxId`, `${cn}税号看起来太短`, `${key}.taxShort`);
    }
  }

  // 收货人 / 通知方与买方相同但没勾选
  const buyerName = String(doc.buyer?.companyName || '').trim();
  if (doc.sameAsBuyerConsignee !== false) {
    if (has(doc.consignee?.companyName) && String(doc.consignee.companyName).trim() !== buyerName) {
      info('sameAsBuyerConsignee', '收货人名称和买方不同，但勾了「收货人同买方」，单据上只显示买方', 'same.consigneeMismatch');
    }
  } else if (!has(doc.consignee?.companyName)) {
    err('consignee.companyName', '没勾「收货人同买方」时，收货人名称必须填', 'consignee.required');
  }

  /* ---------------- 4. 产品明细 ---------------- */
  const items = Array.isArray(doc.items) ? doc.items : [];
  const realItems = items.filter((it) => has(it.description) || num(it.qty) || num(it.unitPrice));
  if (!realItems.length) {
    err('items', '至少要有一行产品明细', 'items.empty');
  }
  items.forEach((it, i) => {
    const at = `items.${i}`;
    const label = `第 ${i + 1} 行`;
    // 数值字段先查「是不是数字」
    const numKeys = [['qty', '数量'], ['unitPrice', '单价'], ['ctns', '件数'],
      ['nw', '净重'], ['gw', '毛重'], ['meas', '体积']];
    for (const [k, cn] of numKeys) {
      if (badNumber(it[k])) err(`${at}.${k}`, `${label}${cn}只能填数字（当前是「${String(it[k]).slice(0, 12)}」）`, 'item.notNumber');
    }
    const desc = String(it.description || '').trim();
    if (!has(desc) && (num(it.qty) || num(it.unitPrice))) {
      err(`${at}.description`, `${label}填了数量或单价，但没写品名`, 'item.noDesc');
    } else if (desc.length > 300) {
      warn(`${at}.description`, `${label}品名过长（${desc.length} 字），打印可能挤`, 'item.descLong');
    }

    // 数量 / 单价 / 金额
    if (num(it.qty) < 0) err(`${at}.qty`, `${label}数量不能为负数`, 'item.qtyNeg');
    if (money) {
      if (num(it.unitPrice) < 0) err(`${at}.unitPrice`, `${label}单价不能为负数`, 'item.priceNeg');
      const q = num(it.qty), p = num(it.unitPrice);
      if (q > 0 && p === 0 && !has(it.sampleNote)) {
        warn(`${at}.unitPrice`, `${label}单价是 0，确认是赠品还是漏填`, 'item.priceZero');
      }
      const expect = q * p;
      if (Math.abs(num(it.amount) - expect) > 0.01) {
        warn(`${at}.amount`, `${label}金额 ${num(it.amount)} 与 数量×单价 ${Math.round(expect * 100) / 100} 不一致`, 'item.amountDiff');
      }
    }

    // 重量 / 体积
    if (num(it.nw) < 0) err(`${at}.nw`, `${label}净重不能为负数`, 'item.nwNeg');
    if (num(it.gw) < 0) err(`${at}.gw`, `${label}毛重不能为负数`, 'item.gwNeg');
    if (num(it.meas) < 0) err(`${at}.meas`, `${label}体积不能为负数`, 'item.measNeg');
    if (num(it.gw) > 0 && num(it.nw) > 0 && num(it.gw) < num(it.nw)) {
      err(`${at}.gw`, `${label}毛重 ${num(it.gw)} 小于净重 ${num(it.nw)}，不合理（毛重 = 净重 + 皮重）`, 'item.gwLtNw');
    }
    if (num(it.gw) > 0 && num(it.nw) === 0) {
      warn(`${at}.nw`, `${label}填了毛重但没填净重`, 'item.noNw');
    }
    if (packing) {
      if (num(it.ctns) < 0) err(`${at}.ctns`, `${label}件数不能为负数`, 'item.ctnsNeg');
      if (num(it.qty) === 0 && num(it.ctns) === 0) {
        warn(`${at}.qty`, `${label}件数和数量都是 0`, 'item.qtyZero');
      }
    }
    // 整数位检查
    if (num(it.qty) > 0 && !Number.isInteger(num(it.qty)) && !['kg', 'm', 'm2', 'm3', 'ton', 'lb'].includes(it.unit)) {
      info(`${at}.qty`, `${label}数量不是整数，确认单位是否允许小数`, 'item.qtyFrac');
    }
  });

  /* ---------------- 5. 费用与金额 ---------------- */
  if (money) {
    // 先查「数值本身是不是数字」—— 中文、字母、多个小数点都会被挑出来
    const numFields = [
      ['discount', '折扣'], ['taxRate', '税率'], ['exchangeRate', '汇率'],
      ['shippingFee', '运费'], ['insuranceFee', '保险费'], ['toolingFee', '模具费'],
      ['otherFee', '其它费用'],
    ];
    for (const [k, cn] of numFields) {
      if (badNumber(doc[k])) err(k, `${cn}只能填数字（当前是「${String(doc[k]).slice(0, 12)}」）`, `${k}.notNumber`);
    }
    (doc.otherFees || []).forEach((r, i) => {
      if (badNumber(r && r.amount)) {
        err(`otherFees.${i}.amount`,
          `其它费用第 ${i + 1} 项（${String(r.label || '').trim() || '未命名'}）的金额只能填数字`, 'otherFee.notNumber');
      }
    });

    const feeFields = [
      ['discount', '折扣'],
      ['shippingFee', '运费'],
      ['insuranceFee', '保险费'],
      ['toolingFee', '模具费'],
    ];
    for (const [k, cn] of feeFields) {
      if (num(doc[k]) < 0) err(k, `${cn}不能为负数`, `${k}.neg`);
    }
    // 其它费用是多项列表，逐项查负数；数组为空时也查一下旧字段（兼容老数据）
    (doc.otherFees || []).forEach((r, i) => {
      if (num(r && r.amount) < 0) {
        err(`otherFees.${i}.amount`, `其它费用第 ${i + 1} 项（${String(r.label || '').trim() || '未命名'}）不能为负数`, 'otherFee.neg');
      }
    });
    if (!(doc.otherFees || []).length && num(doc.otherFee) < 0) {
      err('otherFee', '其它费用不能为负数', 'otherFee.neg');
    }
    if (num(doc.discount) > num(doc.totals?.subtotal) && num(doc.totals?.subtotal) > 0) {
      warn('discount', `折扣 ${num(doc.discount)} 超过了货物金额 ${Math.round(num(doc.totals.subtotal) * 100) / 100}，算下来会是负数`, 'discount.gtSubtotal');
    }
    if (num(doc.taxRate) < 0) err('taxRate', '税率不能为负数', 'taxRate.neg');
    if (num(doc.taxRate) > 100) err('taxRate', '税率不能超过 100%', 'taxRate.over');
    if (num(doc.exchangeRate) < 0) err('exchangeRate', '汇率不能为负数', 'rate.neg');
    if (num(doc.exchangeRate) === 0 && has(doc.currency) && doc.currency !== 'CNY') {
      warn('exchangeRate', '汇率是 0，换算人民币时会得到 0', 'rate.zero');
    }
    if (num(doc.totals?.grandTotal) < 0) {
      err('totals.grandTotal', '总计是负数，检查折扣与各项费用', 'total.neg');
    }
    if (num(doc.grandTotal) > 0 && num(doc.totals?.grandTotal) > 0
      && Math.abs(num(doc.grandTotal) - num(doc.totals.grandTotal)) > 0.01) {
      err('grandTotal', '总计与明细合计不一致，可能没重新计算', 'total.mismatch');
    }
    if (!has(doc.currency)) err('currency', '币种不能为空', 'currency.empty');
    if (has(doc.currency) && !/^[A-Z]{3}$/.test(String(doc.currency).trim())) {
      err('currency', '币种应是 3 位大写字母代码（如 USD / EUR / CNY）', 'currency.format');
    }
    // 小数位
    const md = maxDecimals(String(doc.currency || '').trim());
    for (const it of items) {
      const amt = String(it.unitPrice ?? '');
      const dot = amt.indexOf('.');
      if (dot >= 0 && amt.length - dot - 1 > md) {
        warn(`items.${items.indexOf(it)}.unitPrice`, `${String(doc.currency)} 单价建议最多 ${md} 位小数`, 'price.decimals');
        break;
      }
    }
    // 付款方式
    if (!has(doc.paymentTerms)) warn('paymentTerms', '没填付款方式，客户不知道什么时候付钱', 'terms.empty');
    if (!has(doc.incoterms) && (doc.type === 'pi' || doc.type === 'ci' || doc.type === 'contract')) {
      warn('incoterms', '没填贸易术语（FOB / CIF 等），报关与结算都需明确', 'incoterms.empty');
    }
  }

  /* ---------------- 6. 装箱单专用 ---------------- */
  if (packing) {
    if (!has(doc.countryOfOrigin)) warn('countryOfOrigin', '没填原产国，报关时会用到', 'origin.empty');
    if (!has(doc.invoiceNo)) warn('invoiceNo', '没填发票号码，通常要和商业发票保持一致', 'invNo.empty');
    if (!has(doc.routeFrom) && !has(doc.loadingPort)) warn('routeFrom', '没填起运地', 'route.from');
    if (!has(doc.routeTo) && !has(doc.destination)) warn('routeTo', '没填目的地', 'route.to');
    const nw = num(doc.totals?.totalNw), gw = num(doc.totals?.totalGw);
    if (gw > 0 && nw > 0 && gw < nw) err('totals.totalGw', '总毛重小于总净重，不合理', 'total.gwLtNw');
    if (num(doc.totals?.totalQty) === 0) warn('totals.totalQty', '总件数是 0，确认是否漏填件数', 'total.ctnsZero');
  }

  /* ---------------- 7. 文本类 ---------------- */
  if (has(doc.remarks) && String(doc.remarks).length > 1200) {
    warn('remarks', '备注过长（超过 1200 字），单据会被撑长', 'remarks.long');
  }
  if (has(doc.terms) && String(doc.terms).length > 4000) {
    warn('terms', '条款过长（超过 4000 字），打印可能跨页', 'terms.long');
  }
  if (has(doc.bank?.swift) && !/^[A-Za-z0-9]{8}$|^[A-Za-z0-9]{11}$/.test(String(doc.bank.swift).trim())) {
    warn('bank.swift', 'SWIFT 代码通常是 8 位或 11 位字母数字', 'swift.format');
  }
  if (has(doc.bank?.iban) && !/^[A-Za-z]{2}\d{2}[A-Za-z0-9]{10,30}$/.test(String(doc.bank.iban).replace(/\s/g, ''))) {
    warn('bank.iban', 'IBAN 格式看起来不对（应为 2 位国家码 + 2 位校验位 + 账号）', 'iban.format');
  }

  return out;
}

/** 汇总：有没有阻断性问题 */
export function hasErrors(list) {
  return (list || []).some((x) => x.level === 'error');
}

/** 按级别统计 */
export function countByLevel(list) {
  const c = { error: 0, warn: 0, info: 0 };
  for (const x of list || []) if (c[x.level] !== undefined) c[x.level]++;
  return c;
}

/** 给 UI 用的一句话摘要 */
export function summaryText(list) {
  const c = countByLevel(list);
  if (!c.error && !c.warn && !c.info) return '检查通过，没有问题';
  const parts = [];
  if (c.error) parts.push(`${c.error} 个必须修改`);
  if (c.warn) parts.push(`${c.warn} 个建议检查`);
  if (c.info) parts.push(`${c.info} 个提示`);
  return parts.join('，');
}

/** 中英文错误码文案（校验面板用） */
export const LEVEL_LABEL = { error: '必须修改', warn: '建议检查', info: '提示' };
