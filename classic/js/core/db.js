/* =============================================================
 * 本地数据库层 — IndexedDB 轻封装（零依赖，替代 localforage）
 * 所有业务数据 100% 保存在本机浏览器，不联网、不上传
 * ============================================================= */

const DB_NAME = 'tradedocs';
const DB_VERSION = 4;

/** 当前数据库名（自测时可切到独立库，避免污染真实数据） */
let dbName = globalThis.__TRADEDOCS_DB_NAME__ || DB_NAME;

/** 切换数据库（仅供自测使用） */
export function useDatabase(name) {
  dbName = name || DB_NAME;
  dbPromise = null;
}

/** 对象仓库（表）清单 */
export const STORES = {
  docs: 'docs',               // 单据草稿（报价单/PI/合同/CI/PL）
  settings: 'settings',       // 全局设置（公司信息、编号规则、汇率等）
  customers: 'customers',     // 客户库
  products: 'products',       // 产品库
  clauses: 'clauses',         // 条款模板库
  revisions: 'revisions',     // 草稿历史快照
  history: 'history',         // 输入历史（按字段记录填过的值，用于下拉自动补全）
  profiles: 'profiles',       // 常用公司档案（卖方抬头历史，可增删改）
  banks: 'banks',             // 收款银行档案（收款人/开户行/账号/SWIFT…，可增删改）
};

/** 各仓库的主键字段名 */
export const STORE_KEY_PATHS = {
  [STORES.docs]: 'id',
  [STORES.settings]: 'key',
  [STORES.customers]: 'id',
  [STORES.products]: 'id',
  [STORES.clauses]: 'id',
  [STORES.revisions]: 'id',
  [STORES.history]: 'key',
  [STORES.profiles]: 'id',
  [STORES.banks]: 'id',
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('当前浏览器不支持 IndexedDB，无法本地存储'));
      return;
    }
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion || 0;

      if (!db.objectStoreNames.contains(STORES.docs)) {
        const s = db.createObjectStore(STORES.docs, { keyPath: 'id' });
        s.createIndex('type', 'type', { unique: false });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.customers)) {
        const s = db.createObjectStore(STORES.customers, { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.products)) {
        const s = db.createObjectStore(STORES.products, { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.clauses)) {
        const s = db.createObjectStore(STORES.clauses, { keyPath: 'id' });
        s.createIndex('category', 'category', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.revisions)) {
        const s = db.createObjectStore(STORES.revisions, { keyPath: 'id' });
        s.createIndex('docId', 'docId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.history)) {
        // keyPath = 字段名（如 companyName / bank.bankName），value = { key, values: [...] }
        db.createObjectStore(STORES.history, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.profiles)) {
        // 常用公司档案（卖方抬头）：可新增、可删除
        db.createObjectStore(STORES.profiles, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.banks)) {
        // 收款银行档案：和"常用公司"一样，存好一键套用到单据的银行信息
        db.createObjectStore(STORES.banks, { keyPath: 'id' });
      }
      void oldVersion;
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('打开本地数据库失败'));
    req.onblocked = () => reject(new Error('本地数据库被其他窗口占用，请关闭其他标签页后重试'));
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const objectStore = transaction.objectStore(store);
        let result;
        try {
          result = fn(objectStore, transaction);
        } catch (err) {
          reject(err);
          return;
        }
        transaction.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : result);
        transaction.onerror = () => reject(transaction.error || new Error('本地存储事务失败'));
        transaction.onabort = () => reject(transaction.error || new Error('本地存储事务被中止'));
      })
  );
}

/**
 * 单条写入（put）
 * 防御：主键为 undefined / null 时 IndexedDB 会抛 DataError
 * （曾因 `{ id: undefined, ...obj }` 展开导致「添加」按钮静默失效），这里统一拦掉
 */
export function put(store, value) {
  if (!value || typeof value !== 'object') {
    return Promise.reject(new Error(`写入 ${store} 失败：数据无效`));
  }
  if (STORE_KEY_PATHS[store] === 'id') {
    const v = value.id;
    if (v === undefined || v === null || v === '') {
      return Promise.reject(new Error(`写入 ${store} 失败：缺少主键 id`));
    }
  }
  if (STORE_KEY_PATHS[store] === 'key') {
    const v = value.key;
    if (v === undefined || v === null || v === '') {
      return Promise.reject(new Error(`写入 ${store} 失败：缺少主键 key`));
    }
  }
  return tx(store, 'readwrite', (s) => s.put(value));
}

/** 批量写入 */
export function putAll(store, values = []) {
  return tx(store, 'readwrite', (s) => {
    values.forEach((v) => s.put(v));
  });
}

/** 读取单条 */
export function get(store, key) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, 'readonly');
        const req = t.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      })
  );
}

/** 读取全部 */
export function getAll(store) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, 'readonly');
        const req = t.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      })
  );
}

/** 按索引读取 */
export function getAllByIndex(store, indexName, value) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, 'readonly');
        const req = t.objectStore(store).index(indexName).getAll(value);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      })
  );
}

/** 删除单条 */
export function del(store, key) {
  return tx(store, 'readwrite', (s) => s.delete(key));
}

/** 清空一个仓库 */
export function clear(store) {
  return tx(store, 'readwrite', (s) => s.clear());
}

/** 计数 */
export function count(store) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, 'readonly');
        const req = t.objectStore(store).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
      })
  );
}

/* ---------------- 设置（key-value） ---------------- */

export async function getSetting(key, fallback = null) {
  const row = await get(STORES.settings, key);
  return row && 'value' in row ? row.value : fallback;
}

export function setSetting(key, value) {
  return put(STORES.settings, { key, value, updatedAt: Date.now() });
}

export async function getSettings(keys = []) {
  const out = {};
  for (const k of keys) out[k] = await getSetting(k, null);
  return out;
}

/* ---------------- 单据草稿 ---------------- */

export function saveDoc(doc) {
  return put(STORES.docs, doc);
}

export function getDoc(id) {
  return get(STORES.docs, id);
}

export function listDocs(type = null) {
  return type ? getAllByIndex(STORES.docs, 'type', type) : getAll(STORES.docs);
}

export function deleteDoc(id) {
  return del(STORES.docs, id);
}

/* ---------------- 草稿历史快照 ---------------- */

export function addRevision(docId, snapshot, label = '自动保存') {
  return put(STORES.revisions, {
    id: `${docId}__${Date.now()}`,
    docId,
    label,
    snapshot,
    createdAt: Date.now(),
  });
}

export async function listRevisions(docId) {
  const rows = await getAllByIndex(STORES.revisions, 'docId', docId);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** 只保留最近 N 条快照，避免占用空间 */
export async function pruneRevisions(docId, keep = 20) {
  const rows = await listRevisions(docId);
  const drop = rows.slice(keep);
  for (const r of drop) await del(STORES.revisions, r.id);
  return drop.length;
}

/* ---------------- 输入历史（下拉自动补全用） ---------------- */

const HISTORY_MAX_PER_FIELD = 30;

/**
 * 记录一个字段填过的值
 * @param {string} key 字段名（如 companyName / city / bank.bankName）
 * @param {string} value 用户填写的内容
 */
export async function rememberValue(key, value) {
  const v = String(value ?? '').trim();
  if (!key || v.length < 2 || v.length > 160) return null;
  const row = (await get(STORES.history, key)) || { key, values: [] };
  const list = Array.isArray(row.values) ? row.values : [];
  const idx = list.findIndex((x) => x.value === v);
  if (idx >= 0) {
    list[idx] = { value: v, count: (list[idx].count || 1) + 1, lastUsed: Date.now() };
  } else {
    list.push({ value: v, count: 1, lastUsed: Date.now() });
  }
  // 按使用次数 + 最近使用排序，只留前 N 个，避免无限膨胀
  list.sort((a, b) => (b.count - a.count) || (b.lastUsed - a.lastUsed));
  row.values = list.slice(0, HISTORY_MAX_PER_FIELD);
  row.updatedAt = Date.now();
  await put(STORES.history, row);
  return row;
}

/** 读取某字段的历史值（按最近使用/次数排序，返回字符串数组） */
export async function getHistory(key) {
  const row = await get(STORES.history, key);
  if (!row || !Array.isArray(row.values)) return [];
  return row.values
    .slice()
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || (b.count || 0) - (a.count || 0))
    .map((x) => x.value);
}

/** 批量读取多个字段的历史 */
export async function getHistories(keys = []) {
  const out = {};
  for (const k of keys) out[k] = await getHistory(k);
  return out;
}

/** 历史记录总条数（设置里显示用） */
export async function historyCount() {
  const rows = await getAll(STORES.history);
  return rows.reduce((s, r) => s + (Array.isArray(r.values) ? r.values.length : 0), 0);
}

/* ---------------- 全量备份 / 恢复 ---------------- */

export async function exportAll() {
  const data = {};
  for (const name of Object.values(STORES)) {
    data[name] = await getAll(name);
  }
  return {
    app: 'TradeDocs',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export async function importAll(payload, { merge = true } = {}) {
  if (!payload || !payload.data) throw new Error('备份文件格式不正确');
  const stats = {};
  for (const name of Object.values(STORES)) {
    const rows = Array.isArray(payload.data[name]) ? payload.data[name] : [];
    if (!merge) await clear(name);
    if (rows.length) await putAll(name, rows);
    stats[name] = rows.length;
  }
  return stats;
}

/** 粗略估算本地占用 */
export async function estimateUsage() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    }
  } catch { /* 忽略 */ }
  return { usage: 0, quota: 0 };
}

/** 请求持久化存储权限，降低被系统清理的概率 */
export async function requestPersistent() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch { /* 忽略 */ }
  return false;
}
