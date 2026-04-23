import type { Lang } from './i18n';

interface GlossaryEntry {
  es: string;
  en: string;
}

const GLOSSARY: Record<string, GlossaryEntry> = {
  tdu: {
    es: 'TDU (Transmission & Distribution Utility): empresa que opera las líneas eléctricas y entrega la electricidad al cliente en Texas. Es distinta al proveedor de energía (REP). Elige la TDU de la zona del cliente.',
    en: 'TDU (Transmission & Distribution Utility): the company that operates electrical lines and delivers electricity to the customer in Texas. Separate from the energy provider (REP). Pick the TDU for the customer\'s area.',
  },
  campaignType: {
    es: 'Tipo de campaña: D2D = trabajo puerta a puerta (residencial). Retail = tienda o centro comercial. Solo se puede registrar un tipo por día.',
    en: 'Campaign type: D2D = door-to-door (residential). Retail = store or shopping center. Only one type can be recorded per day.',
  },
  effectiveness: {
    es: 'Efectividad: % de ventas sobre contactos significativos. D2D usa contactos, Retail usa zipcodes. Verde ≥20%, naranja 10–20%, gris <10%.',
    en: 'Effectiveness: % of sales over meaningful contacts. D2D uses contacts, Retail uses zipcodes. Green ≥20%, orange 10–20%, gray <10%.',
  },
  campaignLock: {
    es: 'Lock de campaña: una vez registrada una campaña del día (D2D o Retail), no se puede cambiar al otro tipo hasta el día siguiente.',
    en: 'Campaign lock: once a campaign type is recorded for the day (D2D or Retail), you cannot switch to the other type until the next day.',
  },
  plan: {
    es: 'Plan Watt: define la tarifa de energía por kWh y la duración del contrato. Algunos planes incluyen créditos en factura o energía renovable.',
    en: 'Watt Plan: defines the energy rate per kWh and contract length. Some plans include bill credits or renewable energy.',
  },
};

export function getGlossaryTerm(key: string, lang: Lang): string {
  const entry = GLOSSARY[key];
  if (!entry) return '';
  return entry[lang] ?? entry.es;
}

export default GLOSSARY;
