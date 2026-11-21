/* =============================================================
 * Sales Invoice（销售发票 Duplicate）—— 单据版式
 * 严格照 novatech「Sales Invoice Duplicate」模板逐块复刻：
 *   红块 LOGO / 大标题 + 副标题 / Invoice to · Deliver to 两个框 /
 *   两行订单信息 / 条款提示行 / 明细表（QTY·Product Code·Description·
 *   Unit Cost·Goods Value·VC）/ 左下 Rate·Amount·VAT /
 *   右下 Amount·VAT·TOTAL / Sale By BACS / 三条提示 / 页脚三行
 * ============================================================= */

import { esc, num } from '../core/util.js';
import { defaultSi, emptySiItem } from '../core/si-schema.js';
import { SI_LOGO_DATAURL } from './si-logo-data.js';

const fmt2 = (n) => {
  const v = num(n) || 0;
  return v.toFixed(2);   // 模板里就是 1543.76，不加千分位
};

// 条款提示语固定（用户只改网址，正文不许改）
const TERMS_TEXT = 'ALL SALES ARE SUBJECT TO OUR STANDARD TERMS & CONDITIONS, FOUND HERE:';

const lines = (s) => esc(String(s == null ? '' : s)).replace(/\r?\n/g, '<br>');

/** 汇总：Goods Value = QTY × Unit Cost；Amount = Σ Goods Value；VAT = Amount × 税率 */
export function siTotals(doc) {
  const si = doc.si || defaultSi();
  const rate = num(si.vatRate) || 0;
  const amount = (doc.items || []).reduce((s, it) => s + num(it.qty) * num(it.unitPrice), 0);
  const vat = amount * rate / 100;
  return { rate, amount, vat, total: amount + vat };
}

/** 内置 novatech 标志（用户没上传时用） */
const LOGO_FALLBACK = `<img src="${SI_LOGO_DATAURL}" alt="novatech" />`;

export function renderSalesInvoice(doc) {
  const si = Object.assign(defaultSi(), doc.si || {});
  const items = doc.items || [];
  const { rate, amount, vat, total } = siTotals(doc);
  const cur = si.currencySign || '£';
  // 拖出页面外的历史脏数据（旧 bug 存过 ±5000px）直接归位
  const safeOff = (v) => { const x = num(v) || 0; return Math.abs(x) > 260 ? 0 : x; };
  const ldx = safeOff(si.logoDX);
  const ldy = safeOff(si.logoDY);
  const foot = Object.assign({}, defaultSi().foot, si.foot || {});

  const bodyRows = items.length
    ? items.map((it) => {
      const qtyN = num(it.qty) || 0;
      const unit = num(it.unitPrice) || 0;
      const goods = qtyN * unit;
      return `<tr>
        <td class="c">${qtyN ? esc(String(qtyN)) : ''}</td>
        <td class="c">${esc(it.productCode || '')}</td>
        <td>${esc(it.description || '')}</td>
        <td class="c">${unit ? fmt2(unit) : ''}</td>
        <td class="c">${goods ? fmt2(goods) : ''}</td>
        <td class="c">${esc(it.vc || '')}</td>
      </tr>`;
    }).join('')
    : `<tr><td class="c"></td><td class="c"></td><td></td><td class="c"></td><td class="c"></td><td class="c"></td></tr>`;


  const notes = String(si.footNotes || '').split(/\r?\n/).filter((x) => x.trim())
    .map((x) => `<div class="si-note">${esc(x)}</div>`).join('');

  return `<div class="doc-root si">
  <div class="si-logo" style="transform: translate(${ldx}px, ${ldy}px)">${si.logo ? `<img src="${si.logo}" alt="LOGO" />` : LOGO_FALLBACK}</div>

  <div class="si-title">${esc(si.invoiceTitle || 'Sales Invoice Duplicate')}</div>
  <div class="si-sub">${esc(si.subtitle || '')}</div>

  <div class="si-parties">
    <div class="si-party">
      <div class="si-lbl">Invoice to</div>
      <div class="si-addr">${lines(si.invoiceTo)}</div>
    </div>
    <div class="si-party">
      <div class="si-lbl">Deliver to</div>
      <div class="si-addr">${lines(si.deliverTo)}</div>
    </div>
  </div>

  <div class="si-info">
    <div class="si-info-row r1">
      <div class="cell w1"><div class="k">Order Date</div><div class="v">${esc(si.orderDate || '')}</div></div>
      <div class="cell w2"><div class="k">Time Placed</div><div class="v">${esc(si.timePlaced || '')}</div></div>
      <div class="cell w3"><div class="k">Sales Contact</div><div class="v">${esc(si.salesContact || '')}</div></div>
      <div class="cell w4"><div class="k">Sales Contact Tel</div><div class="v">${esc(si.salesContactTel || '')}</div></div>
    </div>
    <div class="si-info-row r2">
      <div class="cell w1"><div class="k">Tax Date</div><div class="v">${esc(si.taxDate || '')}</div></div>
      <div class="cell w2"><div class="k">Your Ref</div><div class="v">${esc(si.yourRef || '')}</div></div>
      <div class="cell w3"><div class="k">Our Order No</div><div class="v">${esc(si.ourOrderNo || '')}</div></div>
      <div class="cell w4"><div class="k">Invoice No</div><div class="v">${esc(doc.docNo || '')}</div></div>
      <div class="cell w5"><div class="k">Customer No</div><div class="v">${esc(si.customerNo || '')}</div></div>
    </div>
  </div>

  <div class="si-terms">${TERMS_TEXT}${si.termsUrl ? ` <span class="u">${esc(si.termsUrl)}</span>` : ''}</div>

  <table class="si-items">
    <thead>
      <tr>
        <th class="c" style="width:8%">QTY</th>
        <th class="c" style="width:15%">Product Code</th>
        <th style="width:44%">Description</th>
        <th class="c" style="width:12%">Unit Cost</th>
        <th class="c" style="width:13%">Goods Value</th>
        <th class="c" style="width:8%">VC</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>

  <div class="si-sum-wrap">
    <div class="si-vatbox">
      <div class="si-vat-head"><span class="w1">Rate</span><span class="w2">Amount</span><span class="w3">VAT</span></div>
      <div class="si-vat-val"><span class="w1">${esc(String(rate || 0))}%</span><span class="w2">${fmt2(amount)}</span><span class="w3">${fmt2(vat)}</span></div>
    </div>
    <div class="si-total">
      <div class="si-total-row"><span class="k">Amount</span><span class="cur">${esc(cur)}</span><span class="box">${fmt2(amount)}</span></div>
      <div class="si-total-row"><span class="k">VAT</span><span class="cur">${esc(cur)}</span><span class="box">${fmt2(vat)}</span></div>
      <div class="si-total-row last"><span class="k">TOTAL</span><span class="cur">${esc(cur)}</span><span class="box">${fmt2(total)}</span></div>
    </div>
  </div>

  <div class="si-bacs">${esc(si.bacsText || '')}</div>
  <div class="si-notes">${notes}</div>

  <div class="si-rule"></div>
  <div class="si-footer">
    <div>Head Office: ${esc(foot.officeAddr || '')}${foot.officeTel ? `  Tel: ${esc(foot.officeTel)}` : ''}</div>
    <div>VAT No: ${esc(foot.vatNo || '')}${foot.regNo ? `  REG No: ${esc(foot.regNo)}` : ''}</div>
    <div>Account Name: ${esc(foot.accName || '')}${foot.accNo ? `  Account Number: ${esc(foot.accNo)}` : ''}${foot.sortCode ? `  Sort Code: ${esc(foot.sortCode)}` : ''}</div>
  </div>
</div>`;
}

export const SI_CSS = `
.doc-root.si { position: relative; font-family: "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; padding: 0 0 6px; }

/* 右上红块 LOGO */
.si-logo {
  position: absolute; top: -14px; right: -14px;
  width: 122px; background: transparent;
  display: flex; align-items: flex-start; justify-content: center;
}
.si-logo img { width: 100%; height: auto; display: block; border-bottom-left-radius: 14px; }
.si-logo-fallback { text-align: center; color: #fff; }
.si-logo-mark { font-size: 34px; font-weight: 300; letter-spacing: -1px; }
.si-logo-mark span { font-size: 22px; vertical-align: super; }
.si-logo-name { font-size: 13px; letter-spacing: .5px; margin-top: 2px; }

/* 标题 */
.si-title { font-size: 30px; font-weight: 300; letter-spacing: .2px; padding-top: 56px; }
.si-sub { font-size: 12.5px; font-weight: 700; margin-top: 8px; }

/* Invoice to / Deliver to */
.si-parties { display: flex; gap: 14px; margin-top: 18px; }
.si-party { flex: 1 1 0; }
.si-lbl { font-size: 10.5px; font-weight: 700; margin-bottom: 4px; }
.si-addr {
  border: 1px solid #b8bec6; min-height: 106px; padding: 10px 12px;
  font-size: 12.5px; line-height: 1.55; letter-spacing: .1px;
}

/* 订单信息两行 */
.si-info { border: 1px solid #b8bec6; margin-top: 14px; }
.si-info-row { display: flex; }
.si-info-row + .si-info-row { border-top: 1px solid #b8bec6; }
.si-info-row .cell { padding: 7px 10px; }
.si-info-row .cell + .cell { border-left: 1px solid #b8bec6; }
.si-info-row .k { font-size: 10px; font-weight: 700; margin-bottom: 3px; }
.si-info-row .v { font-size: 11.5px; min-height: 13px; }
.si-info-row.r1 .w1 { flex: 0 0 17%; }
.si-info-row.r1 .w2 { flex: 0 0 16%; }
.si-info-row.r1 .w3 { flex: 0 0 17%; }
.si-info-row.r1 .w4 { flex: 1 1 auto; padding-left: 40px; }
.si-info-row.r2 .w1 { flex: 0 0 17%; }
.si-info-row.r2 .w2 { flex: 0 0 17%; }
.si-info-row.r2 .w3 { flex: 0 0 17%; padding-left: 40px; }
.si-info-row.r2 .w4 { flex: 0 0 20%; }
.si-info-row.r2 .w5 { flex: 1 1 auto; }

/* 条款提示 */
.si-terms { margin-top: 12px; font-size: 10.5px; font-weight: 700; white-space: nowrap; letter-spacing: -.05px; }
.si-terms .u { text-decoration: underline; font-weight: 700; }

/* 明细表 */
.si-items { width: 100%; border-collapse: collapse; margin-top: 12px; table-layout: fixed; }
.si-items th {
  font-size: 10.5px; font-weight: 700; text-align: left; padding: 9px 8px;
  border-top: 1px solid #b8bec6; border-bottom: 1px solid #b8bec6; border-left: 1px solid #b8bec6;
}
.si-items th:last-child { border-right: 1px solid #b8bec6; }
.si-items th.c, .si-items td.c { text-align: center; }
.si-items td {
  font-size: 11px; padding: 9px 8px; vertical-align: top;
  border-left: 1px solid #b8bec6; line-height: 1.45;
}
.si-items td:last-child { border-right: 1px solid #b8bec6; }
.si-items tbody tr:last-child td { border-bottom: 1px solid #b8bec6; }
.si-items tbody tr { height: 26px; }
.si-items tbody tr + tr td { border-top: 1px solid #e2e6ec; }

/* 左下 VAT 小表 + 右下合计 */
.si-sum-wrap { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 14px; }
.si-vatbox { width: 52%; border: 1px solid #b8bec6; padding: 10px 12px; }
.si-vat-head, .si-vat-val { display: flex; font-size: 11px; }
.si-vat-head { font-weight: 700; margin-bottom: 8px; }
.si-vat-head .w1, .si-vat-val .w1 { flex: 0 0 26%; }
.si-vat-head .w2, .si-vat-val .w2 { flex: 0 0 40%; }
.si-vat-head .w3, .si-vat-val .w3 { flex: 1 1 auto; }
.si-vat-val { font-size: 11.5px; }

.si-total { width: 40%; }
.si-total-row { display: flex; align-items: center; justify-content: flex-end; gap: 10px; font-size: 12.5px; margin-bottom: 6px; }
.si-total-row .k { font-weight: 700; }
.si-total-row .cur { font-weight: 400; }
.si-total-row .box {
  min-width: 96px; text-align: center; border: 1px solid #b8bec6; padding: 5px 8px;
  font-size: 12px;
}
.si-total-row.last .k { font-weight: 700; }

/* Sale By BACS */
.si-bacs { text-align: center; font-size: 17px; font-weight: 700; margin-top: 18px; }

/* 三条提示 */
.si-notes { margin-top: 10px; text-align: center; }
.si-note { font-size: 11px; font-weight: 700; line-height: 1.55; }

/* 页脚 */
.si-rule { border-top: 1px solid #b8bec6; margin-top: 14px; }
.si-footer { margin-top: 8px; text-align: center; font-size: 9.5px; line-height: 1.7; color: #333; }
`;
