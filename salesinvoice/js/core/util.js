/* =============================================================
 * 外贸单证工作台 TradeDocs — 通用工具函数
 * 纯前端 / 无依赖 / 离线可用
 * ============================================================= */

/** 生成唯一 ID */
export function uid(prefix = '') {
  let id;
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    id = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  } else {
    id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  return prefix ? `${prefix}_${id}` : id;
}

/** 今天日期 yyyy-MM-dd */
export function today() {
  return toDateInput(new Date());
}

/** 在日期上加天数 */
export function addDays(dateLike, days) {
  const d = parseDateInput(dateLike) || new Date();
  const n = new Date(d.getTime() + Number(days || 0) * 86400000);
  return toDateInput(n);
}

/** Date -> yyyy-MM-dd */
export function toDateInput(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** yyyy-MM-dd -> Date（本地时区，避免 UTC 偏移） */
export function parseDateInput(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 单据上的日期显示格式：DD MMM YYYY */
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDateDoc(s) {
  const d = parseDateInput(s);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`;
}

/** 数字保留 n 位小数（四舍五入，规避 1.005 → 1 的浮点误差，负数对称处理） */
export function round(n, digits = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const d = Math.max(0, Math.min(10, Number(digits) || 0));
  const sign = v < 0 ? -1 : 1;
  // 用指数写法规避二进制浮点误差（如 1.005 * 100 = 100.49999999999999）
  const shifted = Number(`${Math.abs(v)}e${d}`);
  const rounded = Number.isFinite(shifted)
    ? Math.round(shifted)
    : Math.round(Math.abs(v) * Math.pow(10, d));
  const out = Number(`${rounded}e-${d}`);
  const result = sign * (Number.isFinite(out) ? out : rounded / Math.pow(10, d));
  return Object.is(result, -0) ? 0 : result;
}

/** 金额显示：千分位 + 指定小数位 */
export function money(n, digits = 2) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 数量显示：最多 3 位小数，去尾 0 */
export function qty(n, digits = 3) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** 汇率换算 */
export function convert(amount, rate) {
  return round((Number(amount) || 0) * (Number(rate) || 0), 2);
}

/** HTML 转义 */
export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 多行文本 -> HTML（保留换行） */
export function escLines(s) {
  return esc(s).replace(/\r?\n/g, '<br>');
}

/** 深拷贝（结构化克隆，降级 JSON） */
export function clone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  try {
    return structuredClone(obj);
  } catch {
    return JSON.parse(JSON.stringify(obj));
  }
}

/** 安全取值 a.b.c */
export function get(obj, path, fallback = undefined) {
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return fallback;
    cur = cur[p];
  }
  return cur === undefined ? fallback : cur;
}

/** 复制文本到剪贴板 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 降级 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Blob 下载（本地导出，不联网） */
export function download(filename, content, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 读取本地文件为文本 */
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('读取文件失败'));
    fr.readAsText(file);
  });
}

/** 读取本地文件为 DataURL（图片存 IndexedDB 用） */
export function readFileDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('读取文件失败'));
    fr.readAsDataURL(file);
  });
}

/** 判断是不是带透明通道的图片（PNG / WebP / GIF / SVG） */
export function isPngLike(dataUrl) {
  return /^data:image\/(png|webp|gif|svg\+xml)/i.test(String(dataUrl || ''));
}

/** 压缩图片，避免 IndexedDB 爆满；PNG 保留透明通道 */
export function compressImage(file, maxSize = 900, quality = 0.82) {
  return readFileDataURL(file).then(
    (dataUrl) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, maxSize / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          const keepAlpha = isPngLike(dataUrl);
          if (!keepAlpha) {
            // 普通产品照：铺白底，避免透明处变黑
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
          }
          ctx.drawImage(img, 0, 0, width, height);
          try {
            resolve(keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality));
          } catch {
            resolve(dataUrl);
          }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      })
  );
}

/**
 * 压缩印章图片 —— 与普通图片不同：
 *  · 强制 PNG 输出并保留透明背景，否则盖章会是一个白底方块
 *  · 压缩更保守，避免红色印章线条糊掉
 */
export function compressStamp(file, maxSize = 520) {
  return readFileDataURL(file).then(
    (dataUrl) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, maxSize / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, width, height);      // 关键：不铺白底
          ctx.drawImage(img, 0, 0, width, height);
          try {
            resolve(canvas.toDataURL('image/png'));
          } catch {
            resolve(dataUrl);
          }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      })
  );
}

/** 防抖 */
export function debounce(fn, wait = 300) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.flush = (...args) => {
    if (timer) clearTimeout(timer);
    timer = null;
    fn(...args);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/** 保存字节数可读化 */
export function bytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(2)} MB`;
}

/** 相对时间（刚刚 / 3 分钟前 …） */
export function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (diff < 30 * 1000) return '刚刚';
  if (diff < 60 * 1000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 30 * 86400 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
  const d = new Date(Number(ts));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 数字输入解析 */
export function num(v, fallback = 0) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

/** 排序：按 order 字段 */
export function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0);
}

/** 简易模板字符串替换 {key} */
export function interpolate(str, vars) {
  return String(str || '').replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? String(vars[k]) : ''));
}
