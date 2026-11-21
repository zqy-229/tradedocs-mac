/**
 * 单据中心（整页视图）—— 三个版本共用
 *
 * 用法（app.js）：
 *   import { openDocCenter } from './ui/doc-center.js';
 *   $('btnDocCenter').onclick = () => openDocCenter({ onChanged: renderAll });
 *
 * 依赖通过参数注入，尽量少碰各版本的业务代码：
 *   onChanged  数据变了（打开/删除/改状态）后让主界面刷新
 *   toast      提示（可选，默认不提示）
 *   confirm    确认框（可选，默认 window.confirm）
 */
import { state, openDoc, removeDoc, duplicateDoc, markDocSaved, exportBackup } from '../core/store.js';
import { docMeta, visibleDocTypes } from '../core/schema.js';
import { esc, money } from '../core/util.js';
import { t } from '../core/i18n.js';

const PAGE_SIZE = 50;
const STATUS_CN = { draft: '草稿', saved: '已保存', final: '已定稿' };
const STATUS_ORDER = ['all', 'draft', 'saved', 'final'];

const statusOf = (d) => (d.status === 'final' ? 'final' : (d.status === 'saved' ? 'saved' : 'draft'));
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (ms) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtDateTime = (ms) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${fmtDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 打开单据中心（整页） */
export function openDocCenter(opts = {}) {
  const onChanged = opts.onChanged || (() => {});
  const toast = opts.toast || (() => {});
  const confirm = opts.confirm || ((msg) => Promise.resolve(window.confirm(msg)));

  const ui = {
    status: 'all',
    type: 'all',
    customer: 'all',
    range: 'all',
    q: '',
    page: 1,
    selected: new Set(),
    sortKey: 'updatedAt',
    sortDir: 'desc',
  };

  // 允许的文档类型（隐藏的类型不出现）
  const allowedTypes = (() => {
    try {
      const list = visibleDocTypes().map((x) => x.type);
      return list.length ? list : null;
    } catch { return null; }
  })();

  const overlay = document.createElement('div');
  overlay.className = 'dc-page';
  overlay.innerHTML = `
    <div class="dc-page-inner">
      <header class="dc-head">
        <div class="dc-title">
          <b>📚 单据中心</b>
          <span class="dc-stat" id="dcStat"></span>
        </div>
        <div class="dc-head-actions">
          <button type="button" class="btn btn-sm" id="dcRefresh">⟳ 刷新</button>
          <button type="button" class="btn btn-sm" id="dcExportAll">⬇ 导出备份</button>
          <button type="button" class="btn btn-sm btn-accent" id="dcNew">＋ 新建单据</button>
          <button type="button" class="btn btn-sm" id="dcClose">✕ 关闭</button>
        </div>
      </header>
      <div class="dc-tabs" id="dcTabs"></div>
      <div class="dc-filters">
        <select id="dcType"></select>
        <select id="dcCustomer"></select>
        <select id="dcRange">
          <option value="all">全部时间</option>
          <option value="7">最近 7 天</option>
          <option value="30">最近 30 天</option>
          <option value="90">最近 90 天</option>
        </select>
        <input type="search" id="dcSearch" placeholder="搜索 编号 / 客户 / PO / 合同号 / 提单号" />
        <span class="dc-spacer"></span>
        <span class="dc-selbar" id="dcSelBar" hidden>
          已选 <b id="dcSelCount">0</b> 张
          <button type="button" class="btn btn-sm" data-batch="saved">标记已保存</button>
          <button type="button" class="btn btn-sm" data-batch="final">定稿</button>
          <button type="button" class="btn btn-sm" data-batch="export">导出所选</button>
          <button type="button" class="btn btn-sm btn-danger" data-batch="del">删除</button>
          <button type="button" class="btn btn-sm" data-batch="clear">取消选择</button>
        </span>
      </div>
      <div class="dc-table-wrap">
        <table class="dc-table">
          <colgroup>
            <col style="width:34px"><col style="width:15%"><col style="width:10%">
            <col style="width:19%"><col style="width:11%"><col style="width:8%">
            <col style="width:13%"><col style="width:16%">
          </colgroup>
          <thead>
            <tr>
              <th><input type="checkbox" id="dcCheckAll" /></th>
              <th data-sort="docNo">单据编号</th>
              <th data-sort="type">类型</th>
              <th>客户</th>
              <th data-sort="amount" class="dc-r">金额</th>
              <th data-sort="status">状态</th>
              <th data-sort="updatedAt">更新时间</th>
              <th class="dc-r">操作</th>
            </tr>
          </thead>
          <tbody id="dcBody"></tbody>
        </table>
      </div>
      <footer class="dc-foot">
        <span id="dcCount"></span>
        <span class="dc-spacer"></span>
        <select id="dcSize" hidden><option>50</option></select>
        <button type="button" class="btn btn-sm" id="dcPrev">‹ 上一页</button>
        <span id="dcPageInfo"></span>
        <button type="button" class="btn btn-sm" id="dcNext">下一页 ›</button>
      </footer>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);

  /** 过滤后的完整列表（未分页） */
  const filtered = () => {
    const now = Date.now();
    const days = ui.range === 'all' ? 0 : Number(ui.range);
    return state.docs
      .filter((d) => (allowedTypes ? allowedTypes.includes(d.type) : true))
      .filter((d) => (ui.status === 'all' ? true : statusOf(d) === ui.status))
      .filter((d) => (ui.type === 'all' ? true : d.type === ui.type))
      .filter((d) => (ui.customer === 'all' ? true : (d.buyer?.companyName || '') === ui.customer))
      .filter((d) => (days ? (now - (d.updatedAt || 0)) <= days * 86400000 : true))
      .filter((d) => {
        const q = ui.q.trim().toLowerCase();
        if (!q) return true;
        return [d.docNo, d.buyer?.companyName, d.poNo, d.lcNo, d.blNo, d.contractNo, d.invoiceNo]
          .filter(Boolean).some((x) => String(x).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const dir = ui.sortDir === 'asc' ? 1 : -1;
        if (ui.sortKey === 'amount') {
          const av = Number(a.totals?.grandTotal || a.totals?.totalAmount || 0);
          const bv = Number(b.totals?.grandTotal || b.totals?.totalAmount || 0);
          return (av - bv) * dir;
        }
        if (ui.sortKey === 'status') return String(statusOf(a)).localeCompare(String(statusOf(b))) * dir;
        if (ui.sortKey === 'type') return String(a.type).localeCompare(String(b.type)) * dir;
        if (ui.sortKey === 'docNo') return String(a.docNo || '').localeCompare(String(b.docNo || '')) * dir;
        return ((a.updatedAt || 0) - (b.updatedAt || 0)) * dir;
      });
  };

  const renderTabs = () => {
    const all = state.docs.filter((d) => (allowedTypes ? allowedTypes.includes(d.type) : true));
    const cnt = (k) => all.filter((d) => (k === 'all' ? true : statusOf(d) === k)).length;
    $('#dcTabs').innerHTML = STATUS_ORDER
      .map((k) => `<button type="button" class="dc-tab${ui.status === k ? ' active' : ''}" data-status="${k}">
        ${k === 'all' ? '全部' : STATUS_CN[k]}<span class="cnt">${cnt(k)}</span></button>`)
      .join('');
  };

  const renderFilters = () => {
    const types = [...new Set(state.docs.map((d) => d.type))]
      .filter((ty) => !allowedTypes || allowedTypes.includes(ty));
    $('#dcType').innerHTML = ['<option value="all">全部类型</option>']
      .concat(types.map((ty) => `<option value="${ty}"${ui.type === ty ? ' selected' : ''}>${esc(t('doc.' + ty))}</option>`))
      .join('');

    const customers = [...new Set(state.docs.map((d) => d.buyer?.companyName).filter(Boolean))].sort();
    $('#dcCustomer').innerHTML = ['<option value="all">全部客户</option>']
      .concat(customers.map((c) => `<option value="${esc(c)}"${ui.customer === c ? ' selected' : ''}>${esc(c)}</option>`))
      .join('');
    $('#dcRange').value = ui.range;
  };

  const renderBody = () => {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (ui.page > pages) ui.page = pages;
    const start = (ui.page - 1) * PAGE_SIZE;
    const rows = list.slice(start, start + PAGE_SIZE);

    $('#dcBody').innerHTML = rows.length ? rows.map((d) => {
      const st = statusOf(d);
      const amount = Number(d.totals?.grandTotal || d.totals?.totalAmount || 0);
      return `<tr data-id="${esc(d.id)}">
        <td><input type="checkbox" data-check="${esc(d.id)}"${ui.selected.has(d.id) ? ' checked' : ''} /></td>
        <td class="dc-no">${esc(d.docNo || '(无编号)')}</td>
        <td>${esc(t('doc.' + d.type))}</td>
        <td>${esc(d.buyer?.companyName || '—')}</td>
        <td class="dc-r">${amount ? money(amount) : '—'}</td>
        <td><span class="dc-st dc-st-${st}">${STATUS_CN[st]}</span></td>
        <td class="dc-when">${fmtDateTime(d.updatedAt)}</td>
        <td class="dc-r dc-ops">
          <button type="button" class="btn btn-sm btn-primary" data-open="${esc(d.id)}">打开</button>
          <button type="button" class="btn btn-sm" data-dup="${esc(d.id)}" title="复制一张">复制</button>
          <button type="button" class="btn btn-sm btn-danger" data-del="${esc(d.id)}" title="删除">删除</button>
        </td>
      </tr>`;
    }).join('') : `<tr><td colspan="8" class="dc-empty">没有符合条件的单据</td></tr>`;

    // 统计
    const totalAmt = list.reduce((s, d) => s + Number(d.totals?.grandTotal || d.totals?.totalAmount || 0), 0);
    $('#dcStat').textContent = `共 ${list.length} 张 · 合计 ${money(totalAmt)}`;
    $('#dcCount').textContent = `显示第 ${list.length ? start + 1 : 0}–${Math.min(start + PAGE_SIZE, list.length)} 条，共 ${list.length} 条`;
    $('#dcPageInfo').textContent = `第 ${ui.page} / ${pages} 页`;
    $('#dcPrev').disabled = ui.page <= 1;
    $('#dcNext').disabled = ui.page >= pages;
    $('#dcCheckAll').checked = rows.length > 0 && rows.every((d) => ui.selected.has(d.id));

    // 选中条
    $('#dcSelBar').hidden = ui.selected.size === 0;
    $('#dcSelCount').textContent = String(ui.selected.size);
  };

  const renderAll = () => { renderTabs(); renderFilters(); renderBody(); };

  /* ---------------- 事件 ---------------- */
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  $('#dcClose').onclick = close;
  $('#dcRefresh').onclick = () => { renderAll(); toast('已刷新', 1500); };

  $('#dcTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    ui.status = b.getAttribute('data-status');
    ui.page = 1;
    renderAll();
  });

  $('#dcType').onchange = (e) => { ui.type = e.target.value; ui.page = 1; renderBody(); };
  $('#dcCustomer').onchange = (e) => { ui.customer = e.target.value; ui.page = 1; renderBody(); };
  $('#dcRange').onchange = (e) => { ui.range = e.target.value; ui.page = 1; renderBody(); };
  $('#dcSearch').oninput = (e) => { ui.q = e.target.value; ui.page = 1; renderBody(); };

  overlay.querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const key = th.getAttribute('data-sort');
    if (ui.sortKey === key) ui.sortDir = ui.sortDir === 'asc' ? 'desc' : 'asc';
    else { ui.sortKey = key; ui.sortDir = 'desc'; }
    renderBody();
  });

  $('#dcCheckAll').onchange = (e) => {
    const list = filtered().slice((ui.page - 1) * PAGE_SIZE, ui.page * PAGE_SIZE);
    list.forEach((d) => (e.target.checked ? ui.selected.add(d.id) : ui.selected.delete(d.id)));
    renderBody();
  };

  $('#dcBody').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-check]');
    if (!cb) return;
    const id = cb.getAttribute('data-check');
    if (cb.checked) ui.selected.add(id); else ui.selected.delete(id);
    renderBody();
  });

  $('#dcBody').addEventListener('click', async (e) => {
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) {
      await openDoc(openBtn.getAttribute('data-open'));
      close(); onChanged();
      return;
    }
    const dupBtn = e.target.closest('[data-dup]');
    if (dupBtn) {
      await duplicateDoc(dupBtn.getAttribute('data-dup'));
      renderAll(); onChanged();
      return;
    }
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      const doc = state.docs.find((x) => x.id === delBtn.getAttribute('data-del'));
      const ok = await confirm(`删除「${doc?.docNo || ''}」？删除后不可恢复。`);
      if (!ok) return;
      await removeDoc(delBtn.getAttribute('data-del'));
      ui.selected.delete(delBtn.getAttribute('data-del'));
      renderAll(); onChanged();
    }
  });

  $('#dcPrev').onclick = () => { if (ui.page > 1) { ui.page--; renderBody(); } };
  $('#dcNext').onclick = () => { ui.page++; renderBody(); };

  $('#dcExportAll').onclick = async () => {
    const payload = await exportBackup();
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tradedocs-backup-${fmtDate(Date.now())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('备份已导出', 2000);
  };

  $('#dcNew').onclick = () => {
    close();
    const btn = document.getElementById('btnNew');
    if (btn) btn.click();
  };

  overlay.querySelector('.dc-selbar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-batch]');
    if (!b) return;
    const act = b.getAttribute('data-batch');
    const ids = [...ui.selected];
    if (act === 'clear') { ui.selected.clear(); renderBody(); return; }
    if (act === 'export') {
      const payload = await exportBackup();
      const subset = { ...payload, data: { ...payload.data, docs: (payload.data.docs || []).filter((d) => ids.includes(d.id)) } };
      const blob = new Blob([JSON.stringify(subset)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `tradedocs-selected-${ids.length}-${fmtDate(Date.now())}.json`;
      a.click(); URL.revokeObjectURL(a.href);
      toast(`已导出所选 ${ids.length} 张`, 2000);
      return;
    }
    if (act === 'del') {
      const ok = await confirm(`删除选中的 ${ids.length} 张单据？不可恢复。`);
      if (!ok) return;
      for (const id of ids) await removeDoc(id);
      ui.selected.clear();
      renderAll(); onChanged();
      return;
    }
    if (act === 'saved' || act === 'final') {
      let done = 0;
      for (const id of ids) {
        const doc = state.docs.find((x) => x.id === id);
        if (!doc) continue;
        if (act === 'saved') {
          const res = await markDocSaved(doc).catch(() => ({ ok: false }));
          if (res && res.ok !== false) done++;
        } else {
          // 定稿：有 finalize 就用，没有就退化为标记已保存
          const st = await import('../core/store.js').catch(() => null);
          if (st && typeof st.finalizeDoc === 'function') { await st.finalizeDoc(doc); done++; }
          else { await markDocSaved(doc).catch(() => null); done++; }
        }
      }
      ui.selected.clear();
      renderAll(); onChanged();
      toast(`已处理 ${done} 张`, 2000);
    }
  });

  renderAll();
  return { close };
}
