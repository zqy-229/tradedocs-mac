/* =============================================================
 * 外贸单证工作台 TradeDocs — 主应用
 * 纯前端 · 本地离线 · 数据保存在本机 IndexedDB
 *
 * ⚠️ APP_VERSION 由 scripts/sync-version.mjs 在打包前自动同步，
 *    不要手改（改了下次打包会被覆盖）。
 *    它显示在窗口底部状态栏 —— 用户装了两份时能一眼看出跑的是哪一版，
 *    排查「装了新版怎么还是旧界面」这类问题时非常有用。
 * ============================================================= */

export const APP_VERSION = '1.1.3';
export const BUILD_DATE = '2026-11-21';

import { esc, clone, bytes, timeAgo, today } from './core/util.js';
import * as db from './core/db.js';
import { STORES } from './core/db.js';
import { t, applyI18n, setUiLang, UI_LANGS } from './core/i18n.js';
import { DOC_LANGS, CURRENCIES, CURRENCY_CN, getTemplate, langOptionLabel } from './core/templates.js';
import { DOC_TYPES, docMeta, emptyParty, emptyItem, incotermsList, visibleDocTypes, isDocTypeHidden, HIDDEN_DOC_TYPES, docLangChoices, isFixedFormatDoc, fallbackDocLang } from './core/schema.js';
import { recalcDoc } from './core/calc.js';
import { fillSample } from './core/sample.js';
import { validateDoc, countByLevel, summaryText } from './core/validate.js';
import * as store from './core/store.js';
import { state, on, emit, DOC_STATUS } from './core/store.js';
import * as toast from './ui/toast.js';
import { initLicense, openActivateDialog, currentStatus as licStatusNow } from './ui/activate.js';
import { EDITION, formatLeft as licFormatLeft, TRIAL_HOURS as LIC_TRIAL_HOURS } from './core/license.js';
import { openModal, confirmModal, promptModal, hasOpenModal } from './ui/modal.js';
import { decorateSections, buildTodoPanel, bindPreviewToForm } from './ui/ux.js';
import { mountSectionNav } from './ui/sec-nav.js';
import { renderForm, initPhotoInputs, syncItemsLayout, openCustomerEditor, openProductEditor, openClauseEditor, openProfileEditor, openProfilePicker, openBankEditor, saveSellerAsProfile, bindEmptyStateNew } from './ui/form.js';
import { openDocCenter as openDocCenterPage } from './ui/doc-center.js';
/* 工具箱模块已移除 */
import { renderDocument } from './doc/render.js';
import { exportPdf, printDocument, exportHtmlFile } from './doc/pdf.js';
import { exportAs, baseFileName } from './doc/export.js';

/* ============================ 元素引用 ============================ */

const $ = (id) => document.getElementById(id);
const el = {};

function cacheEls() {
  el.docTabs = $('docTabs');
  el.formHost = $('formHost');
  el.paper = $('paper');
  el.paperShell = $('paperShell');
  el.previewScroll = $('previewScroll');
  el.zoomValue = $('zoomValue');
  el.previewLang = $('previewLang');
  el.saveState = $('saveState');
  el.statusDoc = $('statusDoc');
  el.statusChip = $('statusChip');
  el.btnMarkSaved = $('btnMarkSaved');
  el.btnBackDraft = $('btnBackDraft');
  el.netDot = $('netDot');
  el.netState = $('netState');
  el.draftList = $('draftList');
  el.revisionList = $('revisionList');
  el.revCount = $('revCount');
  el.drawerDrafts = $('drawerDrafts');
  el.drawerLibrary = $('drawerLibrary');
  el.appBody = $('appBody');
  el.draftTabs = $('draftTabs');
  el.cntDraft = $('cntDraft');
  el.cntSaved = $('cntSaved');
  el.docTypeChips = $('docTypeChips');
  el.libTabs = $('libTabs');
  el.fontValue = $('fontValue');
  el.cntProfiles = $('cntProfiles');
  el.cntBanks = $('cntBanks');
  el.cntCustomers = $('cntCustomers');
  el.cntProducts = $('cntProducts');
  el.cntClauses = $('cntClauses');
}

/* ============================ 初始化 ============================ */

async function boot() {
  cacheEls();
  enableDocTabScroll();
  applyI18n(document);
  installErrorGuards();
  await checkDataVersion();

  try {
    await store.init();
  } catch (err) {
    console.error(err);
    toast.err(`本地数据库初始化失败：${err.message}`);
  }

  // 授权/激活功能已移除：导出 PDF、打印、导出 Word/Excel 等一律免费
  bindGlobalEvents();
  renderTabs();
  renderLangSelect();
  await pickInitialDoc();
  renderAll();
  updateSaveState('saved');
  updateStatus();
  await updateStorageInfo();
  await applyStoredPreferences();
  registerServiceWorker();
  initInstallPrompt();
  reportStorageNote();
  handleUrlParams();

  // 调试钩子：?demo=1 或 ?test=1（供自动化验收脚本驱动真实界面，正常使用不加载额外模块）
  if (/(^|[?&])(demo|test)=1(&|$)/.test(location.search)) {
    const formMod = await import('./ui/form.js');
    window.__TD__ = {
      mountDoc: (doc) => formMod.mountDoc(doc),
      refresh: () => formMod.refreshFormView(),
      state,
      store,
      db,
      STORES,
      render: (d) => renderDocument(d),
      renderPreview,
      renderAll,
      applyZoom,
      openHelp,
      openSettings,
      toggleBigText,
      markCurrentSaved,
      backToDraft,
      // 单据检查（自测与调试用）
      validate: () => currentChecks(),
      refreshChecks,
      openCheckPanel,
      closeCheckPanel,
      toggleCheckPanel,
      jumpToField,
      // 截图 / 调试辅助（同时供布局与示例数据相关用例使用）
      setLayoutForShot: (code) => setLayout(code),
      setThemeForShot: (code) => applyTheme(code),
      loadSampleForShot: () => loadSampleData(),
      openSettingsForShot: () => openSettings(),
      toggleRail: (open) => {
        const rail = $('appRail');
        if (!rail) return;
        rail.classList.toggle('open', open !== false);
        rail.classList.toggle('locked', open === false);
      },
      debugState: () => ({
        docNull: state.doc === null,
        docNo: state.doc && state.doc.docNo,
        docStatus: state.doc && state.doc.status,
        refreshFn: typeof state._refreshPreview,
        paperHtmlLen: document.getElementById('paper').innerHTML.length,
        paperHasTable: !!document.querySelector('#paper table.doc-table'),
      }),
      // 单据类型（自测用：页签里实际有哪些 / 哪些被隐藏）
      visibleTypes: () => visibleDocTypes().map((d) => d.type),
      hiddenTypes: () => HIDDEN_DOC_TYPES.slice(),
      allTypes: () => DOC_TYPES.map((d) => d.type),
    };
  }

  // 浏览器自测模式：?test=1（不影响正常使用）
  if (/(^|[?&])test=1(&|$)/.test(location.search)) {
    try {
      const mod = await import('./test-smoke.js');
      await mod.runSmokeTest();
    } catch (err) {
      console.error('自测执行失败', err);
      const pre = document.createElement('pre');
      pre.id = 'smokeResult';
      pre.textContent = JSON.stringify({ total: 0, failed: 1, results: [], consoleErrors: [String(err && err.stack || err)] }, null, 2);
      pre.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#fff;color:#111;font-size:11px;max-height:100vh;overflow:auto';
      document.body.appendChild(pre);
      document.title = 'SMOKE-FAIL';
    }
  }

  // 授权（客户版才有）：试用倒计时 / 到期锁屏 / 激活窗口
  try { await initLicense(); } catch (err) { console.error('授权初始化失败', err); }
}

/** 首次进入：优先打开最近编辑的单据，并记住它所属的类型（Tab 定位用） */
async function pickInitialDoc() {
  if (state.doc) return;
  // 优先显示中的类型；隐藏类型（检验/熏蒸/受益人证明/发货人委托/保险单/成本估算/原产地证明）
  // 不自动打开，否则用户会看到一张"没有页签"的单据，莫名其妙
  const pool = state.docs.filter((d) => !isDocTypeHidden(d.type));
  const list = pool.length ? pool : state.docs;
  if (list.length) {
    const latest = list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    await store.openDoc(latest.id);
    state.lastType = latest.type;
  }
}

/* ============================ 顶部 Tab ============================ */

/** 手机端单据类型选择条（顶部页签在窄屏放不下，用这个 5 格条代替） */
function renderMobileDocbar() {
  const host = $('mobileDocbar');
  if (!host) return;
  const counts = store.docCounts();
  const current = activeType();
  host.innerHTML = visibleDocTypes().map((d) => {
    const active = state.doc ? state.doc.type === d.type : current === d.type;
    const c = counts[d.type] || { draft: 0, saved: 0 };
    const n = c.draft + c.saved;
    return `<button type="button" class="mdoc${active ? ' active' : ''}" data-type="${d.type}">
      <span class="ico">${d.icon}</span>
      <span class="nm">${esc(t(`doc.${d.type}`))}</span>
      ${n ? `<span class="bd">${n}</span>` : ''}
    </button>`;
  }).join('');
  host.querySelectorAll('.mdoc').forEach((b) => {
    b.addEventListener('click', () => switchType(b.getAttribute('data-type')));
  });
}

/** 单据类型 Tab 横向滚动：鼠标滚轮（纵向）转为横向，解决「顶栏 Tab 太多滑不动」 */
function enableDocTabScroll() {
  const tabs = el.docTabs;
  if (!tabs) return;
  tabs.addEventListener('wheel', (e) => {
    if (tabs.scrollWidth <= tabs.clientWidth) return;   // 没有溢出则不拦截
    if (e.deltaX !== 0) return;                          // 原生横向滚动不重复处理
    e.preventDefault();
    tabs.scrollLeft += e.deltaY;
  }, { passive: false });
}

/** 单据类型线性图标（内嵌 SVG，Lucide 风格，离线可用；stroke 跟随当前文字色） */
const ICON_SVGS = {
  quotation: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  pi: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="16" y1="8" x2="8" y2="8"/><line x1="16" y1="12" x2="8" y2="12"/><line x1="16" y1="16" x2="8" y2="16"/>',
  contract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13l2 2 4-4"/>',
  ci: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>',
  pl: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="21"/>',
  bank: '<path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 10l7-6 7 6"/><path d="M8 14v4"/><path d="M16 14v4"/>',
  bill_of_lading: '<path d="M3 21c2 1 4 1 6 0s4-1 6 0 4 1 6 0"/><path d="M18 16l-2-6H8l-2 6"/><path d="M12 4v7"/><path d="M7 7h10"/>',
  certificate_of_origin: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
  customs_declaration: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  inspection_certificate: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
  fumigation_certificate: '<path d="M7 10V5a5 5 0 0 1 10 0v5"/><path d="M5 10h14l-1.5 10a2 2 0 0 1-2 1.7h-7a2 2 0 0 1-2-1.7z"/>',
  beneficiary_certificate: '<path d="M12 22s7-3 7-9V5l-7-2-7 2v8c0 6 7 9 7 9z"/><path d="M9 11l2 2 4-4"/>',
  shipper_letter_instruction: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>',
  insurance_policy: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  cost_estimation: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="9" y1="11" x2="9" y2="11"/><line x1="12" y1="11" x2="12" y2="11"/><line x1="15" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="9" y2="18"/><line x1="12" y1="15" x2="12" y2="18"/><line x1="15" y1="15" x2="15" y2="18"/>',
};

function svgIcon(type) {
  const p = ICON_SVGS[type];
  return p
    ? `<svg class="doc-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`
    : '';
}

function renderTabs() {
  const counts = store.docCounts();
  const current = activeType();
  el.docTabs.innerHTML = visibleDocTypes().map((d) => {
    // 有打开的单据就按它高亮；空态时按「当前所在类型」高亮，用户才知道自己在哪一页
    const active = state.doc ? state.doc.type === d.type : current === d.type;
    const c = counts[d.type] || { draft: 0, saved: 0, total: 0 };
    const badge = c.draft
      ? `<span class="tab-count" title="草稿 ${c.draft} 份">${c.draft}</span>`
      : (c.saved ? `<span class="tab-count saved" title="已保存 ${c.saved} 份">✓${c.saved}</span>` : '');
    return `<button class="doc-tab${active ? ' active' : ''}" data-type="${d.type}" role="tab">
      ${svgIcon(d.type)}<span class="tab-text">${esc(t(`doc.${d.type}`))}</span>${badge}
    </button>`;
  }).join('');

  el.docTabs.querySelectorAll('.doc-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchType(btn.getAttribute('data-type')));
  });
}

/** 当前所在单据类型（有打开的单据用它，否则用最近用过的类型，默认报价单） */
function activeType() {
  if (state.doc) return state.doc.type;
  if (state.lastType && DOC_TYPES.some((d) => d.type === state.lastType)) return state.lastType;
  // 退而求其次：最近更新过的**显示中**单据的类型
  const pool = state.docs.filter((d) => !isDocTypeHidden(d.type));
  const latest = pool.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  return latest ? latest.type : 'quotation';
}

/**
 * 切换单据类型
 * 规则：每个 Tab 只管自己这一类单据 —— 只打开该类型的单据，绝不跳到别的类型；
 *      该类型没有单据时显示空态，让用户在本页新建。
 */
async function switchType(type) {
  if (state.doc && state.doc.type === type) return;
  await store.flushAutosave().catch(() => null);
  pushNav(state.doc && state.doc.id);

  const sameType = state.docs
    .filter((d) => d.type === type)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const target = sameType.find((d) => d.status !== 'saved') || sameType[0];

  state.lastType = type;

  if (target) {
    await store.openDoc(target.id);
    renderAll();
    renderHistoryButtons();
    return;
  }
  // 本类型还没有单据：显示空态（不自动新建、不切到别的类型）
  state.doc = null;
  renderAll();
  renderHistoryButtons();
  toast.info(`${t(`doc.${type}`)}：${t('drafts.empty')}`, 2800);
}

/* ============================ 返回上一条单据 ============================ */

/** 导航历史（打开过谁），用于没有创建顺序时兜底 */
const navStack = [];

function pushNav(docId) {
  if (!docId) return;
  const last = navStack[navStack.length - 1];
  if (last === docId) return;
  navStack.push(docId);
  if (navStack.length > 30) navStack.shift();
}

/**
 * 按「创建顺序」排好的单据列表（早 → 晚）
 * @param {boolean} sameTypeOnly 只取与当前单据同一类型的（用户要求：商业发票只回商业发票）
 */
function docsByCreation(sameTypeOnly = false) {
  const cur = state.doc;
  return state.docs
    .filter((d) => !sameTypeOnly || !cur || d.type === cur.type)
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** 当前单据在创建顺序里的前一条（默认限定同一单据类型） */
function previousCreatedDoc() {
  if (!state.doc) return null;
  const list = docsByCreation(true);
  const idx = list.findIndex((d) => d.id === state.doc.id);
  if (idx > 0) return list[idx - 1];
  return null;
}

/** 当前单据在创建顺序里的后一条（同类型） */
function nextCreatedDoc() {
  if (!state.doc) return null;
  const list = docsByCreation(true);
  const idx = list.findIndex((d) => d.id === state.doc.id);
  if (idx >= 0 && idx < list.length - 1) return list[idx + 1];
  return null;
}

/** 同步「状态 / 保存提示」到侧栏（顶栏式下这两个元素隐藏，写进去也无害） */
function syncRailState() {
  const chip = $('railStatusChip');
  const src = $('statusChip');
  if (chip && src) {
    chip.dataset.status = src.dataset.status || 'draft';
    chip.textContent = src.textContent || '';
  }
  const rs = $('railSaveState');
  const ss = $('saveState');
  if (rs && ss) {
    rs.className = ss.className.replace('save-state', 'rail-save');
    rs.innerHTML = ss.innerHTML;
  }
  const markSaved = $('railMarkSaved');
  const srcMark = $('btnMarkSaved');
  if (markSaved && srcMark) markSaved.hidden = srcMark.hidden;
  const backDraft = $('railBackDraft');
  const srcBack = $('btnBackDraft');
  if (backDraft && srcBack) backDraft.hidden = srcBack.hidden;
  const back = $('railBack');
  const next = $('railNext');
  if (back) {
    const prev = previousCreatedDoc();
    back.hidden = !prev;
    const txt = back.querySelector('.txt');
    if (txt && prev) txt.textContent = `${t('btn.back')}（${prev.docNo || t(`doc.${prev.type}`)}）`;
    back.title = prev ? `返回上一条${t(`doc.${prev.type}`)}：${prev.docNo || ''}` : '';
  }
  if (next) {
    const nx = nextCreatedDoc();
    next.hidden = !nx;
    next.title = nx ? `下一条${t(`doc.${nx.type}`)}：${nx.docNo || ''}` : '';
  }
}

function renderHistoryButtons() {
  const nav = $('docNav');
  const back = $('btnBack');
  const next = $('btnNext');
  if (!back || !next) return;
  const prev = previousCreatedDoc();
  const nx = nextCreatedDoc();
  // 只有「同类单据有 2 张以上」时才显示这一组 —— 只有一张就不出现，别占地方也别让人误会
  const list = state.doc ? docsByCreation(true) : [];
  const showNav = !!state.doc && list.length > 1;
  if (nav) nav.hidden = !showNav;
  back.hidden = !showNav;
  next.hidden = !showNav;
  if (!showNav) { renderOrderHint(); syncRailState(); return; }
  // 到头了就置灰，不再整颗消失（否则按钮一会有一会没有，看着乱）
  back.disabled = !prev;
  next.disabled = !nx;
  back.title = prev ? `上一条同类单据：${prev.docNo || t(`doc.${prev.type}`)}` : '已经是同类里最早的一条';
  next.title = nx ? `下一条同类单据：${nx.docNo || t(`doc.${nx.type}`)}` : '已经是同类里最后一条';
  const labBack = back.querySelector('.btn-label-back');
  if (labBack) labBack.textContent = prev ? `${t('btn.back')}（${prev.docNo || ''}）` : t('btn.back');
  const labNext = next.querySelector('.btn-label-next');
  if (labNext) labNext.textContent = nx ? `${t('btn.next')}（${nx.docNo || ''}）` : t('btn.next');
  renderOrderHint();
  syncRailState();
}

/** 返回上一条（同类型）创建的单据 */
async function goBackDoc() {
  await store.flushAutosave().catch(() => null);
  const target = previousCreatedDoc();
  if (!target) {
    // 同类型里已经是最早的一条：尝试用浏览历史兜底
    const cur = state.doc && state.doc.id;
    let id = null;
    while (navStack.length) {
      const x = navStack.pop();
      if (x !== cur) { id = x; break; }
    }
    if (!id) { toast.info(`这张已经是最早的${state.doc ? t(`doc.${state.doc.type}`) : '单据'}了`); renderHistoryButtons(); return; }
    const doc = await store.openDoc(id);
    if (!doc) { renderHistoryButtons(); return; }
    state.lastType = doc.type;
    renderAll(); renderRevisionList();
    toast.info(`已返回：${t(`doc.${doc.type}`)} ${doc.docNo || ''}`, 1800);
    return;
  }
  const doc = await store.openDoc(target.id);
  if (!doc) { renderHistoryButtons(); return; }
  state.lastType = doc.type;
  renderAll();
  renderRevisionList();
  toast.info(`上一条${t(`doc.${doc.type}`)}：${doc.docNo || ''}`, 1800);
}

/** 前进到下一条（同类型）创建的单据 */
async function goNextDoc() {
  const target = nextCreatedDoc();
  if (!target) { toast.info(`已经是最后一条${state.doc ? t(`doc.${state.doc.type}`) : '单据'}了`); return; }
  await store.flushAutosave().catch(() => null);
  const doc = await store.openDoc(target.id);
  if (!doc) return;
  state.lastType = doc.type;
  renderAll();
  renderRevisionList();
  toast.info(`下一条${t(`doc.${doc.type}`)}：${doc.docNo || ''}`, 1800);
}

/* ============================ 单据顺序指示 ============================ */

/** 显示「第 2 / 3 条」，让用户知道自己在同类单据创建顺序里的位置（整组导航的中间那格） */
function renderOrderHint() {
  const cur = state.doc;
  const hint = $('orderHint');
  const railHint = $('railOrderHint');
  const nav = $('docNav');
  const setBoth = (hidden, text, title) => {
    for (const el of [hint, railHint]) {
      if (!el) continue;
      el.hidden = hidden;
      if (!hidden) { el.textContent = text; el.title = title; }
    }
  };
  if (!cur) { setBoth(true); if (nav) nav.hidden = true; return; }
  const list = docsByCreation(true);       // 只看同类型
  const idx = list.findIndex((d) => d.id === cur.id);
  if (idx < 0 || list.length < 2) { setBoth(true); if (nav) nav.hidden = true; return; }
  if (nav) nav.hidden = false;
  setBoth(false,
    `${idx + 1} / ${list.length}`,
    `同类单据按创建顺序：这是第 ${idx + 1} 张，共 ${list.length} 张，可用左右箭头翻看`);
}

/* ============================ 示例数据 ============================ */

/** 载入示例数据并把界面切到示例里最近的一张单据 */
async function loadSampleData() {
  const r = await store.loadSampleData();
  if (!r.ok) return r;
  await store.refreshDocs();
  const samplePool = store.state.docs.filter((d) => !isDocTypeHidden(d.type));
  const latest = (samplePool.length ? samplePool : store.state.docs)
    .slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if (latest) {
    await store.openDoc(latest.id);
    state.lastType = latest.type;
  }
  renderAll();
  renderRevisionList();
  renderHistoryButtons();
  return r;
}

/* ============================ 左右分栏：拖拽调整 + 隐藏预览 ============================ */

const SPLIT_MIN = 420;      // 编辑区最小宽度：再窄明细表就只能纵向排，且基础信息也放不下两列
const SPLIT_MAX_RATIO = 82; // 最多占 82%
const SPLIT_DEFAULT = 42;   // 默认 42%

/** 应用分栏宽度（百分比）。只改 CSS 变量，布局交给 CSS */
function applySplit(percent) {
  const v = Math.min(92, Math.max(20, Number(percent) || SPLIT_DEFAULT));
  state.split = v;
  document.documentElement.style.setProperty('--split', `${v}%`);
  return v;
}

/** 预览显示 / 隐藏 */
function applyPreviewVisible(visible) {
  state.previewVisible = visible !== false;
  const body = $('appBody');
  if (body) body.classList.toggle('preview-hidden', !state.previewVisible);
  const stub = $('previewStub');
  if (stub) stub.hidden = state.previewVisible;
  const label = state.previewVisible ? t('prev.hide') : t('prev.show');
  const btnLabel = document.querySelector('#btnHidePreview .btn-label');
  if (btnLabel) btnLabel.textContent = label;
  const railLabel = document.querySelector('#railTogglePreview .txt');
  if (railLabel) railLabel.textContent = label;
  if (state.previewVisible) requestAnimationFrame(() => { try { applyZoom(); } catch { /* 忽略 */ } });
}

async function togglePreview() {
  applyPreviewVisible(!state.previewVisible);
  await store.saveSetting('previewVisible', state.previewVisible);
  toast.info(state.previewVisible ? '已显示右侧预览' : '已隐藏右侧预览，专心填表（Ctrl+\\ 可切回）', 2200);
}

function initSplitter() {
  const sp = $('splitter');
  const body = $('appBody');
  if (!sp || !body) return;

  const setFromX = (clientX) => {
    const rect = body.getBoundingClientRect();
    const rail = $('appRail');
    const railW = (rail && getComputedStyle(rail).display !== 'none')
      ? rail.getBoundingClientRect().width : 0;
    const usable = rect.width - railW;
    if (usable <= 0) return;
    const left = clientX - rect.left - railW;
    const minPct = (SPLIT_MIN / usable) * 100;
    applySplit(Math.min(SPLIT_MAX_RATIO, Math.max(minPct, (left / usable) * 100)));
  };

  // 拖动过程中实时切换明细表的「表格 / 卡片」模式（rAF 节流，避免卡顿）
  let rafId = 0;
  const scheduleSync = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      try { syncItemsLayout(); } catch { /* 忽略 */ }
    });
  };

  let dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    setFromX(e.touches ? e.touches[0].clientX : e.clientX);
    scheduleSync();
    e.preventDefault();
  };
  const onUp = async () => {
    if (!dragging) return;
    dragging = false;
    sp.classList.remove('dragging');
    document.body.classList.remove('col-resizing');
    await store.saveSetting('split', state.split);
  };
  const onDown = (e) => {
    dragging = true;
    sp.classList.add('dragging');
    document.body.classList.add('col-resizing');
    setFromX(e.touches ? e.touches[0].clientX : e.clientX);
    scheduleSync();
    e.preventDefault();
  };

  sp.addEventListener('mousedown', onDown);
  sp.addEventListener('touchstart', onDown, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);

  // 双击还原默认宽度
  sp.addEventListener('dblclick', async () => {
    applySplit(SPLIT_DEFAULT);
    await store.saveSetting('split', SPLIT_DEFAULT);
    toast.info(`编辑区宽度已还原为 ${SPLIT_DEFAULT}%`, 1600);
  });

  // 键盘微调（Tab 聚焦分栏条后按方向键）
  sp.tabIndex = 0;
  sp.addEventListener('keydown', async (e) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft') applySplit(state.split - step);
    else if (e.key === 'ArrowRight') applySplit(state.split + step);
    else return;
    e.preventDefault();
    await store.saveSetting('split', state.split);
  });
}

/** Ctrl+\ 显示 / 隐藏预览；窗口尺寸变化时重算明细表模式 */
function initViewShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '\\' || e.code === 'Backslash')) {
      e.preventDefault();
      togglePreview();
    }
  });

  // 窗口缩放 / 旋转屏幕后，明细表模式可能要跟着变
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { try { syncItemsLayout(); } catch { /* 忽略 */ } }, 160);
  });
}

/* ============================ 导出格式菜单 ============================ */

/**
 * 目前只放 PDF 出去。
 *
 * Word / Excel / CSV / HTML 的实现**完整保留**（js/doc/export.js、docx.js、zip.js 都没动），
 * 只是暂时从界面上隐藏，后续要放出来时把 EXPORT_HIDDEN 改空即可。
 * 这样「暂时隐藏」不会变成「删掉了找不回来」。
 */
const EXPORT_HIDDEN = ['word', 'csv', 'html'];   // Excel 已开放（各种单据都能导出 xlsx）

/**
 * 导出菜单用 Popover API 渲染在 top layer：
 * 祖先 .app-body / .pane-right 都有 overflow:hidden，普通绝对定位的下拉会被剪掉。
 * 不支持 popover 的浏览器退回手动定位 + 自绘遮罩。
 */
function initExportMenu() {
  const btn = $('btnExportMore');
  const menu = $('exportMenu');
  const group = $('exportGroup');

  // 只留 PDF 时，整个「更多格式」入口都不显示（HTML 里已 hidden，这里兜一层，
  // 避免以后有人只改了 HTML 忘了 CSS/JS）
  const onlyPdf = EXPORT_HIDDEN.length >= 4;
  if (group) group.dataset.onlyPdf = onlyPdf ? '1' : '0';
  if (onlyPdf) {
    if (btn) btn.hidden = true;
    if (menu) menu.hidden = true;
  }

  if (!btn || !menu) return;

  const usePopover = typeof menu.showPopover === 'function';

  /** popover 在 top layer 里没有祖先定位参照，必须自己按按钮坐标摆放 */
  const place = () => {
    const r = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    // 先摆一个位置，再按真实高度决定向上还是向下展开
    menu.style.top = '0px';
    menu.style.left = '0px';
    const mw = menu.offsetWidth || 272;
    const mh = menu.offsetHeight || 310;
    let left = r.right - mw;                          // 右对齐按钮
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = r.bottom + 6;                           // 默认向下
    if (top + mh > window.innerHeight - 8) {          // 下面放不下就向上
      top = Math.max(8, r.top - mh - 6);
    }
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };

  const isOpen = () => (usePopover ? menu.matches(':popover-open') : !menu.hidden);

  const close = () => {
    if (usePopover) { try { menu.hidePopover(); } catch { /* 已经关了 */ } }
    else menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    if (usePopover) {
      try { menu.showPopover(); } catch { /* 已经开了 */ }
      place();                                        // 显示出来才量得到尺寸
    } else {
      menu.hidden = false;
      place();
    }
    btn.setAttribute('aria-expanded', 'true');
  };

  // 不支持 popover 的浏览器：退回 hidden 控制显隐（两条路径互斥，别互相污染）
  if (!usePopover) menu.hidden = true;
  menu.style.position = 'fixed';

  btn.onclick = (e) => {
    e.stopPropagation();
    if (isOpen()) close(); else open();
  };

  // 工具栏里独立的 Excel 按钮（不用展开菜单，点了直接导出）
  const btnExcel = $('btnExcel');
  if (btnExcel) {
    btnExcel.onclick = async () => {
      if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
      try {
        btnExcel.disabled = true;
        await exportAs(state.doc, 'excel');
        toast.ok(t('exp.done') || '已导出 Excel', 2000);
      } catch (err) {
        console.error('Excel 导出失败', err);
        toast.err(`Excel 导出失败: ${err && err.message ? err.message : err}`);
      } finally {
        btnExcel.disabled = false;
      }
    };
  }
  menu.querySelectorAll('[data-exp]').forEach((item) => {
    item.onclick = async () => {
      const kind = item.getAttribute('data-exp');
      close();
      if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
      try {
        if (kind === 'pdf') { toast.info(t('msg.pdfStart'), 2600); exportPdf(state.doc); }
        else if (kind === 'html') {
          exportHtmlFile(state.doc);
          toast.ok(t('exp.htmlDone'), 2200);
        } else {
          item.disabled = true;
          await exportAs(state.doc, kind);
          item.disabled = false;
        }
      } catch (err) {
        console.error('导出失败', err);
        toast.err(`${t('exp.unknownFormat')}: ${err && err.message ? err.message : err}`);
      }
    };
  });

  // 窗口尺寸变化时重新贴合按钮
  window.addEventListener('resize', () => { if (isOpen()) place(); });

  // 点别处 / 按 Esc 收起（popover=auto 自带 light-dismiss，这里补一道保险）
  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (e.target === btn || btn.contains(e.target)) return;
    if (menu.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });
}

/* ============================ 界面布局（顶栏式 / 侧栏式） ============================ */

export const LAYOUTS = [
  { code: 'side', labelKey: 'set.layoutSide', descKey: 'set.layoutSideDesc' },
  { code: 'top', labelKey: 'set.layoutTop', descKey: 'set.layoutTopDesc' },
];

/** 应用布局：只改 html[data-layout]，隐藏/显示由 CSS 负责 */
function applyLayout(code) {
  const ok = LAYOUTS.some((l) => l.code === code) ? code : 'side';
  state.layout = ok;
  document.documentElement.setAttribute('data-layout', ok);
  return ok;
}

async function setLayout(code) {
  applyLayout(code);
  await store.saveSetting('layout', state.layout);
  renderHistoryButtons();
}

/* ============================ 侧栏菜单 ============================ */

function bindRail() {
  const rail = $('appRail');
  if (!rail) return;

  // 展开 / 收起
  // 用户一旦主动收起，就加 locked，避免鼠标停在上面又把菜单撑开
  const toggle = $('railToggle');
  if (toggle) {
    toggle.dataset.label = t('rail.menuOpen');
    toggle.onclick = () => {
      const open = rail.classList.toggle('open');
      rail.classList.toggle('locked', !open);
      toggle.dataset.label = open ? t('rail.menuClose') : t('rail.menuOpen');
    };
  }

  // 菜单项：选中时自动展开一次，让用户看到文字（符合「选择时显示，平常隐藏」）
  const flashOpen = () => {
    rail.classList.add('open');
    rail.classList.remove('locked');
    if (toggle) toggle.dataset.label = t('rail.menuClose');
  };

  const map = [
    ['railNew', () => newDocument(activeType())],
    ['railGenerate', openGenerateModal],
    ['railDuplicate', duplicateCurrent],
    ['railBack', goBackDoc],
    ['railNext', goNextDoc],
    ['railMarkSaved', markCurrentSaved],
    ['railBackDraft', backToDraft],
    ['railHelp', openHelp],
    ['railTogglePreview', togglePreview],
    ['railDrafts', () => openDrawer('drafts')],
    ['railLibrary', () => openDrawer('library')],
    ['railSettings', openSettings],
  ];
  for (const [id, fn] of map) {
    const b = $(id);
    if (!b) continue;
    b.onclick = () => { flashOpen(); fn(); };
  }

  // Ctrl+B 快速收起 / 展开
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      const open = rail.classList.toggle('open');
      rail.classList.toggle('locked', !open);
      if (toggle) toggle.dataset.label = open ? t('rail.menuClose') : t('rail.menuOpen');
    }
  });
}

function renderLangSelect() {
  // 固定格式单据（报关单 / 提单 / 水单）栏目名是中英对照、不接多语言模板 →
  // 下拉只给中文 / 英文，并在旁边说明，免得用户以为"切了语言没反应 = 坏了"
  const type = state.doc && state.doc.type;
  const list = docLangChoices(type);
  const fixed = isFixedFormatDoc(type);
  el.previewLang.innerHTML = list
    .map((l) => `<option value="${l.code}">${esc(langOptionLabel(l))}</option>`)
    .join('');
  el.previewLang.title = fixed ? '此单据是固定格式（中英对照），只提供中文 / 英文' : t('lang.title');
  const hint = document.getElementById('langFixedHint');
  if (hint) {
    hint.hidden = !fixed;
    hint.textContent = fixed ? '固定格式 · 中英对照' : '';
  }
}

/* ============================ 主题配色 ============================ */

/** 主题只改 html[data-theme]，CSS 变量与单据颜色都由它驱动 */
function applyTheme(code) {
  state.theme = code || 'blue';
  if (state.theme === 'blue') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', state.theme);
}

/* ============================ 偏好设置（字号等） ============================ */

async function applyStoredPreferences() {
  applyTheme(state.theme);
  applyLayout(state.layout);
  applySplit(state.split);
  applyPreviewVisible(state.previewVisible);
  const bigText = await db.getSetting('bigText', false).catch(() => false);
  if (bigText) document.documentElement.setAttribute('data-bigtext', '1');
  const simple = await db.getSetting('simpleMode', false).catch(() => false);
  document.documentElement.setAttribute('data-simple', simple ? '1' : '0');
  const zoom = await db.getSetting('zoom', null).catch(() => null);
  if (zoom) { state.zoom = Number(zoom) || state.zoom; applyZoom(); }
}

/* ============================ 首次使用引导 ============================ */

/** 全新用户（一条单据都没有）时，在表单区显示三步引导 */
function renderFirstRunGuide(host) {
  host.innerHTML = `
    <div class="firstrun">
      <div class="tt">👋 欢迎使用外贸单证工作台</div>
      <ol>
        <li><b>先填一次公司信息</b>：在「卖方」里填公司名、上传 LOGO 与印章，点「存为常用公司」（或单独点「保存 LOGO」「保存印章」）——以后每张新单自动带上。</li>
        <li><b>做一张报价单</b>：点下面的「报价单」，填客户、加产品行、写数量和单价。</li>
        <li><b>生成其它单据并导出</b>：点「一键生成」做 PI / 合同 / 发票 / 装箱单，点「导出 PDF」发客户。</li>
      </ol>
      <div class="acts">
        <button class="btn btn-primary btn-lg" data-first="quotation">📄 开始做报价单</button>
        <button class="btn btn-lg" data-first="help">💡 查看使用帮助</button>
      </div>
      <div class="hint" style="margin-top:10px;font-size:12.5px;color:var(--c-text-mute)">
        数据全部保存在本机，不联网、不上传。记得定期在「设置 → 导出备份」保存一份。
      </div>
    </div>`;
  host.querySelectorAll('[data-first]').forEach((b) => {
    b.onclick = () => {
      const v = b.getAttribute('data-first');
      if (v === 'help') openHelp();
      else newDocument(v);
    };
  });
}

/* ============================ 全量渲染 ============================ */

/* ===== 印章拖动定位：在右侧预览里直接拖印章，位置的存法沿用 stampDX/stampDY ===== */
function bindStampDrag() {
  const paper = el.paper;
  if (!paper || paper._stampDragBound) return;
  paper._stampDragBound = true;
  let drag = null;

  paper.addEventListener('pointerdown', (e) => {
    const el0 = e.target;
    const stampImg = el0 && el0.closest ? el0.closest('img.sign-stamp') : null;
    const signImg = el0 && el0.closest ? el0.closest('img.sign-inline') : null;
    const img = stampImg || signImg;
    if (!img || !state.doc) return;
    e.preventDefault();
    const z = Number(state.zoom) || 1;
    // 印章与签名各存一套偏移字段
    const kind = stampImg ? 'stamp' : 'sign';
    drag = {
      img,
      kind,
      z,
      startX: e.clientX,
      startY: e.clientY,
      baseDX: Number(state.doc[kind + 'DX']) || 0,
      baseDY: Number(state.doc[kind + 'DY']) || 0,
      moved: false,
    };
    img.style.cursor = 'grabbing';
    img.style.willChange = 'transform';
    try { img.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = Math.round(drag.baseDX + (e.clientX - drag.startX) / drag.z);
    const dy = Math.round(drag.baseDY + (e.clientY - drag.startY) / drag.z);
    state.doc[drag.kind + 'DX'] = dx;
    state.doc[drag.kind + 'DY'] = dy;
    drag.img.style.transform = `translate(${dx}px,${dy}px)`;
    const lbId = drag.kind === 'stamp' ? '#stampOffsetLabel' : '#signOffsetLabel';
    const lb = document.querySelector(lbId);
    if (lb) lb.textContent = `${dx}, ${dy}`;
    drag.moved = true;
  });

  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const moved = drag.moved;
    drag.img.style.cursor = '';
    drag.img.style.willChange = '';
    drag = null;
    if (!moved) return;
    try { store.scheduleAutosave(); } catch { /* 忽略 */ }
    try { updatePreview(); } catch { /* 忽略 */ }
  });
}
function renderAll() {
  renderTabs();
  renderMobileDocbar();
  renderForm(el.formHost, updatePreview);
  // 全新用户（无任何单据）时追加三步引导
  if (!state.doc && !state.docs.length) renderFirstRunGuide(el.formHost);
  renderPreview();
  syncLangSelect();
  updateStatusChip();
  renderDraftList();
  renderHistoryButtons();
  updateStatus();
  renderCheckBadge();
  // 明细表按当前编辑区宽度决定「表格 / 卡片」模式
  requestAnimationFrame(() => { try { syncItemsLayout(); } catch { /* 忽略 */ } });
  try { bindStampDrag(); } catch { /* 忽略 */ }

  // UX 增强：分组进度 + 待填面板 + 点单据文字跳到对应输入框
  requestAnimationFrame(() => {
    try {
      // 已回退：不显示分组进度徽标
      // 待填面板已按用户要求移除（太乱）
      // 已按用户要求回退：不显示分段导航
      const paper = el.paper || document.getElementById('paper');
      bindPreviewToForm(paper, el.formHost);
    } catch (err) { /* 增强失败不影响主流程 */ }
  });
}

/** 仅刷新预览（表单输入时高频调用，需保持轻量）
 *  用 rAF 合并高频输入，但页面不可见（后台标签页 / 无头环境）时 rAF 不触发，
 *  因此加一条定时器兜底，保证预览一定会更新 */
let previewRaf = null;
let previewTimer = null;

function updatePreview() {
  // 表单里聚焦某个区块时，用它把右侧对应的块高亮出来（见 flashPreview）
  state._flashPreview = flashPreview;
  if (previewRaf || previewTimer) return;
  previewRaf = requestAnimationFrame(() => {
    previewRaf = null;
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    renderPreview();
    updateStatus();
    updateSaveState('saving');
  });
  previewTimer = setTimeout(() => {
    previewTimer = null;
    if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = null; }
    renderPreview();
    updateStatus();
    updateSaveState('saving');
  }, 150);
}

function renderPreview() {
  if (!state.doc) {
    // 空态由左侧表单区负责引导（那里有唯一的「新建」按钮），
    // 预览区只留一句轻提示，避免同一个新建入口出现两次让人困惑
    const tp = activeType();
    const meta = docMeta(tp);
    el.paper.innerHTML = `<div class="empty-state">
      <div class="ico">${meta.icon}</div>
      <div class="msg" style="line-height:1.9">
        <b>${esc(t(`doc.${tp}`))}</b> 预览区<br>
        <span style="font-size:13px;color:var(--c-text-mute)">从左边的「＋ ${esc(t('btn.new'))}」开始，内容会实时出现在这里</span>
      </div>
      <div class="hint" style="margin-top:16px;font-size:12px;color:var(--c-text-mute);line-height:1.8">
        支持的单据：${visibleDocTypes().map((d) => esc(t(`doc.${d.type}`))).join('　')}
      </div>
    </div>`;
    return;
  }
  // 单据字号（每个单据可单独调）→ 通过 CSS 变量作用到 .doc-root，避免动到纸张尺寸
  const fscale = Number(state.doc.fontScale) > 0 ? Number(state.doc.fontScale) : 1;
  el.paper.style.setProperty('--doc-fs', String(fscale));
  if (el.fontValue) el.fontValue.textContent = Math.round(fscale * 100) + '%';
  el.paper.innerHTML = renderDocument(state.doc);
  // 报关单是横向表格（A4 横向），纸张要跟着变宽，否则 9 个栏目挤在纵向 A4 里全糊成一团
  const wantLandscape = !!docMeta(state.doc.type).landscape;
  el.paper.classList.toggle('is-landscape', wantLandscape);
  // 横向单据（报关单 / 申报要素表）列多，纸张比预览区宽 → **换成这类单据时**自动"适合宽度"。
  // ⚠️ 只在"类型变化"时做一次：每次 renderAll 都改缩放会把用户手动调的缩放冲掉，
  //    也会影响别的单据的排版测量（自测里就报过列宽被压扁）。
  if (wantLandscape && state._fitType !== state.doc.type) {
    // 进横向单之前先记住原来的缩放，回到纵向单时还回去
    if (!state._fitType) state._zoomBeforeFit = state.zoom;
    state._fitType = state.doc.type;
    setZoom(0, { fit: true });
  } else if (!wantLandscape && state._fitType) {
    state._fitType = '';
    // 还原：否则从横向单切回报价单会一直停留在很小的缩放（自测里就因此量出列宽被压扁）
    if (state._zoomBeforeFit) { const z = state._zoomBeforeFit; state._zoomBeforeFit = 0; setZoom(z); }
  }
  applyZoom();
}

/* ============================ 预览语言下拉 ============================ */

function syncLangSelect() {
  if (!el.previewLang) return;
  const type = state.doc && state.doc.type;
  let lang = state.doc ? state.doc.docLang : state.docLang;
  let coerced = false;
  // 固定格式单据（报关单 / 提单 / 水单）只允许中英：单据上存的是别的语言（比如之前选了法语）
  // 就落到默认值，免得下拉里没有可选项、看着像坏了
  if (isFixedFormatDoc(type)) {
    const ok = docLangChoices(type).some((l) => l.code === lang);
    if (!ok) { lang = fallbackDocLang(type); coerced = true; }
    if (state.doc && state.doc.docLang !== lang) {
      state.doc.docLang = lang;
      try { store.scheduleAutosave(); } catch { /* 自动保存失败不影响显示 */ }
    }
  }
  // 选项按单据类型重建（切换页签时语言的可选范围会变：通用单据 13 种、固定格式 2 种）
  const codes = [...el.previewLang.options].map((o) => o.value).join(',');
  const want = docLangChoices(type).map((l) => l.code).join(',');
  if (codes !== want) renderLangSelect();
  el.previewLang.value = lang;
  if (coerced && !syncLangSelect._warned) {
    syncLangSelect._warned = true;
    try { toast.info('此单据是固定格式（中英对照），语言已切到' + (lang === 'zh' ? '中文' : '英文'), 2600); } catch { /* 忽略 */ }
  }
}

/* ============================ 缩放 ============================ */

/** 判断合同条款是否等于某语言的默认模板（用于语言切换时询问） */
function isDefaultClauses(doc, lang) {
  const list = doc.contractClauses || [];
  if (!list.length) return true;
  const def = getTemplate(lang).defaults?.contractClauses || [];
  if (def.length !== list.length) return false;
  return def.every((d, i) => d.title === list[i].title && d.body === list[i].body);
}

function applyZoom() {
  const z = state.zoom;
  // 用 CSS zoom（布局期缩放）：布局宽度 = 视觉宽度，居中与横向滚动都自然正确。
  // 不要改回 transform: scale —— 那是绘制期缩放，会让纸面布局宽度（794px）
  // 和视觉宽度（794×z）对不上，外壳盒比视觉纸面窄，右边框会被切掉（详见 css/app.css 注释）。
  el.paper.style.zoom = String(z);
  el.paperShell.style.flex = '0 0 auto';
  if (el.zoomValue) el.zoomValue.textContent = `${Math.round(z * 100)}%`;

  requestAnimationFrame(updatePanButtons);

  // 横向单据自动适配期间：窗口变宽变窄都重新算一次，保证整页始终可见
  if (state.doc && docMeta(state.doc.type).landscape && state._fitType === state.doc.type) {
    const MM = 96 / 25.4;
    const avail = el.previewScroll.clientWidth - fitMargin();
    const want = Math.max(0.3, Math.min(1.6, avail / (297 * MM)));
    if (Math.abs(want - state.zoom) > 0.01) {
      state.zoom = want;
      el.paper.style.zoom = String(want);
      if (el.zoomValue) el.zoomValue.textContent = `${Math.round(want * 100)}%`;
    }
  }
}

/**
 * 预览区"左右平移"能力
 *
 * 为什么需要：Windows 的滚动条是覆盖式的，平时不显示，用户找不到（"底部就是没有啊"）。
 * 所以：放大后一旦纸张比可视区宽，就在工具栏显示 ◀ ▶ 两个按钮，并且支持
 *   · 按住预览区拖动（抓手光标）
 *   · Shift + 滚轮
 * 三者都能左右移，不依赖系统滚动条。
 */
function updatePanButtons() {
  const group = $('panGroup');
  const sc = el.previewScroll;
  if (!group || !sc) return;
  // 用户要求：**每个单据**都要有左右滑动入口 → 按钮常驻显示，
  // 没有可横向滚的内容时置灰（而不是把按钮藏起来让人找不到）。
  group.hidden = false;
  const over = sc.scrollWidth > sc.clientWidth + 2;
  const left = $('panLeft');
  const right = $('panRight');
  if (left) left.disabled = !over || sc.scrollLeft <= 0;
  if (right) right.disabled = !over || sc.scrollLeft >= sc.scrollWidth - sc.clientWidth - 1;
  sc.classList.toggle('is-pannable', over);
}

function panBy(dir) {
  const sc = el.previewScroll;
  if (!sc) return;
  const step = Math.max(160, Math.round(sc.clientWidth * 0.6));
  sc.scrollBy({ left: dir * step, behavior: 'smooth' });
  setTimeout(updatePanButtons, 360);   // 平滑滚动结束后刷新按钮状态
}

/**
 * 单据字号（doc.fontScale）
 *
 * 和"预览缩放 state.zoom"是两件事：
 *   · 缩放 = 整张纸放大缩小（看整体版式）
 *   · 字号 = 只改单据里的文字大小（字太小/太大时调字），打印/PDF 同步
 * 存在单据上，每张单单独记。
 */
const FONT_STEPS = [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3];

function currentFontScale() {
  const v = Number(state.doc && state.doc.fontScale);
  return v > 0 ? v : 1;
}

function applyDocFontScale(next) {
  if (!state.doc) return;
  const v = Math.min(1.3, Math.max(0.8, Math.round(next * 100) / 100));
  state.doc.fontScale = v;
  el.paper.style.setProperty('--doc-fs', String(v));
  if (el.fontValue) el.fontValue.textContent = Math.round(v * 100) + '%';
  store.scheduleAutosave();
}

function stepFont(dir) {
  const cur = currentFontScale();
  const i = FONT_STEPS.findIndex((x) => Math.abs(x - cur) < 0.001);
  const idx = i < 0 ? FONT_STEPS.indexOf(1) : i;
  const next = FONT_STEPS[Math.min(FONT_STEPS.length - 1, Math.max(0, idx + dir))];
  applyDocFontScale(next);
}

/** 「适合宽度」需要的水平余量：左右内边距 + 纵向滚动条 + 一点阴影余量 */
function fitMargin() {
  const cs = getComputedStyle(el.previewScroll);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  // 纵向滚动条会吃掉宽度（Windows 上约 15px）
  const sb = el.previewScroll.offsetWidth - el.previewScroll.clientWidth;
  return pad + sb + 2;
}

function setZoom(z, { fit = false } = {}) {
  if (fit) {
    const MM = 96 / 25.4;
    // ⚠️ 早先这里写死 -40，而实际内边距 32 + 滚动条 15 = 47，
    //    于是「适合宽度」后右侧总是差约 17px 被切掉 —— 用户看到的就是「右边框没了」
    const avail = el.previewScroll.clientWidth - fitMargin();
    // 横向纸张（报关单 / 申报要素表）按 A4 横向宽度算，否则「适合宽度」会把横向单子放大到右边被切掉
    const landscape = !!(state.doc && docMeta(state.doc.type).landscape);
    const paperMm = landscape ? 297 : 210;
    state.zoom = Math.max(0.3, Math.min(1.6, avail / (paperMm * MM)));
  } else {
    state._fitType = '';   // 用户手动缩放 → 不再自动适配（否则会被"拉回去"）
    state.zoom = Math.max(0.3, Math.min(1.6, Number(z) || 0.87));
  }
  db.setSetting('zoom', state.zoom);
  applyZoom();
  requestAnimationFrame(() => {
    if (el.previewScroll) el.previewScroll.scrollLeft = 0;
  });
}

/* ============================ 新建 / 生成 / 复制 ============================ */

async function newDocument(type, opts = {}) {
  pushNav(state.doc && state.doc.id);          // 记下当前单据，方便「↩ 返回」
  const doc = await store.createDoc(type, opts);
  // ⚠️ 这里**不能**无条件 fillSample —— 新建单据要真空白（用户反馈：
  // 「直接新建为什么还是有数据的」）。只有设置里勾了「预填一整套示例数据」才填。
  if (state.prefillSample === true) fillSample(doc);
  recalcDoc(doc);              // 重算金额 / 合计
  await store.persistDoc(doc);
  state.doc = doc;
  state.lastType = type;
  emit('doc', doc);
  renderAll();
  renderRevisionList();
  renderHistoryButtons();
  toast.ok(`${t('msg.created')} ${t(`doc.${type}`)} ${doc.docNo}`);
  return doc;
}

async function duplicateCurrent() {
  if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
  pushNav(state.doc.id);
  const copy = await store.duplicateDoc(state.doc.id);
  if (!copy) return;
  state.doc = copy;
  state.lastType = copy.type;
  renderAll();
  renderRevisionList();
  renderHistoryButtons();
  toast.ok(`${t('btn.copy')} → ${copy.docNo}`);
}

/** 单据联动弹层 */
function openGenerateModal() {
  if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
  const render = (body, ref) => {
    body.innerHTML = `
      <div class="field" style="margin-bottom:12px">
        <label>${t('gen.from')}</label>
        <input type="text" value="${esc(`${t(`doc.${state.doc.type}`)} · ${state.doc.docNo}`)}" readonly />
      </div>
      <div class="field" style="margin-bottom:14px">
        <label>${t('gen.to')}</label>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          ${visibleDocTypes().filter((d) => d.type !== state.doc.type).map((d) => `
            <button class="btn" data-gen="${d.type}">${d.icon} ${esc(t(`doc.${d.type}`))}</button>`).join('')}
        </div>
      </div>
      <div class="hint" style="font-size:12px;color:var(--c-text-mute)">${t('gen.hint')}</div>`;
    body.querySelectorAll('[data-gen]').forEach((b) => {
      b.onclick = async () => {
        const target = b.getAttribute('data-gen');
        ref.close();
        const doc = await store.generateFrom(state.doc, target);
        if (!doc) return;
        state.doc = doc;
        renderAll();
        renderRevisionList();
        toast.ok(`${t('msg.genDone')} → ${doc.docNo}`);
      };
    });
  };
  const ref = openModal({ title: `🔗 ${t('gen.title')}`, body: document.createElement('div'), width: '560px' });
  render(ref.body, ref);
}


/**
 * 「按柜拆分生成箱单」确认弹窗
 * 勾选要生成的柜 → 确认 → 每个柜生成一张草稿箱单（每柜一张），可选择同时保留母单。
 */
function openSplitByContainerDialog(src, usable, unassigned, report) {
  const ref = openModal({ title: '🚢 按柜拆分生成箱单', body: document.createElement('div'), width: '620px' });
  const rows = usable.map((r) => `<tr>
      <td><input type="checkbox" data-split-ctn="${r.idx}" checked style="width:auto" /></td>
      <td>${esc(r.ctn.no || '(未填柜号)')}</td>
      <td>${esc(r.ctn.seal || '—')}</td>
      <td>${esc(r.ctn.type || '—')}</td>
      <td class="num">${r.rows} 行</td>
      <td class="num">${r.ctns} 件</td>
    </tr>`).join('');
  ref.body.innerHTML = `
    <div class="hint" style="margin-bottom:10px">
      将按柜生成 <b>独立箱单</b>（草稿）：每张只有该柜的明细，单头自动带柜号/封号/柜型，合计按本柜重新计算。
    </div>
    <table class="ctn-split-table">
      <thead><tr><th style="width:34px"></th><th>柜号</th><th>封号</th><th>柜型</th><th class="num">明细</th><th class="num">件数</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${unassigned.length ? `<div class="hint" style="margin-top:8px;color:#b45309">⚠ 还有 ${unassigned.length} 行没选柜（会另外生成一张「未分配柜」箱单，避免漏箱）</div>` : ''}
    <div class="hint" style="margin-top:10px">源箱单：<b>${esc(src.docNo || '')}</b>（母单保留不动，子单备注里会写「由母单拆分生成」）</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn" data-split-cancel="1">取消</button>
      <button class="btn btn-primary" data-split-ok="1">生成箱单</button>
    </div>`;
  const close = () => { try { ref.close(); } catch { /* 忽略 */ } };
  ref.body.querySelector('[data-split-cancel]').onclick = close;
  ref.body.querySelector('[data-split-ok]').onclick = async () => {
    const picked = [...ref.body.querySelectorAll('[data-split-ctn]')]
      .filter((x) => x.checked)
      .map((x) => Number(x.getAttribute('data-split-ctn')));
    if (!picked.length) { toast.warn('至少勾选一个柜', 2400); return; }
    close();
    // 只把这些柜交给拆分函数（**不改动母单**）
    const pickedIds = report.filter((r) => picked.includes(r.idx)).map((r) => r.ctn.id);
    const res = await store.splitPackingByContainer(src, { include: pickedIds });
    if (!res.docs.length) { toast.warn('没有可拆分的柜（明细里还没分配柜）', 3000); return; }
    toast.ok(`已生成 ${res.docs.length} 张箱单：${res.docs.map((d) => d.docNo).join('、')}`, 5000);
    renderAll();
    try { renderDraftList(); } catch { /* 列表刷新失败不影响拆分 */ }
    if (res.docs[0]) { await store.openDoc(res.docs[0].id); renderAll(); }
  };
}

/* ============================ 保存状态 / 状态栏 ============================ */

function updateSaveState(s) {
  const cur = s || state.saveState;
  const label = cur === 'saving' ? '保存中…' : cur === 'error' ? '保存失败' : t('msg.autoSaved');
  el.saveState.className = `save-state${cur === 'saving' ? ' saving' : ''}`;
  el.saveState.innerHTML = `● <span>${esc(label)}</span>`
    + (cur === 'saved' && state.lastSavedAt ? `<span class="sub" style="color:var(--c-text-mute);margin-left:4px">${esc(timeAgo(state.lastSavedAt))}</span>` : '');
}

function updateStatus() {
  if (state.doc) {
    const items = state.doc.items.length;
    el.statusDoc.textContent = `${t(`doc.${state.doc.type}`)} · ${state.doc.docNo || '—'} · ${items} ${t('sum.items')} · ${state.doc.currency} ${state.doc.totals.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else {
    el.statusDoc.textContent = `${state.docs.filter((d) => !isDocTypeHidden(d.type)).length} ${t('drafts.title')}`;
  }
}

function updateNetState() {
  const online = navigator.onLine;
  el.netDot.className = `dot${online ? '' : ' off'}`;
  el.netState.textContent = online ? t('pwa.online') : t('pwa.offlineNow');
}

async function updateStorageInfo() {
  const { usage, quota } = await db.estimateUsage();
  if (usage) {
    $('statusStore').textContent = `${t('set.usage')}: ${bytes(usage)}${quota ? ` / ${bytes(quota)}` : ''} · ${t('msg.storageOk')}`;
  }
  const persistent = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  void persistent;
}

/**
 * 底部状态栏显示「版本 + 构建日期」。
 *
 * 为什么要在界面上露出版本号：用户装了两份（旧的没卸干净、或便携版和安装版并存）时，
 * 极易出现「我装了新版怎么还是旧界面」的困惑 —— 有版本号一眼就能对比。
 * 桌面版还会显示 Electron/Chrome 版本，方便排查渲染问题。
 */
function showBuildTag() {
  const el = $('buildTag');
  if (!el) return;
  const desktop = /TradeDocsDesktop/.test(navigator.userAgent);
  const chrome = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || '';
  // 版本串里带上版本类型，一眼能看出跑的是客户版还是内部无限制版
  const ed = EDITION === 'licensed' ? '激活版' : '无限制版';
  el.textContent = `v${APP_VERSION} · ${ed}${desktop ? ' · 桌面版' : ''}${chrome ? ` · Chrome ${chrome}` : ''} · ${BUILD_DATE}`;
  el.title = `版本 ${APP_VERSION}（${ed}）\n构建日期 ${BUILD_DATE}`
    + (desktop ? '\n运行方式：桌面应用（Electron）' : '\n运行方式：浏览器')
    + (chrome ? `\n渲染引擎：Chrome ${chrome}` : '')
    + (EDITION === 'licensed' ? '\n授权：12 小时试用 + 通用激活码' : '\n授权：内部无限制版，不弹激活');
}

async function reportStorageNote() {
  const granted = await db.requestPersistent().catch(() => false);
  void granted;
  if (!navigator.onLine) updateNetState();
  showBuildTag();
}

/* ============================ 状态标识（草稿 / 已保存） ============================ */

function updateStatusChip() {
  const doc = state.doc;
  if (!doc) {
    el.statusChip.dataset.status = 'none';
    el.statusChip.textContent = '';
    el.btnMarkSaved.hidden = true;
    el.btnBackDraft.hidden = true;
    return;
  }
  const isSaved = doc.status === 'saved';
  el.statusChip.dataset.status = isSaved ? 'saved' : 'draft';
  el.statusChip.innerHTML = isSaved
    ? `<span>${t('status.saved')}</span><span class="sub">${t('status.savedHint')}</span>`
    : `<span>${t('status.draft')}</span><span class="sub">${t('status.draftHint')}</span>`;
  el.btnMarkSaved.hidden = isSaved;
  el.btnBackDraft.hidden = !isSaved;
}

/** 标记为已保存单据（带完整性检查与友好提示） */
/* =============================================================
 * 单据检查（校验）：编号重复 / 负数额 / 日期倒挂 / 格式错误 …
 * 结果按 error / warn / info 分组，点一条直接跳到出问题的输入框
 * ============================================================= */

/** 字段路径 → 中文位置说明，让用户知道去哪改 */
function fieldWhere(field) {
  const table = {
    docNo: '基础信息 · 单据编号',
    date: '基础信息 · 单据日期',
    validUntil: '基础信息 · 有效期至',
    currency: '基础信息 · 币种',
    exchangeRate: '基础信息 · 汇率',
    paymentTerms: '基础信息 · 付款方式',
    incoterms: '基础信息 · 贸易术语',
    discount: '价格与费用 · 折扣',
    taxRate: '价格与费用 · 税率',
    shippingFee: '价格与费用 · 运费',
    insuranceFee: '价格与费用 · 保险费',
    otherFee: '价格与费用 · 其它费用',
    toolingFee: '价格与费用 · 模具费',
    grandTotal: '价格与费用 · 总计',
    'totals.grandTotal': '价格与费用 · 总计',
    'totals.totalGw': '明细合计 · 总毛重',
    'totals.totalQty': '明细合计 · 总件数',
    items: '产品明细',
    remarks: '条款与备注 · 备注',
    terms: '条款与备注 · 条款',
    marks: '产品明细 · 唛头',
    countryOfOrigin: '单据参考与路线 · 原产国',
    invoiceNo: '单据参考与路线 · 发票号码',
    invoiceDate: '单据参考与路线 · 发票日期',
    routeFrom: '单据参考与路线 · 起运地',
    routeTo: '单据参考与路线 · 目的地',
    totalPackedText: '单据参考与路线 · 合计包装说明',
    lcNo: '单据参考与路线 · 信用证号',
    contractNo: '单据参考与路线 · 合同号码',
    sameAsBuyerConsignee: '客户与收货人 · 收货人同买方',
    'bank.swift': '收款银行 · SWIFT',
    'bank.iban': '收款银行 · IBAN',
  };
  if (table[field]) return table[field];
  let m = /^items\.(\d+)\.(\w+)$/.exec(field || '');
  if (m) {
    const cn = {
      description: '品名及描述', qty: '数量', unitPrice: '单价', amount: '金额',
      nw: '净重', gw: '毛重', meas: '体积', ctns: '件数', unit: '单位', model: '型号',
    }[m[2]] || m[2];
    return `产品明细 第 ${Number(m[1]) + 1} 行 · ${cn}`;
  }
  m = /^(seller|buyer|consignee|notify)\.(\w+)$/.exec(field || '');
  if (m) {
    const who = { seller: '卖方', buyer: '买方', consignee: '收货人', notify: '通知方' }[m[1]];
    const cn = {
      companyName: '公司名称', email: '邮箱', tel: '电话', fax: '传真', country: '国家',
      taxId: '税号', address: '地址', city: '城市', state: '州 / 省', zip: '邮编', contact: '联系人',
    }[m[2]] || m[2];
    return `${who} · ${cn}`;
  }
  return field || '';
}

/** 当前单据的校验结果 */
function currentChecks() {
  const doc = state.doc;
  if (!doc) return [];
  const others = (state.docs || []).map((d) => ({ id: d.id, type: d.type, docNo: d.docNo }));
  return validateDoc(doc, { otherDocs: others, today: today() });
}

/** 刷新按钮角标：不打开面板也能看到有没有问题 */
function renderCheckBadge() {
  const btn = $('btnCheck');
  const badge = $('checkBadge');
  if (!btn || !badge) return;
  const c = countByLevel(currentChecks());
  const total = c.error + c.warn;
  if (!total) {
    btn.dataset.ok = '1';
    delete btn.dataset.warn;
    badge.hidden = true;
  } else {
    delete btn.dataset.ok;
    if (c.error) delete btn.dataset.warn; else btn.dataset.warn = '1';
    badge.hidden = false;
    badge.textContent = String(total);
  }
}

function closeCheckPanel() {
  const p = $('checkPanel');
  if (p && p.hidePopover && p.matches(':popover-open')) p.hidePopover();
}

/** 跳到出问题的输入框并高亮闪一下 */
function jumpToField(field) {
  closeCheckPanel();
  if (!field) return;
  let el = null;
  try { el = document.querySelector(`#formHost [data-bind="${CSS.escape(field)}"]`); } catch { el = null; }
  if (!el && /^items\.\d+\./.test(field)) {
    const rowIdx = Number(field.split('.')[1]);
    const rows = document.querySelectorAll('#formHost tr[data-row], #formHost .item-card');
    el = rows[rowIdx]?.querySelector('input, textarea, select') || null;
  }
  if (!el && /^(seller|buyer|consignee|notify)\./.test(field)) {
    const key = field.split('.')[1];
    el = document.querySelector(`#formHost [data-bind$=".${key}"]`);
  }
  if (!el) {
    const sectionKey = field.startsWith('items') ? 'items' : (field.startsWith('bank') ? 'bank' : null);
    el = sectionKey ? document.querySelector(`#formHost [data-section="${sectionKey}"]`) : null;
  }
  if (!el) { toast.info(t('check.located')); return; }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const target = el.closest('.fld') || el;
  target.classList.remove('field-flash');
  void target.offsetWidth;          // 强制重排，让动画能重复播放
  target.classList.add('field-flash');
  setTimeout(() => target.classList.remove('field-flash'), 1900);
  if (typeof el.focus === 'function') { try { el.focus({ preventScroll: true }); } catch { el.focus(); } }
}

/** 渲染校验结果列表 */
function renderCheckList(list) {
  const body = $('checkBody');
  if (!body) return;
  if (!list.length) {
    body.innerHTML = `<div class="check-empty"><span class="big">✅</span>${esc(t('check.allGood'))}</div>`;
    return;
  }
  const groups = [['error', t('check.levelError')], ['warn', t('check.levelWarn')], ['info', t('check.levelInfo')]];
  const html = [];
  for (const [level, label] of groups) {
    const rows = list.filter((x) => x.level === level);
    if (!rows.length) continue;
    html.push(`<div class="check-group">${esc(label)}（${rows.length}）</div>`);
    for (const x of rows) {
      const where = fieldWhere(x.field);
      html.push(`<button type="button" class="check-item" data-level="${level}" data-field="${esc(x.field)}">
        <span class="dot"></span>
        <span class="txt">${esc(x.msg)}${where ? `<span class="where">${esc(where)}</span>` : ''}</span>
      </button>`);
    }
  }
  body.innerHTML = html.join('');
  body.querySelectorAll('.check-item').forEach((btn) => {
    btn.onclick = () => jumpToField(btn.getAttribute('data-field'));
  });
}

/** 跑一次校验；popup=true 时打开面板 */
function runCheck(popup) {
  const list = currentChecks();
  renderCheckBadge();
  if ($('checkSum')) $('checkSum').textContent = summaryText(list);
  renderCheckList(list);
  if (popup) openCheckPanel();
  return list;
}

function openCheckPanel() {
  const panel = $('checkPanel');
  if (!panel) return;
  refreshChecks();
  if (panel.showPopover && !panel.matches(':popover-open')) panel.showPopover();

  // 等一帧让面板量出真实高度，再定位（否则高度算错会把面板顶到屏幕外）
  positionCheckPanel();
  requestAnimationFrame(positionCheckPanel);
  setTimeout(positionCheckPanel, 60);   // 无头 / 后台标签页 rAF 不触发时的兜底
}

function toggleCheckPanel() {
  const panel = $('checkPanel');
  if (panel && panel.matches(':popover-open')) closeCheckPanel();
  else openCheckPanel();
}

/** 强制重算并刷新检查结果（面板开着时用；单据切换 / 输入变化后调用） */
function refreshChecks() {
  const panel = $('checkPanel');
  const list = currentChecks();
  renderCheckBadge();
  if ($('checkSum')) $('checkSum').textContent = summaryText(list);
  renderCheckList(list);
  if (panel && panel.matches(':popover-open')) positionCheckPanel();
  return list;
}

/** 面板定位（独立出来，便于刷新时重新摆位） */
function positionCheckPanel() {
  const panel = $('checkPanel');
  const btn = $('btnCheck');
  if (!panel) return;
  const r = (btn || panel).getBoundingClientRect();
  const h = panel.offsetHeight || 0;
  const w = panel.offsetWidth || 560;
  // 优先放在检查按钮上方；上方放不下就放下方；都放不下就贴顶
  let top = r.top - h - 8;
  if (top < 10) {
    const below = r.bottom + 8;
    top = (below + h <= window.innerHeight - 10) ? below : 10;
  }
  panel.style.top = Math.round(top) + 'px';
  panel.style.bottom = 'auto';
  panel.style.left = Math.max(10, Math.min(r.left, window.innerWidth - w - 10)) + 'px';
}

/** 保存前拦截：有必须修改的问题时让用户确认（不硬拦，免得耽误急事） */
function checkBeforeSave() {
  const list = currentChecks();
  const c = countByLevel(list);
  renderCheckBadge();
  if (!c.error) return true;
  const first = list.find((x) => x.level === 'error');
  const more = c.error - 1;
  return window.confirm(
    `这张单据有 ${c.error} 处必须修改的问题：\n\n· ${first.msg}${more > 0 ? `\n· 还有 ${more} 处…` : ''}\n\n仍然要标记为已保存吗？（建议先点「检查」修好再保存）`);
}

async function markCurrentSaved() {
  if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
  await store.flushAutosave().catch(() => null);
  // 保存前先跑一遍校验：有必须修改的问题就让用户确认（不硬拦，避免耽误急事）
  if (!checkBeforeSave()) return;
  const res = await store.markDocSaved(state.doc);
  if (!res.ok) {
    const map = {
      'no-number': 'msg.needNumberSaved',
      'no-seller': 'msg.needSeller',
      'no-buyer': 'msg.needBuyer',
      'no-items': 'msg.needItems',
      'no-doc': 'msg.needDoc',
    };
    toast.warn(t(map[res.reason] || 'msg.needDoc'), 3600);
    // 定位到需要补的区块
    const focusMap = {
      'no-seller': 'seller', 'no-buyer': 'buyer', 'no-items': 'items', 'no-number': 'basic',
    };
    const section = el.formHost.querySelector(`[data-section="${focusMap[res.reason]}"]`);
    if (section) {
      section.classList.remove('collapsed');
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }
  updateStatusChip();
  renderTabs();
  renderDraftList();
  toast.ok(t('msg.markedSaved'), 3000);
}

async function backToDraft() {
  if (!state.doc) return;
  await store.markDocDraft(state.doc);
  updateStatusChip();
  renderTabs();
  renderDraftList();
  toast.info(t('msg.backToDraft'));
}

/* ============================ 草稿抽屉 ============================ */

let draftTab = 'draft';
let draftTypeFilter = 'all';

function openDrawer(which) {
  closeDrawers();
  if (which === 'drafts') {
    el.drawerDrafts.classList.add('open');
    renderDraftList($('draftSearch').value);
    renderRevisionList();
  } else {
    el.drawerLibrary.classList.add('open');
    renderLibraryDrawer();
  }
}

function closeDrawers() {
  el.drawerDrafts.classList.remove('open');
  el.drawerLibrary.classList.remove('open');
}

/* ============================ 单据搜索 ============================ */

/** 归一化：忽略大小写、空格、横杠、下划线、斜杠（这样 SC001 也能搜到 SC-001） */
function normSearch(s) {
  return String(s || '').toLowerCase().replace(/[\s\-_/\\]+/g, '');
}

/** 一枚单据上所有「可以拿来搜」的内容：本单编号 + 各类参考号 + 买卖双方 */
function docSearchText(d) {
  return [
    d.docNo,
    d.contractNo, d.invoiceNo, d.piNo, d.poNo, d.lcNo, d.awbNo, d.bookingNo,
    d.containerNo, d.policyNo, d.consignmentNo, d.goodsReferenceNo, d.shipperRef,
    d.customerCode,
    d.buyer?.companyName, d.buyer?.contact,
    d.seller?.companyName,
  ].filter(Boolean).join(' ');
}

/**
 * 匹配等级：3 = 精准（编号完全一致）、2 = 编号前缀、1 = 命中其它内容、0 = 不匹配
 * 用户诉求：输片段就把相关都列出来，输全了就是精准搜索
 */
function matchRank(d, q) {
  const nq = normSearch(q);
  if (!nq) return 0;
  const no = normSearch(d.docNo);
  if (no && no === nq) return 3;
  if (no && no.startsWith(nq)) return 2;
  if (normSearch(docSearchText(d)).includes(nq)) return 1;
  return 0;
}

/** 按相关性排序：精准 > 编号前缀 > 其它；同级按最近修改 */
function sortByRelevance(list, q) {
  return list
    .map((d) => ({ d, rank: matchRank(d, q) }))
    .filter((x) => x.rank > 0)
    .sort((a, b) => (b.rank - a.rank) || ((b.d.updatedAt || 0) - (a.d.updatedAt || 0)));
}

/** 单据类型筛选条（草稿箱里按类型分开）—— 只列**显示中的类型**，隐藏的类型连按钮都不给 */
function renderTypeChips(pool) {
  if (!el.docTypeChips) return;
  const counts = {};
  for (const d of DOC_TYPES) counts[d.type] = 0;
  for (const doc of pool) counts[doc.type] = (counts[doc.type] || 0) + 1;

  // 隐藏的类型（检验证书 / 熏蒸证书 / 受益人证明 / 发货人委托 / 保险单 / 成本估算 / 原产地证明）
  // 一律不出现，包括"手里已经有这类单据"的情况 —— 用户说过暂时不需要它们。
  // 单据本身**不删**，以后把类型放出来（改 HIDDEN_DOC_TYPES）就能重新看到。
  const chips = [
    { key: 'all', label: '全部', icon: '📚', n: pool.length },
    ...visibleDocTypes().map((d) => ({ key: d.type, label: t(`doc.${d.type}`), icon: d.icon, n: counts[d.type] || 0 })),
  ];
  el.docTypeChips.innerHTML = chips.map((c) => `
    <button data-ftype="${c.key}" class="${draftTypeFilter === c.key ? 'active' : ''}">
      <span>${c.icon}</span><span>${esc(c.label)}</span><span class="n">${c.n}</span>
    </button>`).join('');

  el.docTypeChips.querySelectorAll('[data-ftype]').forEach((b) => {
    b.onclick = () => {
      draftTypeFilter = b.getAttribute('data-ftype');
      renderDraftList($('draftSearch').value);
    };
  });
}

function renderDraftList(filter = '') {
  const q = filter.trim();
  const searching = !!q;
  // 只列**显示中的类型**：隐藏类型的单据（检验/熏蒸/受益人证明/发货人委托/保险单/成本估算/原产地证明）
  // 不出现在草稿箱、也不出现在搜索结果里。数据仍在库里，没有删除。
  const visible = (list) => list.filter((d) => !isDocTypeHidden(d.type));
  const drafts = visible(store.draftDocs());
  const saved = visible(store.savedDocs());

  if (el.cntDraft) el.cntDraft.textContent = String(drafts.length);
  if (el.cntSaved) el.cntSaved.textContent = String(saved.length);
  if (el.draftTabs) {
    el.draftTabs.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === draftTab);
    });
  }

  // 有搜索词时**同时搜草稿与已保存**：单据一旦「标记为已保存」就换了页签，
  // 只搜当前页签的话用户会觉得「保存完就搜不到了」。
  const pool = searching ? [...drafts, ...saved] : (draftTab === 'saved' ? saved : drafts);
  // 按钮上的数字按「全部可见单据」统计（草稿 + 已保存），别让切换页签后每个类型都显示 0
  renderTypeChips([...drafts, ...saved]);

  const ranked = searching
    ? sortByRelevance(pool.filter((d) => draftTypeFilter === 'all' || d.type === draftTypeFilter), q)
    : pool
      .filter((d) => draftTypeFilter === 'all' || d.type === draftTypeFilter)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((d) => ({ d, rank: 0 }));
  const rows = ranked.map((x) => x.d);
  const rankOf = new Map(ranked.map((x) => [x.d.id, x.rank]));

  const note = searching
    ? `<div class="search-note" data-search-note="1">
        ${t('drafts.searchScope', { n: rows.length, exact: ranked.filter((x) => x.rank === 3).length })}
        ${rows.length ? `<span class="hint">${esc(t('drafts.searchEnter'))}</span>` : ''}
      </div>`
    : '';

  if (!rows.length) {
    const byType = draftTypeFilter !== 'all' ? `「${t(`doc.${draftTypeFilter}`)}」` : '';
    const msg = searching
      ? `没有找到匹配「${esc(q)}」的单据。<br>可以试：单号片段（如 001）、客户名、PO / 合同号 / 提单号。`
      : draftTab === 'saved'
        ? (byType ? `${byType}还没有已保存的单据。` : '还没有「已保存单据」。')
          + '<br>单据填好后点左上角「标记为已保存」，就会归到这里。'
        : (byType ? `${byType}还没有草稿。` : '还没有草稿。')
          + '<br>点顶部「＋ 新建」开始做第一张单。';
    el.draftList.innerHTML = note + `<div class="empty-state" style="padding:22px">
      <div class="ico">${searching ? '🔍' : (draftTab === 'saved' ? '✅' : '🗂')}</div>
      <div class="msg" style="line-height:1.8">${msg}</div></div>`;
    return;
  }

  // 按单据类型分组显示，一眼看清各类单据放在一起
  const groups = [];
  for (const type of DOC_TYPES.map((d) => d.type)) {
    const list = rows.filter((d) => d.type === type);
    if (list.length) groups.push({ type, list });
  }
  const others = rows.filter((d) => !DOC_TYPES.some((x) => x.type === d.type));
  if (others.length) groups.push({ type: '__other', list: others });

  el.draftList.innerHTML = note + groups.map((g) => `
    <div class="draft-group">
      <div class="draft-group-head">
        <span>${g.type === '__other' ? '📁' : docMeta(g.type).icon} ${esc(g.type === '__other' ? '其它' : t(`doc.${g.type}`))}</span>
        <span class="n">${g.list.length}</span>
      </div>
      ${g.list.map((d) => draftItemHtml(d, rankOf.get(d.id) === 3)).join('')}
    </div>`).join('');

  bindDraftListEvents();
}

/** 单条单据卡片；exact=true 表示这枚单号被完全输入（精准命中） */
function draftItemHtml(d, exact = false) {
  const isSaved = d.status === 'saved';
  const items = (d.items || []).filter((x) => String(x.description || '').trim()).length;
  return `
    <div class="draft-item${state.doc && state.doc.id === d.id ? ' active' : ''}${exact ? ' exact' : ''}" data-id="${d.id}">
      <div class="r1">
        <span class="badge ${isSaved ? 'badge-saved' : 'badge-draft'}">${isSaved ? t('status.saved') : t('status.draft')}</span>
        <span>${esc(d.docNo || '—')}</span>
        ${exact ? `<span class="badge badge-exact">${t('drafts.exact')}</span>` : ''}
        <div class="spacer"></div>
        <button class="mini-btn" data-dup="${d.id}" title="${t('btn.copy')}">⧉</button>
        <button class="mini-btn danger" data-del="${d.id}" title="${t('btn.delete')}">✕</button>
      </div>
      <div class="r2">
        <span>${esc(d.buyer?.companyName || '—')}</span>
        <span>${esc(d.date || '')}</span>
        <span>${items} 行 ${esc(d.currency || '')} ${(d.totals?.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <div class="spacer" style="flex:1"></div>
        <span style="color:var(--c-text-mute)">${esc(timeAgo(d.updatedAt))}</span>
      </div>
    </div>`;
}

function bindDraftListEvents() {
  el.draftList.querySelectorAll('.draft-item').forEach((item) => {
    item.addEventListener('click', async (e) => {
      if (e.target.closest('[data-dup]') || e.target.closest('[data-del]')) return;
      await store.flushAutosave().catch(() => null);
      const doc = await store.openDoc(item.getAttribute('data-id'));
      if (doc) { renderAll(); renderRevisionList(); }
      if (window.matchMedia('(max-width: 1080px)').matches) closeDrawers();
    });
  });
  el.draftList.querySelectorAll('[data-dup]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const copy = await store.duplicateDoc(b.getAttribute('data-dup'));
      if (copy) {
        state.doc = copy;
        draftTab = 'draft';
        draftTypeFilter = 'all';
        renderAll();
        renderRevisionList();
        toast.ok(`${t('btn.copy')} → ${copy.docNo}（${t('status.draft')}）`);
      }
    });
  });
  el.draftList.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!(await confirmModal(t('msg.confirmDelete')))) return;
      await store.removeDoc(b.getAttribute('data-del'));
      if (!state.doc) renderAll();
      else { renderTabs(); updateStatusChip(); }
      renderDraftList($('draftSearch').value);
      toast.ok(t('msg.deleted'));
    });
  });
}

/**
 * 历史快照列表
 *
 * 界面暂时隐藏（见 index.html 的 #revisionSection[hidden]），
 * 但数据层照旧在写快照（store 里的 saveRevision 没动），所以历史不丢；
 * 后续要放出来时，把 index.html 里的 hidden 去掉即可。
 * 这里在最前面挡一道：区块不可见就完全不查库，省掉一次 IndexedDB 往返。
 */
const SNAPSHOT_UI_VISIBLE = false;

async function renderRevisionList() {
  const section = document.getElementById('revisionSection');
  if (!SNAPSHOT_UI_VISIBLE || !section || section.hidden || !el.revisionList) return;

  if (!state.doc) {
    el.revisionList.innerHTML = `<div class="empty-state" style="padding:18px"><div class="msg">${t('msg.noData')}</div></div>`;
    if (el.revCount) el.revCount.textContent = '';
    return;
  }
  const rows = await store.listRevisions(state.doc.id);
  if (el.revCount) el.revCount.textContent = `${rows.length}`;
  if (!rows.length) {
    el.revisionList.innerHTML = `<div class="empty-state" style="padding:18px"><div class="msg">${t('msg.noData')}</div></div>`;
    return;
  }
  el.revisionList.innerHTML = rows.map((r) => `
    <div class="draft-item" style="cursor:default">
      <div class="r1"><span class="badge">${esc(r.label || '')}</span><span>${esc(timeAgo(r.createdAt))}</span>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-restore="${r.id}">${t('drafts.restore')}</button>
      </div>
    </div>`).join('');
  el.revisionList.querySelectorAll('[data-restore]').forEach((b) => {
    b.addEventListener('click', async () => {
      const yes = await confirmModal('恢复该快照会覆盖当前内容（当前内容仍可通过自动快照找回），继续？');
      if (!yes) return;
      const doc = await store.restoreRevision(b.getAttribute('data-restore'), state.doc.id);
      if (doc) { renderAll(); renderRevisionList(); toast.ok('已恢复该版本'); }
    });
  });
}

/* ============================ 模板库抽屉 ============================ */

function renderLibraryDrawer() {
  // 分段页签计数
  if (el.cntProfiles) el.cntProfiles.textContent = String(state.profiles.length);
  if (el.cntCustomers) el.cntCustomers.textContent = String(state.customers.length);
  if (el.cntProducts) el.cntProducts.textContent = String(state.products.length);
  if (el.cntClauses) el.cntClauses.textContent = String(state.clauses.length);
  if (el.cntBanks) el.cntBanks.textContent = String((state.banks || []).length);

  /* --- 常用公司（卖方抬头历史，可增删改） --- */
  const pHost = $('libProfiles');
  if (pHost) {
    pHost.innerHTML = state.profiles.length
      ? state.profiles.map((p) => `<div class="lib-row">
          <div class="info"><div class="nm">${esc(p.companyName)}</div>
          <div class="sub">${esc([p.city, p.country, p.contact, p.tel].filter(Boolean).join(' · ') || '（未填地址）')}</div></div>
          ${state.doc ? `<button class="btn btn-sm btn-primary" data-usepro="${p.id}">${t('btn.apply')}</button>` : ''}
          <button class="mini-btn" data-editpro="${p.id}" title="修改">✏️</button>
          <button class="mini-btn danger" data-delpro="${p.id}" title="删除">✕</button>
        </div>`).join('')
      : `<div class="hint" style="font-size:12px;color:var(--c-text-mute);line-height:1.7">
           还没有常用公司。点「＋」新增，或在单据卖方区填好后点「存为常用公司」。<br>
           建好后在卖方区点「从常用公司选择」就能一键填好整栏。</div>`;

    pHost.querySelectorAll('[data-usepro]').forEach((b) => b.addEventListener('click', () => {
      const row = state.profiles.find((p) => p.id === b.getAttribute('data-usepro'));
      if (!row || !state.doc) return;
      state.doc.seller = { ...emptyParty(), ...state.doc.seller, ...row };
      renderForm(el.formHost, updatePreview); updatePreview(); store.scheduleAutosave();
      toast.ok('已填入：' + row.companyName);
    }));
    pHost.querySelectorAll('[data-editpro]').forEach((b) => b.addEventListener('click', () => {
      openProfileEditor(b.getAttribute('data-editpro'), null, () => renderLibraryDrawer());
    }));
    pHost.querySelectorAll('[data-delpro]').forEach((b) => b.addEventListener('click', async () => {
      const row = state.profiles.find((p) => p.id === b.getAttribute('data-delpro'));
      if (!(await confirmModal(`确定删除常用公司「${row?.companyName || ''}」吗？`))) return;
      await store.removeProfile(b.getAttribute('data-delpro'));
      toast.ok(t('msg.deleted'));
      renderLibraryDrawer();
    }));
  }

  /* --- 收款银行库 --- */
  const bHost = $('libBanks');
  if (bHost) {
    const banks = state.banks || [];
    bHost.innerHTML = banks.length
      ? banks.map((b) => `<div class="lib-row">
          <div class="info"><div class="nm">${esc(b.bankName || b.name || '')}</div>
          <div class="sub">${esc([b.beneficiary, b.accountNo, b.swiftCode].filter(Boolean).join(' · ') || '（未填账号）')}</div></div>
          ${state.doc ? `<button class="btn btn-sm btn-primary" data-usebank="${b.id}">${t('btn.apply')}</button>` : ''}
          <button class="mini-btn" data-editbank="${b.id}" title="修改">✏️</button>
          <button class="mini-btn danger" data-delbank="${b.id}" title="删除">✕</button>
        </div>`).join('')
      : `<div class="hint" style="font-size:12px;color:var(--c-text-mute);line-height:1.7">
          还没有收款银行。点「＋」新增，或在单据「银行信息」填好后点「当前银行」存进来。<br>
          存好后在银行信息区点「🏦 从银行库选择」一键填好。</div>`;

    bHost.querySelectorAll('[data-usebank]').forEach((btn) => btn.addEventListener('click', () => {
      const row = (state.banks || []).find((x) => x.id === btn.getAttribute('data-usebank'));
      if (!row || !state.doc) return;
      state.doc.bank = { ...(state.doc.bank || {}), ...row };
      renderForm(el.formHost, updatePreview); updatePreview(); store.scheduleAutosave();
      toast.ok('已填入银行：' + (row.bankName || ''));
    }));
    bHost.querySelectorAll('[data-editbank]').forEach((btn) => btn.addEventListener('click', () => {
      openBankEditor(btn.getAttribute('data-editbank'), null, () => renderLibraryDrawer());
    }));
    bHost.querySelectorAll('[data-delbank]').forEach((btn) => btn.addEventListener('click', async () => {
      const row = (state.banks || []).find((x) => x.id === btn.getAttribute('data-delbank'));
      if (!(await confirmModal(`确定删除收款银行「${row?.bankName || ''}」吗？`))) return;
      await store.removeBank(btn.getAttribute('data-delbank'));
      toast.ok(t('msg.deleted'));
      renderLibraryDrawer();
    }));
  }

  /* --- 客户库 --- */
  const cHost = $('libCustomers');
  cHost.innerHTML = state.customers.length
    ? state.customers.map((c) => `<div class="lib-row">
        <div class="info"><div class="nm">${esc(c.name || c.companyName)}</div>
        <div class="sub">${esc([c.country, c.city, c.contact, c.tel].filter(Boolean).join(' · '))}</div></div>
        ${state.doc ? `<button class="btn btn-sm" data-usecus="${c.id}">${t('btn.apply')}</button>` : ''}
        <button class="mini-btn" data-editcus="${c.id}" title="修改">✏️</button>
        <button class="mini-btn danger" data-delcus="${c.id}" title="删除">✕</button>
      </div>`).join('')
    : `<div class="hint" style="font-size:12px;color:var(--c-text-mute);line-height:1.7">还没有客户。点右上「＋」新增，或在单据买方区填好后点「当前买方」。</div>`;

  cHost.querySelectorAll('[data-usecus]').forEach((b) => b.addEventListener('click', () => {
    const row = state.customers.find((c) => c.id === b.getAttribute('data-usecus'));
    if (!row || !state.doc) return;
    state.doc.buyer = { ...emptyParty(), ...row };
    if (state.doc.sameAsBuyerConsignee !== false) {
      state.doc.consignee = clone(state.doc.buyer);
      state.doc.notify = clone(state.doc.buyer);
    }
    renderForm(el.formHost, updatePreview); updatePreview(); store.scheduleAutosave();
    toast.ok(t('msg.filled'));
  }));
  cHost.querySelectorAll('[data-editcus]').forEach((b) => b.addEventListener('click', () => {
    openCustomerEditor(b.getAttribute('data-editcus'), null, () => renderLibraryDrawer());
  }));
  cHost.querySelectorAll('[data-delcus]').forEach((b) => b.addEventListener('click', async () => {
    const row = state.customers.find((c) => c.id === b.getAttribute('data-delcus'));
    if (!(await confirmModal(`确定删除客户「${row?.name || ''}」吗？`))) return;
    await store.removeCustomer(b.getAttribute('data-delcus'));
    toast.ok(t('msg.deleted'));
    renderLibraryDrawer();
  }));

  /* --- 产品库 --- */
  const prHost = $('libProducts');
  prHost.innerHTML = state.products.length
    ? state.products.map((p) => `<div class="lib-row">
        <div class="info"><div class="nm">${esc(p.name)}</div>
        <div class="sub">${esc([p.model, p.hsCode, p.unit, p.unitPrice !== undefined && p.unitPrice !== '' ? p.unitPrice : ''].filter(Boolean).join(' · '))}</div></div>
        ${state.doc ? `<button class="btn btn-sm" data-useprd="${p.id}">${t('btn.apply')}</button>` : ''}
        <button class="mini-btn" data-editprd="${p.id}" title="修改">✏️</button>
        <button class="mini-btn danger" data-delprd="${p.id}" title="删除">✕</button>
      </div>`).join('')
    : `<div class="hint" style="font-size:12px;color:var(--c-text-mute);line-height:1.7">还没有产品。点右上「＋」新增，或在单据产品行填好后点「当前产品行」。</div>`;

  prHost.querySelectorAll('[data-useprd]').forEach((b) => b.addEventListener('click', () => {
    const row = state.products.find((p) => p.id === b.getAttribute('data-useprd'));
    if (!row || !state.doc) return;
    state.doc.items.push({
      ...emptyItem(state.doc.items.length),
      description: row.name, model: row.model || '', hsCode: row.hsCode || '',
      unit: row.unit || 'pc', unitPrice: Number(row.unitPrice) || 0, photo: row.photo || '',
      nw: Number(row.nw) || 0, gw: Number(row.gw) || 0, meas: Number(row.meas) || 0,
    });
    recalcDoc(state.doc);
    renderForm(el.formHost, updatePreview); updatePreview(); store.scheduleAutosave();
    toast.ok(t('msg.filled'));
  }));
  prHost.querySelectorAll('[data-editprd]').forEach((b) => b.addEventListener('click', () => {
    openProductEditor(b.getAttribute('data-editprd'), null, () => renderLibraryDrawer());
  }));
  prHost.querySelectorAll('[data-delprd]').forEach((b) => b.addEventListener('click', async () => {
    const row = state.products.find((p) => p.id === b.getAttribute('data-delprd'));
    if (!(await confirmModal(`确定删除产品「${row?.name || ''}」吗？`))) return;
    await store.removeProduct(b.getAttribute('data-delprd'));
    toast.ok(t('msg.deleted'));
    renderLibraryDrawer();
  }));

  /* --- 条款库 --- */
  const lHost = $('libClauses');
  lHost.innerHTML = state.clauses.length
    ? state.clauses.map((c) => `<div class="lib-row">
        <div class="info"><div class="nm">${esc(c.name)}</div>
        <div class="sub">${esc(c.category || '')} · ${esc(String(c.body || '').replace(/\s+/g, ' ').slice(0, 40))}…</div></div>
        ${state.doc ? `<button class="btn btn-sm" data-usecls="${c.id}">${t('btn.apply')}</button>` : ''}
        <button class="mini-btn" data-editcls="${c.id}" title="修改">✏️</button>
        <button class="mini-btn danger" data-delcls="${c.id}" title="删除">✕</button>
      </div>`).join('')
    : `<div class="hint" style="font-size:12px;color:var(--c-text-mute);line-height:1.7">还没有条款。点右上「＋」新增，或在单据条款框写好内容后点「当前条款」。</div>`;

  lHost.querySelectorAll('[data-usecls]').forEach((b) => b.addEventListener('click', () => {
    const row = state.clauses.find((c) => c.id === b.getAttribute('data-usecls'));
    if (!row || !state.doc) return;
    if (row.category === 'contract' && docMeta(state.doc.type).withContract) {
      try {
        const parsed = JSON.parse(row.body);
        if (Array.isArray(parsed)) state.doc.contractClauses = parsed;
      } catch {
        state.doc.contractClauses.push({ title: row.name, body: row.body });
      }
    } else {
      state.doc.terms = state.doc.terms ? `${state.doc.terms}\n${row.body}` : row.body;
    }
    renderForm(el.formHost, updatePreview); updatePreview(); store.scheduleAutosave();
    toast.ok(t('msg.filled'));
  }));
  lHost.querySelectorAll('[data-editcls]').forEach((b) => b.addEventListener('click', () => {
    openClauseEditor(b.getAttribute('data-editcls'), null, () => renderLibraryDrawer());
  }));
  lHost.querySelectorAll('[data-delcls]').forEach((b) => b.addEventListener('click', async () => {
    const row = state.clauses.find((c) => c.id === b.getAttribute('data-delcls'));
    if (!(await confirmModal(`确定删除条款「${row?.name || ''}」吗？`))) return;
    await store.removeClause(b.getAttribute('data-delcls'));
    toast.ok(t('msg.deleted'));
    renderLibraryDrawer();
  }));
}

/* ============================ 使用帮助（面向不熟悉电脑的用户） ============================ */

function openHelp() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="help-step">
      <div class="num">1</div>
      <div class="txt">
        <div class="tt">${t('help.step1t')}</div>
        <div class="bd">${t('help.step1')}</div>
      </div>
    </div>
    <div class="help-step">
      <div class="num">2</div>
      <div class="txt">
        <div class="tt">${t('help.step2t')}</div>
        <div class="bd">${t('help.step2')}</div>
      </div>
    </div>
    <div class="help-step">
      <div class="num">3</div>
      <div class="txt">
        <div class="tt">${t('help.step3t')}</div>
        <div class="bd">${t('help.step3')}</div>
      </div>
    </div>

    <div class="help-tipbox">
      <div class="tt">${t('help.tipTitle')}</div>
      <div class="line"><span class="k-draft">${t('status.draft')}</span> — ${t('status.draftHint')}（${t('drafts.tabDrafts')} 页签）</div>
      <div class="line"><span class="k-saved">${t('status.saved')}</span> — ${t('status.savedHint')}（${t('drafts.tabSaved')} 页签）</div>
    </div>

    <div class="help-note">
      🌐 ${t('lang.hint')}<br>${t('lang.more')}
    </div>
    <div class="help-note">🔒 ${t('help.dataNote')}</div>

    <div class="help-actions">
      <button class="btn btn-primary" data-help-act="new">＋ ${t('btn.new')}</button>
      <button class="btn" data-help-act="lang">🌐 ${t('lang.title')}</button>
      <button class="btn" data-help-act="backup">⬇ ${t('btn.export')}</button>
      <button class="btn" data-help-act="bigtext">🔍 字号切换</button>
    </div>`;

  const footer = document.createElement('div');
  const okBtn = document.createElement('button');
  okBtn.className = 'btn btn-primary btn-lg';
  okBtn.textContent = '知道了，开始用';
  footer.appendChild(okBtn);

  const ref = openModal({ title: `💡 ${t('help.title')}`, body, footer, width: '620px' });
  okBtn.onclick = () => ref.close();

  body.querySelectorAll('[data-help-act]').forEach((b) => {
    b.onclick = () => {
      const act = b.getAttribute('data-help-act');
      if (act === 'new') { ref.close(); newDocument(activeType()); }
      else if (act === 'lang') { ref.close(); $('previewLang').focus(); $('previewLang').click(); }
      else if (act === 'backup') { ref.close(); openSettings(); }
      else if (act === 'bigtext') { toggleBigText(); }
    };
  });
}

/** 大字号模式开关（照顾中年用户阅读） */
function toggleBigText(force) {
  const cur = document.documentElement.getAttribute('data-bigtext') === '1';
  const next = force === undefined ? !cur : !!force;
  document.documentElement.setAttribute('data-bigtext', next ? '1' : '0');
  db.setSetting('bigText', next);
  toast.info(next ? '已切换为大字号' : '已切换为标准字号');
  return next;
}

/* ============================ 表单 ↔ 预览 联动定位 ============================ */

/**
 * 表单区块 → 预览里对应的块。
 *
 * 用户的困惑：「左边输入，我甚至不知道他对应右边哪儿」。
 * 做法：聚焦左边任何输入框（或点区块标题上的 👁），右侧对应的那块就高亮闪一下并滚到眼前。
 * 这里用**现有 CSS 类**做锚点，不改渲染器 —— 单据有十几种版式，靠类名匹配最稳。
 */
const PV_ANCHORS = {
  basic: ['.doc-head', '.cus-top', '.bl-title', '.bs-head'],
  head: ['.doc-head', '.cus-title', '.bl-title', '.bs-head'],
  seller: ['.party-box'],
  buyer: ['.party-box'],
  consignee: ['.party-box'],
  notify: ['.party-box'],
  items: ['.doc-table', '.cus-main', '.bl-main'],
  cols: ['.doc-table', '.cus-main', '.bl-main'],
  terms: ['.doc-section', '.pl-terms'],
  logistics: ['.doc-section', '.ref-table'],
  bank: ['.benef-box', '.bank-box'],
  contractSign: ['.pl-sign2', '.sign-inline', '.stamp-corner'],
  customsInfo: ['.cus-main'],
  ext: ['.doc-plain-info', '.cus-main', '.bl-main'],
  otherfees: ['.doc-section', '.bs-amount'],
  // 水单专用表单的区块
  beneficiary: ['.bs-sec', '.bs-head'],
  originator: ['.bs-sec'],
  money: ['.bs-amount', '.bs-sec'],
  others: ['.bs-sec'],
  remarks: ['.bs-note', '.bs-sec'],
};

/** 都是 .party-box 的块，用标题文字区分（卖方 / 买方 / 收货人 / 通知人） */
const PV_TEXT_MATCH = {
  seller: ['SELLER', '卖方', 'BENEFICIARY'],
  buyer: ['BUYER', '买方', 'CONSIGNEE', '收货人'],
  consignee: ['CONSIGNEE', '收货人'],
  notify: ['NOTIFY', '通知人'],
};

/** 在右侧预览里高亮某个区块（返回是否找到） */
function flashPreview(key) {
  if (!key || !el.paper) return false;
  let target = null;
  const wanted = PV_TEXT_MATCH[key];
  if (wanted) {
    const boxes = Array.from(el.paper.querySelectorAll('.party-box'));
    target = boxes.find((bx) => {
      const up = ((bx.querySelector('.ttl') || {}).textContent || '').toUpperCase();
      return wanted.some((w) => up.includes(w.toUpperCase()));
    }) || null;
    // 标题匹配不到就退回按序号（第一个=卖方，第二个=买方/收货人）
    if (!target && boxes.length) {
      if (key === 'seller') target = boxes[0];
      else if (boxes.length > 1) target = boxes[1];
    }
  }
  if (!target) {
    for (const sel of (PV_ANCHORS[key] || [])) {
      const found = el.paper.querySelector(sel);
      if (found) { target = found; break; }
    }
  }
  if (!target) return false;
  const table = target.closest && target.closest('table');
  const box = table || target;                 // 表格高亮整张表更明显
  box.classList.remove('pv-flash');
  void box.offsetWidth;                        // 强制重排，让动画能重播
  box.classList.add('pv-flash');
  try { box.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { box.scrollIntoView(); }
  clearTimeout(flashPreview._t);
  flashPreview._t = setTimeout(() => box.classList.remove('pv-flash'), 1500);
  return true;
}

/* ============================ 设置弹层 ============================ */
async function openSettings() {
  const body = document.createElement('div');
  const n = state.numbering;
  body.innerHTML = `
    <div class="card" style="margin:0 0 12px">
      <div class="card-head">🔐 授权状态</div>
      <div class="card-body">
        <div id="setLicBox" style="font-size:12.5px;line-height:1.9"></div>
        <div style="margin-top:9px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" id="setLicActivate">🔑 输入激活码</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin:0 0 12px">
      <div class="card-head">📝 新建单据</div>
      <div class="card-body">
        <label class="hint" style="display:flex;align-items:flex-start;gap:8px;font-size:12.5px;line-height:1.7;font-weight:400;cursor:pointer">
          <input type="checkbox" id="setPrefillSample" ${state.prefillSample !== false ? 'checked' : ''} style="width:auto;margin-top:3px" />
          <span><b>新建单据时预填一整套示例数据</b>（默认关）<br />
          <b>关着（默认）</b>：新建出来是空白单据，每个格子里用浅灰字给出填写示例，打印出来是干净的空白单。<br />
          <b>打开</b>：新建就带一整套填好的示例数据（含示例客户和产品），适合"照着填"，但记得把示例内容改成自己的。</span>
        </label>
      </div>
    </div>

    <div class="card" style="margin:0 0 12px">
      <div class="card-head">🧩 ${t('set.layout')}</div>
      <div class="card-body">
        <div class="layout-picker" id="setLayout">
          ${LAYOUTS.map((l) => `
            <button type="button" data-layout="${l.code}" class="${state.layout === l.code ? 'active' : ''}">
              <span class="preview-mini ${l.code}"><i></i><b></b><b></b></span>
              <span class="meta"><span class="nm">${t(l.labelKey)}</span><span class="ds">${t(l.descKey)}</span></span>
            </button>`).join('')}
        </div>
      </div>
    </div>

    <div class="card" style="margin:0 0 12px">
      <div class="card-head">🎨 ${t('set.theme')}（界面与单据同步换色）</div>
      <div class="card-body">
        <div class="theme-picker" id="setTheme">
          ${store.THEMES.map((th) => `
            <button type="button" data-theme="${th.code}" class="${state.theme === th.code ? 'active' : ''}">
              <span class="sw" style="background:${th.color}"></span>
              <span class="nm">${esc(th.label)}</span>
            </button>`).join('')}
        </div>
        <div class="hint" style="font-size:12px;color:var(--c-text-mute);margin-top:9px">
          切换后界面主色、顶部导航与单据版式（表头、合计行、区块标题）一起变色，导出的 PDF 也是这个颜色。
        </div>
      </div>
    </div>

    <div class="card" style="margin:0 0 12px">
      <div class="card-head">🌐 ${t('set.uiLang')} / ${t('set.docLangDefault')}</div>
      <div class="card-body">
        <div class="hint" style="font-size:12.5px;color:var(--c-text-mute);margin-bottom:10px">${t('lang.hint')}<br>${t('lang.more')}</div>
        <div class="grid grid-2">
          <div class="field"><label>${t('set.uiLang')}</label>
            <select id="setUiLang">${UI_LANGS.map((l) => `<option value="${l.code}"${l.code === state.uiLang ? ' selected' : ''}>${l.label}</option>`).join('')}</select>
          </div>
          <div class="field"><label>${t('set.docLangDefault')}</label>
            <select id="setDocLang">${DOC_LANGS.map((l) => `<option value="${l.code}"${l.code === state.docLang ? ' selected' : ''}>${esc(langOptionLabel(l))}</option>`).join('')}</select>
          </div>
          <div class="field"><label>${t('f.currency')}</label>
            <select id="setCurrency">${CURRENCIES.map((c) => `<option value="${c}"${c === state.currency ? ' selected' : ''}>${c}${CURRENCY_CN[c] ? `（${CURRENCY_CN[c]}）` : ''}</option>`).join('')}</select>
          </div>
          <div class="field"><label>${t('f.incoterms')}</label>
            <select id="setIncoterms">${incotermsList().map((c) => `<option value="${c}"${c === state.incoterms ? ' selected' : ''}>${c}</option>`).join('')}</select>
          </div>
          <div class="field span-2"><label>${t('f.paymentTerms')}</label>
            <input type="text" id="setPayment" value="${esc(state.paymentTerms)}" /></div>
          <div class="field span-2"><label>${t('f.leadTime')}</label>
            <input type="text" id="setLead" value="${esc(state.leadTime)}" /></div>
        </div>
        <div style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <button class="btn" id="setBigText">🔍 大字号模式（方便阅读）</button>
          <span class="hint" id="setBigTextState" style="font-size:12.5px;color:var(--c-text-mute)"></span>
          <button class="btn" id="setSimple">🧹 简化界面（隐藏高级功能）</button>
          <span class="hint" id="setSimpleState" style="font-size:12.5px;color:var(--c-text-mute)"></span>
        </div>
      </div>
    </div>

    <div class="card" style="margin:0 0 12px">
      <div class="card-head">🔢 ${t('set.numbering')}</div>
      <div class="card-body">
        <div class="grid grid-4" style="font-size:12px">
          ${visibleDocTypes().map((d) => `
            <div class="field"><label>${esc(t(`doc.${d.type}`))} ${t('set.prefix')}</label>
              <input type="text" data-num="${d.type}:prefix" value="${esc(n[d.type]?.prefix || d.prefix)}" /></div>
            <div class="field"><label>${t('set.nextNo')}</label>
              <input type="number" data-num="${d.type}:next" value="${esc(n[d.type]?.next || 1)}" /></div>
            <div class="field"><label>${t('set.digits')}</label>
              <input type="number" data-num="${d.type}:digits" value="${esc(n[d.type]?.digits || 3)}" /></div>
            <div class="field"><label>${t('set.dateInNo')}</label>
              <select data-num="${d.type}:withDate">
                <option value="false"${!n[d.type]?.withDate ? ' selected' : ''}>否</option>
                <option value="true"${n[d.type]?.withDate ? ' selected' : ''}>是</option>
              </select></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card" style="margin:0 0 12px">
      <div class="card-head">🧠 ${t('set.history')}</div>
      <div class="card-body">
        <div class="hint" style="font-size:12.5px;color:var(--c-text-mute);margin-bottom:9px">${t('set.historyHint')}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn" id="setClearHistory">🧹 ${t('set.clearHistory')}</button>
          <span class="hint" id="setHistoryCount" style="font-size:12.5px;color:var(--c-text-mute)"></span>
        </div>
      </div>
    </div>

    <div class="card" style="margin:0 0 12px">
      <div class="card-head">💾 ${t('set.backup')}</div>
      <div class="card-body">
        <div class="hint" style="font-size:12px;color:var(--c-text-mute);margin-bottom:9px">${t('set.backupHint')}</div>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          <button class="btn btn-accent" id="setExport">⬇ ${t('btn.export')}</button>
          <button class="btn" id="setImport">⬆ ${t('btn.import')}</button>
        </div>
        <!-- 自动备份：状态 + 立即备份 + 从备份恢复 -->
        <div class="auto-backup-row" id="autoBackupRow" style="margin-top:10px;font-size:12px;color:var(--c-text-mute);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span id="autoBackupInfo">自动备份：检查中…</span>
          <button type="button" class="btn btn-sm" data-act="backup-now">💾 立即备份</button>
          <button type="button" class="btn btn-sm" data-act="backup-restore">♻ 从备份恢复</button>
          <button type="button" class="btn btn-sm" data-act="backup-open">打开备份文件夹</button>
        </div>
        <div class="data-dir-row" id="dataDirRow" style="margin-top:11px;font-size:12px;color:var(--c-text-mute);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span>📁 数据实际位置（本机，不上传）：</span>
          <code id="dataDirPath" style="background:var(--c-bg-soft);padding:2px 6px;border-radius:4px;max-width:100%;word-break:break-all">读取中…</code>
          <button type="button" class="btn btn-sm" data-act="open-data-dir">打开文件夹</button>
          <button type="button" class="btn btn-sm" data-act="copy-data-dir">复制路径</button>
          <button type="button" class="btn btn-sm btn-accent" data-act="data-dir-move">📂 更改位置</button>
          <button type="button" class="btn btn-sm" data-act="data-dir-reset">恢复默认</button>
          <span id="dataDirBadge" style="font-size:11.5px"></span>
        </div>
      </div>
    </div>

    <div class="card" style="margin:0 0 12px">
      <div class="card-head">🧪 ${t('set.loadDemo')}</div>
      <div class="card-body">
        <div class="hint" style="font-size:12px;color:var(--c-text-mute);margin-bottom:9px">${t('set.loadDemoDesc')}</div>
        <button class="btn btn-accent" id="setLoadDemo" style="margin-bottom:8px">📦 ${t('btn.loadDemo')}</button>
        <div class="hint" style="font-size:12px;color:var(--c-text-mute)">
          示例含：报价单 3 张（含泰语 / 中文版）、PI / 合同 / CI / 装箱单各 1 张；5 个客户（美 / 德 / 泰 / 阿联酋 / 澳）、6 个产品、7 条合同条款、3 家常用公司，并已带好公章。
        </div>
      </div>
    </div>

    <div class="card" style="margin:0 0 4px;border-color:#f0b6b6">
      <div class="card-head" style="color:var(--c-danger)">⚠ ${t('set.dangerZone')}</div>
      <div class="card-body">
        <button class="btn btn-danger" id="setClear">${t('set.clearAll')}</button>
      </div>
    </div>`;

  const footer = document.createElement('div');
  const close = document.createElement('button');
  close.className = 'btn'; close.textContent = t('btn.close');
  const apply = document.createElement('button');
  apply.className = 'btn btn-primary'; apply.textContent = t('btn.apply');
  footer.append(close, apply);

  const ref = openModal({
    title: `⚙ ${t('set.title')}`,
    body,
    footer,
    width: '760px',
  });
  close.onclick = () => ref.close();

  apply.onclick = async () => {
    const numbering = clone(state.numbering);
    body.querySelectorAll('[data-num]').forEach((input) => {
      const [type, key] = input.getAttribute('data-num').split(':');
      const raw = input.value;
      numbering[type] = numbering[type] || {};
      numbering[type][key] = key === 'prefix' ? raw : key === 'withDate' ? raw === 'true' : Number(raw) || 0;
    });
    await store.saveNumbering(numbering);
    const uiLang = body.querySelector('#setUiLang').value;
    if (uiLang !== state.uiLang) {
      await store.setUiLanguage(uiLang);
      setUiLang(uiLang);
      applyI18n(document);
    }
    await store.setDefaultDocLang(body.querySelector('#setDocLang').value);
    await store.saveSetting('defaultCurrency', body.querySelector('#setCurrency').value);
    state.currency = body.querySelector('#setCurrency').value;
    state.incoterms = body.querySelector('#setIncoterms').value;
    await store.saveSetting('defaultIncoterms', state.incoterms);
    state.paymentTerms = body.querySelector('#setPayment').value;
    await store.saveSetting('defaultPaymentTerms', state.paymentTerms);
    state.leadTime = body.querySelector('#setLead').value;
    await store.saveSetting('defaultLeadTime', state.leadTime);
    ref.close();
    renderAll();
    toast.ok(t('msg.draftSaved'));
  };

  body.querySelector('#setExport').onclick = async () => {
    const payload = await store.exportBackup();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadJson(`tradedocs-backup-${stamp}.json`, payload);
    toast.ok(t('msg.exported'));
  };
  body.querySelector('#setImport').onclick = () => $('fileImport').click();
  body.querySelector('#setClear').onclick = async () => {
    if (!(await confirmModal(t('set.clearConfirm'), { danger: true }))) return;
    await store.clearAllData();
    ref.close();
    renderAll();
    toast.ok('已清空本地数据');
  };

  // 大字号模式
  const bt = body.querySelector('#setBigText');
  const btState = body.querySelector('#setBigTextState');
  const paint = () => {
    const on = document.documentElement.getAttribute('data-bigtext') === '1';
    btState.textContent = on ? '当前：大字号' : '当前：标准字号';
    bt.classList.toggle('btn-primary', on);
  };
  bt.onclick = () => { toggleBigText(); paint(); };
  paint();

  // 简化界面模式
  const sm = body.querySelector('#setSimple');  const smState = body.querySelector('#setSimpleState');
  const paintSimple = () => {
    const on = document.documentElement.getAttribute('data-simple') === '1';
    smState.textContent = on ? '当前：简化（已隐藏高级功能）' : '当前：完整功能';
    sm.classList.toggle('btn-primary', on);
  };
  sm.onclick = async () => {
    const on = document.documentElement.getAttribute('data-simple') === '1';
    const next = !on;
    document.documentElement.setAttribute('data-simple', next ? '1' : '0');
    await db.setSetting('simpleMode', next);
    renderAll();
    paintSimple();
    toast.info(next ? '已切换为简化界面' : '已恢复完整功能');
  };
  paintSimple();

  // 主题配色：点了立即生效，并写入本机
  const tp = body.querySelector('#setTheme');
  if (tp) {
    tp.querySelectorAll('[data-theme]').forEach((b) => {
      b.onclick = async () => {
        const code = b.getAttribute('data-theme');
        applyTheme(code);
        await store.setTheme(code);
        tp.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('active', x === b));
        toast.ok(`主题已切换：${store.THEMES.find((x) => x.code === code)?.label || code}`, 1800);
      };
    });
  }

  // 界面布局：顶栏式 / 侧栏式
  const lp = body.querySelector('#setLayout');
  if (lp) {
    lp.querySelectorAll('[data-layout]').forEach((b) => {
      b.onclick = async () => {
        await setLayout(b.getAttribute('data-layout'));
        lp.querySelectorAll('[data-layout]').forEach((x) => x.classList.toggle('active', x === b));
      };
    });
  }

  // 授权状态（客户版显示试用/激活情况；无限制版隐藏这张卡片）
  const licBox = body.querySelector('#setLicBox');
  const licBtn = body.querySelector('#setLicActivate');
  if (licBox) {
    const card = licBox.closest('.card');
    if (EDITION !== 'licensed') {
      if (card) card.hidden = true;
    } else {
      const st = licStatusNow();
      licBox.innerHTML = st.state === 'activated'
        ? '<b>✅ 已激活</b> · 永久可用，可享受后续免费升级。'
        : st.state === 'trial'
          ? `<b>🎁 试用中</b> · 剩余 <b>${licFormatLeft(st.msLeft)}</b>（共 ${LIC_TRIAL_HOURS} 小时）。`
          : st.state === 'expired'
            ? '<b>⛔ 试用已结束</b> · 输入激活码后继续使用（数据不会丢）。'
            : `<b>未激活</b> · 首次使用可免费试用 ${LIC_TRIAL_HOURS} 小时。`;
    }
  }
  if (licBtn) licBtn.onclick = () => { ref.close(); openActivateDialog(); };

  // 新建单据是否预填完整示例
  const pf = body.querySelector('#setPrefillSample');
  if (pf) pf.onchange = async () => {
    state.prefillSample = !!pf.checked;
    await store.saveSetting('prefillSample', state.prefillSample);
    toast.info(state.prefillSample ? '新建单据会预填一份完整示例' : '新建单据将是空白的', 2400);
  };

  // 载入示例数据
  const demoBtn = body.querySelector('#setLoadDemo');
  if (demoBtn) demoBtn.onclick = async () => {
    const r = await loadSampleData();
    if (!r.ok) { toast.warn(r.reason === 'exists' ? t('demo.exists') : t('demo.failed')); return; }
    demoBtn.disabled = true;
    const shown = store.state.docs.filter((d) => !isDocTypeHidden(d.type)).length;
    toast.ok(t('demo.loaded', { docs: shown, customers: r.customers, products: r.products }), 3600);
  };

  // 输入历史
  const hc = body.querySelector('#setHistoryCount');
  const paintHistory = async () => {
    const n = store.historyTotal();
    hc.textContent = t('set.historyCount', { n });
  };
  paintHistory();
  body.querySelector('#setClearHistory').onclick = async () => {
    if (!(await confirmModal('确定清空输入历史吗？只影响下拉候选，不影响已保存的单据。'))) return;
    await store.clearHistory();
    await paintHistory();
    toast.ok(t('msg.historyCleared'));
  };
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ============================ 全局事件 ============================ */

function bindGlobalEvents() {
  bindRail();                     // 侧栏式布局的菜单
  initSplitter();                 // 左右分栏拖拽
  initViewShortcuts();            // Ctrl+\ 隐藏预览
  const hideBtn = $('btnHidePreview');
  if (hideBtn) hideBtn.onclick = togglePreview;
  const stub = $('previewStub');
  if (stub) stub.onclick = togglePreview;
  $('btnBack').onclick = goBackDoc;
  $('btnNext').onclick = goNextDoc;
  // 新建：只建当前所在类型的单据（每个 Tab 管自己那一类）
  /* 装箱单：按柜拆分生成多张箱单 */
  window.addEventListener('td:split-by-container', async () => {
    // 多柜拆分功能已移除
    toast.info('多柜拆分功能已移除', 2400);
    return;
    const src = state.doc;
    if (!src) return;
    const ctnList = Array.isArray(src.containers) ? src.containers : [];
    if (ctnList.length < 2) { toast.warn('至少要 2 个柜才能拆分', 2600); return; }
    const ids = new Set(ctnList.map((c) => c.id));
    const report = ctnList.map((c, idx) => {
      const list = (src.items || []).filter((it) => it.containerId === c.id);
      const ctns = list.reduce((s, it) => s + (Number(it.ctns || it.qty) || 0), 0);
      return { idx, ctn: c, rows: list.length, ctns };
    });
    const un = (src.items || []).filter((it) => !it.containerId || !ids.has(it.containerId));
    const usable = report.filter((r) => r.rows > 0);
    if (!usable.length) { toast.warn('明细里还没有分配柜，先在「装柜」列选一下', 3000); return; }
    openSplitByContainerDialog(src, usable, un, report);
  });

  if ($('btnDocCenter')) $('btnDocCenter').onclick = () => openDocCenterPage({ onChanged: () => renderAll(), toast: (m2, d) => toast.ok(m2, d), confirm: (m2) => confirmModal(m2) });
  $('btnNew').onclick = () => newDocument(activeType());
  $('btnGenerate').onclick = openGenerateModal;
  $('btnDuplicate').onclick = duplicateCurrent;
  $('btnMarkSaved').onclick = markCurrentSaved;
  $('btnBackDraft').onclick = backToDraft;
  $('btnCheck').onclick = toggleCheckPanel;
  $('checkClose').onclick = closeCheckPanel;
  $('checkRecheck').onclick = () => runCheck(true);
  $('btnHelp').onclick = openHelp;
  /* 工具箱已移除（用户要求） */

  document.addEventListener('tradedocs:apply-marks', (e) => {
    if (!state.doc) { toast.warn('请先新建一张单据，再把唛头应用进去'); return; }
    if (state.doc.type !== 'ci' && state.doc.type !== 'pl') {
      toast.warn('唛头通常在商业发票 / 装箱单上使用，当前单据没有唛头栏'); return;
    }
    state.doc.marks = e.detail?.marks || '';
    renderForm(el.formHost, updatePreview);
    updatePreview();
    store.scheduleAutosave();
    toast.ok('唛头已应用到当前单据');
  });
  document.addEventListener('tradedocs:apply-payment', (e) => {
    if (!state.doc) { toast.warn('请先新建一张单据，再把付款方式应用进去'); return; }
    state.doc.paymentTerms = e.detail?.paymentTerms || '';
    renderForm(el.formHost, updatePreview);
    updatePreview();
    store.scheduleAutosave();
    toast.ok('付款方式已应用到当前单据');
  });
  $('btnDrafts').onclick = () => openDrawer('drafts');
  $('btnLibrary').onclick = () => openDrawer('library');
  $('btnSettings').onclick = openSettings;
  $('drawerDraftsClose').onclick = closeDrawers;
  $('drawerLibraryClose').onclick = closeDrawers;
  $('drawerNew').onclick = () => newDocument(activeType());

  $('draftSearch').oninput = (e) => renderDraftList(e.target.value);
  // 回车打开最相关的那一条（编号输全时，第一条就是精准命中）
  $('draftSearch').onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = el.draftList.querySelector('.draft-item');
      if (first) first.click();
    } else if (e.key === 'Escape') {
      e.target.value = '';
      renderDraftList('');
    }
  };

  // 草稿 / 已保存单据 分段页签
  if (el.draftTabs) {
    el.draftTabs.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        draftTab = b.getAttribute('data-tab');
        draftTypeFilter = 'all';            // 换页签时重置类型筛选，避免出现"空列表"
        renderDraftList($('draftSearch').value);
      };
    });
  }

  // 模板库分段页签
  if (el.libTabs) {
    el.libTabs.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const tab = b.getAttribute('data-tab');
        el.libTabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        document.querySelectorAll('#drawerLibrary [data-libpanel]').forEach((p) => {
          p.hidden = p.getAttribute('data-libpanel') !== tab;
        });
      };
    });
  }

  $('zoomIn').onclick = () => setZoom(state.zoom + 0.1);
  $('zoomOut').onclick = () => setZoom(state.zoom - 0.1);
  el.previewScroll.addEventListener('scroll', () => updatePanButtons(), { passive: true });
  if ($('fontIn')) $('fontIn').onclick = () => stepFont(1);
  if ($('fontOut')) $('fontOut').onclick = () => stepFont(-1);
  if ($('fontReset')) $('fontReset').onclick = () => applyDocFontScale(1);
  if ($('panLeft')) $('panLeft').onclick = () => panBy(-1);
  if ($('panRight')) $('panRight').onclick = () => panBy(1);
  /* 按住预览拖动 = 平移（预览是只读的，不会影响输入） */
  {
    const sc = el.previewScroll;
    let dragging = false, sx = 0, sy = 0, sl = 0, st = 0, moved = false;
    sc.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (sc.scrollWidth <= sc.clientWidth + 2 && sc.scrollHeight <= sc.clientHeight + 2) return;
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY; sl = sc.scrollLeft; st = sc.scrollTop;
      sc.classList.add('is-panning');
    });
    sc.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      sc.scrollLeft = sl - dx;
      sc.scrollTop = st - dy;
    });
    const stop = () => { if (!dragging) return; dragging = false; sc.classList.remove('is-panning'); };
    sc.addEventListener('pointerup', stop);
    sc.addEventListener('pointercancel', stop);
    sc.addEventListener('pointerleave', stop);
    // 拖动结束时别触发点击（避免误触预览里的图片编辑等）
    sc.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  }
  /* Shift + 滚轮 → 左右平移 */
  el.previewScroll.addEventListener('wheel', (e) => {
    if (!e.shiftKey) return;
    const sc = el.previewScroll;
    if (sc.scrollWidth <= sc.clientWidth + 2) return;
    sc.scrollLeft += e.deltaY || e.deltaX;
    e.preventDefault();
  }, { passive: false });

  $('zoomFit').onclick = () => setZoom(1, { fit: true });
  $('zoom100').onclick = () => setZoom(1);

  $('previewLang').onchange = async (e) => {
    if (!state.doc) return;
    const prevLang = state.doc.docLang;
    const nextLang = e.target.value;
    const meta = docMeta(state.doc.type);
    const langName = (code) => DOC_LANGS.find((l) => l.code === code)?.native || code;
    state.doc.docLang = nextLang;

    // 合同：条款仍是上一语言默认模板时，询问是否替换为新语言默认条款
    if (meta.withContract && isDefaultClauses(state.doc, prevLang)) {
      const switchIt = await confirmModal(
        `检测到合同条款为「${langName(prevLang)}」默认模板，是否替换为「${langName(nextLang)}」默认条款？`,
        { title: '条款语言', okText: '替换', cancelText: '保持不变' }
      );
      if (switchIt) state.doc.contractClauses = clone(getTemplate(nextLang).defaults?.contractClauses || []);
    }

    // 报价单 / PI：条款为空时自动补当前语言的默认条款
    if ((state.doc.type === 'quotation' || state.doc.type === 'pi') && !String(state.doc.terms || '').trim()) {
      const key = state.doc.type === 'quotation' ? 'quotationTerms' : 'piTerms';
      state.doc.terms = getTemplate(nextLang).defaults?.[key] || '';
    }

    renderForm(el.formHost, updatePreview);
    updatePreview();
    store.scheduleAutosave();
  };

  $('btnPdf').onclick = () => {
    if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
    toast.info(t('msg.pdfStart'), 2600);
    exportPdf(state.doc);
  };
  /* 数据目录：显示真实路径 + 打开 / 复制 */
  async function loadDataDirInfo() {
    const el = $('dataDirPath');
    if (!el) return;
    try {
      if (window.tdDesktop && window.tdDesktop.dataDir) {
        const info = await window.tdDesktop.dataDir();
        el.textContent = info.dbPath || info.path || '—';
        el.title = info.path || '';
      } else {
        el.textContent = '浏览器演示模式';
      }
    } catch (e) { el.textContent = '读取失败'; }
  }
  loadDataDirInfo();
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-act="open-data-dir"]');
    if (b) {
      e.preventDefault(); e.stopPropagation();
      if (window.tdDesktop && window.tdDesktop.openDataDir) {
        const r = await window.tdDesktop.openDataDir();
        if (!r.ok) toast.warn('打开失败：' + (r.error || ''), 2600);
      } else { toast.info('请在桌面版里使用', 2200); }
      return;
    }
    const c = e.target.closest && e.target.closest('[data-act="copy-data-dir"]');
    if (c) {
      e.preventDefault(); e.stopPropagation();
      const t0 = ($('dataDirPath') || {}).textContent || '';
      try { await navigator.clipboard.writeText(t0); toast.ok('路径已复制'); } catch { toast.warn('复制失败'); }
    }
  });

  /* ---------- 自动备份（每天一次，保留 30 份）+ 一键恢复 ---------- */
  const BACKUP_MARK = 'lastAutoBackupDate';
  async function refreshBackupInfo() {
    const el = $('autoBackupInfo');
    if (!el) return;
    if (!window.tdDesktop || !window.tdDesktop.backupList) { el.textContent = '自动备份：仅桌面版可用'; return; }
    try {
      const res = await window.tdDesktop.backupList();
      if (!res || !res.ok) { el.textContent = '自动备份：读取失败'; return; }
      const items = res.items || [];
      if (!items.length) { el.textContent = '自动备份：还没有备份（每天首次打开会自动备份）'; return; }
      const last = items[0];
      const d = new Date(last.mtime);
      const p2 = (n) => String(n).padStart(2, '0');
      const days = Math.floor((Date.now() - last.mtime) / 86400000);
      const ago = days <= 0 ? '今天' : (days + ' 天前');
      el.textContent = '自动备份：共 ' + items.length + ' 份 · 最近 '
        + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' '
        + p2(d.getHours()) + ':' + p2(d.getMinutes()) + '（' + ago + '）';
      el.style.color = days > 7 ? '#b45309' : '';
    } catch (e) { el.textContent = '自动备份：读取失败'; }
  }
  async function doBackup(silent) {
    if (!window.tdDesktop || !window.tdDesktop.backupSave) return null;
    try {
      const payload = await store.exportBackup();
      const res = await window.tdDesktop.backupSave(payload);
      if (!silent) {
        if (res && res.ok) toast.ok('已备份：' + res.name, 2600);
        else toast.warn('备份失败：' + ((res && res.error) || ''), 2600);
      }
      refreshBackupInfo();
      return res;
    } catch (err) {
      if (!silent) toast.warn('备份失败', 2600);
      return null;
    }
  }
  async function runAutoBackup() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(BACKUP_MARK) === today) { refreshBackupInfo(); return; }
      const res = await doBackup(true);
      if (res && res.ok) {
        localStorage.setItem(BACKUP_MARK, today);
        toast.info('已自动备份今日数据', 2200);
      }
      refreshBackupInfo();
    } catch (e) { /* 忽略 */ }
  }
  setTimeout(runAutoBackup, 3000);
  document.addEventListener('click', async (e) => {
    const bn = e.target.closest && e.target.closest('[data-act="backup-now"]');
    if (bn) { e.preventDefault(); e.stopPropagation(); await doBackup(false); return; }
    const br = e.target.closest && e.target.closest('[data-act="backup-restore"]');
    if (br) {
      e.preventDefault(); e.stopPropagation();
      if (!window.tdDesktop || !window.tdDesktop.backupList) { toast.warn('仅桌面版可用', 2200); return; }
      const res = await window.tdDesktop.backupList();
      const items = (res && res.items) || [];
      if (!items.length) { toast.warn('还没有备份文件', 2400); return; }
      const p2 = (n) => String(n).padStart(2, '0');
      const lines = items.slice(0, 10).map((it, i) => {
        const d = new Date(it.mtime);
        return (i + 1) + ') ' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
          + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
          + '   ' + (it.docs == null ? '' : it.docs + ' 张') + '   ' + Math.round(it.size / 1024) + 'KB';
      }).join('\n');
      const pick = prompt('选择要恢复的备份（输入序号，1 = 最近）：\n\n' + lines, '1');
      if (!pick) return;
      const item = items[Number(pick) - 1];
      if (!item) { toast.warn('序号无效', 2000); return; }
      const ok = await confirmModal('用「' + item.name + '」覆盖恢复？当前数据会被替换（建议先点「立即备份」）。');
      if (!ok) return;
      const rd = await window.tdDesktop.backupRead(item.name);
      if (!rd || !rd.ok) { toast.warn('读取备份失败', 2400); return; }
      await store.importBackup(JSON.parse(rd.text), { merge: false });
      renderAll();
      toast.ok('已从备份恢复', 2600);
      return;
    }
    const bo = e.target.closest && e.target.closest('[data-act="backup-open"]');
    if (bo) {
      e.preventDefault(); e.stopPropagation();
      if (window.tdDesktop && window.tdDesktop.backupOpenDir) await window.tdDesktop.backupOpenDir();
    }
  });

  /* ---------- 数据存放位置：显示 / 更改 / 恢复默认 ---------- */
  async function refreshDataDir() {
    const el = $('dataDirPath');
    if (!el) return;
    try {
      if (!window.tdDesktop || !window.tdDesktop.dataDirInfo) { el.textContent = '仅桌面版可用'; return; }
      const info = await window.tdDesktop.dataDirInfo();
      el.textContent = info.dir || '—';
      el.title = (info.isCustom ? '自定义位置' : '默认位置') + '\n' + (info.dir || '');
      const badge = $('dataDirBadge');
      if (badge) badge.textContent = info.isCustom ? '（自定义）' : '（默认）';
      // 启动时如果记录的位置失效，提示一次
      const fb = await window.tdDesktop.dataDirFallback && window.tdDesktop.dataDirFallback();
      if (fb) toast.warn('原数据位置不可用，已回到默认目录：' + fb, 6000);
    } catch (e) { el.textContent = '读取失败'; }
  }
  setTimeout(refreshDataDir, 1200);
  document.addEventListener('click', async (e) => {
    const mv = e.target.closest && e.target.closest('[data-act="data-dir-move"]');
    if (mv) {
      e.preventDefault(); e.stopPropagation();
      if (!window.tdDesktop || !window.tdDesktop.dataDirMove) { toast.warn('仅桌面版可用', 2200); return; }
      const ok = await confirmModal('更改数据存放位置会把现有数据复制到新文件夹，然后需要重启程序。继续吗？');
      if (!ok) return;
      const res = await window.tdDesktop.dataDirMove();
      if (!res || !res.ok) {
        if (res && res.reason === 'cancel') return;
        toast.warn('更改失败：' + ((res && (res.reason || res.error)) || ''), 4000);
        return;
      }
      toast.ok('已复制到：' + res.dir + '，请关闭并重新打开程序生效', 6000);
      refreshDataDir();
      return;
    }
    const rs = e.target.closest && e.target.closest('[data-act="data-dir-reset"]');
    if (rs) {
      e.preventDefault(); e.stopPropagation();
      const ok = await confirmModal('恢复到默认数据位置？需要重启程序生效（不会删除现有数据）。');
      if (!ok) return;
      const res = await window.tdDesktop.dataDirReset();
      if (res && res.ok) toast.ok('已恢复默认位置，请重启程序', 5000);
      refreshDataDir();
    }
  });

  /* ---------- 签名图片：与印章同机制，存进卖方信息 ---------- */
  const pickImage = (cb) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => cb(String(reader.result || ''));
      reader.readAsDataURL(file);
    };
    inp.click();
  };
  document.addEventListener('click', (e) => {
    const up = e.target.closest && e.target.closest('[data-act="upload-sign"]');
    if (up) {
      e.preventDefault(); e.stopPropagation();
      pickImage((dataUrl) => {
        state.doc.seller.signature = dataUrl;
        try { store.persistDoc(state.doc); } catch (err) {}
        renderAll();
        toast.ok('签名已上传', 1600);
      });
      return;
    }
    const cl = e.target.closest && e.target.closest('[data-act="clear-sign"]');
    if (cl) {
      e.preventDefault(); e.stopPropagation();
      state.doc.seller.signature = '';
      try { store.persistDoc(state.doc); } catch (err) {}
      renderAll();
    }
  });

  $('btnPrint').onclick = () => {
    if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
    printDocument(state.doc);
  };
  /* ⋯ 更多菜单：点开、点外面关、点里面某一项后关 */
  {
    const more = $('tbMore');
    const menu = $('tbMoreMenu');
    if (more && menu) {
      const closeMenu = () => {
        menu.hidden = true;
        more.setAttribute('aria-expanded', 'false');
      };
      more.onclick = (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden;
        menu.hidden = !willOpen;
        more.setAttribute('aria-expanded', String(willOpen));
      };
      menu.addEventListener('click', () => setTimeout(closeMenu, 60));
      document.addEventListener('click', (e) => {
        if (menu.hidden) return;
        if (!menu.contains(e.target) && e.target !== more) closeMenu();
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    }
  }
  initExportMenu();

  // 模板库按钮
  $('libSaveCompany') && ($('libSaveCompany').onclick = () => saveSellerAsProfile().then(() => renderLibraryDrawer()));
  $('libAddProfile').onclick = () => openProfileEditor(null, state.doc?.seller, () => renderLibraryDrawer());
  /* 收款银行库：新增 / 存当前银行 */
  if ($('libAddBank')) {
    $('libAddBank').onclick = () => openBankEditor(null, state.doc?.bank, () => renderLibraryDrawer());
  }
  if ($('libSaveBank')) {
    $('libSaveBank').onclick = async () => {
      if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
      if (!String(state.doc.bank?.bankName || '').trim()) { toast.warn('请先在单据「银行信息」里填开户银行', 3000); return; }
      const row = await openBankEditor(null, state.doc.bank, () => renderLibraryDrawer());
      return row;
    };
  }
  $('libSaveCustomer').onclick = () => {
    if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
    openCustomerEditor(null, state.doc.buyer, () => renderLibraryDrawer());
  };
  $('libAddCustomer').onclick = () => openCustomerEditor(null, null, () => renderLibraryDrawer());
  $('libSaveProducts').onclick = async () => {
    if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
    const rows = state.doc.items.filter((it) => (it.description || '').trim());
    if (!rows.length) { toast.warn('产品行还没有品名'); return; }
    for (const it of rows) {
      await store.saveProduct({
        name: it.description, model: it.model, hsCode: it.hsCode, unit: it.unit,
        unitPrice: it.unitPrice, photo: it.photo, nw: it.nw, gw: it.gw, meas: it.meas,
      });
    }
    renderLibraryDrawer();
    toast.ok(`${t('msg.savedToLib')} ×${rows.length}`);
  };
  $('libAddProduct').onclick = () => openProductEditor(null, null, () => renderLibraryDrawer());
  $('libSaveClause').onclick = async () => {
    if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
    const isContract = docMeta(state.doc.type).withContract;
    openClauseEditor(null, {
      name: `${t(`doc.${state.doc.type}`)} ${state.doc.docNo || ''}`.trim(),
      category: isContract ? 'contract' : state.doc.type,
      body: isContract ? JSON.stringify(state.doc.contractClauses || [], null, 2) : state.doc.terms,
    }, () => renderLibraryDrawer());
  };
  $('libAddClause').onclick = () => openClauseEditor(null, null, () => renderLibraryDrawer());

  // 备份导入
  $('fileImport').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const yes = await confirmModal('导入将合并到本机现有数据（同 ID 记录会被覆盖）。继续？');
      if (!yes) return;
      const stats = await store.importBackup(payload);
      renderAll();
      renderLibraryDrawer();
      const total = Object.values(stats).reduce((s, n) => s + n, 0);
      toast.ok(t('msg.imported', { n: total }));
    } catch (err) {
      console.error(err);
      toast.err(t('msg.importFailed', { reason: err.message }));
    }
  });

  // 手机底部 Tab
  document.querySelectorAll('#mobileTabbar button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#mobileTabbar button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const which = b.getAttribute('data-mtab');
      if (which === 'edit') { el.appBody.classList.remove('show-preview'); closeDrawers(); }
      else if (which === 'preview') { el.appBody.classList.add('show-preview'); closeDrawers(); applyZoom(); }
      else if (which === 'drafts') { el.appBody.classList.remove('show-preview'); openDrawer('drafts'); }
      else openSettings();
    };
  });

  // 状态变化
  on('savestate', (s) => updateSaveState(s));
  on('docs', () => { renderTabs(); renderDraftList(); updateStatus(); });
  on('doc', () => { renderRevisionList(); });
  window.addEventListener('online', updateNetState);
  window.addEventListener('offline', updateNetState);
  updateNetState();

  // 图片上传（LOGO / 产品图）
  initPhotoInputs(updatePreview);
  bindEmptyStateNew((type) => newDocument(type));

  // 快捷键：Ctrl/Cmd + S 保存，Ctrl/Cmd + P 打印
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      store.flushAutosave().then(() => { toast.ok(t('msg.draftSaved')); updateSaveState('saved'); });
    }
    if (mod && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      if (!state.doc) { toast.warn(t('msg.needDoc')); return; }
      printDocument(state.doc);
    }
  });

  // 离开页面前兜底保存
  window.addEventListener('beforeunload', () => {
    if (state.doc) {
      recalcDoc(state.doc);
      // 同步写一份（IndexedDB 异步，这里尽力而为）
      try { store.persistDoc(state.doc); } catch { /* 忽略 */ }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.doc) store.persistDoc(state.doc).catch(() => null);
  });

  window.addEventListener('resize', () => {
    if (window.matchMedia('(max-width: 1080px)').matches) return;
    applyZoom();
  });
}

/* ============================ 数据结构版本守卫 ============================ */

const APP_SCHEMA_VERSION = '3';

/**
 * 浏览器里可能同时开着旧版页面：旧页面用旧版代码去开新版数据库会报错。
 * 这里在启动时记下当前版本，发现不一致就提示用户刷新，避免出现莫名其妙的写入失败。
 */
async function checkDataVersion() {
  try {
    const seen = await db.getSetting('appSchemaVersion', null);
    if (seen && seen !== APP_SCHEMA_VERSION) {
      toast.warn('检测到程序已更新，请按 Ctrl+F5 强制刷新页面后再使用，避免数据写入异常。', 9000);
    }
    await db.setSetting('appSchemaVersion', APP_SCHEMA_VERSION);
  } catch { /* 首次运行或读不到都不影响 */ }
}

/* ============================ 首屏错误兜底（避免"点了没反应"） ============================ */

let lastErrAt = 0;
let lastErrMsg = '';

function surfaceFatal(context, err) {
  const msg = (err && (err.message || err.reason?.message)) || String(err || '未知错误');
  const now = Date.now();
  // 同一条错误 3 秒内只提示一次，避免刷屏
  if (msg === lastErrMsg && now - lastErrAt < 3000) return;
  lastErrMsg = msg;
  lastErrAt = now;
  console.error(`[${context}]`, err);
  try {
    toast.err(`${context}失败：${msg}`, 5000);
  } catch { /* toast 都挂了就只写控制台 */ }
}

function installErrorGuards() {
  window.addEventListener('error', (e) => {
    // 资源加载失败（如图片）不弹提示，只记日志
    if (e.target && e.target !== window && e.target.tagName) {
      console.warn('资源加载失败:', e.target.src || e.target.href);
      return;
    }
    surfaceFatal('运行', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    surfaceFatal('操作', e.reason);
    e.preventDefault();
  });
}

/* ============================ URL 参数（PWA 快捷方式） ============================ */

function handleUrlParams() {
  const p = new URLSearchParams(location.search);
  const type = p.get('type');
  if (type && DOC_TYPES.some((d) => d.type === type)) {
    newDocument(type).then(() => {
      history.replaceState(null, '', location.pathname);
    });
  }
}

/* ============================ 安装成 App（PWA） ============================ */

/** 捕获安装事件，把它变成界面上的「安装到桌面 / 手机」按钮 */
let deferredInstall = null;

function initInstallPrompt() {
  // 桌面版（Electron 打包后的 exe）本身就是 App，不该再提示「装成 App 用」。
  // electron/main.cjs 会往 User-Agent 里加 TradeDocsDesktop 标记。
  if (/TradeDocsDesktop/.test(navigator.userAgent)) {
    const bar = $('installBar');
    if (bar) bar.hidden = true;
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const bar = $('installBar');
    if (bar) bar.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    const bar = $('installBar');
    if (bar) bar.hidden = true;
    toast.ok(t('pwa.installed'), 4000);
  });

  const btn = $('installNow');
  if (btn) {
    btn.onclick = async () => {
      const bar = $('installBar');
      if (!deferredInstall) {
        if (bar) bar.hidden = true;
        return;
      }
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch { /* 用户取消也无所谓 */ }
      deferredInstall = null;
      if (bar) bar.hidden = true;
    };
  }
  const later = $('installLater');
  if (later) later.onclick = () => { const bar = $('installBar'); if (bar) bar.hidden = true; };

  // 已经是安装版（独立窗口）就不提示了
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    const bar = $('installBar');
    if (bar) bar.hidden = true;
  }
}

/* ============================ Service Worker ============================ */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // file:// 不支持 SW，功能仍完整可用

  // 桌面版（Electron 打包后的 exe）**不注册 Service Worker**，并主动注销已有的。
  //
  // 为什么：SW 是 cache-first，而桌面版的文件就在本地磁盘上、加载本来就快，
  // 缓存没带来收益，反而会导致「装了新版本，看到的还是旧界面」——
  // 用户就遇到了这个问题（改了字体和配色，装上新版却还是旧的）。
  // 浏览器版（PWA）仍需 SW 提供离线能力，所以只在桌面版跳过。
  if (/TradeDocsDesktop/.test(navigator.userAgent)) {
    navigator.serviceWorker.getRegistrations?.().then((regs) => {
      regs.forEach((r) => r.unregister().catch(() => {}));
    }).catch(() => {});
    return;
  }

  const start = () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast.info(t('pwa.update'), 6000);
          }
        });
      });
    }).catch((err) => {
      console.warn('Service Worker 注册失败（不影响使用）', err);
    });
  };

  // 注意：本模块是 type="module"，执行时往往已过 load 事件，
  // 因此必须判断 readyState，否则永远等不到 load 而静默失效
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/* ============================ 启动 ============================ */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
