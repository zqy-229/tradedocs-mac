/* 每张单据新建时预填的示例案例（方便用户参照 / 直接改写）
 * 覆盖全部 15 种单据：统一卖方 + 按类型的买方 / 明细 / 特有字段。
 * 纯数据，不依赖其它模块，避免循环引用。
 *
 * 设计原则（2026-10 重写）：
 *   1. **尽量填满** —— 单据上会印的字段，示例里基本都有值，新建出来就是一份完整样张；
 *   2. **同一笔生意** —— 三家客户、同一批货（100 箱宠物用品，深圳 → 汉堡），
 *      报价单 / PI / 合同 / 发票 / 装箱单 / 提单 / 报关单 / 产地证 / 保险单的数据互相对得上；
 *   3. 卖方、银行等重复信息抽成常量，改一处全改。
 */

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** 今天往后 n 天（有效期之类） */
function daysLater(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------------- 卖方（示例出口商） ---------------- */
const SELLER = {
  companyName: 'SUNVL TECH CO., LTD.',
  address: 'Room 1203, Building A, Hi-Tech Park, Nanshan District, Shenzhen, Guangdong, China',
  city: 'Shenzhen', state: 'Guangdong', zip: '518057', country: 'China',
  contact: 'Mr. Chen Wei', tel: '+86 755 8888 6666', fax: '+86 755 8888 6667',
  email: 'sales@sunvl-demo.com', website: 'www.sunvl-demo.com', taxId: '91440300MA5XXXXXX0K',
};

/* ---------------- 收款银行（PI / CI / 合同 / 报价单 / 装箱单 都会印） ---------------- */
const BANK = {
  beneficiary: 'SUNVL TECH CO., LTD.',
  bankName: 'BANK OF CHINA, SHENZHEN BRANCH',
  bankAddress: 'No. 2022 Jianshe Road, Luohu District, Shenzhen, China',
  accountNo: '7654 3210 9876 5432 100',
  swift: 'BKCHCNBJ45A',
  iban: '',
};

/* ---------------- 客户（三家 + 银行 / 货代） ---------------- */
const BUYER_US = {
  companyName: 'ACME Import Co., Ltd.',
  address: '123 Harbor Blvd, Suite 500', city: 'Los Angeles', state: 'CA', zip: '90802',
  country: 'United States', contact: 'Ms. Emily Carter', tel: '+1 310 555 0182',
  fax: '+1 310 555 0183', email: 'purchase@acme-demo.com', website: 'www.acme-demo.com',
  taxId: 'US-95-1234567',
};
const BUYER_TH = {
  companyName: 'Bangkok Trading Co., Ltd.',
  address: '88/9 Sukhumvit Road, Klongtoey', city: 'Bangkok', state: '', zip: '10110',
  country: 'Thailand', contact: 'Khun Somchai', tel: '+66 2 123 4567',
  fax: '+66 2 123 4568', email: 'purchase@siam-demo.co.th', website: 'www.bangkok-trading-demo.co.th',
  taxId: 'TH-0105551234567',
};
const BUYER_AE = {
  companyName: 'AI Noor General Trading LLC',
  address: 'Warehouse 12, Al Quoz Industrial Area 3', city: 'Dubai', state: 'Dubai', zip: '00000',
  country: 'United Arab Emirates', contact: 'Mr. Ahmed Al Noor', tel: '+971 4 555 0180',
  fax: '+971 4 555 0181', email: 'import@alnoor-demo.ae', website: 'www.alnoor-demo.ae',
  taxId: 'AE-100123456700003',
};
const BUYER_AU = {
  companyName: 'Smith Trading LLC',
  address: 'Level 8, 45 Clarence Street', city: 'Sydney', state: 'NSW', zip: '2000',
  country: 'Australia', contact: 'Ms. Olivia Smith', tel: '+61 2 9000 1234',
  fax: '+61 2 9000 1235', email: 'import@smith-demo.com.au', website: 'www.smith-demo.com.au',
  taxId: 'AU-51 824 753 556',
};
const BUYER_DE = {
  companyName: 'VELTRONA GMBH',
  address: 'Hafenstrasse 12, Speicherstadt', city: 'Hamburg', state: 'Hamburg', zip: '20457',
  country: 'Germany', contact: 'Mr. Hans Müller', tel: '+49 40 1234 5678',
  fax: '+49 40 1234 5679', email: 'import@veltr-demo.de', website: 'www.veltrona-demo.de',
  taxId: 'DE-123456789',
};
const BANK_DE = {
  companyName: 'First National Bank AG, Hamburg',
  address: 'Ballindamm 27', city: 'Hamburg', state: '', zip: '20095',
  country: 'Germany', contact: 'Trade Finance Dept.', tel: '+49 40 9876 5432',
  email: 'trade.finance@fnb-demo.de', taxId: 'DE-987654321',
};
const FORWARDER = {
  companyName: 'Global Freight Forwarders Co., Ltd.',
  address: 'Room 505, Logistics Building, Yantian Port', city: 'Shenzhen', state: 'Guangdong', zip: '518081',
  country: 'China', contact: 'Ms. Liu Na', tel: '+86 755 2222 3333',
  fax: '+86 755 2222 3334', email: 'booking@globalfreight-demo.com', website: 'www.globalfreight-demo.com',
  taxId: '91440300MA5YYYYYY1L',
};

/* ---------------- 同一批货的公共信息（深圳 → 汉堡） ---------------- */
const SHIP = {
  incoterms: 'CIF', tradeTermsPlace: 'HAMBURG, GERMANY',
  destination: 'HAMBURG, GERMANY', loadingPort: 'SHENZHEN, CHINA',
  leadTime: '25-30 days after receipt of deposit',
  paymentTerms: 'T/T 30% deposit, 70% balance before shipment',
  currency: 'USD', exchangeRate: 1,
  priceTerms: 'CIF HAMBURG', countryOfOrigin: 'China',
  marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
  shippingMethod: 'Sea', deliveryPlace: 'Hamburg, Germany',
  productionTime: '25-30 days', warranty: '12 months against manufacturing defects',
  invoiceType: 'Commercial Invoice',
  shippingFee: 320, insuranceFee: 85, otherFee: 0, otherFeeLabel: '',
  routeFrom: 'SHENZHEN, CHINA', routeTo: 'HAMBURG, GERMANY', routeBy: 'BY SEA',
};

/* 出口报关 / 信用证等参考号：一张单一份，编得像真的 */
const REFS = {
  poNo: 'PO-ACME-2026-0088', piNo: 'PI-2026-001', lcNo: '', awbNo: '',
  countryOfExport: 'China', reasonForExport: 'Commercial sale',
  contractNo: 'SC-2026-001', invoiceNo: 'INV-2026-001', invoiceDate: today(),
  payingBank: 'HSBC Bank (China) Company Limited, Shenzhen Branch',
  beneficiaryAccount: '7654 3210 9876 5432 100',
  preparedBy: 'Chen Wei',
};

/* ---------------- 明细：同一批货三种口径 ---------------- */
/* 报价 / PI / CI 用：按件计价 */
const ITEMS_SALE = [
  {
    description: 'Automatic Pet Feeder', model: 'APF-2000', size: '28×24×20 cm',
    hsCode: '8436800000', unit: 'set', qty: 500, unitPrice: 18.5,
    nw: 2.1, gw: 2.6, meas: 0.01, ctns: 50, domesticSource: 'Shenzhen, Guangdong',
    origin: 'China', dest: 'Germany', remark: 'CE / RoHS certified', color: 'White',
    material: 'ABS + stainless steel', styleName: 'APF', moq: 200,
  },
  {
    description: 'Silicone Food Bowl', model: 'SFB-300', size: '15×15×6 cm',
    hsCode: '3924100000', unit: 'pc', qty: 1000, unitPrice: 3.2,
    nw: 0.15, gw: 0.2, meas: 0.0006, ctns: 50, domesticSource: 'Shenzhen, Guangdong',
    origin: 'China', dest: 'Germany', remark: 'Food grade, anti-slip', color: 'Various',
    material: 'Food grade silicone', styleName: 'SFB', moq: 500,
  },
  {
    description: 'Pet Water Fountain', model: 'PWF-150', size: '22×20×18 cm',
    hsCode: '8421210000', unit: 'set', qty: 200, unitPrice: 24.8,
    nw: 1.6, gw: 2.0, meas: 0.008, ctns: 20, domesticSource: 'Shenzhen, Guangdong',
    origin: 'China', dest: 'Germany', remark: '2.5 L, USB powered', color: 'Grey',
    material: 'ABS + PP', styleName: 'PWF', moq: 100,
  },
];
/* 装箱单 / 提单 / 熏蒸用：按箱计重量体积 */
const ITEMS_SHIP = [
  {
    description: 'Automatic Pet Feeder (export carton)', model: 'APF-2000', size: '50 pcs / ctn',
    hsCode: '8436800000', unit: 'ctn', qty: 50, ctns: 50, ctnNo: 'CTN NO. 1-50',
    nw: 105, gw: 132, meas: 1.5, origin: 'China', dest: 'Germany',
    marks: 'SUNVL\nHAMBURG\nCTN NO. 1-50', remark: '50 sets per carton',
  },
  {
    description: 'Silicone Food Bowl (export carton)', model: 'SFB-300', size: '100 pcs / ctn',
    hsCode: '3924100000', unit: 'ctn', qty: 50, ctns: 50, ctnNo: 'CTN NO. 51-100',
    nw: 45, gw: 60, meas: 0.8, origin: 'China', dest: 'Germany',
    marks: 'SUNVL\nHAMBURG\nCTN NO. 51-100', remark: '100 pcs per carton',
  },
];
/* 成本估算用 */
const ITEMS_COST = [
  { description: 'Material & Components', qty: 500, unit: 'set', unitPrice: 8.2, remark: 'ABS, stainless steel, silicone' },
  { description: 'Production & Labour', qty: 500, unit: 'set', unitPrice: 3.5, remark: 'Assembly, QC' },
  { description: 'Packaging', qty: 500, unit: 'set', unitPrice: 0.8, remark: 'Export carton + inner box' },
  { description: 'Certification & Testing', qty: 500, unit: 'set', unitPrice: 0.45, remark: 'CE / RoHS test report' },
  { description: 'Inland Freight & Port Charges', qty: 500, unit: 'set', unitPrice: 0.6, remark: 'Shenzhen → Yantian' },
  { description: 'Bank Charges & Misc.', qty: 500, unit: 'set', unitPrice: 0.25, remark: 'T/T fees' },
];

const D = today();

/* 每种单据：buyer=买方/收货方，items=明细，fields=各种字段，bank/bankSlip=银行块 */
const SAMPLE_DOCS = {
  /* ---------------- 报价单 ---------------- */
  quotation: {
    buyer: BUYER_US,
    bank: BANK,
    items: ITEMS_SALE,
    fields: {
      incoterms: 'FOB', priceTerms: 'FOB SHENZHEN', tradeTermsPlace: 'SHENZHEN, CHINA',
      destination: 'LOS ANGELES, USA', loadingPort: 'SHENZHEN, CHINA',
      validUntil: daysLater(30),
      leadTime: '25-30 days after receipt of deposit',
      paymentTerms: 'T/T 30% deposit, 70% balance before shipment',
      minOrderQty: '500 sets',
      deliveryTerms: 'Delivery within 25-30 days after receipt of the deposit; FOB Shenzhen.',
      productionTime: '25-30 days',
      warranty: '12 months against manufacturing defects',
      sampleNote: 'Sample fee USD 30/pc, refundable against the first bulk order; samples ready in 5-7 days.',
      invoiceType: 'Commercial Invoice',
      countryOfOrigin: 'China',
      marks: 'SUNVL\nLOS ANGELES\nCTN NO. 1-120',
      signatureName: 'Chen Wei', signatureTitle: 'Sales Manager', signatureDate: D,
      payingBank: 'Bank of America, Los Angeles Branch (the buyer bank)',
      deliveryPlace: 'Los Angeles, USA',
      preparedBy: 'Chen Wei',
      remarks: 'Prices are valid for 30 days. Packing: standard export carton.',
      otherFee: 0, shippingFee: 0, insuranceFee: 0,
      terms: [
        '1. This Proforma Invoice is not a tax invoice.',
        '2. 30% T/T deposit, 70% balance against copy of B/L.',
        '3. Shipment within 30 days after receipt of deposit.',
        '4. Partial shipment and transhipment are allowed.',
        '5. Packing: standard export carton, suitable for long sea transportation.',
      ].join('\n'),
    },
  },

  /* ---------------- 形式发票 PI ---------------- */
  pi: {
    buyer: BUYER_TH,
    bank: BANK,
    items: ITEMS_SALE,
    fields: {
      ...SHIP,
      ...REFS,
      poNo: 'PO-SIAM-2026-0107',
      piNo: 'PI-2026-001',
      lcNo: 'LC-2026-0107-BKK',
      awbNo: '999-12345678',
      sampleNote: 'One free sample per SKU for the first order; courier charge to be collected.',
      destination: 'BANGKOK, THAILAND', tradeTermsPlace: 'BANGKOK, THAILAND',
      priceTerms: 'CIF BANGKOK',
      validUntil: daysLater(30),
      countryOfExport: 'China', reasonForExport: 'Commercial sale',
      marks: 'SUNVL\nBANGKOK\nCTN NO. 1-120',
      remarks: 'Goods are packed in export cartons. All prices are in USD.',
      terms: [
        '1. This Proforma Invoice is not a tax invoice.',
        '2. 30% T/T deposit, 70% balance against copy of B/L.',
        '3. Shipment within 30 days after receipt of deposit.',
        '4. Partial shipment and transhipment are allowed.',
        '5. Insurance covered by the Seller for 110% of the invoice value.',
      ].join('\n'),
    },
  },

  /* ---------------- 销售合同 ---------------- */
  contract: {
    buyer: BUYER_AE,
    bank: BANK,
    items: ITEMS_SALE,
    fields: {
      ...SHIP,
      ...REFS,
      contractNo: 'SC-2026-001',
      destination: 'JEBEL ALI, DUBAI, UAE', tradeTermsPlace: 'JEBEL ALI, DUBAI, UAE',
      priceTerms: 'CIF JEBEL ALI',
      placeOfSigning: 'Shenzhen, China',
      shipmentDate: daysLater(30),
      deliveryTerms: 'Shipment within 25-30 days after receipt of the deposit; partial shipment and transhipment allowed.',
      insuranceTerms: 'Insurance to be covered by the Seller for 110% of the invoice value against All Risks and War Risk (ICC(A)).',
      penaltyClause: 'Late delivery penalty: 0.5% of the contract value per week, maximum 5% of the total contract value.',
      sellerSigner: 'Chen Wei', sellerSignerTitle: 'Sales Manager', sellerSignDate: D,
      buyerSigner: 'Ahmed Al Noor', buyerSignerTitle: 'Managing Director', buyerSignDate: D,
      marks: 'SUNVL\nDUBAI\nCTN NO. 1-120',
      sampleNote: 'Pre-shipment sample to be approved by the buyer before mass production.',
      remarks: 'Both parties confirm the terms of this contract by signature and stamp.',
    },
  },

  /* ---------------- 商业发票 CI ---------------- */
  ci: {
    buyer: BUYER_AU,
    consignee: BUYER_AU,
    bank: BANK,
    items: ITEMS_SALE,
    fields: {
      ...SHIP,
      ...REFS,
      poNo: 'PO-SMITH-2026-0231',
      invoiceNo: 'INV-2026-001',
      invoiceDate: D,
      destination: 'SYDNEY, AUSTRALIA', tradeTermsPlace: 'SYDNEY, AUSTRALIA',
      priceTerms: 'CIF SYDNEY',
      countryOfExport: 'China', reasonForExport: 'Commercial sale',
      lcNo: 'LC-2026-0231-SYD',
      awbNo: '999-87654321',
      sampleNote: '',
      marks: 'SUNVL\nSYDNEY\nCTN NO. 1-120',
      remarks: 'We hereby certify that the information on this invoice is true and correct.',
      terms: [
        '1. Payment: 30% T/T deposit, 70% balance against copy of B/L.',
        '2. Country of origin: China.',
        '3. Packing: standard export carton, 100 cartons on 1 pallet.',
      ].join('\n'),
    },
  },

  /* ---------------- 装箱单 ---------------- */
  pl: {
    buyer: BUYER_AU,
    consignee: BUYER_AU,
    bank: BANK,
    items: ITEMS_SHIP,
    fields: {
      ...SHIP,
      ...REFS,
      invoiceNo: 'INV-2026-001', invoiceDate: D,
      poNo: 'PO-SMITH-2026-0231',
      destination: 'SYDNEY, AUSTRALIA', tradeTermsPlace: 'SYDNEY, AUSTRALIA',
      priceTerms: 'CIF SYDNEY',
      totalPackedText: 'SAY ONE HUNDRED CARTONS ONLY',
      lcNo: 'LC-2026-0231-SYD',
      remarks: 'Total 100 cartons on 1 pallet. Packing list for customs clearance only.',
      terms: [
        'Shipping marks: SUNVL / SYDNEY / CTN NO. 1-100',
        'Each carton is labelled with item code, quantity and gross weight.',
      ].join('\n'),
    },
  },

  /* ---------------- 水单（银行收付款凭证） ---------------- */
  bank: {
    buyer: BUYER_US,
    items: [],
    fields: { remarks: 'T/T remittance for proforma invoice PI-2026-001 (30% deposit).' },
    bankSlip: {
      bankName: 'BANK OF CHINA, SHENZHEN BRANCH',
      beneficiaryName: 'SUNVL TECH CO., LTD.',
      beneficiaryAccount: '7654 3210 9876 5432 100',
      beneficiaryBank: 'BANK OF CHINA, SHENZHEN BRANCH',
      beneficiaryBankCountry: 'China',
      beneficiarySwift: 'BKCHCNBJ45A',
      beneficiaryBankCode: '104',
      beneficiaryBranchCode: '045',
      originatorName: 'ACME IMPORT CO., LTD.',
      originatorAccount: '9876543210',
      originatorBank: 'BANK OF AMERICA, LOS ANGELES',
      originatorSwift: 'BOFAUS3N',
      amountCurrency: 'USD', amount: 2775, fee: 25, debitAmount: 2800,
      rate: 1, instructedAmount: 'USD 2,775.00',
      status: 'COMPLETE', settlement: 'T/T · 电汇', feeBearer: 'SHA',
      reference: 'PI-2026-001 / 30% DEPOSIT',
      date: D, paymentTime: '10:38 AM PT', valueDate: D,
      remarks: '30% deposit against Proforma Invoice PI-2026-001. Goods: pet feeders & bowls, 100 cartons, Shenzhen → Hamburg.',
    },
  },

  /* ---------------- 海运提单 ---------------- */
  bill_of_lading: {
    buyer: BUYER_DE,
    consignee: BUYER_DE,
    notify: BUYER_DE,
    items: ITEMS_SHIP,
    fields: {
      ...SHIP,
      shipperRef: 'SUNVL-2026-001', bookingNo: 'SO-20261015-001', drNo: 'DR-20261015-001',
      containerOwner: 'COSCO', blType: 'ORIGINAL',
      preCarriageBy: 'FEEDER VESSEL / HONGDA V.026',
      placeOfReceipt: 'SHENZHEN, CHINA',
      vessel: 'COSCO SHANGHAI', voyageNo: 'V.0123E',
      portOfLoading: 'SHENZHEN, CHINA', portOfDischarge: 'HAMBURG, GERMANY',
      placeOfDelivery: 'HAMBURG, GERMANY', finalDestination: 'HAMBURG, GERMANY',
      totalInWords: 'SAY ONE HUNDRED CARTONS ONLY',
      freightTerms: 'PREPAID', revenueTons: '2.30', rate: 'USD 85.00', per: 'CBM',
      prepayAmount: 'USD 195.50', collectAmount: '', prepaidAt: 'SHENZHEN, CHINA', payableAt: '',
      placeOfIssue: 'SHENZHEN, CHINA', dateOfIssue: D, totalPrepaid: 'USD 195.50',
      numberOfOriginal: '3', dateOfShipment: D, loadingOnBoardBy: 'COSCO SHANGHAI',
      containerInfo: 'CY-CY 45G1*1: CONTAINER', shippingClause: 'SHIPPER LOAD, COUNT & SEAL.',
      carrierName: 'COSCO SHIPPING LINES CO., LTD.',
      carrierSignatureDate: D, signingAgent: 'AS AGENT FOR THE CARRIER',
      declaration: 'SHIPPED ON BOARD IN APPARENT GOOD ORDER AND CONDITION UNLESS OTHERWISE STATED.',
      remarks: 'Freight PREPAID. Container: MSKU 123456 7 / 40HQ. 100 cartons on 1 pallet.',
      totalPkgs: '100 CTNS', totalGrossWeight: '192', totalMeasurement: '2.30',
      marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
    },
  },



  /* ---------------- 申报要素表（报关资料） ---------------- */
  declaration_elements: {
    buyer: BUYER_DE,
    items: [
      { description: '风冷弧形台式蛋糕柜', hsCode: '8418500000', brandType: '无品牌', preferential: '不确定',
        usagePurpose: '用于酒店或超市陈列展示', material: '不锈钢', model: 'ACD-CB09', specText: '1200*700*800', ext: { de1: '20' } },
      { description: '风冷弧形立式蛋糕柜', hsCode: '8418500000', brandType: '无品牌', preferential: '不确定',
        usagePurpose: '用于酒店或超市陈列展示', material: '不锈钢', model: 'ACD-CL09', specText: '1500*800*800', ext: { de1: '42' } },
      { description: '12盘风冷速冻柜', hsCode: '8418401000', brandType: '无品牌', preferential: '无出口享惠',
        usagePurpose: '用于酒店或超市快速冷冻', material: '不锈钢', model: 'PLF-P12', specText: '1800*800*800',
        remark: '结构：立式', ext: { de1: '610' } },
    ],
    extraCols: [{ id: 'de1', label: '容积L' }],
    fields: { ...SHIP },
  },

  /* ---------------- 装船指示 SI（提单补料） ---------------- */
  shipping_instruction: {
    buyer: BUYER_DE,
    consignee: BUYER_DE,
    notify: BUYER_DE,
    items: ITEMS_SHIP,
    fields: {
      ...SHIP,
      siNo: 'SI-2026-001',
      siCutoff: '2026-10-18 17:00',
      bookingNo: 'SO-20261015-001',
      forwarder: 'COSCO SHIPPING LINES CO., LTD.',
      forwarderContact: 'Ms. Li Na / +86 755 6688 5566 / booking@cosco-demo.com',
      vessel: 'COSCO SHANGHAI', voyageNo: 'V.0123E',
      portOfLoading: 'SHENZHEN, CHINA', portOfDischarge: 'HAMBURG, GERMANY',
      placeOfDelivery: 'HAMBURG, GERMANY',
      dateOfShipment: D,
      containerNo: 'MSKU 123456 7', sealNo: 'SL-88990011',
      packageType: 'CTNS', totalPkgs: '100 CTNS',
      totalGrossWeight: '192 KG', totalMeasurement: '2.30 CBM',
      marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
      goodsDescription: 'Automatic Pet Feeder / Silicone Food Bowl / Pet Water Fountain',
      hsCode: '8436800000 / 3924100000 / 8421210000',
      releaseType: 'TELEX RELEASE',
      freightTerms: 'PREPAID',
      specialInstructions: '提单收货人与通知人按本指示填写；品名按实际申报，不要只写 spare parts。',
      remarks: '请于截补料时间前回传 B/L 草稿给我司确认。',
    },
  },

  /* ---------------- 装船通知 SA ---------------- */
  shipping_advice: {
    buyer: BUYER_DE,
    consignee: BUYER_DE,
    notify: BUYER_DE,
    items: ITEMS_SHIP,
    fields: {
      ...SHIP,
      bookingNo: 'SO-20261015-001',
      vessel: 'COSCO SHANGHAI', voyageNo: 'V.0123E',
      portOfLoading: 'SHENZHEN, CHINA', portOfDischarge: 'HAMBURG, GERMANY',
      placeOfDelivery: 'HAMBURG, GERMANY',
      etd: '2026-10-18', eta: '2026-11-12',
      dateOfShipment: D,
      modeOfTransport: 'SEA',
      blNo: 'COSU6288888888',
      containerNo: 'MSKU 123456 7',
      totalPkgs: '100 CTNS', totalGrossWeight: '192 KG',
      contractNo: 'SC-2026-001', invoiceNo: 'INV-2026-001',
      insuranceNote: 'CFR 条款：请买方自行投保；如我司代办，请于装船前 48 小时告知。',
      marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
      specialInstructions: '货物已按发票号 INV-2026-001 装船出运，请安排清关与提货；提单副本已随附。',
      remarks: '',
    },
  },

  /* ---------------- 原产地证明 ---------------- */
  certificate_of_origin: {
    buyer: BUYER_DE,
    items: ITEMS_SHIP,
    fields: {
      ...SHIP,
      issuingAuthority: 'China Council for the Promotion of International Trade (CCPIT), Shenzhen Sub-Council',
      originCountry: 'China', goodsReferenceNo: 'CO-2026-001',
      transportRoute: 'From Shenzhen, China to Hamburg, Germany by sea, on board COSCO SHANGHAI V.0123E',
      marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
      declaration: 'WE HEREBY CERTIFY THAT THE GOODS DESCRIBED IN THIS CERTIFICATE ORIGINATE FROM THE PEOPLE\'S REPUBLIC OF CHINA.',
      payingBank: 'Bank of China, Shenzhen Branch',
      sampleNote: '',
      preparedBy: 'Chen Wei',
      terms: [
        'This document is issued for customs clearance only.',
        'All information herein is true and correct to the best of our knowledge.',
      ].join('\n'),

      remarks: 'Issued at Shenzhen on ' + D + '.',
    },
  },

  /* ---------------- 报关单 ---------------- */
  customs_declaration: {
    buyer: BUYER_DE,
    items: ITEMS_SALE,
    fields: {
      ...SHIP,
      ...REFS,
      declarationType: 'Export Declaration', tradeMode: 'General Trade',
      consignmentNo: 'CD-2026-001', declarationDate: D,
      preEntryNo: '20261015000012345678', customsNo: '530120260000123456',
      declarantName: 'Customs Broker Zhang', declarantCode: '91440300MA5ZZZZZZ2P',
      declarantPhone: '+86 755 8888 1234',
      shipperCreditCode: '91440300MA5XXXXXX0K',
      producerName: 'SUNVL TECH CO., LTD.', producerCode: '91440300MA5XXXXXX0K',
      declareUnit: 'SUNVL TECH CO., LTD. / Shenzhen Express Customs Brokerage Co., Ltd.',
      declareUnitCode: '91440300MA5XXXXXX0K',
      supervisionMode: '一般贸易', dutyNature: '一般征税',
      tradeCountry: '德国', destinationCountry: '德国',
      exitCustoms: '深圳海关', exitPort: '蛇口港', destPort: 'HAMBURG',
      shippingMethod: '水路运输', vesselVoyage: 'COSCO SHANGHAI / V.0123E',
      blNo: 'COSU6288888888', packageType: '纸箱', exportDate: D,
      attachedDocs: '合同 / 发票 / 装箱单 / 提单',
      recordNo: 'H2026-000123', licenseNo: '',
      declarantSignature: 'Customs Broker Zhang', signatureDate: D,
      relatedPartyConfirm: '否', priceImpactConfirm: '否', royaltyConfirm: '否', selfDeclaration: '是',
      declaration: '兹申明对以上内容承担如实申报、依法纳税之法律责任。',
      customsRemark: '',    // 海关批注由海关填写，示例里留空
      remarks: '随附单证齐全，货物无木质包装（免熏蒸）。',
      marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
    },
  },

  /* ---------------- 检验证书 ---------------- */
  inspection_certificate: {
    buyer: BUYER_DE,
    items: ITEMS_SALE,
    fields: {
      ...SHIP,
      inspectionOrg: 'SGS-CSTC Standards Technical Services Co., Ltd. (Shenzhen)',
      inspectionDate: D, inspectionStandard: 'ISO 9001:2015 / Customer specification / AQL 2.5',
      inspectionResult: 'CONFORMING. Quality, quantity, packing and marking were checked and found to be in accordance with the contract and the approved samples.',
      payingBank: 'Bank of China, Shenzhen Branch',
      sampleNote: '',
      preparedBy: 'Chen Wei',
      terms: [
        'This document is issued for customs clearance only.',
        'All information herein is true and correct to the best of our knowledge.',
      ].join('\n'),

      marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
      remarks: 'Certificate No. SGS-SZ-2026-10231. Inspection carried out at the seller\'s warehouse.',
    },
  },

  /* ---------------- 熏蒸证书 ---------------- */
  fumigation_certificate: {
    buyer: BUYER_DE,
    items: ITEMS_SHIP,
    fields: {
      ...SHIP,
      treatmentType: 'Fumigation (Methyl Bromide)', fumigationDate: D,
      fumigationMethod: 'Methyl Bromide fumigation under gas-proof sheet, 48 g/m³ at 21°C or above',
      chemicalUsed: 'Methyl Bromide 98% (CAS 74-83-9)', duration: '24 hours',
      payingBank: 'Bank of China, Shenzhen Branch',
      sampleNote: '',
      preparedBy: 'Chen Wei',
      terms: [
        'This document is issued for customs clearance only.',
        'All information herein is true and correct to the best of our knowledge.',
      ].join('\n'),

      marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
      remarks: 'Treated at the seller\'s warehouse, Shenzhen. Container No. MSKU 123456 7 / 40HQ.',
    },
  },

  /* ---------------- 受益人证明 ---------------- */
  beneficiary_certificate: {
    buyer: BANK_DE,
    items: ITEMS_SALE,     // 这张版式会印产品明细表，给一份完整明细
    fields: {
      certificateType: 'Beneficiary Certificate (under L/C)',
      certificateDate: D,
      beneficiaryName: 'SUNVL TECH CO., LTD.',
      marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
      declaration: 'WE HEREBY CERTIFY THAT ONE SET OF ORIGINAL SHIPPING DOCUMENTS (B/L, INVOICE, PACKING LIST, CERTIFICATE OF ORIGIN) HAVE BEEN SENT TO THE APPLICANT BY COURIER WITHIN 3 WORKING DAYS AFTER SHIPMENT, AND THAT THE SHIPMENT HAS BEEN EFFECTED WITHIN THE SHIPMENT PERIOD STIPULATED IN THE CREDIT.',
      remarks: 'L/C No. LC-2026-0088 issued by First National Bank AG, Hamburg.',
      deliveryPlace: 'Hamburg, Germany',
      warranty: '12 months against manufacturing defects',
      productionTime: '25-30 days',
      invoiceType: 'Commercial Invoice',
      payingBank: 'Bank of China, Shenzhen Branch',
      sampleNote: '',
      preparedBy: 'Chen Wei',
      terms: [
        'This document is issued for customs clearance only.',
        'All information herein is true and correct to the best of our knowledge.',
      ].join('\n'),

    },
  },

  /* ---------------- 发货人委托书（订舱委托） ---------------- */
  shipper_letter_instruction: {
    buyer: FORWARDER,
    items: ITEMS_SHIP,
    fields: {
      ...SHIP,
      bookingNo: 'BK-20261015-01', vessel: 'COSCO SHANGHAI', voyageNo: 'V.0123E',
      portOfLoading: 'SHENZHEN, CHINA', portOfDischarge: 'HAMBURG, GERMANY',
      cargoReadyDate: D, containerNo: 'MSKU 123456 7 / 40HQ',
      cargoDescription: 'Automatic Pet Feeder & Silicone Food Bowl & Pet Water Fountain (3 SKUs, 100 cartons, 192 kg gross, 2.3 CBM). Freight PREPAID. Marks: SUNVL / HAMBURG / CTN NO. 1-100.',
      payingBank: 'Bank of China, Shenzhen Branch',
      sampleNote: '',
      preparedBy: 'Chen Wei',
      terms: [
        'This document is issued for customs clearance only.',
        'All information herein is true and correct to the best of our knowledge.',
      ].join('\n'),

      marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
      remarks: 'Please book the above shipment and confirm the SO number by return.',
    },
  },

  /* ---------------- 保险单 ---------------- */
  insurance_policy: {
    buyer: BUYER_DE,
    items: ITEMS_SALE,     // 保险单要列明承保货物
    fields: {
      ...SHIP,
      policyNo: 'IP-2026-001',
      insurer: 'PICC Property and Casualty Company Limited, Shenzhen Branch',
      coverage: 'All Risks & War Risk (ICC(A)) — Institute Cargo Clauses (A)',
      insuredAmount: 11550, premium: 85, totalInsuredValue: 11550,
      claimPayableAt: 'Hamburg, Germany', issuedDate: D,
      payingBank: 'Bank of China, Shenzhen Branch',
      sampleNote: '',
      preparedBy: 'Chen Wei',
      terms: [
        'This document is issued for customs clearance only.',
        'All information herein is true and correct to the best of our knowledge.',
      ].join('\n'),

      marks: 'SUNVL\nHAMBURG\nCTN NO. 1-100',
      remarks: 'Insured value USD 11,550.00 = 110% of the invoice value. Vessel: COSCO SHANGHAI V.0123E.',
    },
  },

  /* ---------------- 成本估算单 ---------------- */
  cost_estimation: {
    buyer: BUYER_US,
    items: ITEMS_COST,
    fields: {
      incoterms: 'EXW', priceTerms: 'EXW SHENZHEN', currency: 'USD',
      shippingFee: 0, insuranceFee: 0, otherFee: 0,
      marks: 'SUNVL\nN/A (cost estimation)',
      deliveryPlace: 'Shenzhen, China',
      warranty: '12 months against manufacturing defects',
      productionTime: '25-30 days',
      invoiceType: 'Cost Estimation',
      remarks: 'Unit cost estimation for 500 sets of pet feeders. Exchange rate: 1 USD ≈ 7.10 CNY.',
      payingBank: 'Bank of China, Shenzhen Branch',
      sampleNote: '',
      preparedBy: 'Chen Wei',
      terms: [
        'This document is issued for customs clearance only.',
        'All information herein is true and correct to the best of our knowledge.',
      ].join('\n'),

    },
  },
};

/**
 * 给单据预填示例案例。
 *
 * @param {object} doc       目标单据
 * @param {object} [opts]
 * @param {boolean} [opts.overwrite=true]
 *        true  —— 示例值直接覆盖（「载入示例数据」用：整套案例是设计好的，数据互相自洽）
 *        false —— 只填空着的字段（「新建单据」用：不覆盖用户自己的默认币种 / 条款 / 交货条件等）
 */
export function fillSample(doc, opts = {}) {
  if (!doc || !doc.type) return;
  const overwrite = opts.overwrite !== false;
  const s = SAMPLE_DOCS[doc.type];
  if (!s) return;
  // 基本信息（仅当为空时填，避免覆盖）
  const base = {
    incoterms: 'FOB', currency: 'USD',
    destination: 'HAMBURG, GERMANY', loadingPort: 'SHENZHEN, CHINA',
    leadTime: '25-30 days after receipt of deposit',
    paymentTerms: 'T/T 30% deposit, 70% before shipment',
  };
  for (const k in base) if (!doc[k]) doc[k] = base[k];
  // 卖方 / 买方 / 收货人 / 通知人
  doc.seller = { ...doc.seller, ...SELLER };
  if (s.buyer) doc.buyer = { ...doc.buyer, ...s.buyer };
  if (s.consignee) doc.consignee = { ...doc.consignee, ...s.consignee };
  if (s.notify) doc.notify = { ...doc.notify, ...s.notify };
  // 收款银行 / 水单字段
  if (s.bank) doc.bank = { ...doc.bank, ...s.bank };
  if (s.bankSlip) doc.bankSlip = { ...(doc.bankSlip || {}), ...s.bankSlip };
  // 明细（带序号，有单价则算出行金额）；示例明确给了空数组就清空（例如水单没有明细）
  if (Array.isArray(s.items)) {
    doc.items = s.items.map((it, i) => {
      const row = { ...(doc.items[i] || {}), no: i + 1, ...it };
      if (typeof row.unitPrice === 'number' && typeof row.qty === 'number') row.amount = row.unitPrice * row.qty;
      return row;
    });
  }
  // 各种字段（特有字段 / 基础信息 / 条款 / 备注…）
  if (s.fields) {
    for (const k in s.fields) {
      const v = s.fields[k];
      const cur = doc[k];
      const empty = cur === '' || cur === null || cur === undefined;
      if (overwrite || empty) doc[k] = v;
    }
  }
  // 自定义列（申报要素表用）：示例里给了就补上，用户已有列则不动
  if (Array.isArray(s.extraCols) && !(Array.isArray(doc.extraCols) && doc.extraCols.length)) {
    doc.extraCols = JSON.parse(JSON.stringify(s.extraCols));
  }
}
