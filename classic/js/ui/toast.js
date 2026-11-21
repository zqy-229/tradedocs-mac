/* =============================================================
 * 轻提示 Toast
 * ============================================================= */

const host = () => document.getElementById('toastHost');

export function toast(message, type = '', timeout = 2200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host().appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, timeout);
  return el;
}

export const ok = (m, ms) => toast(`✓ ${m}`, 'ok', ms);
export const err = (m, ms) => toast(`✕ ${m}`, 'err', ms ?? 3600);
export const warn = (m, ms) => toast(`! ${m}`, 'warn', ms ?? 3000);
export const info = (m, ms) => toast(m, '', ms);
