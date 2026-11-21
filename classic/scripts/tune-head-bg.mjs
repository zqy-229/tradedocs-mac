/**
 * 校验并微调「表头底色」色板
 *
 * 用法：node scripts/tune-head-bg.mjs [--write]
 *
 * 手工选的色板比"往深色混"更耐看（混深会把色相洗成灰）。
 * 这里只做一件事：逐个校验「表头上的深色文字 ≥7:1」，
 * 不达标的就朝白色方向提亮，直到达标 —— 只动不达标的，别的不碰。
 */
import fs from "node:fs";

const WRITE = process.argv.includes("--write");
const TARGET = 7.0;

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
const contrast = (a, b) => {
  const [l1, l2] = [lum(hex2rgb(a)), lum(hex2rgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const mix = (a, b, t) => rgb2hex(hex2rgb(a).map((v, i) => v + (hex2rgb(b)[i] - v) * t));

// 手选色板：比 band 明显一档的浅色底，色相跟着主题走
const PALETTE = {
  blue: "#dce4f0",
  red: "#f7dede",
  green: "#dbebe3",
  purple: "#e8dff5",
  graphite: "#e9e4da",
  navy: "#dbe5f1",
  orange: "#f8e5d4",
};

const RENDER = "js/doc/render.js";
const src = fs.readFileSync(RENDER, "utf8");
const m = /export const THEME_DOC_VARS = \{([\s\S]*?)\n\};/.exec(src);
const themes = {};
for (const line of m[1].split("\n")) {
  const t = /^\s*(\w+):\s*\{(.+?)\},?\s*$/.exec(line);
  if (!t) continue;
  const vars = {};
  for (const kv of t[2].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{3,6})'/g)) vars[kv[1]] = kv[2];
  themes[t[1]] = vars;
}

console.log("主题         深字色    表头底      深字对比度   处理");
console.log("-".repeat(60));
const out = {};
for (const [name, v] of Object.entries(themes)) {
  const ink = v.ink;
  let head = PALETTE[name] || v.band;
  const before = contrast(ink, head);
  let action = "不变";
  if (before < TARGET) {
    // 朝白色提亮，直到达标（步长 0.01）
    for (let t = 0.01; t <= 1; t += 0.01) {
      const cand = mix(head, "#ffffff", t);
      if (contrast(ink, cand) >= TARGET) { head = cand; break; }
    }
    action = `调浅（原 ${before.toFixed(2)}:1）`;
  }
  const c = contrast(ink, head);
  out[name] = { ...v, headBg: head };
  console.log(`${name.padEnd(12)} ${ink}  ${head}  ${c.toFixed(2).padStart(6)}:1   ${action}`);
}

const lines = Object.entries(out).map(([name, v]) =>
  `  ${name}: { ink: '${v.ink}', ink2: '${v.ink2}', soft: '${v.soft}', line: '${v.line}', accent: '${v.accent}', band: '${v.band}', headBg: '${v.headBg}' },`);
const block = `export const THEME_DOC_VARS = {\n${lines.join("\n")}\n};`;

if (WRITE) {
  fs.writeFileSync(RENDER, src.replace(/export const THEME_DOC_VARS = \{[\s\S]*?\n\};/, block), "utf8");
  console.log(`\n✓ 已写入 ${RENDER}`);
  console.log("\n同步 css/app.css 用：");
  console.log(`  :root   → --doc-head-bg: ${out.blue.headBg};`);
  for (const [name, v] of Object.entries(out)) {
    if (name === "blue") continue;
    console.log(`  ${name.padEnd(8)} → --doc-head-bg: ${v.headBg};`);
  }
} else {
  console.log("\n（预览。加 --write 才写入）");
}
