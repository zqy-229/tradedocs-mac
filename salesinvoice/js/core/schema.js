/* =============================================================
 * 单据数据模型 —— 空白单据工厂 / 字段清单 / 迁移
 * 5 套单据共用一套底层结构，按类型决定表格列与汇总口径
 * ============================================================= */

import { uid, today, addDays } from './util.js';
import { defaultSi, sampleSiItems } from './si-schema.js';
import { INCOTERMS, DOC_LANGS } from './templates.js';

/** 单据类型注册表
 *  withBank：单据上会渲染收款银行信息（编辑页必须有对应输入框，否则用户改不了）
 *  icon：界面上的类型图标（页签、类型条、新建入口共用）
 */
export const DOC_TYPES = [
  // 定制版三号新增：Sales Invoice Duplicate（照 novatech 模板，放在第一个）
  { type: 'sales_invoice', prefix: 'SIV', icon: '🧾', mode: 'sales' },
  { type: 'quotation', prefix: 'QT', icon: '📄', mode: 'money' },
  { type: 'pi', prefix: 'PI', icon: '🧾', mode: 'money', withBank: true },
  // 合同底部也有银行 / 开证行信息（对照真实合同版式），所以同样需要银行区
  { type: 'contract', prefix: 'SC', icon: '📝', mode: 'money', withContract: true, withBank: true },
  { type: 'ci', prefix: 'CI', icon: '🧮', mode: 'money', withHs: true, withMarks: true, withBank: true },
  { type: 'pl', prefix: 'PL', icon: '📦', mode: 'packing', withMarks: true },
  // 水单：银行收付凭证（收款方/付款方/金额/手续费/附言…），无产品明细表
  { type: 'bank', prefix: 'BS', icon: '🏦', mode: 'bank' },
  /* ============ 以下为融合 TradeKit 新增单据类型 ============ */
  // 无金额名称类单据（mode:'plain'）：提单 / 原产地证明 / 报关单 / 检验证书 /
  // 熏蒸证书 / 受益人证明 / 发货人委托书 / 保险单 —— 走统一「名称类无金额」版式
  { type: 'bill_of_lading', prefix: 'BL', icon: '🚢', mode: 'plain' },
  // 装船指示 / 提单补料（SI）：出货前发给货代/船公司，用来做提单
  { type: 'shipping_instruction', prefix: 'SI', icon: '📋', mode: 'plain', withHs: true, withMarks: true },
  // 装船通知（SA）：开船后发给国外客户，告知已装船 + 船名航次 + ETD/ETA，方便买保险和清关
  { type: 'shipping_advice', prefix: 'SA', icon: '📤', mode: 'plain', withHs: true },
  { type: 'certificate_of_origin', prefix: 'CO', icon: '🌍', mode: 'plain' },
  // 报关单虽走 plain 版式，但 exradoc 的报关单表格里有单价 / 总价 → 用 withMoney 打开金额列；
  // weightByCtns：官方的件数 / 毛重 / 净重是整票口径，按「箱数 × 每箱重量」汇总；
  // landscape：官方表格是横向宽表（9 个栏目），纵向 A4 塞不下 → 预览/打印都用 A4 横向
  // 申报要素：把产品的申报要素（材质/用途/品牌/型号/优惠关税…）汇成一张表，
  // 给报关行/货代申报用。产品要素存在产品库里，勾选后自动填表。
  { type: 'declaration_elements', prefix: 'DE', icon: '📋', mode: 'plain', landscape: true },
  { type: 'customs_declaration', prefix: 'CD', icon: '🛃', mode: 'plain', withMoney: true, weightByCtns: true, landscape: true },
  { type: 'inspection_certificate', prefix: 'IC', icon: '🔬', mode: 'plain' },
  { type: 'fumigation_certificate', prefix: 'FC', icon: '🚫', mode: 'plain' },
  { type: 'beneficiary_certificate', prefix: 'BC', icon: '📜', mode: 'plain' },
  { type: 'shipper_letter_instruction', prefix: 'SL', icon: '✉️', mode: 'plain' },
  { type: 'insurance_policy', prefix: 'IP', icon: '🛡️', mode: 'plain' },
  // 成本估算单：有金额，走 money 模式统一框架
  { type: 'cost_estimation', prefix: 'CE', icon: '🧮', mode: 'money' },
];

/** 单据类型简短说明（空态与新建入口用，让人一眼知道这单是干嘛的） */
export const DOC_HINTS = {
  sales_invoice: '销售发票 Duplicate（英式 CI，含 VAT 与 VC 列）',
  quotation: '给客户报价，可标有效期',
  pi: '客户用来申请外汇 / 开信用证',
  contract: '双方签约用，含 7 条标准条款',
  ci: '目的国清关用，含 HS 编码与唛头',
  pl: '配套 CI 给海关，只体现重量体积',
  bank: '银行收付凭证，核对客户到账（收款方 / 付款方 / 金额 / 手续费）',
  bill_of_lading: '海运提单，船公司签发（发货人 / 收货人 / 通知方 / 船名航次）',
  certificate_of_origin: '原产地证明，证明货物产自某国',
  customs_declaration: '进出口报关单，供海关申报',
  inspection_certificate: '检验证书，第三方机构验货证明',
  fumigation_certificate: '熏蒸证书，木质包装出口常用',
  beneficiary_certificate: '受益人证明，信用证项下常用',
  shipper_letter_instruction: '发货人委托书 / 订舱托书，委托货代订舱',
  insurance_policy: '保险单，货物运输投保凭证',
  cost_estimation: '成本估算单，核算出厂 / 落地成本',
};

export const DOC_TYPE_KEYS = DOC_TYPES.map((d) => d.type);

/* ============ 暂时隐藏的单据类型 ============
 * 用户要求：先不要这几张（页签 / 新建 / 一键生成 里都不出现）。
 * ⚠️ 只是「界面上不给新建」，**老单据不会丢**：
 *    草稿与已保存列表里照旧能看到并打开（类型筛选条也会为已有单据保留一个 chip）。
 * 想重新放出来：把类型名从下面这个数组里删掉即可。
 */
export const HIDDEN_DOC_TYPES = [
  'inspection_certificate',       // 检验证书
  'fumigation_certificate',       // 熏蒸证书
  'beneficiary_certificate',      // 受益人证明
  'certificate_of_origin',        // 原产地证明
  'cost_estimation',              // 成本估算单
  'shipper_letter_instruction',   // 发货人委托书
  'insurance_policy',             // 保险单
];

/**
 * 「条款与条件」这个自由文本输入框哪些单据用得上？
 * 用不上就别显示 —— 用户反馈「如果这个页面用不到条款与条件，就隐藏输入的地方」。
 *
 * 用不上的三类：
 *   · 水单（bank）：备注走「附言/汇款附言」，没有条款区
 *   · 报关单 / 提单：走各自的专用表格式版式，不渲染条款区
 */
export const NO_TERMS_FIELD = [
  'bank',                 // 水单
  'customs_declaration',  // 报关单（专用版式）
  'bill_of_lading',       // 提单（专用版式）
  'insurance_policy',     // 保险单
  'shipping_instruction', // 装船指示（专用版式，只印特殊指示/备注）
  'shipping_advice',      // 装船通知（同上）
];

export function usesTermsField(type) {
  return !NO_TERMS_FIELD.includes(type);
}

/**
 * 固定格式单据：栏目名由版式写死（中英对照），不接多语言模板。
 *
 * · 报关单 —— 中国海关法定格式，中文为主 + 格式自带的英文对照；
 * · 提单 —— 国际海运标准格式，实务上一律英文（中资船公司常把栏目名印成中英对照）；
 * · 水单 —— 银行凭证，同样是中英对照的固定格式。
 *
 * 这三张单据的语言下拉只给中文 / 英文 —— 选别的语言栏目名也不会变，只会让人以为坏了。
 */
export const FIXED_FORMAT_DOCS = ['customs_declaration', 'bill_of_lading', 'bank', 'shipping_instruction', 'shipping_advice', 'declaration_elements'];

/** 是不是固定格式单据（中英对照，切语言不生效） */
export function isFixedFormatDoc(type) {
  return FIXED_FORMAT_DOCS.includes(type);
}

/** 该单据可选的单据语言；固定格式单据只给中文 / 英文 */
export function docLangChoices(type) {
  if (!isFixedFormatDoc(type)) return DOC_LANGS;
  // 报关单是给中国海关看的 → 中文在前；提单 / 水单 → 英文在前
  const order = type === 'customs_declaration' ? ['zh', 'en'] : ['en', 'zh'];
  return order.map((code) => DOC_LANGS.find((l) => l.code === code)).filter(Boolean);
}

/** 单据语言不在允许范围内时回退到哪个 */
export function fallbackDocLang(type) {
  return type === 'customs_declaration' ? 'zh' : 'en';
}

export function isDocTypeHidden(type) {
  return HIDDEN_DOC_TYPES.includes(type);
}

/** 界面上可用的单据类型（去掉隐藏的），用于页签 / 新建 / 一键生成 */
export function visibleDocTypes() {
  return DOC_TYPES.filter((d) => !isDocTypeHidden(d.type));
}

export function docMeta(type) {
  return DOC_TYPES.find((d) => d.type === type) || DOC_TYPES[0];
}

/**
 * 表格列定义（按单据类型自动组合）
 *
 * 装箱单按真实 PL 模板排：Marks & Nos. → Item No. → 品名 → 件数 → 数量
 * → 毛重 → 净重 → 体积（重量体积在表头下方带单位行 KGS / M3）
 *
 * 名称类单据（报价单 / PI / 合同 / CI）默认不算件数重量体积，
 * 因为那些单据本来只谈价格；需要时在表单里勾选显示。
 *
 * @param {string} type
 * @param {object} [doc] 传入单据后按 doc 的显示开关裁剪列
 */
/* ============ 明细表的「可选列」 ============
 * 用户诉求：exradoc 的表格里有的列（规格 / HS 编码 / 备注…），我们也必须都有。
 * 做法：每张单据都能单独勾选这些列；没勾过时按下面这份「按单据类型的默认值」走。
 *
 * 默认值依据 exradoc 同类单据的实际表头（2026-10 抓取，见 docs/字段对照-exradoc.md）：
 *   报价单 Commercial Quotation : 编号 描述 规格 数量 单位 单价 折扣 行合计
 *   形式发票 Proforma Invoice   : 项号 唛头 描述 HS编码 数量 单位 单价 金额
 *   外贸合同 Trade Contract     : 项号 描述 规格 数量 单位 单价 金额
 *   商业发票 Commercial Invoice : 项号 唛头 描述 HS编码 数量 单位 单价 金额
 *   成本估算 Cost Estimation    : 项目名称 规格 数量 单位成本 总价 备注
 *   原产地证 / 报关单 / 保险单 / 发货人委托书 : 描述 … HS编码
 *   检验证书                    : 项号 描述 规格 数量 单位 批次号
 * 注意：只「新增」默认列，不动已有的（CI 依旧不显示型号，其它类型依旧显示型号）。
 */
export const COL_DEFAULTS = {
  quotation: { model: true, spec: true, hsCode: false, remark: false, discount: false, origin: false, dest: false },
  pi: { model: true, spec: false, hsCode: true, remark: false, discount: false, origin: false, dest: false },
  contract: { model: true, spec: true, hsCode: true, remark: false, discount: false, origin: false, dest: false },
  ci: { model: false, spec: false, hsCode: true, remark: false, discount: false, origin: false, dest: false },
  cost_estimation: { model: true, spec: true, hsCode: false, remark: true, discount: false, origin: false, dest: false },
  certificate_of_origin: { model: true, spec: false, hsCode: true, remark: false, discount: false, origin: false, dest: false },
  // 报关单：exradoc 的表格里明确有「原产国 / 目的国」两列
  customs_declaration: { model: true, spec: true, hsCode: true, remark: false, discount: false, origin: true, dest: true },
  insurance_policy: { model: true, spec: false, hsCode: true, remark: false, discount: false, origin: false, dest: false },
  // 装船指示 / 装船通知：单据上有 HS 编码列，表单默认也显示（否则"印出来却没法填"）
  shipping_instruction: { model: false, spec: false, hsCode: true, remark: false, discount: false, origin: false, dest: false },
  shipping_advice: { model: true, spec: false, hsCode: true, remark: false, discount: false, origin: false, dest: false },
  shipper_letter_instruction: { model: true, spec: false, hsCode: true, remark: false, discount: false, origin: false, dest: false },
  inspection_certificate: { model: true, spec: true, hsCode: false, remark: false, discount: false, origin: false, dest: false },
};
const COL_DEFAULT_FALLBACK = { model: true, spec: false, hsCode: false, remark: false, discount: false, origin: false, dest: false };

/** 某个类型、某个可选列默认是否显示（表单勾选框与单据渲染共用同一份判断） */
export function columnDefault(type, key) {
  const row = COL_DEFAULTS[type];
  if (row && key in row) return !!row[key];
  return !!COL_DEFAULT_FALLBACK[key];
}

/** 明细表的可选列切换开关（true=显示 / false=不显示；未设置=按 columnDefault） */
export const COL_SWITCHES = [
  { key: 'spec', docKey: 'showSpec', i18n: 'opt.showSpec' },
  { key: 'model', docKey: 'showModel', i18n: 'opt.showModel' },
  { key: 'hsCode', docKey: 'showHs', i18n: 'opt.showHs' },
  { key: 'discount', docKey: 'showDiscount', i18n: 'opt.showDiscount' },
  { key: 'origin', docKey: 'showOrigin', i18n: 'opt.showOrigin' },
  { key: 'dest', docKey: 'showDest', i18n: 'opt.showDest' },
  { key: 'remark', docKey: 'showRemark', i18n: 'opt.showRemark' },
];

function itemColumnsRaw(type, doc = null) {
  const meta = docMeta(type);
  const on = (key) => !doc || doc[key] !== false;      // 未设置视为显示（兼容老数据）
  const off = (key) => !!(doc && doc[key]);            // 显式关闭
  /** 可选列是否显示：用户显式设过就用用户的，否则用类型默认 */
  const want = (key, docKey) => {
    if (doc && typeof doc[docKey] === 'boolean') return doc[docKey];
    return columnDefault(type, key);
  };

  // 申报要素表：列按客户给的参考表（HS/品牌类型/出口享惠/用途/材质/名称/型号/规格/GTIN/CAS/其他 + 自定义列）
  if (type === 'declaration_elements') {
    const cols = [
      { key: 'no', label: 'no', cls: 'col-no' },
      { key: 'hsCode', label: 'hsCode', cls: 'col-hs' },
      { key: 'brandType', label: 'brandType', cls: 'col-sm' },
      { key: 'preferential', label: 'preferential', cls: 'col-sm' },
      { key: 'usagePurpose', label: 'usagePurpose', cls: 'col-mid' },
      { key: 'material', label: 'material', cls: 'col-sm' },
      { key: 'description', label: 'description', cls: 'col-desc' },
      { key: 'model', label: 'model', cls: 'col-sm' },
      { key: 'specText', label: 'specText', cls: 'col-mid' },
      { key: 'gtin', label: 'gtin', cls: 'col-sm' },
      { key: 'cas', label: 'cas', cls: 'col-sm' },
      { key: 'remark', label: 'remark', cls: 'col-mid' },
    ];
    for (const c of (Array.isArray(doc && doc.extraCols) ? doc.extraCols : [])) {
      cols.push({ key: 'ext.' + c.id, label: 'extra:' + c.label, cls: 'col-sm' });
    }
    return cols;
  }

  if (meta.mode === 'packing') {
    const cols = [
      { key: 'ctnNo', label: 'ctnNo', cls: 'col-ctn' },
      { key: 'no', label: 'no', cls: 'col-no' },
      { key: 'description', label: 'description', cls: 'col-desc' },
    ];
    // HS 编码列：在「明细列显示」里勾了就印（报关/清关常要）
    if (want('hsCode', 'showHs')) cols.push({ key: 'hsCode', label: 'hsCode', cls: 'col-hs' });
    // 多柜场景：单据里建了柜清单，就多一列「装柜」让每行选柜
    //（只有一个柜时不出现，避免给普通用户添乱）
    // 多柜功能已移除：明细不再出现「装柜号」列


    if (on('hideCtns') === false || !off('hideCtns')) {
      if (!off('hideCtns')) cols.push({ key: 'qty', label: 'pkgs', cls: 'col-qty' });
    }
    cols.push({ key: 'qtyPcs', label: 'qty', cls: 'col-qty' });
    if (!off('hideWeight')) {
      cols.push({ key: 'gw', label: 'gw', cls: 'col-num' });
      cols.push({ key: 'nw', label: 'nw', cls: 'col-num' });
    }
    if (!off('hideMeas')) cols.push({ key: 'meas', label: 'meas', cls: 'col-num' });
    return cols;
  }

  // 名称类单据列（顺序对照真实单证：编号 → [图片] → 品名 → 规格 → 型号 → HS 编码 → …）
  //   CI（报关单据）：编号 → 品名 → HS 编码（报关必须有）
  //   合同 / 报价单：品名后面跟「规格」；PI / 证书类按需显示 HS 编码
  const base = [
    { key: 'no', label: 'no', cls: 'col-no' },
    { key: 'description', label: 'description', cls: 'col-desc' },
  ];

  // 图片列（photo）：所有名称类单据都支持。
  // 显示条件（满足任一）：
  //   1. doc.showPhoto 为真（用户在「明细列显示」里勾了，或上传图片时自动置上）；
  //   2. 已经有一行填了图片 —— 且只在 showPhoto === undefined 时兜底。
  //      这样用户**显式取消勾选（false）能真正关掉**，不会被自动逻辑顶回来。
  const rows = (doc && doc.items) || [];
  const hasPhoto = rows.some((it) => it && it.photo);
  const wantPhoto = !!(doc && doc.showPhoto) || (!!doc && doc.showPhoto === undefined && hasPhoto);
  if (doc && wantPhoto) base.splice(1, 0, { key: 'photo', label: 'photo', cls: 'col-photo' });

  if (want('spec', 'showSpec')) base.push({ key: 'size', label: 'spec', cls: 'col-spec' });
  if (want('model', 'showModel')) base.push({ key: 'model', label: 'model', cls: 'col-model' });
  if (want('hsCode', 'showHs')) base.push({ key: 'hsCode', label: 'hsCode', cls: 'col-hs' });

  const tail = [];
  if (doc && doc.showCtns) tail.push({ key: 'ctns', label: 'ctns', cls: 'col-qty' });
  tail.push({ key: 'unit', label: 'unit', cls: 'col-unit' });
  tail.push({ key: 'qty', label: 'qty', cls: 'col-qty' });
  // plain 模式（提单/证书类等无金额单据）不显示单价与金额列；
  // 但如果该类型声明了 withMoney（如报关单），仍然要有金额列
  if (meta.mode !== 'plain' || meta.withMoney) {
    tail.push({ key: 'unitPrice', label: 'unitPrice', cls: 'col-money' });
    // 行折扣（报价单）：夹在单价与行合计之间，和 exradoc 的报价单列序一致
    if (want('discount', 'showDiscount')) tail.push({ key: 'discount', label: 'discount', cls: 'col-money' });
    tail.push({ key: 'amount', label: 'amount', cls: 'col-money' });
  }
  // 原产国 / 目的国（报关单、产地证明细要这两列）放在金额后面
  if (want('origin', 'showOrigin')) tail.push({ key: 'origin', label: 'origin', cls: 'col-origin' });
  if (want('dest', 'showDest')) tail.push({ key: 'dest', label: 'dest', cls: 'col-dest' });
  if (want('remark', 'showRemark')) tail.push({ key: 'remark', label: 'remark', cls: 'col-remark' });
  if (doc && doc.showWeight) {
    tail.push({ key: 'nw', label: 'nw', cls: 'col-num' });
    tail.push({ key: 'gw', label: 'gw', cls: 'col-num' });
  }
  if (doc && doc.showMeas) tail.push({ key: 'meas', label: 'meas', cls: 'col-num' });

  // 提单唛头 / 报关单境内货源地：作为商品行的一列（行数跟着商品走，不写死）
  if (type === 'bill_of_lading') tail.push({ key: 'marks', label: 'marks', cls: 'col-desc' });
  if (type === 'customs_declaration') tail.push({ key: 'domesticSource', label: 'domesticSource', cls: 'col-mid' });

  return [...base, ...tail];
}

/**
 * 列顺序：用户可自定义（doc.colOrder = ['no','description',...]）
 * 「No.」列固定在第一位，其余按 colOrder 排列，未列出的排后面。
 */
export function itemColumns(type, doc = null) {
  const cols = itemColumnsRaw(type, doc);
  const order = Array.isArray(doc && doc.colOrder) ? doc.colOrder : null;
  if (!order || !order.length) return cols;
  const idx = (k) => {
    const i = order.indexOf(k);
    return i < 0 ? 999 : i;
  };
  return cols.slice().sort((a, b) => {
    if (a.key === 'no') return -1;
    if (b.key === 'no') return 1;
    return idx(a.key) - idx(b.key);
  });
}

/**
 * 把「按行隐藏」汇总成「整列隐藏」
 *
 * 用户的语义是「不显示这一列」，不是「这一行留空」：
 * 只有当**所有行**都不需要某列时，这一列才整列去掉。
 * 只要还有任意一行需要它，列就保留 —— 否则会出现「某行有净重、某行没有」的断列，很难看。
 *
 * 表单与单据预览都调这个，保证两边列集合一致。
 * @returns {Set<string>} 需要整列去掉的列 key
 */
export function columnsHiddenByRows(doc) {
  const items = (doc && doc.items) || [];
  const out = new Set();
  const keys = new Set();
  for (const it of items) {
    for (const k of Object.keys((it && it.hide) || {})) if (it.hide[k]) keys.add(k);
  }
  for (const k of keys) {
    if (items.length && items.every((it) => it && it.hide && it.hide[k])) out.add(k);
  }
  return out;
}

/** 空白卖方信息 */
export function emptyParty() {
  return {
    companyName: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    contact: '',
    tel: '',
    fax: '',
    email: '',
    website: '',
    taxId: '',
    logo: '',        // 公司 LOGO
    stamp: '',       // 公章 / 签章图片（透明底 PNG）
  };
}

/** 空白产品行（含所有单据类型需要的字段，按类型显示） */
/** 常见柜型（体积/载重参考，装箱助手用得到） */
export const CONTAINER_TYPES = ['20GP', '40GP', '40HQ', '45HQ'];

export function emptyItem(order = 0) {
  return {
    id: uid('it'),
    order,
    photo: '',
    description: '',
    model: '',
    hsCode: '',
    unit: 'pc',
    qty: 0,
    unitPrice: 0,
    amount: 0,
    productCode: '',   // 销售发票：产品编码列
    vc: '',            // 销售发票：VAT 代码列（VC）
  
    ctnNo: '',
    containerId: '',     // 装柜号（指向单据 containers[] 里的某一个柜；空=未分配）
    /* ---- 申报要素（自查表用；产品库里也存同一套）---- */
    usagePurpose: '',    // 用途（简单概述，如"用于酒店陈列展示"）
    brandName: '',       // 品牌（没有就写"无"）
    brandType: '',       // 品牌类型（无品牌 / 境内自主品牌 / 境外品牌…）
    preferential: '',    // 出口享惠情况（无出口享惠 / 不确定 / 享受…）
    gtin: '',            // GTIN
    cas: '',             // CAS
    specText: '',        // 规格（如 1200*700*800）
    ext: {},             // 自定义列的值：{ 列id: 值 }     // 装柜号（指向单据 containers[] 里的某一个柜；空=未分配）
    ctns: 0,
    packUnit: 'ctn',      // 包装单位（装箱单「件数」用）
    nw: 0,
    gw: 0,
    meas: 0,
    weightUnit: 'kg',     // 重量单位
    measUnit: 'm³',       // 体积单位
    remark: '',
    marks: '',            // 唛头（提单 / 证书类单据用，如 ABC/NYC）
    freight: '',          // 运费（提单行级，Prepaid / Collect / 金额）
    origin: '',           // 原产国（报关单/产地证明细列；留空取单据级 countryOfOrigin）
    dest: '',             // 目的国（报关单/产地证明细列；留空取单据级 destinationCountry）
    domesticSource: '',   // 境内货源地（报关单明细列）
    lineDutyNature: '',   // 征免（报关单明细列；留空取单据级 dutyNature）
    discount: 0,          // 行折扣（报价单「折扣」列）
    /* ---- 产品规格（报价单模板里的 Style / Size / Color / Material 等） ---- */
    size: '',                 // 规格 / 尺寸
    color: '',                // 颜色
    material: '',             // 材质
    styleName: '',            // 款号 / 花号
    moq: 0,                   // 起订量
    leadTime: '',             // 该行的交期（如 45 days）
    sampleFee: 0,             // 样品费 / 单价
    sampleQty: 0,             // 样品数量
    bulkPrice: 0,             // 大货价（与样品价区分）
    unitsPerCtn: 0,           // 每箱数量
    ctnL: 0, ctnW: 0, ctnH: 0, // 外箱尺寸 cm
    netWeight: 0,             // 单件净重 / 单件重量 g
    toolingCost: 0,           // 该行模具费
    specNote: '',             // 规格补充说明（多行）
    /* ---- 按行控制某个格子是否显示（用户要求：每一条数据都能单独选择显示/不显示） ----
       例：hide: { nw: true } 表示这一行的净重格留空不打印，别的行照常显示。
       空对象表示全部照常显示。 */
    hide: {},
  };
}

/** 空白银行信息 */
export function emptyBank() {
  return {
    beneficiary: '',
    bankName: '',
    bankAddress: '',
    accountNo: '',
    swift: '',
    iban: '',
  };
}

/**
 * 新建空白单据
 * @param {string} type quotation|pi|contract|ci|pl
 * @param {object} opts { number, docLang, currency, seller, company }
 */
export function newDoc(type, opts = {}) {
  const meta = docMeta(type);
  const isSI = type === 'sales_invoice';
  const lang = opts.docLang || 'en';
  return {
    id: uid('doc'),
    type,
    titleOverride: '',
    status: 'draft',           // draft 草稿 | saved 已保存单据（定稿，可发客户）
    savedAt: 0,                // 定稿时间
    docLang: lang,
    docNo: opts.number || '',
    date: today(),
    validUntil: type === 'quotation' || type === 'pi' ? addDays(today(), 30) : '',
    incoterms: '',              // 新建留空：贸易术语不预填（表单里有下拉+示例提示）
    destination: '',
    loadingPort: '',
    leadTime: '',
    paymentTerms: '',
    currency: opts.currency || 'USD',
    exchangeRate: 1,
    priceTerms: '',
    countryOfOrigin: '',        // 新建留空：原产国不预填
    /* ---- 商业发票 / 清关常用字段（按单据类型显示） ---- */
    poNo: '',                        // PO / 参考号
    piNo: '',                        // 形式发票号（装箱单上常引用，便于对单）
    lcNo: '',                        // 信用证号 L/C NO.
    awbNo: '',                       // 空运单号 / 提单号
    countryOfExport: '',             // 出口国（留空时取卖方国家）
    reasonForExport: '',              // 出口原因：Commercial / Sample / Gift / Repair…（新建留空）
    payingBank: '',                   // 开证行（信用证付款时）
    sampleNote: '',                   // 样品说明
    tradeTermsPlace: '',             // 贸易术语交货地，如 Shenzhen, China
    shippingMethod: '',              // 运输方式：Sea / Air / Express / Land
    /* ---- 报价 / 条款常用（真实报价单上都有） ---- */
    deliveryPlace: '',               // 交货地点
    warranty: '',                    // 保修条款
    productionTime: '',              // 生产周期
    invoiceType: '',                 // 发票类型（增值税专用发票 / 普票）
    toolingFee: 0,                   // 模具费 / 开模费
    toolingRefund: '',               // 模具费退还说明
    taxRate: 0,                      // 增值税率 %
    discount: 0,                     // 折扣金额
    insuranceFee: 0,                 // 保险费
    otherFee: 0,                     // 其它费用（旧字段，保留兼容；新数据用 otherFees）
    otherFeeLabel: '',               // 旧「其它费用名称」
    otherFees: [],                   // 其它费用明细（可多项）：[{ label, amount }]
    shippingFee: 0,                  // 运费
    grandTotal: 0,                   // 含税 / 含费用后的总计（自动算）
    beneficiaryAccount: '',          // 收款账户名（与银行信息配套）
    /* ---- 装箱单专用（对照真实 PL 模板） ---- */
    contractNo: '',                  // 合同号码
    invoiceNo: '',                   // 发票号码（PL 上要和商业发票一致）
    invoiceDate: '',                 // 发票日期
    routeFrom: '',                   // 起运地（船由 ROUTE: FROM ___ TO ___ BY ___）
    routeTo: '',                     // 目的地
    routeBy: '',                     // 运输方式英文（BY SEA / BY AIR / BY EXPRESS）
    totalPackedText: '',             // 底部 TOTAL PACKED IN ___ ONLY 的说明
    /* ---- 显示开关（控制明细表显示哪些列） ----
       装箱单 hideXxx（勾上=隐藏）；名称类单据 showXxx（勾上=显示）。
       用户要求：**除装箱单外默认都不显示件数 / 毛净重 / 体积**，
       所以名称类单据的三个开关默认全关，需要时自己在「明细列显示」里勾。
       比列更细一级：每一行还能用 item.hide 单独隐藏某个格子。 */
    hideWeight: false,               // 装箱单：隐藏毛净重
    hideMeas: false,                 // 装箱单：隐藏体积
    hideCtns: false,                 // 装箱单：隐藏件数
    showCtns: false,                 // 名称类单据：显示件数列
    showWeight: false,               // 名称类单据：显示毛净重列
    showMeas: false,                 // 名称类单据：显示体积列
    showPhoto: false,                // 名称类单据：显示产品图片列（在表单「明细列显示」里勾选）
    showEmptyRows: false,            // 单据上的「标签 + 值」行：值为空时是否仍保留该行
                                     // 默认 false = 空值直接不显示（用户诉求：PO 没填就别显示 PO 这一行）
                                     // 设 true = 保留空行，适合"先打出来手写补填"
    // 买卖双方区布局：
    //   ''/'single' = 单栏（只画买方框，占满整行，不显示银行信息）
    //   'split'     = 两栏（买方框 + 银行信息框）
    // 留空表示"用该单据类型的默认值"（见 render.js 的 DEFAULT_PARTY_LAYOUT）
    partyLayout: '',
    marks: '',
    // 集装箱清单：一张单可以装 2~3 个柜（装箱单按柜分组小计、可按柜拆分生成子单）
    // 结构：[{ id: 'ct-xxx', no: 'MSKU1234567', seal: 'SL-88990011', type: '40HQ' }]
    containers: [],
    // 申报要素表的「自定义列」：[{ id, label }]，值存在明细行的 ext[列id]
    extraCols: [],
    // 申报要素表的列显示开关：{ hsCode: false, cas: false, ... }（没写=显示）
    showCols: {},
    // 申报要素表的列顺序：['hsCode','description',...,'ext:xxx']（没写=默认顺序）
    colOrder: [],
    remarks: '',
    terms: '',
    seller: opts.seller ? JSON.parse(JSON.stringify(opts.seller)) : emptyParty(),
    buyer: emptyParty(),
    consignee: emptyParty(),
    notify: emptyParty(),
    sameAsBuyerConsignee: true,
    bank: emptyBank(),
    items: type === 'sales_invoice' ? sampleSiItems() : [emptyItem(0)],
    totals: { totalQty: 0, totalAmount: 0, totalNw: 0, totalGw: 0, totalMeas: 0 },
    contractClauses: [],
    preparedBy: '',
    sourceDocId: opts.sourceDocId || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: meta.mode,
    si: type === 'sales_invoice' ? defaultSi() : undefined,
    ...extraDocFields(type),
    _schema: 1,
  };
}

/**
 * 融合 TradeKit 新增单据的特有字段（按类型注入 newDoc）
 * 这些字段在编辑表单与版式渲染中按类型读取；不存在的类型返回空对象（不影响老单据）
 */
export function extraDocFields(type) {
  if (type === 'shipping_instruction' || type === 'shipping_advice') {
    const isSI = type === 'shipping_instruction';
    const si = [
      // 单据本身
      { key: 'siNo', label: 'SI 编号', en: 'SI No.', zh: 'SI 编号', type: 'text', span: 1 },
      { key: 'siCutoff', label: '补料截止时间', en: 'SI Cut-off', zh: '补料截止时间', type: 'text', span: 1, tip: '货代要求的截补料时间，晚了会收改单费' },
      // 订舱 / 货代
      { key: 'bookingNo', label: '订舱号', en: 'Booking No.', zh: '订舱号', type: 'text', span: 1 },
      { key: 'forwarder', label: '货代', en: 'Forwarder', zh: '货代 / 船公司', type: 'text', span: 1 },
      { key: 'forwarderContact', label: '货代联系方式', en: 'Forwarder Contact', zh: '货代联系方式', type: 'text', span: 2, tip: '联系人 / 电话 / 邮箱' },
      // 船名航次与港口
      { key: 'vessel', label: '船名', en: 'Vessel', zh: '船名', type: 'text', span: 1 },
      { key: 'voyageNo', label: '航次', en: 'Voyage No.', zh: '航次', type: 'text', span: 1 },
      { key: 'portOfLoading', label: '装运港', en: 'Port of Loading', zh: '装运港 POL', type: 'text', span: 1 },
      { key: 'portOfDischarge', label: '目的港', en: 'Port of Discharge', zh: '目的港 POD', type: 'text', span: 1 },
      { key: 'placeOfDelivery', label: '交货地', en: 'Place of Delivery', zh: '交货地', type: 'text', span: 1 },
      { key: 'etd', label: '开船日 ETD', en: 'ETD', zh: '预计开船 ETD', type: 'text', span: 1 },
      { key: 'eta', label: '到港日 ETA', en: 'ETA', zh: '预计到港 ETA', type: 'text', span: 1 },
      { key: 'dateOfShipment', label: '装运日期', en: 'Date of Shipment', zh: '装运日期', type: 'text', span: 1, tip: '提单上的 ON BOARD 日期' },
      { key: 'modeOfTransport', label: '运输方式', en: 'Mode of Transport', zh: '运输方式', type: 'text', span: 1, tip: '海运 / 空运 / 陆运' },
      // 箱 / 封 / 件数 / 唛头
      { key: 'containerNo', label: '箱号', en: 'Container No.', zh: '集装箱号', type: 'text', span: 1 },
      { key: 'sealNo', label: '封号', en: 'Seal No.', zh: '铅封号', type: 'text', span: 1 },
      { key: 'packageType', label: '包装单位', en: 'Package Type', zh: '包装种类（CTNS / PLTS）', type: 'text', span: 1 },
      { key: 'totalPkgs', label: '总件数', en: 'Total Packages', zh: '总件数', type: 'text', span: 1 },
      { key: 'totalGrossWeight', label: '总毛重', en: 'Total Gross Weight', zh: '总毛重', type: 'text', span: 1 },
      { key: 'totalMeasurement', label: '总体积', en: 'Total Measurement', zh: '总体积', type: 'text', span: 1 },
      { key: 'marks', label: '唛头', en: 'Marks & Nos.', zh: '唛头（没有写 N/M）', type: 'textarea', span: 4, rows: 2 },
      // 货物
      { key: 'goodsDescription', label: '货物描述', en: 'Description of Goods', zh: '货物描述', type: 'text', span: 2 },
      { key: 'hsCode', label: 'HS 编码', en: 'HS Code', zh: 'HS 编码', type: 'text', span: 1 },
      // 出单方式 / 运费
      { key: 'releaseType', label: '出单方式', en: 'Release Type', zh: '出单方式（电放/海运单/正本）', type: 'text', span: 1, tip: 'TELEX RELEASE / SEAWAY BILL / ORIGINAL 3' },
      { key: 'freightTerms', label: '运费条款', en: 'Freight Terms', zh: '运费条款（PREPAID / COLLECT）', type: 'text', span: 1 },
      // 文件参考
      { key: 'blNo', label: '提单号', en: 'B/L No.', zh: '提单号', type: 'text', span: 1 },
      { key: 'contractNo', label: '合同号', en: 'Contract No.', zh: '合同号', type: 'text', span: 1 },
      { key: 'invoiceNo', label: '发票号', en: 'Invoice No.', zh: '发票号', type: 'text', span: 1 },
      // 说明
      { key: 'insuranceNote', label: '投保提示', en: 'Insurance', zh: '投保提示', type: 'text', span: 2, tip: 'CFR/FOB 时提醒客户自行投保' },
      { key: 'specialInstructions', label: '特殊指示', en: 'Special Instructions', zh: '特殊指示', type: 'textarea', span: 4, rows: 2 },
      { key: 'remarks', label: '备注', en: 'Remarks', zh: '备注', type: 'textarea', span: 4, rows: 2 },
    ];
    return isSI ? si.filter((x) => !['etd', 'eta', 'insuranceNote'].includes(x.key)) : si.filter((x) => x.key !== 'siCutoff');
  }

  const M = {
    /* 合同：对照 exradoc 的 Trade Contract 字段补齐
     * （合同号走 docNo、签署日期走 date、货币走 currency、买方/卖方走 parties，
     *   这里只列它独有、我们以前没有的） */
    contract: {
      placeOfSigning: '',    // 签署地（PLACE OF SIGNING）
      shipmentDate: '',      // 装运日期
      deliveryTerms: '',     // 交货条款（独立一行，和条款区互补）
      insuranceTerms: '',    // 保险条款
      penaltyClause: '',     // 违约 / 罚则条款
      sellerSigner: '',      // 卖方签署人
      sellerSignerTitle: '', // 卖方签署人职务
      sellerSignDate: '',    // 卖方签署日期
      buyerSigner: '',       // 买方签署人
      buyerSignerTitle: '',  // 买方签署人职务
      buyerSignDate: '',     // 买方签署日期
    },
    /* 报关单：对照 exradoc 的「报关单」与「报关资料工具」两页字段补齐
     * （编号走 docNo、日期走 date、币制走 currency、成交方式走 incoterms、
     *   运输方式走 shippingMethod、运费/保费/杂费走 shippingFee/insuranceFee/otherFee、
     *   合同号/发票号走 contractNo/invoiceNo、唛头备注走 marks/remarks） */
    customs_declaration: {
      // 申报类型 / 报关单号 / 申报日期（原有字段，保留兼容）
      declarationType: '',   // 申报类型
      tradeMode: '',         // 贸易方式
      consignmentNo: '',     // 报关单号 / 清单号
      declarationDate: '',   // 申报日期
      // 申报人（报关行 / 报关员）
      declarantName: '',
      declarantCode: '',
      declarantPhone: '',
      // 境内发货人：默认用卖方，这里只补它独有的统一社会信用代码（留空取 seller.taxId）
      shipperCreditCode: '',
      // 生产销售单位
      producerName: '',
      producerCode: '',
      // 监管 / 贸易信息
      supervisionMode: '',     // 监管方式（一般贸易）
      tradeCountry: '',        // 贸易国
      destinationCountry: '',  // 运抵国
      exitCustoms: '',         // 出境关别（上海海关）
      exitPort: '',            // 离境口岸（上海洋山港）
      destPort: '',            // 指运港（洛杉矶）
      vesselVoyage: '',        // 运输工具（船名 / 航次）
      blNo: '',                // 提运单号（留空取 awbNo）
      exportDate: '',          // 出口日期
      packageType: '',         // 包装种类
      recordNo: '',            // 备案号
      licenseNo: '',           // 许可证号
      dutyNature: '',          // 征免性质
      attachedDocs: '',        // 随附单证
      declaration: '',         // 声明内容
      declarantSignature: '',  // 申报人签章（姓名 / 单位）
      signatureDate: '',       // 签章日期
      /* ---- 对照官方《中华人民共和国海关出口货物报关单》再补 ---- */
      preEntryNo: '',          // 预录入编号
      customsNo: '',           // 海关编号
      declareUnit: '',         // 申报单位（统一社会信用代码/公司名称 + 代理报关公司名称）
      declareUnitCode: '',     // 申报单位代码
      relatedPartyConfirm: '否',      // 特殊关系确认
      priceImpactConfirm: '否',       // 价格影响确认
      royaltyConfirm: '否',           // 支付特许权使用费确认
      selfDeclaration: '否',          // 自报自缴
      customsRemark: '',       // 海关批注及签章（留空盖章用）
    },
    /* 报价单：对照 exradoc 的商业报价单补齐它独有的字段 */
    quotation: {
      minOrderQty: '',         // 最小起订量（整单口径，和每行的 MOQ 互补）
      deliveryTerms: '',       // 交货条款
      signatureName: '',       // 签名
      signatureTitle: '',      // 职务
      signatureDate: '',       // 签日期
    },
    /* 提单：对照标准海运提单（样本 4-1，1~22 栏目）+ 提单确认件补齐
     * 序号即单据上的栏目号：4 前程运输 / 5 收货地 / 6 船名航次 / 7 装货港 / 8 卸货港 /
     * 9 交货地 / 10 目的地 / 16 总件数大写 / 17 运费 / 18 出单地点时间 / 19 正本份数 /
     * 20 装船日期 / 21 装船船名 / 22 承运人签章 */
    bill_of_lading: {
      shipperRef: '',       // 发货人参考号
      bookingNo: '',        // 订舱号 / SO 号（托运编号）
      drNo: '',             // D/R No. 场站收据编号
      containerOwner: '',   // 箱属公司
      blType: '',           // 提单类型：ORIGINAL 正本 / TELEX RELEASE 电放 / SEAWAYBILL
      preCarriageBy: '',    // 4. 前程运输（驳船名 / feeder ship）
      placeOfReceipt: '',   // 5. 收货地
      vessel: '',           // 6. 船名
      voyageNo: '',         // 6. 航次
      portOfLoading: '',    // 7. 装货港
      portOfDischarge: '',  // 8. 卸货港
      placeOfDelivery: '',  // 9. 交货地
      finalDestination: '', // 10. 目的地（仅全程转运时填）
      totalInWords: '',     // 16. 总件数（大写，如 SAY TWO HUNDRED CTNS ONLY）
      freightTerms: '',     // 17. 运费条款 PREPAID / COLLECT
      revenueTons: '',      // 17. 运费吨
      rate: '',             // 17. 运费率
      per: '',              // 17. 计费单位
      prepayAmount: '',     // 17. 运费预付金额
      collectAmount: '',    // 17. 运费到付金额
      prepaidAt: '',        // 预付地点
      payableAt: '',        // 到付地点
      placeOfIssue: '',     // 18. 出单地点
      dateOfIssue: '',      // 18. 出单日期（一般与装船日一致）
      totalPrepaid: '',     // 预付总金额
      numberOfOriginal: '3', // 19. 正本提单份数（标准 3 份）
      dateOfShipment: '',   // 20. 装船日期
      loadingOnBoardBy: '', // 21. 装船船名
      containerInfo: '',    // 集装箱/箱型行，如 CY-CY 45G1*1: CONTAINER
      shippingClause: '',   // 装运条款，如 SHIPPER LOAD, COUNT & SEAL.
      carrierName: '',      // 承运人（B/L NO. 右侧那块）
      carrierSignatureDate: '', // 22. 承运人签发日期
      signingAgent: '',     // 22. 签章人 / 代理
      declaration: '',      // 声明内容
      totalPkgs: '',        // 总件数（留空按明细自动汇总）
      totalGrossWeight: '', // 总毛重（留空自动）
      totalMeasurement: '', // 总体积（留空自动）
    },
    certificate_of_origin: {
      issuingAuthority: '',  // 签发机构
      declaration: '',       // 产地声明
      transportRoute: '',    // 运输路线
      goodsReferenceNo: '',  // 商品参考号
      originCountry: '',     // 原产国（默认卖方国家）
    },
    inspection_certificate: {
      inspectionOrg: '',     // 检验机构
      inspectionDate: '',    // 检验日期
      inspectionResult: '',  // 检验结果
      inspectionStandard: '',// 检验标准
    },
    fumigation_certificate: {
      fumigationDate: '',    // 熏蒸日期
      fumigationMethod: '',  // 熏蒸方法
      chemicalUsed: '',      // 药剂
      duration: '',          // 熏蒸时长
      treatmentType: '',     // 处理类型
    },
    beneficiary_certificate: {
      certificateDate: '',   // 证明日期
      declaration: '',       // 受益人声明
      beneficiaryName: '',   // 受益人名称
      certificateType: '',   // 证明类型
    },
    shipper_letter_instruction: {
      bookingNo: '',         // 订舱号
      vessel: '',            // 船名
      voyageNo: '',          // 航次
      portOfLoading: '',     // 装货港
      portOfDischarge: '',   // 卸货港
      cargoReadyDate: '',    // 备货日期
      containerNo: '',       // 集装箱号
      cargoDescription: '',  // 货物描述
    },
    insurance_policy: {
      policyNo: '',          // 保单号
      insurer: '',           // 保险人 / 承保公司
      insuredAmount: 0,      // 投保金额
      coverage: '',          // 险别（如 All Risks）
      premium: 0,            // 保费
      totalInsuredValue: 0,  // 保险总值
      claimPayableAt: '',    // 索赔地点
      issuedDate: '',        // 出单日期
    },
  };
  return M[type] || {};
}

/** 补齐老数据缺失字段（向后兼容）
 *  注意：不能简单用 {...fresh, ...doc}，因为 doc 里可能是 undefined 的同名字段
 *  （如新建时传入的 number 为空），会把默认值覆盖掉或让派生字段失真 */
export function migrateDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const fresh = newDoc(doc.type || 'quotation');
  const merged = { ...fresh };
  for (const [k, v] of Object.entries(doc)) {
    if (v !== undefined) merged[k] = v;
  }
  merged.type = doc.type || fresh.type;
  merged.mode = docMeta(merged.type).mode;          // 派生字段始终重算
  merged.docNo = doc.docNo === undefined || doc.docNo === null ? '' : doc.docNo;
  merged.id = doc.id || fresh.id;
  merged.seller = { ...emptyParty(), ...(doc.seller || {}) };
  merged.buyer = { ...emptyParty(), ...(doc.buyer || {}) };
  merged.consignee = { ...emptyParty(), ...(doc.consignee || {}) };
  merged.notify = { ...emptyParty(), ...(doc.notify || {}) };
  merged.bank = { ...emptyBank(), ...(doc.bank || {}) };
  merged.totals = { totalQty: 0, totalAmount: 0, totalNw: 0, totalGw: 0, totalMeas: 0, ...(doc.totals || {}) };
  merged.items = Array.isArray(doc.items) && doc.items.length
    ? doc.items.map((it, i) => ({ ...emptyItem(i), ...it, order: i }))
    : [emptyItem(0)];
  merged.contractClauses = Array.isArray(doc.contractClauses) ? doc.contractClauses : [];
  if (!merged.docLang) merged.docLang = 'en';
  // 注意：不再给 countryOfOrigin 兜底 'CHINA' —— 用户要求新建单据是**真空白**，
  // 兜底会让每张新单都印出「原产国 CHINA」，看着像已经填好了。
  // 老数据没有状态字段（或为 null/undefined）：有编号的一律视为「已保存单据」，
  // 避免升级后老用户原来的单据突然变成草稿找不着
  const hasStatus = doc.status === 'draft' || doc.status === 'saved';
  if (!hasStatus) merged.status = merged.docNo ? 'saved' : 'draft';
  if (merged.status === 'saved' && !merged.savedAt) merged.savedAt = merged.updatedAt || Date.now();
  return merged;
}

/** 贸易术语选项 */
export function incotermsList() {
  return INCOTERMS.slice();
}

/** 生成单据编号：QT-20250101-001 / QT-001 */
export function buildDocNo(prefix, seq, { digits = 3, withDate = false, date } = {}) {
  const n = String(Math.max(1, Number(seq) || 1)).padStart(Number(digits) || 3, '0');
  if (!withDate) return `${prefix}-${n}`;
  const d = (date || today()).replace(/-/g, '');
  return `${prefix}-${d}-${n}`;
}

/** 从已有编号中解析出序号，用于自动递增 */
export function parseDocNo(docNo, prefix) {
  if (!docNo) return 0;
  const re = new RegExp(`^${prefix}[-_ ]?(?:\\d{6,8}[-_ ])?(\\d+)$`, 'i');
  const m = re.exec(String(docNo).trim());
  if (m) return Number(m[1]) || 0;
  const tail = /(\d+)\s*$/.exec(String(docNo));
  return tail ? Number(tail[1]) || 0 : 0;
}

/** 单据字段的默认条款（从模板语言包取） */
export function defaultTerms(type, tpl) {
  const d = (tpl && tpl.defaults) || {};
  if (type === 'quotation') return d.quotationTerms || '';
  if (type === 'pi') return d.piTerms || '';
  return '';
}
