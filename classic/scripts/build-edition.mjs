/* =============================================================
 * 按版本打包：内部无限制版 / 客户激活版
 *
 * 用法：
 *   node scripts/build-edition.mjs free       → 无激活码版（内部用，功能完全一样）
 *   node scripts/build-edition.mjs licensed   → 客户版（12 小时试用 + 通用激活码）
 *
 * 做法：
 *   ① 改写 js/core/license.js 里的 EDITION 常量；
 *   ② 同步版本号（sw.js 缓存键 + 界面版本号）；
 *   ③ 临时把 package.json 里两个 artifactName 改成带版本后缀的名字，
 *      打完包无论如何都还原（避免两个版本重名、也避免把包名留在仓库里）；
 *   ④ 调 electron-builder。
 * ============================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edition = (process.argv[2] || '').toLowerCase();
if (!['free', 'licensed'].includes(edition)) {
  console.error('用法: node scripts/build-edition.mjs <free|licensed>');
  process.exit(1);
}

const isFree = edition === 'free';
const label = isFree ? '无激活码版' : '激活版';

/* ① 改写 EDITION */
const licPath = path.join(ROOT, 'js', 'core', 'license.js');
let src = fs.readFileSync(licPath, 'utf8');
const before = src;
src = src.replace(/^export const EDITION = '(free|licensed)';$/m, `export const EDITION = '${edition}';`);
if (src === before && !before.includes(`EDITION = '${edition}'`)) {
  console.error('✗ 没找到 EDITION 那一行，打包中止（避免打出错误版本）');
  process.exit(1);
}
fs.writeFileSync(licPath, src);
console.log(`✓ 版本：${isFree ? '内部无限制版（不弹激活）' : '客户版（12 小时试用 + 通用激活码）'}`);

/* ② 同步版本号 */
const sync = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-version.mjs')], { stdio: 'inherit' });
if (sync.status !== 0) process.exit(sync.status || 1);

/* ③ 临时改产物名（安装版走 win.artifactName，绿色版走 portable.artifactName） */
const pkgPath = path.join(ROOT, 'package.json');
const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);
const tag = pkg.editionLabel ? `-${pkg.editionLabel}` : '';
const winName = `TradeDocs${tag}-\${version}-${label}-x64.\${ext}`;
const portableName = `TradeDocs${tag}-\${version}-${label}-便携版.\${ext}`;
const savedWin = pkg.build.win.artifactName;
const savedPortable = pkg.build.portable && pkg.build.portable.artifactName;
pkg.build.win.artifactName = winName;
pkg.build.portable = { ...(pkg.build.portable || {}), artifactName: portableName };
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ 产物名：${winName.replace('${version}', pkg.version)} / ${portableName.replace('${version}', pkg.version)}`);

const restore = () => {
  try {
    const cur = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    cur.build.win.artifactName = savedWin;
    if (savedPortable === undefined) delete cur.build.portable.artifactName;
    else cur.build.portable.artifactName = savedPortable;
    if (cur.build.portable && !Object.keys(cur.build.portable).length) delete cur.build.portable;
    fs.writeFileSync(pkgPath, JSON.stringify(cur, null, 2) + '\n');
  } catch { /* 还原失败就保留原样，人工处理 */ }
};

/* ④ 打包 */
const cli = path.join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
console.log(`\n开始打包 ${pkg.version} · ${label}\n`);
const res = spawnSync(process.execPath, [cli, '--win', '--x64'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache'),
  },
});
restore();
process.exit(res.status || 0);
