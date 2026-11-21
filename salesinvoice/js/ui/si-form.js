/* =============================================================
 * Sales Invoice —— 专用输入页面（精简版）
 * 只留需要填的内容：收件人 / 订单信息 / 商品明细
 * 标题、LOGO、条款提示、BACS、页脚 都用模板固定文案，不再让用户改
 * ============================================================= */

import { esc, num } from '../core/util.js';
import { state, scheduleAutosave } from '../core/store.js';
import { defaultSi, emptySiItem } from '../core/si-schema.js';
import { SI_LOGO_DATAURL } from '../doc/si-logo-data.js';
import * as toast from './toast.js';

const fmt2 = (n) => (num(n) || 0).toFixed(2);

function field(si, key, label, opts = {}) {
  const v = si[key] == null ? '' : si[key];
  if (opts.type === 'textarea') {
    return `<div class="field si-f" style="grid-column: span ${opts.span || 1}">
      <label>${esc(label)}</label>
      <textarea data-si="${key}" rows="${opts.rows || 4}" placeholder="${esc(opts.placeholder || '')}">${esc(v)}</textarea>
    </div>`;
  }
  return `<div class="field si-f" style="grid-column: span ${opts.span || 1}">
    <label>${esc(label)}</label>
    <input type="text" data-si="${key}" value="${esc(v)}" placeholder="${esc(opts.placeholder || '')}" />
  </div>`;
}

function itemRow(it, i) {
  const qty = num(it.qty) || 0;
  const unit = num(it.unitPrice) || 0;
  const goods = qty * unit;
  return `<tr data-row="${i}">
    <td class="c"><input type="text" inputmode="decimal" data-it="${i}" data-itk="qty" value="${qty || ''}" /></td>
    <td><input type="text" data-it="${i}" data-itk="productCode" value="${esc(it.productCode || '')}" /></td>
    <td><input type="text" data-it="${i}" data-itk="description" value="${esc(it.description || '')}" /></td>
    <td class="c"><input type="text" inputmode="decimal" data-it="${i}" data-itk="unitPrice" value="${unit || ''}" /></td>
    <td class="c"><span class="si-goods">${goods ? fmt2(goods) : ''}</span></td>
    <td class="c"><input type="text" data-it="${i}" data-itk="vc" value="${esc(it.vc || '')}" /></td>
    <td class="c"><button type="button" class="si-del" data-del="${i}" title="删除这一行">✕</button></td>
  </tr>`;
}

export function renderSiForm(host, doc, onRefreshPreview) {
  if (!doc.si) doc.si = defaultSi();
  const si = Object.assign(defaultSi(), doc.si);
  const foot = Object.assign({}, defaultSi().foot, si.foot || {});
  if (!Array.isArray(doc.items) || !doc.items.length) doc.items = [emptySiItem(0)];

  const rows = doc.items.map(itemRow).join('');
  const amount = doc.items.reduce((s, it) => s + (num(it.qty) || 0) * (num(it.unitPrice) || 0), 0);
  const vat = amount * (num(si.vatRate) || 0) / 100;

  host.innerHTML = `
  <div class="card si-card">
    <div class="card-head">📮 收件人 / 送货地址</div>
    <div class="grid si-grid-2">
      ${field(si, 'invoiceTo', 'Invoice to', { type: 'textarea', rows: 6, span: 1 })}
      ${field(si, 'deliverTo', 'Deliver to', { type: 'textarea', rows: 6, span: 1 })}
    </div>
  </div>

  <div class="card si-card">
    <div class="card-head">🗂 订单信息</div>
    <div class="grid si-grid-3">
      ${field(si, 'orderDate', 'Order Date', { placeholder: '17-09-25' })}
      ${field(si, 'timePlaced', 'Time Placed', { placeholder: '10:41' })}
      ${field(si, 'salesContact', 'Sales Contact', { placeholder: 'DRM' })}
      ${field(si, 'salesContactTel', 'Sales Contact Tel', { placeholder: '02392 322 541' })}
      ${field(si, 'taxDate', 'Tax Date', { placeholder: '18-09-25' })}
      ${field(si, 'yourRef', 'Your Ref', { placeholder: 'Le Zhang' })}
      ${field(si, 'ourOrderNo', 'Our Order No', { placeholder: '6437689' })}
      ${field(si, 'customerNo', 'Customer No', { placeholder: 'THE016' })}
      <div class="field si-f"><label>Invoice No</label><input type="text" id="siDocNo" value="${esc(doc.docNo || '')}" /></div>
    </div>
  </div>

  <div class="card si-card">
    <div class="card-head">🏷 LOGO 与条款网址</div>
    <div class="grid si-grid-2">
      <div class="field si-f">
        <label>右上角 LOGO（默认用内置的 novatech 标志）</label>
        <div class="si-logo-row">
          <img id="siLogoPrev" src="${si.logo ? esc(si.logo) : SI_LOGO_DATAURL}" alt="LOGO" class="si-logo-thumb" />
          <div class="si-logo-ops">
            <input type="file" id="siLogoFile" accept="image/*" />
            <button type="button" class="btn btn-sm" id="siLogoClear">恢复默认</button>
            <button type="button" class="btn btn-sm" id="siLogoReset" title="把 LOGO 拖回右上角">⟲ 复位位置</button>
          </div>
        </div>
      </div>
      <div class="field si-f">
        <label>条款网址（前半句固定，只改网址）</label>
        <input type="text" data-si="termsUrl" value="${esc(si.termsUrl || '')}" placeholder="www.novatech.co.uk/termsandconditions.html" />
        <div class="hint" style="margin-top:4px;font-size:11.5px">单据上显示：ALL SALES ARE SUBJECT TO OUR STANDARD TERMS &amp; CONDITIONS, FOUND HERE: 网址（下划线）</div>
      </div>
    </div>
  </div>

  <div class="card si-card">
    <div class="card-head">🧾 页脚（冒号后面的内容可改）</div>
    <div class="grid si-grid-3">
      <div class="field si-f" style="grid-column: span 2"><label>Head Office 地址</label><input type="text" data-foot="officeAddr" value="${esc(foot.officeAddr || '')}" /></div>
      <div class="field si-f"><label>Tel</label><input type="text" data-foot="officeTel" value="${esc(foot.officeTel || '')}" /></div>
      <div class="field si-f"><label>VAT No</label><input type="text" data-foot="vatNo" value="${esc(foot.vatNo || '')}" /></div>
      <div class="field si-f"><label>REG No</label><input type="text" data-foot="regNo" value="${esc(foot.regNo || '')}" /></div>
      <div class="field si-f"><label>Sort Code</label><input type="text" data-foot="sortCode" value="${esc(foot.sortCode || '')}" /></div>
      <div class="field si-f"><label>Account Name</label><input type="text" data-foot="accName" value="${esc(foot.accName || '')}" /></div>
      <div class="field si-f"><label>Account Number</label><input type="text" data-foot="accNo" value="${esc(foot.accNo || '')}" /></div>
    </div>
  </div>
  <div class="card si-card">
    <div class="card-head">📦 商品明细 <span class="hint">${doc.items.length} 行</span>
      <button type="button" class="btn btn-sm" id="siAddRow" style="margin-left:auto">＋ 增加产品行</button>
    </div>
    <div class="si-table-wrap">
      <table class="si-table">
        <thead><tr>
          <th class="c" style="width:56px">QTY</th>
          <th style="width:132px">Product Code</th>
          <th>Description</th>
          <th class="c" style="width:92px">Unit Cost</th>
          <th class="c" style="width:96px">Goods Value</th>
          <th class="c" style="width:52px">VC</th>
          <th class="c" style="width:34px"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="si-rate-row">
      <label>VAT 税率 %</label>
      <input type="text" inputmode="decimal" data-si="vatRate" value="${esc(String(si.vatRate == null ? '' : si.vatRate))}" />
      <span class="hint">改这里，左下 Rate 与 VAT 金额会跟着变</span>
    </div>
    <div class="si-totals">
      <span>Amount <b>${fmt2(amount)}</b></span>
      <span>VAT ${esc(String(si.vatRate || 0))}% <b>${fmt2(vat)}</b></span>
      <span>Total <b>${fmt2(amount + vat)}</b></span>
    </div>
  </div>`;

  /* ---------------- 绑定 ---------------- */
  const commit = () => {
    scheduleAutosave();
    if (typeof onRefreshPreview === 'function') onRefreshPreview();
  };

  const recompute = () => {
    const tbody = host.querySelector('.si-table tbody');
    if (tbody) {
      [...tbody.querySelectorAll('tr')].forEach((tr, i) => {
        const it = doc.items[i] || {};
        const goods = (num(it.qty) || 0) * (num(it.unitPrice) || 0);
        const cell = tr.querySelector('.si-goods');
        if (cell) cell.textContent = goods ? fmt2(goods) : '';
      });
    }
    const amount2 = doc.items.reduce((s2, it) => s2 + (num(it.qty) || 0) * (num(it.unitPrice) || 0), 0);
    const vat2 = amount2 * (num(doc.si.vatRate) || 0) / 100;
    const box = host.querySelector('.si-totals');
    if (box) {
      box.innerHTML = `<span>Amount <b>${fmt2(amount2)}</b></span>`
        + `<span>VAT ${esc(String(doc.si.vatRate || 0))}% <b>${fmt2(vat2)}</b></span>`
        + `<span>Total <b>${fmt2(amount2 + vat2)}</b></span>`;
    }
  };

  host.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('[data-si]')) {
      const key = el.getAttribute('data-si');
      doc.si[key] = key === 'vatRate' ? (num(el.value) || 0) : el.value;
      recompute();
      commit();
      return;
    }
    if (el.matches('[data-foot]')) {
      const k = el.getAttribute('data-foot');
      doc.si.foot = Object.assign({}, defaultSi().foot, doc.si.foot || {}, { [k]: el.value });
      commit();
      return;
    }
    if (el.matches('[data-it]')) {
      const i = Number(el.getAttribute('data-it'));
      const k = el.getAttribute('data-itk');
      const it = doc.items[i];
      if (!it) return;
      it[k] = (k === 'qty' || k === 'unitPrice') ? (num(el.value) || 0) : el.value;
      if (k === 'qty' || k === 'unitPrice') it.amount = (num(it.qty) || 0) * (num(it.unitPrice) || 0);
      recompute();
      commit();
    }
  });

  host.addEventListener('click', (e) => {
    const t = e.target;
    if (t.id === 'siAddRow') {
      doc.items.push(emptySiItem(doc.items.length));
      renderSiForm(host, doc, onRefreshPreview);
      commit();
      return;
    }
    if (t.classList.contains('si-del')) {
      const i = Number(t.getAttribute('data-del'));
      doc.items.splice(i, 1);
      if (!doc.items.length) doc.items.push(emptySiItem(0));
      renderSiForm(host, doc, onRefreshPreview);
      commit();
    }
  });

  const fileEl = host.querySelector('#siLogoFile');
  if (fileEl) {
    fileEl.addEventListener('change', () => {
      const file = fileEl.files && fileEl.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        doc.si.logo = String(reader.result || '');
        const prev = host.querySelector('#siLogoPrev');
        if (prev) prev.src = doc.si.logo;
        commit();
      };
      reader.readAsDataURL(file);
    });
  }
  const clearEl = host.querySelector('#siLogoClear');
  if (clearEl) {
    clearEl.addEventListener('click', () => {
      doc.si.logo = '';
      const prev = host.querySelector('#siLogoPrev');
      if (prev) prev.src = SI_LOGO_DATAURL;
      commit();
    });
  }

  const resetEl = host.querySelector('#siLogoReset');
  if (resetEl) {
    resetEl.addEventListener('click', () => {
      doc.si.logoDX = 0;
      doc.si.logoDY = 0;
      commit();
      if (typeof onRefreshPreview === 'function') onRefreshPreview();
    });
  }

  const docNoEl = host.querySelector('#siDocNo');
  if (docNoEl) {
    docNoEl.addEventListener('input', () => {
      doc.docNo = docNoEl.value;
      commit();
    });
  }
}

/* ---------------- 预览里拖动 LOGO ---------------- */
if (!window.__TD_SI_LOGO_DRAG__) {
  window.__TD_SI_LOGO_DRAG__ = true;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest && e.target.closest('#paper .si-logo');
    if (!el) return;
    const doc = state.doc;
    if (!doc || doc.type !== 'sales_invoice' || !doc.si) return;
    e.preventDefault();
    el.style.cursor = 'grabbing';

    // ⚠️ state.zoom 是小数（0.87 = 87%），不能当百分数除以 100
    const raw = Number(state.zoom);
    const scale = !raw ? 1 : (raw > 3 ? raw / 100 : raw);

    const startX = e.clientX;
    const startY = e.clientY;
    let dx = Number(doc.si.logoDX) || 0;
    let dy = Number(doc.si.logoDY) || 0;
    const clamp = (v) => Math.max(-700, Math.min(700, v));

    const move = (ev) => {
      // 单次位移限幅，避免异常事件把元素甩飞
      const mx = Math.max(-120, Math.min(120, ev.clientX - startX));
      const my = Math.max(-120, Math.min(120, ev.clientY - startY));
      doc.si.logoDX = Math.round(clamp(dx + mx / scale));
      doc.si.logoDY = Math.round(clamp(dy + my / scale));
      el.style.transform = 'translate(' + doc.si.logoDX + 'px, ' + doc.si.logoDY + 'px)';
    };
    const up = () => {
      el.style.cursor = '';
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      scheduleAutosave();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
}
