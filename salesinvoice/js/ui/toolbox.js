/* =============================================================
 * 工具箱：唛头生成器 + 付款条款计算器
 * 独立于单据数据模型，打开即用，可复制 / 打印 / 应用结果。
 * ============================================================= */

import { esc } from '../core/util.js';
import { openModal } from './modal.js';
import * as toast from './toast.js';

/* ---------------- 唛头生成器 ---------------- */

function buildMark({ consignee, refNo, dest, ctnFrom, ctnTo, gw, nw, meas, madeIn, extra }) {
  const lines = [];
  if (consignee.trim()) lines.push(consignee.trim().toUpperCase());
  if (refNo.trim()) lines.push(`REF: ${refNo.trim()}`);
  if (dest.trim()) lines.push(dest.trim().toUpperCase());
  const ctn = ctnFrom || ctnTo ? `${ctnFrom || 1}-${ctnTo || ctnFrom || ''}`.replace(/-$/g, '') : '';
  if (ctn) lines.push(`CTN: ${ctn}`);
  if (gw) lines.push(`G.W.: ${gw} KG`);
  if (nw) lines.push(`N.W.: ${nw} KG`);
  if (meas) lines.push(`MEAS.: ${meas}`);
  if (madeIn.trim()) lines.push(madeIn.trim().toUpperCase());
  if (extra.trim()) lines.push(extra.trim());
  return lines.join('\n');
}

function openShippingMarkTool() {
  const body = document.createElement('div');
  body.className = 'tool-panel';
  body.innerHTML = `
    <div class="tool-ttl">📦 唛头生成器（Shipping Mark）</div>
    <div class="tool-sub">填收货人缩写、参考号、目的港、箱号范围与重量，一键生成标准唛头，直接复制到单据或打印贴箱。</div>
    <div class="grid grid-2">
      <div class="field"><label>收货人缩写 / 抬头</label><input type="text" id="mkConsignee" placeholder="NORTH STAR" /></div>
      <div class="field"><label>参考号（PO / 发票号）</label><input type="text" id="mkRef" placeholder="PO-7842" /></div>
      <div class="field"><label>目的港 / 目的地</label><input type="text" id="mkDest" placeholder="ROTTERDAM, NETHERLANDS" /></div>
      <div class="field"><label>箱号范围</label><div class="inline-row"><input type="text" id="mkCtnFrom" placeholder="1" style="min-width:64px" /><span>—</span><input type="text" id="mkCtnTo" placeholder="12" style="min-width:64px" /></div></div>
      <div class="field"><label>毛重 G.W. (kg)</label><input type="number" id="mkGw" placeholder="154" /></div>
      <div class="field"><label>净重 N.W. (kg)</label><input type="number" id="mkNw" placeholder="138" /></div>
      <div class="field"><label>体积 MEAS.</label><input type="text" id="mkMeas" placeholder="52 x 38 x 31 cm" /></div>
      <div class="field"><label>原产国</label><input type="text" id="mkMadeIn" value="MADE IN CHINA" /></div>
      <div class="field span-2"><label>附加行（可选，如 KEEP DRY）</label><input type="text" id="mkExtra" placeholder="KEEP DRY" /></div>
    </div>
    <div class="mark-preview"><div class="mark-box" id="mkPreview">填写左侧字段后自动生成</div></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap">
      <button class="btn" id="mkCopy">📋 复制唛头</button>
      <button class="btn" id="mkApply">📄 应用到当前单据</button>
    </div>
  `;

  const ref = openModal({ title: '🧰 工具箱 · 唛头生成器', body, width: '720px' });

  const getVal = (id) => body.querySelector(`#${id}`).value;
  const render = () => {
    const txt = buildMark({
      consignee: getVal('mkConsignee'), refNo: getVal('mkRef'), dest: getVal('mkDest'),
      ctnFrom: getVal('mkCtnFrom'), ctnTo: getVal('mkCtnTo'),
      gw: getVal('mkGw'), nw: getVal('mkNw'), meas: getVal('mkMeas'),
      madeIn: getVal('mkMadeIn'), extra: getVal('mkExtra'),
    });
    body.querySelector('#mkPreview').textContent = txt;
  };
  body.querySelectorAll('input').forEach((i) => i.addEventListener('input', render));
  render();

  body.querySelector('#mkCopy').onclick = () => {
    const txt = body.querySelector('#mkPreview').textContent;
    if (!txt || txt.includes('填写左侧字段')) { toast.warn('请先填写唛头信息'); return; }
    navigator.clipboard?.writeText(txt).then(() => toast.ok('唛头已复制到剪贴板')).catch(() => toast.warn('复制失败，请手动选择复制'));
  };
  body.querySelector('#mkApply').onclick = () => {
    const txt = body.querySelector('#mkPreview').textContent;
    if (!txt || txt.includes('填写左侧字段')) { toast.warn('请先填写唛头信息'); return; }
    const evt = new CustomEvent('tradedocs:apply-marks', { detail: { marks: txt } });
    document.dispatchEvent(evt);
    ref.close();
  };
}

/* ---------------- 付款条款计算器 ---------------- */

function calcPayment({ amount, currency, terms }) {
  // 解析形如「30% deposit, 70% before shipment」的分期，自动拆出每笔金额
  const pct = String(terms || '').match(/\d+(?:\.\d+)?\s*%/g);
  if (!pct || !pct.length) return null;
  const total = Number(amount) || 0;
  const rows = pct.map((p) => ({ pct: Number(p.replace('%', '')), label: p.replace('%', '') + '%' }));
  let sum = 0;
  const parts = rows.map((r, i) => {
    const isLast = i === rows.length - 1;
    const v = isLast ? Math.max(0, total - sum) : Math.round(total * r.pct / 100 * 100) / 100;
    sum += v;
    return { pct: r.pct, label: r.label, value: v };
  });
  return { total, parts, sum };
}

function fmtMoney(n, cur) {
  const digits = /(JPY|KRW|VND|IDR)/.test(cur) ? 0 : 2;
  return `${cur || 'USD'} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function openPaymentCalcTool() {
  const body = document.createElement('div');
  body.className = 'tool-panel';
  body.innerHTML = `
    <div class="tool-ttl">💰 付款条款计算器（Payment Terms Calculator）</div>
    <div class="tool-sub">客户说「30% 预付，70% 见提单副本付款」，填合同金额和付款比例，自动算出每笔该付多少。</div>
    <div class="grid grid-2">
      <div class="field"><label>合同金额</label><input type="number" id="payAmount" placeholder="12300" /></div>
      <div class="field"><label>币种</label><select id="payCur">
        <option value="USD">USD 美元</option><option value="EUR">EUR 欧元</option>
        <option value="GBP">GBP 英镑</option><option value="CNY">CNY 人民币</option>
        <option value="JPY">JPY 日元</option><option value="HKD">HKD 港币</option>
      </select></div>
      <div class="field span-2"><label>付款条款（含百分比的描述）</label>
        <input type="text" id="payTerms" placeholder="30% deposit, 70% before shipment" />
        <div class="hint" style="font-size:11.5px;color:var(--c-text-mute);margin-top:3px">示例：30% deposit / 50% before shipment / 20% against B/L copy</div>
      </div>
    </div>
    <div class="pay-result" id="payResult" style="display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap">
      <button class="btn" id="payCalc">🧮 计算</button>
      <button class="btn" id="payCopy" style="display:none">📋 复制结果</button>
      <button class="btn" id="payInsert" style="display:none">📄 应用到付款方式</button>
    </div>
  `;

  const ref = openModal({ title: '🧰 工具箱 · 付款条款计算器', body, width: '640px' });
  const out = () => body.querySelector('#payResult');
  const cur = () => body.querySelector('#payCur').value;

  body.querySelector('#payCalc').onclick = () => {
    const amount = body.querySelector('#payAmount').value;
    const terms = body.querySelector('#payTerms').value;
    const res = calcPayment({ amount, currency: cur(), terms });
    if (!res) { toast.warn('请填写金额，并在付款条款里写清百分比（如 30% deposit）'); return; }
    let html = `<div class="pr-row gt"><span class="k">合同总金额</span><span class="v">${fmtMoney(res.total, cur())}</span></div>`;
    res.parts.forEach((p) => {
      html += `<div class="pr-row"><span class="k">${esc(p.label)}（${p.pct}%）</span><span class="v">${fmtMoney(p.value, cur())}</span></div>`;
    });
    out().innerHTML = html;
    out().style.display = 'block';
    body.querySelector('#payCopy').style.display = '';
    body.querySelector('#payInsert').style.display = '';
  };

  body.querySelector('#payCopy').onclick = () => {
    const total = body.querySelector('#payAmount').value;
    const terms = body.querySelector('#payTerms').value;
    const res = calcPayment({ amount: total, currency: cur(), terms });
    if (!res) return;
    const lines = res.parts.map((p) => `${p.label} (${p.pct}%) : ${fmtMoney(p.value, cur())}`);
    navigator.clipboard?.writeText(lines.join('\n')).then(() => toast.ok('已复制')).catch(() => toast.warn('复制失败'));
  };
  body.querySelector('#payInsert').onclick = () => {
    const total = body.querySelector('#payAmount').value;
    const terms = body.querySelector('#payTerms').value;
    const res = calcPayment({ amount: total, currency: cur(), terms });
    if (!res) return;
    const text = terms.trim() + ` (total ${fmtMoney(res.total, cur())})`;
    const evt = new CustomEvent('tradedocs:apply-payment', { detail: { paymentTerms: text } });
    document.dispatchEvent(evt);
    ref.close();
  };
}

/* ---------------- 工具箱入口 ---------------- */

export function openToolbox() {
  const body = document.createElement('div');
  body.className = 'tool-panel';
  body.innerHTML = `
    <div class="tool-ttl">🧰 工具箱</div>
    <div class="tool-sub">常用外贸小工具，独立于单据，打开即用。</div>
    <div class="tool-grid">
      <button class="tool-card" data-tool="mark">
        <span class="tc-ico">📦</span>
        <span class="tc-name">唛头生成器</span>
        <span class="tc-desc">生成标准 Shipping Mark：收货人缩写、目的港、箱号范围、毛净重、原产国，一键复制 / 应用到单据。</span>
      </button>
      <button class="tool-card" data-tool="pay">
        <span class="tc-ico">💰</span>
        <span class="tc-name">付款条款计算器</span>
        <span class="tc-desc">按付款比例自动拆出每笔金额（30% deposit + 70% before shipment…），一键套用到付款方式。</span>
      </button>
    </div>
  `;
  const ref = openModal({ title: '🧰 工具箱', body, width: '680px' });
  body.querySelector('[data-tool="mark"]').onclick = () => { ref.close(); setTimeout(openShippingMarkTool, 60); };
  body.querySelector('[data-tool="pay"]').onclick = () => { ref.close(); setTimeout(openPaymentCalcTool, 60); };
}
