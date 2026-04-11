import { Lang } from './i18n';

export interface TDU {
  id: string;
  name: string;
  region: string;
  customerCharge: number;   // Fixed monthly distribution customer charge
  meteringCharge: number;   // Fixed monthly AMS/metering charge
  deliveryRate: number;     // Combined per-kWh: distribution + transmission + other fees
}

export interface Plan {
  id: string;
  name: string;
  rate: number;
  baseCharge: number;
  termMonths: number;
  renewable: boolean;
  billCredit?: { threshold: number; amount: number };
  description: { es: string; en: string };
  featured?: boolean;
  badge?: { es: string; en: string };
}

export interface BillLineItem {
  labelKey: string;           // i18n key in bill.*
  sublabel?: string;          // computed (numbers), language-neutral
  amount: number;
  type: 'charge' | 'credit' | 'tax';
}

export interface BillResult {
  customerName: string;
  kwh: number;
  tdu: TDU;
  plan: Plan;
  lineItems: BillLineItem[];
  subtotal: number;
  taxes: number;
  billCredit: number;
  total: number;
  avgTxBill: number;
  savings: number;
  savingsPercent: number;
  effectiveRate: number;
  avgTxRate: number;
}

// Delivery rates are the sum of all per-kWh TDU charges:
//   distribution charge + transmission cost recovery + nuclear decommissioning + other rider fees
export const TDUs: TDU[] = [
  {
    id: 'oncor',
    name: 'Oncor Electric Delivery',
    region: 'Dallas · Fort Worth · West Texas',
    customerCharge: 3.42,
    meteringCharge: 1.35,
    deliveryRate: 0.074736, // 0.037350 + 0.011840 + 0.025510 + 0.000036
  },
  {
    id: 'centerpoint',
    name: 'CenterPoint Energy',
    region: 'Houston · Greater Houston Area',
    customerCharge: 4.39,
    meteringCharge: 2.48,
    deliveryRate: 0.082796, // 0.041380 + 0.014970 + 0.026410 + 0.000036
  },
  {
    id: 'aep-central',
    name: 'AEP Texas Central',
    region: 'Corpus Christi · Laredo · Victoria · McAllen · Edinburg · Harlingen · Brownsville',
    customerCharge: 3.33,
    meteringCharge: 0.42,
    deliveryRate: 0.084396, // 0.042180 + 0.018820 + 0.023360 + 0.000036
  },
  {
    id: 'aep-north',
    name: 'AEP Texas North',
    region: 'Abilene · Lubbock · Amarillo',
    customerCharge: 7.50,
    meteringCharge: 0.60,
    deliveryRate: 0.079536, // 0.039750 + 0.016890 + 0.022860 + 0.000036
  },
  {
    id: 'tnmp',
    name: 'Texas-New Mexico Power (TNMP)',
    region: 'Lewisville · Midland · Odessa · Galveston',
    customerCharge: 7.85,
    meteringCharge: 0.82,
    deliveryRate: 0.088416, // 0.044190 + 0.019130 + 0.025060 + 0.000036
  },
];

export const PLANS: Plan[] = [
  {
    id: 'je-saver-12',
    name: 'JE Saver 12',
    rate: 0.0890, baseCharge: 4.95, termMonths: 12, renewable: false,
    description: { es: 'Tarifa fija por 12 meses — ideal para nuevos clientes', en: '12-month fixed rate — great for new customers' },
    featured: true,
    badge: { es: 'MÁS POPULAR', en: 'MOST POPULAR' },
  },
  {
    id: 'je-value-24',
    name: 'JE Value 24',
    rate: 0.0820, baseCharge: 4.95, termMonths: 24, renewable: false,
    billCredit: { threshold: 1000, amount: 50 },
    description: { es: 'Menor tarifa — protección de precio por 24 meses', en: 'Lowest rate — 24-month price protection' },
    badge: { es: 'MEJOR PRECIO', en: 'BEST PRICE' },
  },
  {
    id: 'je-green-12',
    name: 'JE Green Energy 12',
    rate: 0.0940, baseCharge: 4.95, termMonths: 12, renewable: true,
    description: { es: '100% energía renovable — 12 meses fijos', en: '100% renewable energy — 12-month fixed' },
    badge: { es: '100% VERDE', en: '100% GREEN' },
  },
  {
    id: 'je-bundle-12',
    name: 'JE Smart Bundle 12',
    rate: 0.0860, baseCharge: 4.95, termMonths: 12, renewable: false,
    billCredit: { threshold: 1000, amount: 50 },
    description: { es: 'Tarifa fija + crédito de $50 cuando usas 1,000+ kWh', en: 'Fixed rate + $50 bill credit when using 1,000+ kWh' },
  },
  {
    id: 'je-secure-36',
    name: 'JE Secure 36',
    rate: 0.0950, baseCharge: 4.95, termMonths: 36, renewable: false,
    description: { es: 'Precio fijo garantizado 3 años — máxima tranquilidad', en: 'Guaranteed fixed price for 3 years — maximum peace of mind' },
    badge: { es: '3 AÑOS', en: '3 YEARS' },
  },
  {
    id: 'je-ultimate-60',
    name: 'JE Ultimate 60',
    rate: 0.0999, baseCharge: 4.95, termMonths: 60, renewable: false,
    description: { es: 'Protección total 5 años — nunca más preocupaciones por precios', en: '5-year total protection — no more price worries' },
    badge: { es: '5 AÑOS', en: '5 YEARS' },
  },
];

export const AVG_TX_RATE = 0.1289;

export const TAXES = {
  stateSales: 0.0625,
  grossReceipts: 0.018,
  cityFranchise: 0.02,
};

export function calculateBill(
  customerName: string,
  kwh: number,
  tdu: TDU,
  plan: Plan,
  includeCity: boolean,
  _lang: Lang = 'es'
): BillResult {
  const items: BillLineItem[] = [];

  // Just Energy charges
  items.push({
    labelKey: 'bill.energyCharge',
    sublabel: `${(plan.rate * 100).toFixed(3)}¢/kWh × ${kwh.toLocaleString()} kWh`,
    amount: plan.rate * kwh,
    type: 'charge',
  });
  items.push({
    labelKey: 'bill.baseChargeJE',
    sublabel: 'Cargo fijo mensual REP',
    amount: plan.baseCharge,
    type: 'charge',
  });

  // TDU fixed charges
  items.push({
    labelKey: 'bill.tduCustomerCharge',
    sublabel: tdu.name,
    amount: tdu.customerCharge,
    type: 'charge',
  });
  items.push({
    labelKey: 'bill.meteringCharge',
    sublabel: 'AMS / Medidor inteligente',
    amount: tdu.meteringCharge,
    type: 'charge',
  });

  // TDU delivery (single combined per-kWh line item)
  items.push({
    labelKey: 'bill.deliveryCharge',
    sublabel: `${(tdu.deliveryRate * 100).toFixed(4)}¢/kWh × ${kwh.toLocaleString()} kWh`,
    amount: tdu.deliveryRate * kwh,
    type: 'charge',
  });

  const subtotal = items.reduce((s, i) => s + i.amount, 0);

  items.push({
    labelKey: 'bill.stateSalesTax',
    sublabel: `${(TAXES.stateSales * 100).toFixed(2)}%`,
    amount: subtotal * TAXES.stateSales,
    type: 'tax',
  });
  items.push({
    labelKey: 'bill.grossReceiptsTax',
    sublabel: `${(TAXES.grossReceipts * 100).toFixed(1)}%`,
    amount: subtotal * TAXES.grossReceipts,
    type: 'tax',
  });

  let cityTaxAmt = 0;
  if (includeCity) {
    cityTaxAmt = subtotal * TAXES.cityFranchise;
    items.push({
      labelKey: 'bill.cityFranchiseTax',
      sublabel: `${(TAXES.cityFranchise * 100).toFixed(2)}%`,
      amount: cityTaxAmt,
      type: 'tax',
    });
  }

  const taxes = subtotal * TAXES.stateSales + subtotal * TAXES.grossReceipts + cityTaxAmt;

  let billCredit = 0;
  if (plan.billCredit && kwh >= plan.billCredit.threshold) {
    billCredit = plan.billCredit.amount;
    items.push({
      labelKey: 'bill.billCreditItem',
      sublabel: `≥ ${plan.billCredit.threshold.toLocaleString()} kWh`,
      amount: -billCredit,
      type: 'credit',
    });
  }

  const total = subtotal + taxes - billCredit;

  const taxFactor = 1 + TAXES.stateSales + TAXES.grossReceipts + (includeCity ? TAXES.cityFranchise : 0);
  const avgBase = tdu.customerCharge + tdu.meteringCharge + tdu.deliveryRate * kwh;
  const avgTxBill = (AVG_TX_RATE * kwh + avgBase) * taxFactor;

  const savings = avgTxBill - total;

  return {
    customerName, kwh, tdu, plan, lineItems: items, subtotal, taxes, billCredit, total,
    avgTxBill, savings, savingsPercent: (savings / avgTxBill) * 100,
    effectiveRate: total / kwh, avgTxRate: avgTxBill / kwh,
  };
}
