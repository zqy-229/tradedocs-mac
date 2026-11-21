/* =============================================================
 * 单据模板多语言文本包
 * 共 12 种语言：English / 中文 / ไทย / Español / Français / Deutsch /
 *              Português / Русский / العربية(RTL) / Tiếng Việt / 日本語 / 한국어
 * 基础三种语言在本文件内，其余在 templates-intl.js 内合并
 * 新增语种：在 templates-intl.js 加一份语言包并加进 EXTRA_TEMPLATES 即可
 * ============================================================= */

import { EXTRA_TEMPLATES } from './templates-intl.js';

export const DOC_LANGS = [
  { code: 'en', label: 'English', native: 'English', region: '通用 / 欧美', dir: 'ltr' },
  { code: 'zh', label: '中文', native: '中文（简体）', region: '中国', dir: 'ltr' },
  { code: 'th', label: '泰语', native: 'ไทย', region: '泰国', dir: 'ltr' },
  { code: 'es', label: '西班牙语', native: 'Español', region: '西班牙 / 拉美', dir: 'ltr' },
  { code: 'fr', label: '法语', native: 'Français', region: '法国 / 西非', dir: 'ltr' },
  { code: 'de', label: '德语', native: 'Deutsch', region: '德国 / 中欧', dir: 'ltr' },
  { code: 'pt', label: '葡萄牙语', native: 'Português', region: '巴西 / 葡萄牙', dir: 'ltr' },
  { code: 'ru', label: '俄语', native: 'Русский', region: '俄罗斯 / 中亚', dir: 'ltr' },
  { code: 'uz', label: '乌兹别克语', native: 'Oʻzbekcha', region: '乌兹别克斯坦', dir: 'ltr' },
  { code: 'ar', label: '阿拉伯语', native: 'العربية', region: '中东 / 北非', dir: 'rtl' },
  { code: 'vi', label: '越南语', native: 'Tiếng Việt', region: '越南', dir: 'ltr' },
  { code: 'ja', label: '日语', native: '日本語', region: '日本', dir: 'ltr' },
  { code: 'ko', label: '韩语', native: '한국어', region: '韩国', dir: 'ltr' },
];

/** 语言下拉显示文本：中文名 + 原文 + 地区 */
export function langOptionLabel(l) {
  if (l.code === 'en') return 'English（英文 · 通用）';
  if (l.code === 'zh') return '中文（简体）';
  return `${l.label}（${l.native} · ${l.region}）`;
}


export const TEMPLATES = {
  /* ---------------- English ---------------- */
  en: {
    code: 'en',
    dir: 'ltr',
    docTitle: {
      quotation: 'QUOTATION',
      pi: 'PROFORMA INVOICE',
      contract: 'SALES CONTRACT',
    purchase_contract: 'PURCHASE CONTRACT',
      ci: 'COMMERCIAL INVOICE',
      pl: 'PACKING LIST',
      bank: 'BANK SLIP',
      bill_of_lading: 'BILL OF LADING',
    shipping_instruction: 'SHIPPING INSTRUCTION',
    shipping_advice: 'SHIPPING ADVICE',
      certificate_of_origin: 'CERTIFICATE OF ORIGIN',
      customs_declaration: 'CUSTOMS DECLARATION',
    declaration_elements: 'DECLARATION ELEMENTS',
      inspection_certificate: 'INSPECTION CERTIFICATE',
      fumigation_certificate: 'FUMIGATION CERTIFICATE',
      beneficiary_certificate: 'BENEFICIARY CERTIFICATE',
      shipper_letter_instruction: 'SHIPPER LETTER OF INSTRUCTION',
      insurance_policy: 'INSURANCE POLICY',
      cost_estimation: 'COST ESTIMATION',
    },
    label: {
      from: 'FROM',
      to: 'TO',
      consignee: 'CONSIGNEE',
      notify: 'NOTIFY PARTY',
      // 装箱单专用（对照真实 PL 模板）
      route: 'ROUTE',
      routeBy: 'BY',
      invoiceNoShort: 'INV NO.',
      invoiceDate: 'INV DATE',
      stampSignature: 'Company Stamp & Signature',
      totalPackedIn: 'TOTAL PACKED IN',
      docNo: 'No.',
      date: 'Date',
      validUntil: 'Valid Until',
      contractNo: 'Contract No.',
      /* 合同专有（对照 exradoc 的 Trade Contract） */
      placeOfSigning: 'Place of Signing',
      shipmentDate: 'Shipment Date',
      deliveryTerms: 'Delivery Terms',
      insuranceTerms: 'Insurance',
      penaltyClause: 'Penalty',
      signer: 'Signer',
      signerTitle: 'Title',
      signDate: 'Date',
      spec: 'Size (mm)',
      remark: 'Remarks',
      minOrderQty: 'Min. Order Qty',
      signatureName: 'Signed by',
      signatureTitle: 'Title',
      invoiceNo: 'Invoice No.',
      piNo: 'P.I. No.',
      // 装箱单明细信息区用的短标签（与单据正文的长标签分开，避免表格里换行）
      piNoShort: 'PI No.',
      poNoShort: 'PO No.',
      priceTerm: 'Price Term',
      quotationNo: 'Quotation No.',
      plNo: 'P/L No.',
      incoterms: 'Incoterms',
      destination: 'Destination',
      loadingPort: 'Port of Loading',
      leadTime: 'Lead Time',
      paymentTerms: 'Payment Terms',
      currency: 'Currency',
      priceTerms: 'Price Terms',
      countryOfOrigin: 'Country of Origin',
      /* Customs / export reference fields */
      poNo: 'PO / Reference No.',
      lcNo: 'L/C No.',
      awbNo: 'AWB / B/L No.',
      countryOfExport: 'Country of Export',
      reasonForExport: 'Reason for Export',
      tradeTerms: 'Trade Terms',
      tradeTermsPlace: 'Place',
      shippingMethod: 'Shipping Method',
      totalPackages: 'Total Packages / Weight',
      deliveryPlace: 'Place of Delivery',
      productionTime: 'Production Time',
      warranty: 'Warranty',
      invoiceType: 'Invoice Type',
      payingBank: 'Issuing Bank',
      sampleNote: 'Sample Note',
      logistics: 'DELIVERY & SERVICE',
      marks: 'Shipping Marks',
    domesticSource: 'Domestic Source',
      refNo: 'Ref. No.',
      attn: 'Attn',
      tel: 'Tel',
      fax: 'Fax',
      email: 'E-mail',
      address: 'Address',
      city: 'City',
      state: 'State',
      zip: 'Zip Code',
      country: 'Country',
      bankInfo: 'BANK INFORMATION',
      beneficiary: 'Beneficiary',
      bankName: 'Bank Name',
      bankAddress: 'Bank Address',
      accountNo: 'Account No.',
      swift: 'SWIFT Code',
      iban: 'IBAN / Other',
      remarks: 'REMARKS',
      terms: 'TERMS & CONDITIONS',
      seller: 'THE SELLER',
      buyer: 'THE BUYER',
      signature: 'Signature',
      stamp: 'Company Stamp',
      preparedBy: 'Prepared By',
      page: 'Page',
      ourRef: 'Our Ref.',
      yourRef: 'Your Ref.',
    },
    /* 表头列 */
    th: {
      no: 'No.',
      photo: 'Photo',
      description: 'Description',
      spec: 'Size (mm)',
      model: 'Model',
      hsCode: 'HS Code',
      discount: 'Discount',
      origin: 'Origin',
      dest: 'Dest.',
      remark: 'Remarks',
      unit: 'Unit',
      qty: 'Qty',
      unitPrice: 'Unit Price',
      amount: 'Amount',
      ctnNo: 'Ctn No.',
      brandType: 'Brand Type',
      preferential: 'Preferential',
      usagePurpose: 'Use',
      material: 'Material',
      specText: 'Spec',
      gtin: 'GTIN',
      cas: 'CAS',
      container: 'Container',
      subtotal: 'Subtotal',
      unassigned: 'Unassigned',
      seal: 'Seal',
      // 表头尽量短：单位在下方单位行里，这里再写 "Packages" 会折成两行
      pkgs: 'Ctns',
      nw: 'N.W.',
      gw: 'G.W.',
      meas: 'Meas.',
      total: 'TOTAL',
      origin: 'Origin',
    },
    /* 汇总与说明 */
    sum: {
      totalQty: 'Total Qty',
      totalAmount: 'TOTAL AMOUNT',
      totalNw: 'Total N.W.',
      totalGw: 'Total G.W.',
      totalMeas: 'Total Volume',
      totalCtn: 'Total Cartons',
      sayTotal: 'SAY TOTAL',
      freight: 'Freight',
      insurance: 'Insurance',
      discount: 'Discount',
    },
    footer: {
      validityNote: 'Prices are valid until the date stated above.',
      offerNote: 'This quotation is for your reference only and does not constitute a binding offer unless confirmed by us in writing.',
      piNote: 'This Proforma Invoice is for the buyer to apply for foreign exchange / open L/C. It is not a tax invoice.',
      ciNote: 'We hereby certify that the information stated in this invoice is true and correct.',
      plNote: 'This packing list is issued for customs clearance purposes only.',
    },
    /* 默认条款模板 */
    defaults: {
      quotationTerms:
        '1. Payment Terms: 30% T/T deposit, 70% balance before shipment.\n2. Delivery Time: 25-30 days after receipt of deposit.\n3. Prices are quoted in the currency stated above.\n4. Packing: standard export carton.',
      piTerms:
        '1. This Proforma Invoice is not a tax invoice.\n2. 30% T/T deposit, 70% balance against copy of B/L.\n3. Shipment within 30 days after receipt of deposit.\n4. Partial shipment and transshipment are allowed.',
      contractClauses: [
        {
          title: '1. Commodity and Price',
          body: 'The Seller agrees to sell and the Buyer agrees to buy the commodities listed above at the prices stated in this Contract. The prices are fixed and shall not be adjusted except by written agreement of both parties.',
        },
        {
          title: '2. Quality Standard',
          body: 'The quality of the goods shall conform to the specification confirmed by both parties. Inspection certificate issued by the manufacturer shall be taken as the basis of delivery.',
        },
        {
          title: '3. Delivery',
          body: 'Time of shipment: within 30 days after receipt of the deposit, subject to the terms stated above. Partial shipment and transshipment are allowed. The shipping advice shall be sent to the Buyer promptly after shipment.',
        },
        {
          title: '4. Payment',
          body: 'The Buyer shall pay 30% of the total amount as deposit by T/T within 3 working days after signing this Contract, and the remaining 70% by T/T before shipment or against the copy of shipping documents.',
        },
        {
          title: '5. Packing, Transport and Insurance',
          body: 'The goods shall be packed in standard export packing, suitable for long-distance ocean transportation and well protected against dampness, moisture, shock and rough handling. Insurance shall be effected by the party named in the price terms.',
        },
        {
          title: '6. Claims and Force Majeure',
          body: 'Any claim by the Buyer regarding the goods shall be filed within 30 days after arrival of the goods at the port of destination, supported by an inspection report. Neither party shall be liable for failure to perform caused by force majeure events.',
        },
        {
          title: '7. Arbitration',
          body: 'All disputes arising from or in connection with this Contract shall be settled through friendly negotiation. In case no settlement can be reached, the dispute shall be submitted to arbitration in the Seller\u2019s country. The arbitral award shall be final and binding upon both parties.',
        },
      ],
    },
  },

  /* ---------------- 中文 ---------------- */
  zh: {
    code: 'zh',
    dir: 'ltr',
    docTitle: {
      quotation: '报价单',
      pi: '形式发票',
      contract: '销售合同',
    purchase_contract: '采购合同',
      ci: '商业发票',
      pl: '装箱单',
      bank: '水单',
      bill_of_lading: '提单',
      certificate_of_origin: '原产地证明',
      customs_declaration: '报关单',
    declaration_elements: '申报要素',
      inspection_certificate: '检验证书',
      fumigation_certificate: '熏蒸证书',
      beneficiary_certificate: '受益人证明',
      shipper_letter_instruction: '发货人委托书',
      insurance_policy: '保险单',
      cost_estimation: '成本估算单',
    },
    label: {
      from: '卖方 / 出口商',
      to: '买方 / 客户',
      consignee: '收货人',
      notify: '通知方',
      // 装箱单专用（对照真实 PL 模板）
      route: '船由',
      routeBy: 'BY',
      invoiceNoShort: '发票号码',
      invoiceDate: '发票日期',
      stampSignature: '盖章与签字',
      totalPackedIn: '合计包装',
      docNo: '编号',
      date: '日期',
      validUntil: '有效期至',
      contractNo: '合同编号',
      /* 合同专有（对照 exradoc 的 Trade Contract） */
      placeOfSigning: '签署地',
      shipmentDate: '装运日期',
      deliveryTerms: '交货条款',
      insuranceTerms: '保险条款',
      penaltyClause: '违约条款',
      signer: '签署人',
      signerTitle: '职务',
      signDate: '签署日期',
      spec: '尺寸 (mm)',
      remark: '备注',
      minOrderQty: '最小起订量',
      signatureName: '签名人',
      signatureTitle: '职务',
      invoiceNo: '发票编号',
      piNo: '形式发票号',
      piNoShort: 'PI 号',
      poNoShort: 'PO 号',
      priceTerm: '价格条款',
      quotationNo: '报价单号',
      plNo: '装箱单号',
      incoterms: '贸易术语',
      destination: '目的港',
      loadingPort: '装运港',
      leadTime: '交货期',
      paymentTerms: '付款方式',
      currency: '币种',
      priceTerms: '价格条款',
      countryOfOrigin: '原产国',
      /* 清关 / 出口参考信息 */
      poNo: 'PO / 参考号',
      lcNo: '信用证号',
      awbNo: '空运单 / 提单号',
      countryOfExport: '出口国',
      reasonForExport: '出口原因',
      tradeTerms: '贸易术语',
      tradeTermsPlace: '交货地',
      shippingMethod: '运输方式',
      totalPackages: '总件数 / 总毛重',
      deliveryPlace: '交货地点',
      productionTime: '生产周期',
      warranty: '保修条款',
      invoiceType: '发票类型',
      payingBank: '开证行',
      sampleNote: '样品说明',
      logistics: '交货与售后',
      marks: '唛头',
    domesticSource: '境内货源地',
      refNo: '参考号',
      attn: '联系人',
      tel: '电话',
      fax: '传真',
      email: '邮箱',
      address: '地址',
      city: '城市',
      state: '州/省',
      zip: '邮编',
      country: '国家',
      bankInfo: '银行收款信息',
      beneficiary: '收款人',
      bankName: '开户银行',
      bankAddress: '银行地址',
      accountNo: '银行账号',
      swift: 'SWIFT 代码',
      iban: 'IBAN / 其他',
      remarks: '备注',
      terms: '条款与条件',
      seller: '卖方（签章）',
      buyer: '买方（签章）',
      signature: '签字',
      stamp: '公司盖章',
      preparedBy: '制单人',
      page: '第',
      ourRef: '我方编号',
      yourRef: '客户编号',
    },
    th: {
      no: '序号',
      photo: '图片',
      description: '品名及描述',
      spec: '尺寸 (mm)',
      model: '型号',
      hsCode: 'HS 编码',
      discount: '折扣',
      origin: '原产国',
      dest: '目的国',
      remark: '备注',
      unit: '单位',
      qty: '数量',
      unitPrice: '单价',
      amount: '金额',
      ctnNo: '箱号',
      brandType: '品牌类型',
      preferential: '出口享惠情况',
      usagePurpose: '用途',
      material: '材质',
      specText: '规格',
      gtin: 'GTIN',
      cas: 'CAS',
      container: '装柜',
      subtotal: '小计',
      unassigned: '未分配柜',
      seal: '封号',
      pkgs: '件数',
      nw: '净重',
      gw: '毛重',
      meas: '体积',
      total: '合计',
      origin: '原产地',
    },
    sum: {
      totalQty: '总数量',
      totalAmount: '总金额',
      totalNw: '总净重',
      totalGw: '总毛重',
      totalMeas: '总体积',
      totalCtn: '总箱数',
      sayTotal: '金额大写',
      freight: '运费',
      insurance: '保险费',
      discount: '折扣',
    },
    footer: {
      validityNote: '以上报价在有效期内有效。',
      offerNote: '本报价单仅供参考，最终以双方书面确认为准。',
      piNote: '本形式发票供买方办理付汇 / 开立信用证使用，不作为税务发票。',
      ciNote: '兹证明本发票所列内容真实无误。',
      plNote: '本装箱单仅供报关清关使用。',
    },
    defaults: {
      quotationTerms:
        '1. 付款方式：30% T/T 定金，70% 发货前付清。\n2. 交货期：收到定金后 25-30 天。\n3. 以上价格为所注币种报价。\n4. 包装：标准出口纸箱。',
      piTerms:
        '1. 本形式发票非税务发票。\n2. 30% T/T 定金，70% 见提单副本付款。\n3. 收到定金后 30 天内装运。\n4. 允许分批装运和转运。',
      contractClauses: [
        {
          title: '一、商品与价格条款',
          body: '卖方同意按本合同所列价格出售、买方同意购买上述商品。价格为固定价格，除双方书面同意外不得调整。',
        },
        {
          title: '二、质量标准条款',
          body: '货物质量应符合双方确认的规格要求。以生产厂家出具的检验证书作为交货依据。',
        },
        {
          title: '三、交货条款',
          body: '装运期：收到定金后 30 天内，具体以本合同约定为准。允许分批装运与转运。装运后卖方应及时向买方发出装运通知。',
        },
        {
          title: '四、付款条款',
          body: '买方应于本合同签订后 3 个工作日内以 T/T 方式支付合同总额 30% 作为定金，余款 70% 于发货前或凭装运单据副本以 T/T 方式付清。',
        },
        {
          title: '五、包装、运输与保险',
          body: '货物采用标准出口包装，适合长途海运，并具备防潮、防湿、防震及防粗暴装卸能力。保险由价格条款约定的一方负责办理。',
        },
        {
          title: '六、异议索赔与不可抗力',
          body: '买方对货物的任何异议应于货物到达目的港后 30 天内提出，并附检验报告。因不可抗力事件导致无法履约的，双方均不承担责任。',
        },
        {
          title: '七、争议解决',
          body: '凡因本合同引起的或与本合同有关的任何争议，双方应友好协商解决；协商不成的，提交卖方所在国仲裁机构仲裁。仲裁裁决为终局裁决，对双方均有约束力。',
        },
      ],
    },
  },

  /* ---------------- ไทย (泰语) ---------------- */
  th: {
    code: 'th',
    dir: 'ltr',
    docTitle: {
      quotation: 'ใบเสนอราคา',
      pi: 'ใบแจ้งหนี้ชั่วคราว',
      contract: 'สัญญาการซื้อขาย',
      ci: 'ใบกำกับสินค้า',
      pl: 'ใบรายการบรรจุหีบห่อ',
    },
    label: {
      from: 'ผู้ขาย / ผู้ส่งออก',
      to: 'ผู้ซื้อ / ลูกค้า',
      consignee: 'ผู้รับสินค้า',
      notify: 'ผู้รับแจ้ง',
      // 装箱单专用（对照真实 PL 模板）
      route: 'เส้นทาง',
      routeBy: 'โดย',
      invoiceNoShort: 'เลขที่ใบกำกับ',
      invoiceDate: 'วันที่ใบกำกับ',
      stampSignature: 'ตราประทับและลายเซ็นบริษัท',
      totalPackedIn: 'บรรจุรวมใน',
      docNo: 'เลขที่',
      date: 'วันที่',
      validUntil: 'ใช้ได้ถึงวันที่',
      contractNo: 'เลขที่สัญญา',
      invoiceNo: 'เลขที่ใบกำกับ',
      piNo: 'เลขที่ใบแจ้งหนี้ชั่วคราว',
      quotationNo: 'เลขที่ใบเสนอราคา',
      plNo: 'เลขที่ใบรายการบรรจุ',
      incoterms: 'เงื่อนไขการค้า (Incoterms)',
      destination: 'ท่าเรือปลายทาง',
      loadingPort: 'ท่าเรือต้นทาง',
      leadTime: 'ระยะเวลาส่งมอบ',
      paymentTerms: 'เงื่อนไขการชำระเงิน',
      currency: 'สกุลเงิน',
      priceTerms: 'เงื่อนไขราคา',
      countryOfOrigin: 'ประเทศแหล่งกำเนิด',
      poNo: 'เลขที่ PO / อ้างอิง',
      lcNo: 'เลขที่ L/C',
      awbNo: 'เลขที่ใบขนย้าย / B/L',
      countryOfExport: 'ประเทศที่ส่งออก',
      reasonForExport: 'เหตุผลการส่งออก',
      tradeTerms: 'เงื่อนไขการค้า',
      tradeTermsPlace: 'สถานที่',
      shippingMethod: 'วิธีขนส่ง',
      totalPackages: 'จำนวนหีบห่อ / น้ำหนักรวม',
      deliveryPlace: 'สถานที่ส่งมอบ',
      productionTime: 'ระยะเวลาผลิต',
      warranty: 'การรับประกัน',
      invoiceType: 'ประเภทใบกำกับ',
      payingBank: 'ธนาคารที่เปิด L/C',
      sampleNote: 'หมายเหตุตัวอย่างสินค้า',
      logistics: 'การส่งมอบและบริการหลังการขาย',
      marks: 'เครื่องหมายหีบห่อ',
      refNo: 'เลขที่อ้างอิง',
      attn: 'ผู้ติดต่อ',
      tel: 'โทรศัพท์',
      fax: 'แฟกซ์',
      email: 'อีเมล',
      address: 'ที่อยู่',
      // 用最常见的单一叫法：原来写成「เมือง / อำเภอ」这类并列双名称，
      // 在单据里会折成两行，反而不好读（泰语里 เมือง 就是通用的「城市/区」）
      city: 'เมือง',
      state: 'จังหวัด',
      zip: 'รหัสไปรษณีย์',
      country: 'ประเทศ',
      bankInfo: 'ข้อมูลบัญชีธนาคาร',
      beneficiary: 'ผู้รับเงิน',
      bankName: 'ชื่อธนาคาร',
      bankAddress: 'ที่อยู่ธนาคาร',
      accountNo: 'เลขที่บัญชี',
      swift: 'รหัส SWIFT',
      iban: 'IBAN / อื่น ๆ',
      remarks: 'หมายเหตุ',
      terms: 'ข้อกำหนดและเงื่อนไข',
      seller: 'ผู้ขาย (ลงนาม)',
      buyer: 'ผู้ซื้อ (ลงนาม)',
      signature: 'ลายเซ็น',
      stamp: 'ตราประทับบริษัท',
      preparedBy: 'ผู้จัดทำ',
      page: 'หน้า',
      ourRef: 'เลขที่ของเรา',
      yourRef: 'เลขที่ของท่าน',
    },
    /* 注意：泰语表格列名放在 tableTh，避免与 th 国别代码混淆 */
    tableTh: {
      no: 'ลำดับ',
      photo: 'รูปภาพ',
      description: 'รายละเอียดสินค้า',
      model: 'รุ่น',
      hsCode: 'รหัส HS',
      unit: 'หน่วย',
      qty: 'จำนวน',
      unitPrice: 'ราคาต่อหน่วย',
      amount: 'จำนวนเงิน',
      ctnNo: 'เลขที่หีบห่อ',
      pkgs: 'จำนวนหีบ',
      nw: 'น้ำหนักสุทธิ (กก.)',
      gw: 'น้ำหนักรวม (กก.)',
      meas: 'ปริมาตร (ลบ.ม.)',
      total: 'รวม',
      origin: 'แหล่งกำเนิด',
    },
    sum: {
      totalQty: 'จำนวนรวม',
      totalAmount: 'จำนวนเงินรวม',
      totalNw: 'น้ำหนักสุทธิรวม',
      totalGw: 'น้ำหนักรวมทั้งหมด',
      totalMeas: 'ปริมาตรรวม',
      totalCtn: 'จำนวนหีบห่อรวม',
      sayTotal: 'จำนวนเงินเป็นตัวอักษร',
      subtotal: 'ยอดรวมย่อย',
      freight: 'ค่าขนส่ง',
      insurance: 'ค่าประกันภัย',
      discount: 'ส่วนลด',
    },
    footer: {
      validityNote: 'ราคาข้างต้นมีผลภายในระยะเวลาที่กำหนดไว้ข้างต้น',
      offerNote: 'ใบเสนอราคานี้จัดทำเพื่อประกอบการพิจารณาเท่านั้น ไม่ถือเป็นข้อผูกพันจนกว่าจะได้รับการยืนยันเป็นลายลักษณ์อักษร',
      piNote: 'ใบแจ้งหนี้ชั่วคราวนี้ใช้สำหรับผู้ซื้อเพื่อขอเปิด L/C เท่านั้น ไม่ใช่ใบกำกับภาษี',
      ciNote: 'ขอรับรองว่าข้อความในใบกำกับสินค้านี้ถูกต้องและเป็นความจริง',
      plNote: 'ใบรายการบรรจุนี้จัดทำขึ้นเพื่อใช้ในการผ่านพิธีการศุลกากรเท่านั้น',
    },
    defaults: {
      quotationTerms:
        '1. เงื่อนไขการชำระเงิน: ชำระมัดจำ 30% ทาง T/T ส่วนที่เหลือ 70% ชำระก่อนการส่งสินค้า\n2. ระยะเวลาส่งมอบ: 25-30 วันหลังได้รับเงินมัดจำ\n3. ราคาตามสกุลเงินที่ระบุไว้ข้างต้น\n4. การบรรจุ: กล่องกระดาษมาตรฐานเพื่อการส่งออก',
      piTerms:
        '1. ใบแจ้งหนี้ชั่วคราวนี้ไม่ใช่ใบกำกับภาษี\n2. ชำระมัดจำ 30% ทาง T/T ส่วนที่เหลือ 70% ชำระเมื่อเห็นสำเนาใบตราส่งสินค้า\n3. จัดส่งภายใน 30 วันหลังได้รับเงินมัดจำ\n4. ยอมรับการส่งสินค้าเป็นบางส่วนและการถ่ายลำ',
      contractClauses: [
        {
          title: '1. ข้อกำหนดเกี่ยวกับสินค้าและราคา',
          body: 'ผู้ขายตกลงขายและผู้ซื้อตกลงซื้อสินค้าตามรายการข้างต้นในราคาที่ระบุในสัญญาฉบับนี้ ราคาดังกล่าวเป็นราคาคงที่ จะไม่มีการปรับเปลี่ยนเว้นแต่ทั้งสองฝ่ายตกลงเป็นลายลักษณ์อักษร',
        },
        {
          title: '2. ข้อกำหนดด้านคุณภาพ',
          body: 'คุณภาพของสินค้าต้องเป็นไปตามข้อกำหนดที่ทั้งสองฝ่ายได้ยืนยันร่วมกัน โดยใช้ใบรับรองการตรวจสอบที่ออกโดยผู้ผลิตเป็นหลักฐานในการส่งมอบ',
        },
        {
          title: '3. ข้อกำหนดการส่งมอบ',
          body: 'กำหนดเวลาจัดส่ง: ภายใน 30 วันนับจากวันที่ได้รับเงินมัดจำ ตามเงื่อนไขที่ระบุข้างต้น ยอมรับการส่งสินค้าเป็นบางส่วนและการถ่ายลำ ผู้ขายต้องแจ้งข้อมูลการจัดส่งให้ผู้ซื้อทราบโดยเร็วหลังการจัดส่ง',
        },
        {
          title: '4. ข้อกำหนดการชำระเงิน',
          body: 'ผู้ซื้อต้องชำระเงินมัดจำ 30% ของยอดรวมทาง T/T ภายใน 3 วันทำการหลังลงนามในสัญญา และชำระส่วนที่เหลือ 70% ทาง T/T ก่อนการจัดส่งหรือเมื่อเห็นสำเนาเอกสารการส่งสินค้า',
        },
        {
          title: '5. การบรรจุ การขนส่ง และการประกันภัย',
          body: 'สินค้าต้องบรรจุด้วยบรรจุภัณฑ์มาตรฐานเพื่อการส่งออก เหมาะสมกับการขนส่งทางทะเลระยะไกล ป้องกันความชื้น ความเสียหายจากการกระแทกและการขนย้ายอย่างหยาบ การประกันภัยดำเนินการโดยฝ่ายที่ระบุในเงื่อนไขราคา',
        },
        {
          title: '6. การเรียกร้องค่าเสียหายและเหตุสุดวิสัย',
          body: 'การเรียกร้องใด ๆ ของผู้ซื้อเกี่ยวกับสินค้าต้องยื่นภายใน 30 วันหลังจากสินค้าถึงท่าเรือปลายทาง พร้อมรายงานการตรวจสอบ ทั้งสองฝ่ายไม่ต้องรับผิดชอบจากการไม่สามารถปฏิบัติตามสัญญาอันเนื่องมาจากเหตุสุดวิสัย',
        },
        {
          title: '7. การระงับข้อพิพาท',
          body: 'ข้อพิพาทใด ๆ ที่เกิดจากหรือเกี่ยวข้องกับสัญญาฉบับนี้ ให้แก้ไขด้วยการเจรจาอย่างฉันท์มิตร หากไม่สามารถตกลงกันได้ ให้เสนอต่อสถาบันอนุญาโตตุลาการในประเทศของผู้ขาย คำชี้ขาดถือเป็นที่สุดและมีผลผูกพันทั้งสองฝ่าย',
        },
      ],
    },
  },
};

/** 产品规格列名的兜底（各语种语言包没写时用这些英文，避免出现 undefined） */
const SPEC_LABEL_FALLBACK = {
  spec: 'Size (mm)',
  remark: 'Remarks',
  discount: 'Discount',
  origin: 'Origin',
  dest: 'Dest.',
  styleName: 'Style',
  size: 'Size',
  color: 'Color',
  material: 'Material',
  moq: 'MOQ',
  unitsPerCtn: 'Units/ctn',
  ctnSize: 'Carton',
  netWeight: 'Unit weight',
  toolingCost: 'Tooling',
  sampleQty: 'Sample qty',
  sampleFee: 'Sample price',
  bulkPrice: 'Bulk price',
};

/** 兼容：泰语等语种的表格列名放在 tableTh，其它语言为 th */
export function tableLabels(langCode) {
  const tpl = getTemplate(langCode);
  return { ...SPEC_LABEL_FALLBACK, ...(tpl.tableTh || tpl.th || TEMPLATES.en.th) };
}

/**
 * 取语言包（带兜底与补全）
 * · 未知语言回退英文
 * · 缺失的 label / sum / th / footer 用英文补齐，避免界面出现 key 或空白
 * · 合同条款若不完整（少于 7 条）自动用英文完整条款补齐，保证合同专业性
 */
/**
 * 装箱单底部说明条款的 12 语言文案 + 买卖双方签字标题。
 *
 * 集中定义在这里，而不是各语言包里复制一份 —— 原因：
 *   1. 这两组文案是「装箱单专用」的成块文本，集中放改起来不容易漏；
 *   2. getTemplate 的合并是按白名单字段做的（见下方 ensureSharedKeys），
 *      分散写会踩到「新加的顶层键对扩展语种不生效」这个坑。
 */
export const PL_TEXT = {
  en: { seller: 'THE SELLER', buyer: 'THE BUYER',
    short: { attn: 'Attn', addr: 'Add', invoiceNoShort: 'INV No.', piNoShort: 'PI No.', poNoShort: 'PO No.', priceTerm: 'Price Term' },
    terms: ['COUNTRY OF ORIGIN', 'TERMS OF PAYMENT', 'DELIVERY TIME', 'PACKAGING', 'by roll then in box', 'SHIPPING MARK', "SELLER (BENEFICIARY)'S SPECIFIC INFORMATION"] },
  zh: { seller: '卖方', buyer: '买方',
    short: { attn: '联系人', addr: '地址', invoiceNoShort: '发票号', piNoShort: 'PI 号', poNoShort: 'PO 号', priceTerm: '价格条款' },
    terms: ['原产国', '付款方式', '交货期', '包装方式', '卷装后装箱', '唛头', '卖方（收款人）具体信息'] },
  th: { seller: 'ผู้ขาย', buyer: 'ผู้ซื้อ',
    short: { attn: 'ผู้ติดต่อ', addr: 'ที่อยู่', invoiceNoShort: 'เลขที่ใบกำกับ', piNoShort: 'เลขที่ PI', poNoShort: 'เลขที่ PO', priceTerm: 'เงื่อนไขราคา' },
    terms: ['ประเทศแหล่งกำเนิด', 'เงื่อนไขการชำระเงิน', 'กำหนดส่งมอบ', 'การบรรจุ', 'ม้วนแล้วบรรจุในกล่อง', 'เครื่องหมายหีบห่อ', 'ข้อมูลเฉพาะของผู้ขาย (ผู้รับเงิน)'] },
  es: { seller: 'EL VENDEDOR', buyer: 'EL COMPRADOR',
    short: { attn: 'Atn.', addr: 'Dir.', invoiceNoShort: 'N.º FACT.', piNoShort: 'N.º PI', poNoShort: 'N.º PO', priceTerm: 'Cond. precio' },
    terms: ['PAÍS DE ORIGEN', 'CONDICIONES DE PAGO', 'PLAZO DE ENTREGA', 'EMBALAJE', 'en rollo y luego en caja', 'MARCA DE ENVÍO', 'INFORMACIÓN DEL VENDEDOR (BENEFICIARIO)'] },
  fr: { seller: 'LE VENDEUR', buyer: "L'ACHETEUR",
    short: { attn: 'Attn', addr: 'Adr.', invoiceNoShort: 'N° FACT.', piNoShort: 'N° PI', poNoShort: 'N° PO', priceTerm: 'Cond. prix' },
    terms: ["PAYS D'ORIGINE", 'CONDITIONS DE PAIEMENT', 'DÉLAI DE LIVRAISON', 'EMBALLAGE', 'en rouleau puis en carton', "MARQUE D'EXPÉDITION", 'INFORMATIONS DU VENDEUR (BÉNÉFICIAIRE)'] },
  de: { seller: 'DER VERKÄUFER', buyer: 'DER KÄUFER',
    short: { attn: 'z. Hd.', addr: 'Adr.', invoiceNoShort: 'RG-Nr.', piNoShort: 'PI-Nr.', poNoShort: 'PO-Nr.', priceTerm: 'Preisbed.' },
    terms: ['URSPRUNGSLAND', 'ZAHLUNGSBEDINGUNGEN', 'LIEFERZEIT', 'VERPACKUNG', 'auf Rolle, dann in Karton', 'VERSANDMARKE', 'ANGABEN DES VERKÄUFERS (BEGÜNSTIGTER)'] },
  pt: { seller: 'O VENDEDOR', buyer: 'O COMPRADOR',
    short: { attn: 'Att.', addr: 'End.', invoiceNoShort: 'N.º FAT.', piNoShort: 'N.º PI', poNoShort: 'N.º PO', priceTerm: 'Cond. preço' },
    terms: ['PAÍS DE ORIGEM', 'CONDIÇÕES DE PAGAMENTO', 'PRAZO DE ENTREGA', 'EMBALAGEM', 'em rolo e depois em caixa', 'MARCA DE ENVIO', 'INFORMAÇÕES DO VENDEDOR (BENEFICIÁRIO)'] },
  ru: { seller: 'ПРОДАВЕЦ', buyer: 'ПОКУПАТЕЛЬ',
    short: { attn: 'Контакт', addr: 'Адрес', invoiceNoShort: '№ счёта', piNoShort: '№ PI', poNoShort: '№ PO', priceTerm: 'Усл. цены' },
    terms: ['СТРАНА ПРОИСХОЖДЕНИЯ', 'УСЛОВИЯ ОПЛАТЫ', 'СРОК ПОСТАВКИ', 'УПАКОВКА', 'в рулоне, затем в коробке', 'ОТГРУЗОЧНАЯ МАРКИРОВКА', 'ДАННЫЕ ПРОДАВЦА (БЕНЕФИЦИАРА)'] },
  ar: { seller: 'البائع', buyer: 'المشتري',
    short: { attn: 'الشخص', addr: 'العنوان', invoiceNoShort: 'رقم الفاتورة', piNoShort: 'رقم PI', poNoShort: 'رقم PO', priceTerm: 'شرط السعر' },
    terms: ['بلد المنشأ', 'شروط الدفع', 'مدة التسليم', 'التغليف', 'لفة ثم في صندوق', 'علامة الشحن', 'معلومات البائع (المستفيد)'] },
  vi: { seller: 'NGƯỜI BÁN', buyer: 'NGƯỜI MUA',
    short: { attn: 'Người nhận', addr: 'Địa chỉ', invoiceNoShort: 'Số HĐ', piNoShort: 'Số PI', poNoShort: 'Số PO', priceTerm: 'ĐK giá' },
    terms: ['NƯỚC XUẤT XỨ', 'ĐIỀU KHOẢN THANH TOÁN', 'THỜI GIAN GIAO HÀNG', 'ĐÓNG GÓI', 'cuộn rồi đóng thùng', 'NHÃN HIỆU VẬN CHUYỂN', 'THÔNG TIN NGƯỜI BÁN (THỤ HƯỞNG)'] },
  ja: { seller: '売主', buyer: '買主',
    short: { attn: '担当', addr: '住所', invoiceNoShort: '請求書番号', piNoShort: 'PI 番号', poNoShort: 'PO 番号', priceTerm: '価格条件' },
    terms: ['原産国', '支払条件', '納期', '梱包方法', 'ロール巻きの後、箱詰め', '荷印', '売主（受取人）情報'] },
  ko: { seller: '매도인', buyer: '매수인',
    short: { attn: '담당자', addr: '주소', invoiceNoShort: '송장번호', piNoShort: 'PI 번호', poNoShort: 'PO 번호', priceTerm: '가격 조건' },
    terms: ['원산지', '결제 조건', '납기', '포장 방식', '롤 포장 후 박스 포장', '화인(선적 표시)', '매도인(수취인) 정보'] },
  // 乌兹别克语（装箱单第 1~6 条）
  uz: { seller: 'SOTUVCHI', buyer: 'XARIDOR',
    short: { attn: 'Diqqatiga', addr: 'Manzil', invoiceNoShort: 'HISOB-FAKTURA №', piNoShort: 'PROFORMA №', poNoShort: 'Buyurtma №', priceTerm: 'Narx sharti' },
    terms: ['KELIB CHIQISH MAMLAKATI', 'TOʻLOV SHARTLARI', 'YETKAZIB BERISH MUDDATI', 'QADOQLASH', 'oʻraladi, soʻng qutiga solinadi', 'YUK BELGILARI', 'SOTUVCHI (BENEFISIAR) MAʼLUMOTLARI'] },
};

const PL_TERM_KEYS = ['origin', 'payment', 'delivery', 'packing', 'packingUnit', 'marks', 'beneficiary'];

/** 把 PL_TEXT 注入某个语言包（幂等）
 *  以 PL_TEXT 为准而不是「缺了才补」：label 会从英语包展开合并，
 *  如果英语包里已带着英文值，"缺了才补" 会让其它语种全都显示英文。 */
function applyPlText(tpl, code) {
  const t = PL_TEXT[code] || PL_TEXT.en;
  tpl.label.theSeller = t.seller;
  tpl.label.theBuyer = t.buyer;
  // 明细信息区的短标签（装箱单用；正文里另有更长的同义标签，短标签是为了表格里不折行）
  for (const [k, v] of Object.entries(t.short || {})) tpl.label[k] = v;
  tpl.plTerms = {};
  PL_TERM_KEYS.forEach((k, i) => { tpl.plTerms[k] = t.terms[i]; });
  return tpl;
}

export function getTemplate(langCode) {
  const base = TEMPLATES.en;
  let tpl = TEMPLATES[langCode] || base;
  if (tpl === base) return applyPlText(base, 'en');
  if (!tpl.__merged) {
    tpl.label = { ...base.label, ...(tpl.label || {}) };
    tpl.sum = { ...base.sum, ...(tpl.sum || {}) };
    tpl.footer = { ...base.footer, ...(tpl.footer || {}) };
    tpl.docTitle = { ...base.docTitle, ...(tpl.docTitle || {}) };
    const th = tpl.tableTh || tpl.th || {};
    tpl.tableTh = { ...base.th, ...th };
    if (tpl.code !== 'th') tpl.th = tpl.tableTh;
    tpl.defaults = { ...base.defaults, ...(tpl.defaults || {}) };
    const clauses = tpl.defaults.contractClauses;
    if (!Array.isArray(clauses) || clauses.length < 7) {
      tpl.defaults.contractClauses = base.defaults.contractClauses;
      tpl.defaults.contractClausesFallback = true;
    }
    // 装箱单文案：label.theSeller / theBuyer / plTerms
    // 注意必须在这里补 —— 上面的合并是白名单式的，新加的顶层键不会自动带过来
    applyPlText(tpl, tpl.code || langCode);
    Object.defineProperty(tpl, '__merged', { value: true, enumerable: false });
  }
  return tpl;
}

/** 合并扩展语种（实际调用放在文件末尾，确保 TEMPLATES 已定义） */
function mergeExtraTemplates() {
  for (const [code, pack] of Object.entries(EXTRA_TEMPLATES || {})) {
    if (!pack || TEMPLATES[code]) continue;
    TEMPLATES[code] = { ...pack, code };
  }
}

export function docTitle(type, langCode) {
  const tpl = getTemplate(langCode);
  return (tpl.docTitle && tpl.docTitle[type]) || type;
}

export function docLabel(key, langCode) {
  const tpl = getTemplate(langCode);
  return (tpl.label && tpl.label[key]) || key;
}

export function docSum(key, langCode) {
  const tpl = getTemplate(langCode);
  return (tpl.sum && tpl.sum[key]) || key;
}

/** 币种列表（E 覆盖主要贸易结算货币） */
export const CURRENCIES = [
  'USD', 'EUR', 'CNY', 'THB', 'GBP', 'JPY', 'AUD', 'HKD', 'SGD', 'VND',
  'MYR', 'AED', 'SAR', 'RUB', 'BRL', 'KRW', 'CAD', 'CHF', 'INR', 'IDR', 'PHP', 'MXN', 'ZAR', 'TRY',
];

/** 币种符号 */
export const CURRENCY_SYMBOL = {
  USD: '$', EUR: '€', CNY: '¥', THB: '฿', GBP: '£', JPY: '¥',
  AUD: 'A$', HKD: 'HK$', SGD: 'S$', VND: '₫', MYR: 'RM', AED: 'AED',
  SAR: 'SAR', RUB: '₽', BRL: 'R$', KRW: '₩', CAD: 'C$', CHF: 'CHF',
  INR: '₹', IDR: 'Rp', PHP: '₱', MXN: 'MX$', ZAR: 'R', TRY: '₺',
};

/** 币种中文名（界面下拉用，降低中年用户理解成本） */
export const CURRENCY_CN = {
  USD: '美元', EUR: '欧元', CNY: '人民币', THB: '泰铢', GBP: '英镑', JPY: '日元',
  AUD: '澳元', HKD: '港币', SGD: '新加坡元', VND: '越南盾', MYR: '马来西亚林吉特',
  AED: '迪拉姆', SAR: '沙特里亚尔', RUB: '卢布', BRL: '雷亚尔', KRW: '韩元',
  CAD: '加元', CHF: '瑞士法郎', INR: '印度卢比', IDR: '印尼盾', PHP: '菲律宾比索',
  MXN: '墨西哥比索', ZAR: '南非兰特', TRY: '土耳其里拉',
};

/** 贸易术语 */
export const INCOTERMS = [
  'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP',
];

/** 贸易术语中文解释（下拉提示用） */
export const INCOTERMS_CN = {
  EXW: '工厂交货（买方承担全部运费与风险）',
  FCA: '货交承运人',
  FAS: '船边交货',
  FOB: '装运港船上交货（最常见）',
  CFR: '成本加运费（不含保险）',
  CIF: '成本加保险费加运费（最常见）',
  CPT: '运费付至',
  CIP: '运费和保险费付至',
  DAP: '目的地交货',
  DPU: '目的地卸货交货',
  DDP: '完税后交货（卖方承担最多）',
};

/** 单位 */
export const UNITS = ['pc', 'pcs', 'set', 'pair', 'ctn', 'box', 'bag', 'kg', 'ton', 'm', 'm²', 'm³', 'roll', 'drum'];

/** 重量单位（默认 kg —— 外贸装箱单最常用） */
export const WEIGHT_UNITS = ['kg', 'g', 'ton', 'lb', 'oz'];
export const DEFAULT_WEIGHT_UNIT = 'kg';

/** 体积单位（默认 m³ —— 海运报价最常用） */
export const MEAS_UNITS = ['m³', 'cbm', 'ft³', 'L'];
export const DEFAULT_MEAS_UNIT = 'm³';

/** 包装单位（默认 ctn 纸箱 —— 出口装箱最常用） */
export const PACK_UNITS = ['ctn', 'box', 'case', 'pallet', 'bag', 'drum', 'bale'];
export const DEFAULT_PACK_UNIT = 'ctn';

/** 常用单位中文说明（下拉里带出来，降低理解成本） */
export const UNIT_CN = {
  pc: '个', pcs: '个', set: '套', pair: '对', ctn: '纸箱', box: '盒/箱',
  bag: '袋', kg: '千克', g: '克', ton: '吨', lb: '磅', oz: '盎司',
  m: '米', 'm²': '平方米', 'm³': '立方米', cbm: '立方米', 'ft³': '立方英尺',
  L: '升', roll: '卷', drum: '桶', case: '木箱', pallet: '托盘', bale: '包',
};

/** 带中文说明的单位选项 */
export function unitOptions(list) {
  return list.map((u) => ({ value: u, label: UNIT_CN[u] ? `${u}（${UNIT_CN[u]}）` : u }));
}

/* 文件末尾执行语种合并：此时 TEMPLATES 已定义完毕 */
mergeExtraTemplates();

