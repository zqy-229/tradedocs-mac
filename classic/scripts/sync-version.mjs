/**
 * 把 package.json 的 version 同步进 sw.js 的缓存键 / manifest.json
 *
 * 用法：node scripts/sync-version.mjs [--check]
 *
 * 为什么需要它：
 *   Service Worker 缓存是 cache-first。浏览器只在 sw.js **字节内容变化**时才安装新 SW，
 *   如果代码更新了但缓存键没动，老用户升级后会一直用旧缓存 ——
 *   现象就是「换了版本，界面/功能还是老的」。
 *   手动记得改容易漏，所以让打包流程自动同步。
 *
 *   --check  只检查不写（CI / 验收用）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHECK = process.argv.includes("--check");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = pkg.version;
/** 缓存键就带完整版本号，例如 tradedocs-1.1.0 */
const swVersion = `tradedocs-${version}`;
/** 构建日期（只到天，避免每次构建都产生无意义的 diff） */
const today = new Date().toISOString().slice(0, 10);

const targets = [
  {
    file: "sw.js",
    re: /const VERSION = '[^']*';/,
    to: `const VERSION = '${swVersion}';`,
    desc: `Service Worker 缓存键 → ${swVersion}`,
  },
  {
    // 界面底部显示的版本号：用户装了两份时能一眼对比出跑的是哪一版
    file: "js/app.js",
    re: /export const APP_VERSION = '[^']*';/,
    to: `export const APP_VERSION = '${version}';`,
    desc: `界面版本号 → ${version}`,
  },
  {
    file: "js/app.js",
    re: /export const BUILD_DATE = '[^']*';/,
    to: `export const BUILD_DATE = '${today}';`,
    desc: `构建日期 → ${today}`,
  },
];

let changed = 0, stale = 0;
for (const t of targets) {
  const p = path.join(ROOT, t.file);
  let src = fs.readFileSync(p, "utf8");
  if (!t.re.test(src)) {
    console.log(`  ✗ ${t.file} 里找不到要同步的那一行（${t.re}）`);
    process.exitCode = 1;
    continue;
  }
  const cur = t.re.exec(src)[0];
  if (cur === t.to) continue;                       // 已经同步
  if (CHECK) {
    console.log(`  ✗ ${t.file} 过期：现在是 ${cur}，应为 ${t.to}`);
    stale++;
  } else {
    src = src.replace(t.re, t.to);
    fs.writeFileSync(p, src, "utf8");
    console.log(`  ✓ ${t.desc}`);
    changed++;
  }
}

if (CHECK) {
  if (stale) {
    console.log(`\n❌ 有 ${stale} 处版本号过期。跑 node scripts/sync-version.mjs 修一下。`);
    process.exit(1);
  }
  console.log(`✅ 版本号已同步（app ${version}）`);
} else {
  console.log(changed ? `\n已同步 ${changed} 处（app ${version}）` : `\n已是最新（app ${version}）`);
}
