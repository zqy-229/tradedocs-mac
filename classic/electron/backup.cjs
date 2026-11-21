/**
 * 备份服务（主进程侧）—— 三个版本共用
 *
 * 职责：
 *  · 写备份文件到 <userData>/backups/backup-YYYY-MM-DD-HHmmss.json
 *  · 只保留最近 N 份（默认 30），超出删最旧的
 *  · 列出已有备份（按时间倒序，带大小/条数）
 *  · 读出某份备份供渲染进程导入恢复
 *
 * 渲染进程用 preload 暴露的接口调用。
 */
const fs = require('node:fs');
const path = require('node:path');

const RETENTION = 30;

function backupDir(app) {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listBackups(app) {
  const dir = backupDir(app);
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => {
      const full = path.join(dir, n);
      const st = fs.statSync(full);
      let docs = null;
      try {
        const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
        docs = Array.isArray(raw?.data?.docs) ? raw.data.docs.length : null;
      } catch { docs = null; }
      return { name: n, path: full, size: st.size, mtime: st.mtimeMs, docs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function prune(app) {
  const list = listBackups(app);
  list.slice(RETENTION).forEach((b) => { try { fs.unlinkSync(b.path); } catch { /* 忽略 */ } });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function registerBackup({ ipcMain, app }) {
  ipcMain.handle('td:backup-save', async (ev, payload) => {
    try {
      const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const dir = backupDir(app);
      const name = `backup-${stamp()}.json`;
      const full = path.join(dir, name);
      fs.writeFileSync(full, json, 'utf8');
      prune(app);
      const st = fs.statSync(full);
      return { ok: true, name, path: full, size: st.size };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  ipcMain.handle('td:backup-list', async () => {
    try { return { ok: true, dir: backupDir(app), items: listBackups(app) }; }
    catch (err) { return { ok: false, error: String(err && err.message || err), items: [] }; }
  });

  ipcMain.handle('td:backup-read', async (ev, name) => {
    try {
      const full = path.join(backupDir(app), String(name || ''));
      if (!full.startsWith(backupDir(app))) return { ok: false, error: 'bad-path' };
      return { ok: true, text: fs.readFileSync(full, 'utf8') };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  ipcMain.handle('td:backup-open-dir', async () => {
    const { shell } = require('electron');
    const err = await shell.openPath(backupDir(app));
    return { ok: !err, dir: backupDir(app), error: err || null };
  });
}

module.exports = { registerBackup, listBackups, backupDir };
