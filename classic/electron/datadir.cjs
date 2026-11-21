/**
 * 数据目录定位 + 迁移（三个版本共用）
 *
 * 规则：
 *  · 默认目录：<appData>/<产品目录名>（原版=外贸单证工作台，定制版各自独立）
 *  · 用户可在设置里改成别的盘/文件夹，位置记录在
 *      <appData>/<产品目录名>-datalocation.json  （放在默认位置，启动时一定读得到）
 *  · 启动时若记录的位置不可用（U 盘拔了/目录被删），自动回退默认目录，并把 fallback 标记给界面提示
 */
const fs = require('node:fs');
const path = require('node:path');

const LOCATION_FILE_SUFFIX = '-datalocation.json';

function pointerPath(app, productDirName) {
  return path.join(app.getPath('appData'), productDirName + LOCATION_FILE_SUFFIX);
}

function readPointer(app, productDirName) {
  try {
    const p = pointerPath(app, productDirName);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const dir = raw && typeof raw.dir === 'string' ? raw.dir.trim() : '';
    return dir || null;
  } catch { return null; }
}

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.td-write-test');
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

/** 在 app ready 之前调用；返回 { dir, fallbackFrom } */
function resolveDataDir({ app, productDirName }) {
  const def = path.join(app.getPath('appData'), productDirName);
  const custom = readPointer(app, productDirName);
  if (custom) {
    if (fs.existsSync(custom) && writable(custom)) {
      app.setPath('userData', custom);
      return { dir: custom, fallbackFrom: null };
    }
    // 记录的位置不可用 → 回退默认
    app.setPath('userData', def);
    return { dir: def, fallbackFrom: custom };
  }
  app.setPath('userData', def);
  return { dir: def, fallbackFrom: null };
}

/** 复制数据目录（跳过缓存类子目录，避免搬几百 MB 垃圾） */
function copyDataDir(from, to) {
  const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary', 'blob_storage']);
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (SKIP.has(name)) continue;
    const src = path.join(from, name);
    const dst = path.join(to, name);
    try {
      const st = fs.statSync(src);
      if (st.isDirectory()) fs.cpSync(src, dst, { recursive: true, force: true });
      else fs.copyFileSync(src, dst);
    } catch { /* 单个失败不整体中断 */ }
  }
}

function registerDataDir({ ipcMain, app, dialog, productDirName, getWindow }) {
  ipcMain.handle('td:data-dir-info', () => {
    const cur = app.getPath('userData');
    const ptr = readPointer(app, productDirName);
    return {
      dir: cur,
      defaultDir: path.join(app.getPath('appData'), productDirName),
      custom: ptr || null,
      isCustom: !!(ptr && path.resolve(ptr) === path.resolve(cur)),
    };
  });

  ipcMain.handle('td:data-dir-move', async () => {
    const win = getWindow && getWindow();
    const pick = await dialog.showOpenDialog(win || undefined, {
      title: '选择新的数据存放文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (pick.canceled || !pick.filePaths?.length) return { ok: false, reason: 'cancel' };
    const target = path.join(pick.filePaths[0], productDirName);
    if (!writable(target)) return { ok: false, reason: 'not-writable', target };
    try {
      copyDataDir(app.getPath('userData'), target);
      fs.writeFileSync(pointerPath(app, productDirName), JSON.stringify({ dir: target, at: Date.now() }, null, 2));
      return { ok: true, dir: target, needRestart: true };
    } catch (err) {
      return { ok: false, reason: 'copy-failed', error: String(err && err.message || err) };
    }
  });

  ipcMain.handle('td:data-dir-reset', () => {
    try {
      const p = pointerPath(app, productDirName);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return { ok: true, needRestart: true };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
}

module.exports = { resolveDataDir, registerDataDir, copyDataDir, pointerPath };
