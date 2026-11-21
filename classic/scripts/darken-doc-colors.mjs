/**
 * 把单据 / 界面的文字色压到「浅黑」级别（对比度 ≥10:1）
 *
 * 用法：node scripts/darken-doc-colors.mjs --level 10 [--write]
 *
 * 背景：用户反馈「很多灰色字体，换成浅黑色，太不明显了」。
 * 上一版压到 7:1，数值上达标（AA 是 4.5），但**偏蓝灰**，
 * 主观上仍然是"灰的"。这一版把正文级文字统一提到 10:1 以上，
 * 观感才算"浅黑"；只有真正次要的信息（提示、辅助标签）才留在 7~8:1。
 */
import fs from "node:fs";

const WRITE = process.argv.includes("--write");
const lvlIdx = process.argv.indexOf("--level");
const LEVEL = lvlIdx >= 0 ? Number(process.argv[lvlIdx + 1]) : 10;
const WHITE = "#ffffff";

const hex2rgb = (h) => {
  const s = h.replace("#", "");
  const v = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};
const rgb2hex = ([r, g, b]) => "#" + [r, g, b].map((c) =>
  Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
const lum = ([r, g, b]) => {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (fg, bg) => {
  const [l1, l2] = [lum(hex2rgb(fg)), lum(hex2rgb(bg))].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
};
const rgb2hsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
};
const hsl2rgb = ([h, s, l]) => {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
};
/**
 * 保持色相，把颜色压暗到「对所有目标背景都达到 min 对比度」。
 *
 * 实现：从当前明度往下**逐档扫描**（步长小），第一个达标的就是答案。
 * 不用二分 —— 二分在「函数不单调」的边界情况会返回 null，
 * 之前就是这么写出 undefined 的。扫描虽然朴素但没有死角。
 */
const darkenTo = (hex, targets) => {
  const hsl = rgb2hsl(hex2rgb(hex));
  const ok = (c) => targets.every((t) => contrast(c, t.bg) >= t.min);
  if (ok(hex)) return hex;
  for (let l = hsl[2]; l >= 0; l -= 0.004) {
    const cand = rgb2hex(hsl2rgb([hsl[0], hsl[1], l]));
    if (ok(cand)) return cand;                 // 从当前明度逐渐变暗，第一个达标即最优（最浅且达标）
  }
  return rgb2hex(hsl2rgb([hsl[0], hsl[1], 0])); // 纯黑兜底
};

/* ---------- 单据主题（render.js） ---------- */
// 解析要稳：一行形如
//   blue: { ink: '#16233a', ink2: '#303a4a', soft: '#4b5461', line: '#c8d1de', accent: '#1f5fd6', band: '#f2f5f9' },
// 用全局正则逐对抓，别按逗号切（之前那样切出过 undefined）
const P = "js/doc/render.js";
const src = fs.readFileSync(P, "utf8");
const m = /export const THEME_DOC_VARS = \{([\s\S]*?)\n\};/.exec(src);
const themes = {};
for (const line of m[1].split("\n")) {
  const t = /^\s*(\w+):\s*\{(.+?)\},?\s*$/.exec(line);
  if (!t) continue;
  const vars = {};
  for (const kv of t[2].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{3,6})'/g)) vars[kv[1]] = kv[2];
  const need = ["ink", "ink2", "soft", "line", "accent", "band"];
  const missing = need.filter((k) => !vars[k]);
  if (missing.length) {
    console.log(`  ✗ 主题 ${t[1]} 解析缺字段: ${missing.join(", ")} —— 中止，避免写出 undefined`);
    process.exit(1);
  }
  themes[t[1]] = vars;
}
console.log(`解析到 ${Object.keys(themes).length} 个主题: ${Object.keys(themes).join(", ")}\n`);

console.log(`目标：正文级文字 ≥ ${LEVEL}:1（浅黑）；真正的次要信息留在 7:1\n`);
console.log("主题         变量    原色 → 新色        白底    底纹");
console.log("-".repeat(62));
/**
 * 判断一个颜色是不是「偏灰」—— 用户抱怨的就是灰，不是深色主题色。
 *
 * 用 HSL 饱和度区分：
 *   · soft / ink2 这类辅助文字饱和度低（<30%），看着发灰 → 要压到 10:1
 *   · red / orange / green 主题的 ink 饱和度高（40%+），本来就是彩色主文字，
 *     已经在 9~10:1，**再压会丢掉主题色彩**（red.ink 从 #8c1c22 变 #74171c 就死了）
 */
const isGrayish = (hex) => {
  const [, s] = rgb2hsl(hex2rgb(hex));
  return s < 0.30;
};

const out = {};
for (const [name, v] of Object.entries(themes)) {
  out[name] = { ...v };
  const band = v.band || WHITE;
  for (const key of ["ink", "ink2", "soft"]) {
    const src0 = v[key];
    if (!src0) continue;
    // 主文字（ink）如果是彩色主题色，只要达到 7:1 就保留原样，别压暗
    const target = (key === "ink" && !isGrayish(src0)) ? 7 : LEVEL;
    const r = darkenTo(src0, [{ bg: WHITE, min: target }, { bg: band, min: target }]);
    if (!r) continue;
    out[name][key] = r;
    if (r !== src0) {
      console.log(`${name.padEnd(13)} ${key.padEnd(7)} ${src0} → ${r}   ${contrast(r, WHITE).toFixed(2)}   ${contrast(r, band).toFixed(2)}   (目标 ${target})`);
    }
  }
  // accent 是有色小标题，保持 4.5 即可（再深就丢了色彩感）
  const a = darkenTo(v.accent, [{ bg: WHITE, min: 4.5 }]);
  if (a) out[name].accent = a;
}

const lines = Object.entries(out).map(([name, v]) =>
  `  ${name}: { ink: '${v.ink}', ink2: '${v.ink2}', soft: '${v.soft}', line: '${v.line}', accent: '${v.accent}', band: '${v.band}' },`);
const block = `export const THEME_DOC_VARS = {\n${lines.join("\n")}\n};`;
console.log("\n新的 THEME_DOC_VARS：\n" + block);

if (WRITE) {
  fs.writeFileSync(P, src.replace(/export const THEME_DOC_VARS = \{[\s\S]*?\n\};/, block), "utf8");
  console.log(`\n✓ 已写入 ${P}`);
  console.log("⚠️ 记得同步 css/app.css 里 blue 主题的 --doc-* 与各主题的 --doc-* 覆盖值");
} else {
  console.log("\n（预览。加 --write 才写入）");
}
