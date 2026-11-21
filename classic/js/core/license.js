/* =============================================================
 * 授权（激活）—— 软授权 / 试用 + 通用激活码
 *
 * 设计目标（按需求："伪装激活就行，主要唬住客户"）：
 *   · 首次启动给 **12 小时试用**，到期后弹激活窗口；
 *   · 一个**通用激活码**，所有客户通用；
 *   · 记录做两处冗余（localStorage + IndexedDB）并带签名，
 *     只清 localStorage 不能重置试用；手改记录会校验失败 → 直接锁；
 *   · 系统时间往回拨（想"续命"试用）也会被判定异常 → 锁。
 *
 * ⚠️ 说明：这是**软锁**，不是加密授权。代码是明文 JS，懂技术的人绕过它并不难；
 *    它拦的是正常客户的"我也能用"心理，不拦逆向。真要强授权得走服务端校验。
 * ============================================================= */

/* ---------------- 版本与配置 ----------------
 * EDITION 这一行由 scripts/build-edition.mjs 改写：
 *   'licensed' —— 客户版（带试用 + 激活码）
 *   'free'     —— 内部无限制版（不弹激活，功能完全一样）
 */
export const EDITION = 'licensed';

/** 通用激活码（所有客户同一个）。输入时会忽略大小写、空格和横杠 */
export const UNIVERSAL_CODE = 'TD-PRO-2026-8888';

/** 试用时长：半天 = 12 小时 */
export const TRIAL_HOURS = 12;
export const TRIAL_MS = TRIAL_HOURS * 60 * 60 * 1000;

/** 购买联系方式（激活窗口里显示给客户）。
 *  留空也没关系：激活窗口会显示下面的 note；正式发给客户前在
 *  「设置 → 授权状态 → 联系方式」里填一次即可（不用重新打包）。 */
export const CONTACT = {
  wechat: '',
  phone: '',
  taobao: '',
  note: '购买后发一个激活码：一码通用、永久可用，后续升级免费。',
};

/** 记录签名用的常量（只为"看起来正规"+防手改，不是密钥） */
const SECRET = 'td-lic-1f4b8e2a|sunvl';
const STORE_KEY = 'td.license.v1';

/* ---------------- 纯函数（可单测） ---------------- */

/** 激活码归一化：去空格/横杠、转大写 → 客户大小写随便打都能过 */
export function normCode(input) {
  return String(input == null ? '' : input).replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

/** 简易哈希（djb2 → base36），够用且无依赖 */
export function hashCode(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** 给记录打签名：状态/时间/码任一被改，签名就对不上 */
export function signRecord(rec) {
  return hashCode([SECRET, rec.state, rec.start, rec.code, rec.v].join('|'));
}

/** 生成一条记录 */
export function makeRecord(state, now, code = '') {
  const rec = {
    v: 1,
    state,                       // 'trial' | 'activated'
    start: Math.round(now || Date.now()),
    code: state === 'activated' ? hashCode(normCode(code || UNIVERSAL_CODE)) : '',
  };
  rec.sig = signRecord(rec);
  return rec;
}

/**
 * 校验一条记录
 * @returns {{ok:boolean, state:string, msLeft:number, reason:string}}
 *          state: 'none' | 'trial' | 'activated' | 'expired' | 'bad'
 */
export function verifyRecord(rec, now = Date.now()) {
  const none = { ok: false, state: 'none', msLeft: 0, reason: 'none' };
  if (!rec || typeof rec !== 'object') return none;
  if (rec.v !== 1 || (rec.state !== 'trial' && rec.state !== 'activated')) {
    return { ok: false, state: 'bad', msLeft: 0, reason: 'shape' };
  }
  if (signRecord(rec) !== rec.sig) return { ok: false, state: 'bad', msLeft: 0, reason: 'sig' };
  if (rec.state === 'activated') {
    // 激活码必须是通用码算出来的哈希（改码 → 这里不过）
    if (rec.code !== hashCode(normCode(UNIVERSAL_CODE))) {
      return { ok: false, state: 'bad', msLeft: 0, reason: 'code' };
    }
    return { ok: true, state: 'activated', msLeft: Infinity, reason: 'ok' };
  }
  // 试用：时钟往回拨超过 1 分钟 → 判为"改系统时间续命"
  const elapsed = now - rec.start;
  if (elapsed < -60 * 1000) return { ok: false, state: 'bad', msLeft: 0, reason: 'clock' };
  const msLeft = TRIAL_MS - Math.max(0, elapsed);
  if (msLeft <= 0) return { ok: false, state: 'expired', msLeft: 0, reason: 'expired' };
  return { ok: true, state: 'trial', msLeft, reason: 'ok' };
}

/**
 * 把两边（本机 localStorage / 数据库）的记录合起来判断
 * · 只有一边有 → 就用它（并回头补齐另一边）
 * · 两边都有且都能校验 → 取"更强"的那个（已激活 > 试用），试用起始时间取更早的
 * · 任何一边校验失败 → 判为被改过，锁
 */
export function resolveStatus(localRec, dbRec, now = Date.now()) {
  const a = localRec ? verifyRecord(localRec, now) : null;
  const b = dbRec ? verifyRecord(dbRec, now) : null;
  if (a && (a.state === 'bad')) return { ...a, tampered: true, rec: localRec };
  if (b && (b.state === 'bad')) return { ...b, tampered: true, rec: dbRec };
  if (!a && !b) return { ok: false, state: 'none', msLeft: 0, reason: 'none' };
  if (a && !b) return { ...a, rec: localRec };
  if (!a && b) return { ...b, rec: dbRec };
  // 两边都能校验：已激活优先；都是试用则取较早的起始时间（不吃亏）
  if (a.state === 'activated' || b.state === 'activated') {
    return { ok: true, state: 'activated', msLeft: Infinity, reason: 'ok', rec: a.state === 'activated' ? localRec : dbRec };
  }
  const rec = localRec.start <= dbRec.start ? localRec : dbRec;
  return { ...verifyRecord(rec, now), rec };
}

/* ---------------- 存储适配（浏览器 / Electron / 单测各一套） ---------------- */

/** 默认存储：localStorage（同步，启动时能立刻判断） */
export const localStore = {
  read() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  write(rec) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rec)); return true; } catch { return false; }
  },
  clear() {
    try { localStorage.removeItem(STORE_KEY); } catch { /* 忽略 */ }
  },
};

/** 内存存储（单测用） */
export function memoryStore(initial = null) {
  let rec = initial;
  return { read: () => rec, write: (r) => { rec = r; return true; }, clear: () => { rec = null; } };
}

/* ---------------- 状态查询 / 动作（store 可注入，便于单测） ---------------- */

/** 只看本机记录 + 数据库副本的状态 */
export function status(store = localStore, dbRec = null, now = Date.now()) {
  if (EDITION !== 'licensed') {
    return { ok: true, state: 'free', msLeft: Infinity, reason: 'free', locked: false, rec: null };
  }
  const st = resolveStatus(store.read(), dbRec, now);
  const locked = !(st.state === 'activated' || st.state === 'trial');
  return { ...st, locked };
}

/** 开始试用（返回新状态） */
export function startTrial(store = localStore, now = Date.now()) {
  const cur = status(store, null, now);
  // 试用过（不管到期没到期）就不再给 —— 反正清 localStorage 也没用，数据库那边还留着
  if (cur.state === 'trial' || cur.state === 'activated' || cur.state === 'expired') return cur;
  const rec = makeRecord('trial', now);
  store.write(rec);
  return status(store, null, now);
}

/** 用激活码激活 */
export function activate(store = localStore, input = '', now = Date.now()) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false, reason: 'empty' };
  const code = normCode(raw);
  // 全是没法识别的字符（比如中文、乱码）也按"不正确"处理，别报"没填"
  if (!code || code !== normCode(UNIVERSAL_CODE)) return { ok: false, reason: 'wrong' };
  const rec = makeRecord('activated', now, code);
  store.write(rec);
  return { ok: true, state: 'activated', rec };
}

/** 已激活？ */
export function isActivated(store = localStore, dbRec = null, now = Date.now()) {
  return status(store, dbRec, now).state === 'activated';
}

/** 剩余时间格式化：11:58:12 / 45 分钟 */
export function formatLeft(ms) {
  if (!isFinite(ms)) return '';
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

/** 归一化后的通用码（填进提示文案用） */
export const UNIVERSAL_CODE_DISPLAY = UNIVERSAL_CODE;
