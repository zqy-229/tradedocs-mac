/* =============================================================
 * Sales Invoice（销售发票 / Duplicate）—— 数据默认值与字段定义
 * 严格照 novatech 的「Sales Invoice Duplicate」模板做，字段一一对应
 * ============================================================= */

/** 新单据的默认内容（照着模板里的公司信息填死，可改） */
export function defaultSi() {
  return {
    /* 抬头 */
    invoiceTitle: 'Sales Invoice Duplicate',
    subtitle: 'Please retain for your Records',
    logo: '',                                  // 留空则用内置 novatech 标志
    currencySign: '£',

    /* 收件人 / 送货地址（多行） */
    invoiceTo: 'UNIVERSITY OF BIRMINGHAM\nCRC INSTITUTE FOR CANCER\nSTUDIES\nEDGBASTON\nBIRMINGHAM\nB15 2TT',
    deliverTo: 'ROOM 122, SCHOOL OF\nENGINEERING (Y8)\nUNIVERSITY OF BIRMINGHAM\nEDGBASTON\nBIRMINGHAM\nB15 2TT',

    /* 订单信息两行 */
    orderDate: '17-09-25',
    timePlaced: '10:41',
    salesContact: 'DRM',
    salesContactTel: '02392 322 541',
    taxDate: '18-09-25',
    yourRef: 'Le Zhang',
    ourOrderNo: '6437689',
    customerNo: 'THE016',

    /* 条款行 */
    termsText: 'ALL SALES ARE SUBJECT TO OUR STANDARD TERMS & CONDITIONS, FOUND HERE:',
    termsUrl: 'www.novatech.co.uk/termsandconditions.html',

    /* 汇总 */
    vatRate: 20,

    /* 底部 */
    bacsText: 'Sale By BACS',
    footNotes: [
      'All consumer credit transactions are authorized and regulated by the financial conduct authority',
      'All goods remain the property of the vendor until paid for in full',
      'To expedite your redress we recommend that you contact us within 7 days of any damages, shortages or incorrect goods',
    ].join('\n'),
    // 页脚：冒号后面的内容可自定义（前缀固定）
    foot: {
      officeAddr: 'Novatech Ltd, Harbour House, Hamilton Road, Cosham, Portsmouth, PO6 4PU',
      officeTel: '023 9232 2500',
      vatNo: 'GB 730 0687 55',
      regNo: '2605046',
      accName: 'Novatech Ltd',
      accNo: '10887240',
      sortCode: '09-02-22',
    },
    // 右上角 LOGO 的拖动偏移（px，可拖动调整位置）
    logoDX: 0,
    logoDY: 0,
  };
}

/** 明细行：模板列 = QTY / Product Code / Description / Unit Cost / Goods Value / VC */
export function emptySiItem(order = 0) {
  return {
    id: `si_${Math.random().toString(36).slice(2, 9)}`,
    order,
    qty: 0,
    productCode: '',
    description: '',
    unitCost: 0,
    vc: '9',
  };
}

/** 表单里用到的字段清单（si 页专用） */
export const SI_TEXT_FIELDS = [
  { key: 'invoiceTitle', label: '单据标题', span: 2, tip: '默认 Sales Invoice Duplicate；要改成 Tax Invoice 就改这里' },
  { key: 'subtitle', label: '副标题', span: 2 },
  { key: 'invoiceTo', label: 'Invoice to（收票方地址，可多行）', type: 'textarea', rows: 6, span: 1 },
  { key: 'deliverTo', label: 'Deliver to（送货地址，可多行）', type: 'textarea', rows: 6, span: 1 },
  { key: 'orderDate', label: 'Order Date', span: 1, placeholder: '如 17-09-25' },
  { key: 'timePlaced', label: 'Time Placed', span: 1, placeholder: '如 10:41' },
  { key: 'salesContact', label: 'Sales Contact', span: 1, placeholder: '如 DRM' },
  { key: 'salesContactTel', label: 'Sales Contact Tel', span: 1, placeholder: '如 02392 322 541' },
  { key: 'taxDate', label: 'Tax Date', span: 1, placeholder: '如 18-09-25' },
  { key: 'yourRef', label: 'Your Ref', span: 1, placeholder: '如 Le Zhang' },
  { key: 'ourOrderNo', label: 'Our Order No', span: 1, placeholder: '如 6437689' },
  { key: 'customerNo', label: 'Customer No', span: 1, placeholder: '如 THE016' },
  { key: 'termsText', label: '条款提示语', span: 3 },
  { key: 'termsUrl', label: '条款网址', span: 1 },
  { key: 'vatRate', label: 'VAT 税率 %', type: 'number', span: 1 },
  { key: 'currencySign', label: '币种符号', span: 1, placeholder: '£' },
  { key: 'bacsText', label: '底部付款方式标题', span: 2 },
  { key: 'footNotes', label: '底部提示（可多行，每行一条）', type: 'textarea', rows: 3, span: 2 },
  { key: 'footOffice', label: '页脚：公司地址 / 电话', span: 2 },
  { key: 'footVat', label: '页脚：VAT / REG', span: 2 },
  { key: 'footBank', label: '页脚：银行信息', span: 2 },
];

/** 新建单据时的示例明细（照模板 PDF 的五条，方便直接改） */
export function sampleSiItems() {
  const rows = [
    [8, 'DLL-100491', 'DELL P2425H 24" CLASS FULL HD', 128.32, '9'],
    [4, 'DLL-UD22', 'DELL UNIVERSAL DOCK 130W USB-C', 101.61, '9'],
    [4, 'DLL-KB216', 'DELL MULTIMEDIA KEYBOARD-KB216', 16.64, '9'],
    [4, 'DLL-100261', 'DELL MS116 MOUSE - OPTICAL - C', 11.05, '9'],
    [3, 'DELI01', '*   ** NEXT DAY **', 0, '9'],
  ];
  return rows.map(([qty, productCode, description, unitPrice, vc], i) => ({
    id: 'si_' + Math.random().toString(36).slice(2, 9),
    order: i,
    qty,
    productCode,
    description,
    unitPrice,
    amount: qty * unitPrice,
    vc,
  }));
}
