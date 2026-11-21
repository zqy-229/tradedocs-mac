/* =============================================================
 * 激活界面 —— 全屏锁 + 激活窗口 + 状态栏倒计时
 *
 * 行为：
 *   · 客户版（EDITION === 'licensed'）首次启动 → 弹全屏激活窗口，可以点「免费试用 12 小时」；
 *   · 试用中 → 状态栏显示倒计时；到期立刻锁屏，要求激活；
 *   · 输入通用激活码 → 永久可用；
 *   · 内部无限制版（EDITION === 'free'）→ 完全不出现这些界面。
 *
 * ⚠️ 软锁：拦的是"我也能用"的心理，不是逆向。数据永远不删。
 * ============================================================= */

import { esc } from '../core/util.js';
import * as db from '../core/db.js';
import * as toast from './toast.js';
import {
  EDITION, CONTACT, TRIAL_HOURS, localStore,
  status as licStatus, startTrial as licStartTrial, activate as licActivate, formatLeft,
} from '../core/license.js';

const LIC_DB_KEY = 'licenseRecord';   // 数据库里的副本（清 localStorage 也重置不了试用）
const CONTACT_DB_KEY = 'licContact';  // 购买联系方式（设置里可改，不用重新打包）

let ticker = null;
let gateEl = null;
let cachedDbRec = null;
let cachedContact = null;

/** 购买联系方式：设置里存过就用设置里的，否则用代码里的默认值 */
export async function loadContact() {
  try { cachedContact = await db.getSetting(CONTACT_DB_KEY, null); } catch { cachedContact = null; }
  return { ...CONTACT, ...(cachedContact || {}) };
}

export async function saveContact(patch) {
  cachedContact = { ...(cachedContact || {}), ...patch };
  try { await db.setSetting(CONTACT_DB_KEY, cachedContact); } catch { /* 忽略 */ }
  return { ...CONTACT, ...cachedContact };
}

function contactNow() {
  return { ...CONTACT, ...(cachedContact || {}) };
}

/* ---------------- 小工具 ---------------- */

export function machineCode() {
  const fromShell = window.tdDesktop && window.tdDesktop.machineCode;
  if (fromShell) return fromShell;
  // 浏览器里没有系统信息 → 用环境特征凑一个稳定的串，照样显示
  const src = [navigator.platform, navigator.hardwareConcurrency || 0, screen.width, screen.height, navigator.language].join('|');
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 << 5) + h2 + c * 31) >>> 0;
  }
  const part = (n) => n.toString(36).toUpperCase().padStart(4, '0').slice(-4);
  return [part(h1), part(h2), part((h1 ^ h2) >>> 0)].join('-');
}

function editionOn() {
  if (EDITION !== 'licensed') return false;
  // 自动化测试 / 演示用：URL 带 lic=off 时跳过激活界面（打包给客户的程序不会带这个参数）
  try { if (/(^|[?&])lic=off(&|$)/.test(location.search)) return false; } catch { /* 忽略 */ }
  return true;
}

/** 读状态（带数据库副本交叉校验） */
export function currentStatus(now = Date.now()) {
  return licStatus(localStore, cachedDbRec, now);
}

/** 把记录同时落到 localStorage 与数据库（两边都有 → 单独清一边没用） */
async function persistBoth() {
  cachedDbRec = localStore.read();
  try { await db.setSetting(LIC_DB_KEY, cachedDbRec); } catch { /* 数据库写失败不影响本机激活 */ }
}

/* ---------------- 状态栏小标签 ---------------- */

function chipEl() {
  return document.getElementById('licChip');
}

function renderChip(st) {
  const el = chipEl();
  if (!el) return;
  if (!editionOn()) { el.hidden = true; return; }
  el.hidden = false;
  if (st.state === 'activated') {
    el.textContent = '✅ 已激活';
    el.dataset.lic = 'ok';
    el.title = '已激活，永久可用';
  } else if (st.state === 'trial') {
    el.textContent = `试用剩余 ${formatLeft(st.msLeft)}`;
    el.dataset.lic = 'trial';
    el.title = '点击输入激活码';
  } else {
    el.textContent = '未激活';
    el.dataset.lic = 'bad';
    el.title = '点击输入激活码';
  }
}

/* ---------------- 全屏激活锁 ---------------- */

function reasonText(st) {
  if (st.state === 'expired') return `免费试用（${TRIAL_HOURS} 小时）已结束，请输入激活码继续使用。`;
  if (st.state === 'bad') return '检测到授权信息异常（试用记录被修改或系统时间被调整），请输入激活码继续使用。';
  if (st.state === 'trial') return `试用中，剩余 ${formatLeft(st.msLeft)}。`;
  return `首次使用可免费试用 ${TRIAL_HOURS} 小时。`;
}

/** 显示全屏激活锁（不可关闭，除非激活或开始试用） */
export function showGate() {
  if (!editionOn()) return;
  if (gateEl) { refreshGate(); return; }
  const wrap = document.createElement('div');
  wrap.className = 'lic-gate';
  wrap.id = 'licGate';
  wrap.innerHTML = `
    <div class="lic-card">
      <div class="lic-head">
        <div class="lic-badge">🔐</div>
        <div>
          <h2>外贸单证工作台</h2>
          <div class="lic-sub" id="licSub"></div>
        </div>
      </div>
      <div class="lic-meta">
        <div class="lic-row"><span class="k">本机机器码</span><span class="v" id="licMachine"></span>
          <button class="btn btn-sm" id="licCopy">复制</button></div>
        <div class="lic-row"><span class="k">授权状态</span><span class="v" id="licState"></span></div>
      </div>
      <div class="lic-form">
        <input type="text" id="licInput" placeholder="请输入激活码" autocomplete="off" spellcheck="false" />
        <button class="btn btn-primary" id="licGo">激活</button>
      </div>
      <div class="lic-msg" id="licMsg"></div>
      <div class="lic-actions">
        <button class="btn" id="licTrial" hidden>🎁 免费试用 ${TRIAL_HOURS} 小时</button>
      </div>
      <div class="lic-buy" id="licBuy"></div>
      <div class="lic-safe">你的单据、客户、产品资料仍然完整保存在本机，激活后立即恢复，不会丢失。</div>
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('lic-locked');
  gateEl = wrap;

  wrap.querySelector('#licCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(machineCode());
      toast.ok('机器码已复制', 1600);
    } catch { toast.warn('复制失败，请手动记录', 2000); }
  };
  wrap.querySelector('#licGo').onclick = doActivate;
  wrap.querySelector('#licInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doActivate();
  });
  wrap.querySelector('#licTrial').onclick = async () => {
    licStartTrial(localStore, Date.now());
    await persistBoth();
    closeGate();
    toast.ok(`已开始 ${TRIAL_HOURS} 小时免费试用`, 2600);
    startTicker();
  };
  refreshGate();
  setTimeout(() => { const i = wrap.querySelector('#licInput'); if (i) i.focus(); }, 80);
}

function refreshGate() {
  if (!gateEl) return;
  const st = currentStatus();
  const sub = gateEl.querySelector('#licSub');
  const stEl = gateEl.querySelector('#licState');
  const buy = gateEl.querySelector('#licBuy');
  const trialBtn = gateEl.querySelector('#licTrial');
  if (sub) sub.textContent = reasonText(st);
  if (stEl) {
    stEl.textContent = st.state === 'trial' ? `试用中 · 剩余 ${formatLeft(st.msLeft)}`
      : st.state === 'expired' ? '试用已结束'
        : st.state === 'activated' ? '已激活' : '未激活';
  }
  const m = gateEl.querySelector('#licMachine');
  if (m) m.textContent = machineCode();
  if (trialBtn) trialBtn.hidden = !(st.state === 'none');
  if (buy) {
    const C = contactNow();
    const lines = [];
    if (C.wechat) lines.push(`微信：${esc(C.wechat)}`);
    if (C.phone) lines.push(`电话：${esc(C.phone)}`);
    if (C.taobao) lines.push(`店铺：${esc(C.taobao)}`);
    buy.innerHTML = `<div class="ttl">怎么获取激活码？</div>
      ${lines.length ? `<div class="ln">${lines.join('</div><div class="ln">')}</div>` : '<div class="ln">请联系卖家索取激活码。</div>'}
      ${C.note ? `<div class="note">${esc(C.note)}</div>` : ''}`;
  }
}

function gateMsg(text, kind = 'err') {
  const el = gateEl && gateEl.querySelector('#licMsg');
  if (!el) return;
  el.textContent = text || '';
  el.dataset.kind = kind;
}

async function doActivate() {
  const input = gateEl && gateEl.querySelector('#licInput');
  const val = input ? input.value : '';
  const r = licActivate(localStore, val, Date.now());
  if (!r.ok) {
    gateMsg(r.reason === 'empty' ? '请先输入激活码' : '激活码不正确，请核对后重试（大小写、空格、横杠都可以忽略）');
    if (input) input.select();
    return;
  }
  await persistBoth();
  gateMsg('激活成功！', 'ok');
  toast.ok('激活成功，感谢支持！', 2600);
  closeGate();
  stopTicker();
  renderChip(currentStatus());
}

function closeGate() {
  if (gateEl) {
    gateEl.remove();
    gateEl = null;
    document.body.classList.remove('lic-locked');
  }
}

/* ---------------- 倒计时（试用期间） ---------------- */

function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    const st = currentStatus();
    renderChip(st);
    if (st.locked) {
      stopTicker();
      showGate();
    }
  }, 1000);
  renderChip(currentStatus());
}

function stopTicker() {
  if (ticker) { clearInterval(ticker); ticker = null; }
}

/* ---------------- 入口：启动时调用 ---------------- */

export async function initLicense() {
  if (!editionOn()) return;                     // 无限制版 / 测试模式：什么都不做
  try { cachedDbRec = await db.getSetting(LIC_DB_KEY, null); } catch { cachedDbRec = null; }
  await loadContact();
  const st = currentStatus();
  // 本机记录被清掉但数据库还有 → 补回本机（客户清缓存想重置试用是没用的）
  if (!localStore.read() && cachedDbRec) localStore.write(cachedDbRec);
  // 状态栏标签
  const chip = chipEl();
  if (chip) chip.onclick = () => openActivateDialog();
  renderChip(st);
  if (st.locked) { showGate(); return; }
  if (st.state === 'trial') startTicker();
}

/** 手动打开激活窗口（设置里 / 点状态栏标签） */
export function openActivateDialog() {
  if (!editionOn()) { toast.info('当前是无限制版，不需要激活', 2400); return; }
  const st = currentStatus();
  if (st.state === 'activated') { toast.ok('当前已是激活状态，永久可用', 2400); return; }
  showGate();
}
