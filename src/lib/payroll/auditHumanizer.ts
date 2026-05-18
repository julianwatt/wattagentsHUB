/**
 * Block 14 — payroll_audit_log humanizer.
 *
 * Turns the raw audit row (entity_type/action/old_value/new_value/change_notes)
 * into a single Spanish-or-English sentence the Admin/CEO can scan without
 * having to read JSON.
 *
 * The audit log lives forever, but the humanizer is best-effort: when the
 * entry shape doesn't match any known recipe we fall back to a generic
 * "{Actor} {action} {entity_type}" sentence so the row still renders.
 *
 * The API route that lists audit entries hydrates `actor_name` and a
 * minimal entity context (e.g. payfile_owner_name) and passes the merged
 * row here. Anything missing is rendered as "Sistema" / "(sin datos)".
 */

import type { PayrollAuditLog } from '@/types/payroll';

export interface AuditEntryContext {
  /** Pre-resolved actor display name (null = system / unknown). */
  actor_name: string | null;
  actor_role?: string | null;
  /** Optional entity context the API may pre-resolve. */
  payfile_owner_name?: string | null;
  payfile_pay_week?: string | null;
  line_item_owner_name?: string | null;
  line_item_pay_week?: string | null;
  bonus_description?: string | null;
  recipient_names?: string[];
  recipient_amounts?: Array<{ name: string; amount: number }>;
  sale_contract_id?: string | null;
}

export type AuditLang = 'es' | 'en';

interface HumanizableRow extends PayrollAuditLog, AuditEntryContext {}

/** Pretty actor: "Admin Julian", "CEO Carlos", or "Sistema". */
function actorPrefix(row: HumanizableRow, lang: AuditLang): string {
  if (!row.actor_name) return lang === 'es' ? 'Sistema' : 'System';
  const role = row.actor_role?.toLowerCase();
  if (role === 'admin') return `Admin ${row.actor_name}`;
  if (role === 'ceo') return `CEO ${row.actor_name}`;
  if (role === 'sr_manager') return `Sr Manager ${row.actor_name}`;
  if (role === 'jr_manager') return `Jr Manager ${row.actor_name}`;
  return row.actor_name;
}

function money(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$?';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Main entry point. Always returns a non-empty string. */
export function formatAuditEntry(row: HumanizableRow, lang: AuditLang = 'es'): string {
  const actor = actorPrefix(row, lang);
  const oldV = row.old_value ?? {};
  const newV = row.new_value ?? {};
  const notes = row.change_notes?.trim();

  // ── payfile state transitions ─────────────────────────────────────────────
  if (row.entity_type === 'payfile' && row.action === 'STATE_CHANGE') {
    const from = String(oldV.state ?? '?');
    const to = String(newV.state ?? '?');
    const ownerBit = row.payfile_owner_name
      ? (lang === 'es' ? ` de ${row.payfile_owner_name}` : ` of ${row.payfile_owner_name}`)
      : '';
    const weekBit = row.payfile_pay_week
      ? (lang === 'es' ? ` (semana ${row.payfile_pay_week})` : ` (week ${row.payfile_pay_week})`)
      : '';
    const verb = humanizeStateTransition(from, to, lang);
    return `${actor} ${verb} ${lang === 'es' ? 'el payfile' : 'the payfile'}${ownerBit}${weekBit}${notes ? `. ${lang === 'es' ? 'Nota' : 'Note'}: "${notes}"` : '.'}`;
  }

  // ── payfile_version (publish / regenerate PDF) ────────────────────────────
  if (row.entity_type === 'payfile_version' && row.action === 'CREATE') {
    const week = String(newV.pay_week ?? row.payfile_pay_week ?? '?');
    const versionNum = newV.version_number ?? '?';
    return `${actor} ${lang === 'es' ? `publicó versión #${versionNum} del payfile (semana ${week})` : `published version #${versionNum} of the payfile (week ${week})`}.`;
  }
  if (row.entity_type === 'payfile_version' && row.action === 'UPDATE' && notes) {
    return `${actor} · ${notes}.`;
  }

  // ── line items ────────────────────────────────────────────────────────────
  if (row.entity_type === 'payfile_line_item' && row.action === 'EDIT_AMOUNT') {
    const before = money(oldV.amount);
    const after = money(newV.amount);
    const editNote = typeof newV.edit_note === 'string' ? ` ${lang === 'es' ? 'Nota' : 'Note'}: "${newV.edit_note}"` : '';
    const owner = row.line_item_owner_name ? (lang === 'es' ? `de ${row.line_item_owner_name} ` : `of ${row.line_item_owner_name} `) : '';
    const week = row.line_item_pay_week ? (lang === 'es' ? `(semana ${row.line_item_pay_week})` : `(week ${row.line_item_pay_week})`) : '';
    return `${actor} ${lang === 'es' ? 'editó el monto del line item' : 'edited the line item amount'} ${owner}${before} → ${after} ${week}.${editNote}`;
  }
  if (row.entity_type === 'payfile_line_item' && row.action === 'CREATE') {
    return `${actor} ${lang === 'es' ? 'agregó manualmente un line item' : 'manually added a line item'}${notes ? ` — ${notes}` : ''}.`;
  }
  if (row.entity_type === 'payfile_line_item' && row.action === 'DELETE') {
    return `${actor} ${lang === 'es' ? 'eliminó manualmente un line item' : 'manually deleted a line item'}${notes ? ` — ${notes}` : ''}.`;
  }
  if (row.entity_type === 'payfile_line_item' && row.action === 'STATE_CHANGE' && notes) {
    return `${actor} · ${notes}.`;
  }

  // ── overrides ─────────────────────────────────────────────────────────────
  if (row.entity_type === 'payfile_override') {
    const verb = row.action === 'DELETE'
      ? (lang === 'es' ? 'eliminó un override' : 'deleted an override')
      : row.action === 'UPDATE'
        ? (lang === 'es' ? 'editó un override' : 'edited an override')
        : (lang === 'es' ? 'agregó un override' : 'added an override');
    return `${actor} ${verb}${notes ? ` — ${notes}` : ''}.`;
  }

  // ── bonuses ───────────────────────────────────────────────────────────────
  if (row.entity_type === 'company_bonus' && row.action === 'UPDATE') {
    if (Array.isArray(newV.distributions)) {
      const created = Number(newV.distributions_created ?? (newV.distributions as unknown[]).length);
      const desc = row.bonus_description ? ` "${row.bonus_description}"` : '';
      const breakdown = row.recipient_amounts && row.recipient_amounts.length > 0
        ? `: ${row.recipient_amounts.map((r) => `${money(r.amount)} ${lang === 'es' ? 'a' : 'to'} ${r.name}`).join(', ')}`
        : '';
      return `${actor} ${lang === 'es' ? `distribuyó bono${desc} a ${created} receptor(es)` : `distributed bonus${desc} to ${created} recipient(s)`}${breakdown}.`;
    }
    return `${actor} ${lang === 'es' ? 'editó un bono de empresa' : 'edited a company bonus'}${notes ? ` — ${notes}` : ''}.`;
  }
  if (row.entity_type === 'bonus_distribution') {
    const verb = row.action === 'DELETE'
      ? (lang === 'es' ? 'eliminó una distribución de bono' : 'deleted a bonus distribution')
      : (lang === 'es' ? 'editó una distribución de bono' : 'edited a bonus distribution');
    return `${actor} ${verb}${notes ? ` — ${notes}` : ''}.`;
  }

  // ── plan mappings ─────────────────────────────────────────────────────────
  if (row.entity_type === 'plan_mapping') {
    const planName = (newV.plan_name ?? oldV.plan_name ?? '?') as string;
    const verb = row.action === 'CREATE'
      ? (lang === 'es' ? 'creó el plan mapping' : 'created plan mapping')
      : (lang === 'es' ? 'actualizó el plan mapping' : 'updated plan mapping');
    return `${actor} ${verb} "${planName}"${notes ? ` · ${notes}` : ''}.`;
  }

  // ── uploads ───────────────────────────────────────────────────────────────
  if (row.entity_type === 'payroll_upload') {
    const fileName = (newV.file_name ?? oldV.file_name ?? '') as string;
    if (row.action === 'CREATE') {
      return `${actor} ${lang === 'es' ? `subió el archivo "${fileName}"` : `uploaded file "${fileName}"`}.`;
    }
    if (row.action === 'DELETE') {
      return `${actor} ${lang === 'es' ? 'eliminó un archivo' : 'deleted a file'}${notes ? ` (${notes})` : ''}.`;
    }
    if (row.action === 'STATE_CHANGE' && notes) {
      return `${actor} · ${notes}.`;
    }
  }

  // ── roster: badge add/inactivate ──────────────────────────────────────────
  if (row.entity_type === 'roster_entry') {
    if (row.action === 'CREATE') {
      const badge = (newV.je_badge ?? '') as string;
      return `${actor} ${lang === 'es' ? `agregó JE badge ${badge}` : `added JE badge ${badge}`}${notes ? ` (${notes})` : ''}.`;
    }
    if (row.action === 'STATE_CHANGE') {
      return `${actor} · ${notes ?? (lang === 'es' ? 'inactivó un JE badge' : 'inactivated a JE badge')}.`;
    }
    if (row.action === 'UPDATE') {
      return `${actor} ${lang === 'es' ? 'editó un JE badge' : 'edited a JE badge'}.`;
    }
  }

  // ── roster merge ──────────────────────────────────────────────────────────
  if (row.entity_type === 'roster_merge') {
    return `${actor} ${lang === 'es' ? 'fusionó dos usuarios' : 'merged two users'}${notes ? ` — ${notes}` : ''}.`;
  }

  // ── custom rates ──────────────────────────────────────────────────────────
  if (row.entity_type === 'custom_rate') {
    const verb = row.action === 'CREATE'
      ? (lang === 'es' ? 'creó una tarifa custom' : 'created a custom rate')
      : row.action === 'DELETE'
        ? (lang === 'es' ? 'eliminó una tarifa custom' : 'deleted a custom rate')
        : (lang === 'es' ? 'actualizó una tarifa custom' : 'updated a custom rate');
    return `${actor} ${verb}${notes ? ` — ${notes}` : ''}.`;
  }

  // ── users ─────────────────────────────────────────────────────────────────
  if (row.entity_type === 'user') {
    if (row.action === 'CREATE') {
      const name = (newV.name ?? newV.username ?? '') as string;
      return `${actor} ${lang === 'es' ? `creó al usuario ${name}` : `created user ${name}`}${notes ? ` (${notes})` : ''}.`;
    }
    if (row.action === 'DELETE') {
      return `${actor} · ${notes ?? (lang === 'es' ? 'eliminó un usuario' : 'deleted a user')}.`;
    }
    if (row.action === 'UPDATE') {
      const fields = Object.keys(newV);
      if (fields.length === 0) return `${actor} ${lang === 'es' ? 'actualizó un usuario' : 'updated a user'}.`;
      return `${actor} ${lang === 'es' ? `actualizó ${fields.join(', ')} de un usuario` : `updated ${fields.join(', ')} on a user`}${notes ? ` — ${notes}` : ''}.`;
    }
  }

  // ── negative balance ──────────────────────────────────────────────────────
  if (row.entity_type === 'negative_balance') {
    if (row.action === 'CREATE') {
      return `${actor} · ${notes ?? (lang === 'es' ? 'creó un saldo negativo' : 'created a negative balance')}.`;
    }
    if (row.action === 'UPDATE') {
      return `${actor} ${lang === 'es' ? 'aplicó un cobro contra un saldo negativo' : 'applied a charge against a negative balance'}.`;
    }
    if (row.action === 'DELETE') {
      return `${actor} · ${notes ?? (lang === 'es' ? 'borró un saldo negativo' : 'deleted a negative balance')}.`;
    }
  }

  // ── collections ───────────────────────────────────────────────────────────
  if (row.entity_type === 'collection') {
    if (row.action === 'CREATE') {
      return `${actor} ${lang === 'es' ? 'creó un cobro programado' : 'created a scheduled collection'}.`;
    }
    if (row.action === 'STATE_CHANGE') {
      return `${actor} · ${notes ?? (lang === 'es' ? 'cambió el estado del cobro' : 'changed collection state')}.`;
    }
    if (row.action === 'UPDATE') {
      return `${actor} ${lang === 'es' ? 'editó un cobro programado' : 'edited a scheduled collection'}.`;
    }
  }

  // ── sales ─────────────────────────────────────────────────────────────────
  if (row.entity_type === 'payroll_sale') {
    if (row.action === 'STATE_CHANGE' && notes) {
      return `${actor} · ${notes}`;
    }
    if (row.action === 'UPDATE') {
      const fields = Object.keys(newV).filter((k) => k !== 'contract_id');
      const contract = row.sale_contract_id ? ` (contract ${row.sale_contract_id})` : '';
      return `${actor} ${lang === 'es' ? `editó ${fields.join(', ')} de una venta${contract}` : `edited ${fields.join(', ')} on a sale${contract}`}.`;
    }
  }

  // ── residual ──────────────────────────────────────────────────────────────
  if (row.entity_type === 'residual' && row.action === 'UPDATE') {
    return `${actor} ${lang === 'es' ? 'editó las notas de un residual' : 'edited residual notes'}.`;
  }

  // ── payfile_calc ──────────────────────────────────────────────────────────
  if (row.entity_type === 'payfile_calc') {
    return `${actor} · ${notes ?? (lang === 'es' ? 'recalculó un payfile' : 'recalculated a payfile')}.`;
  }

  // ── generic fallback ──────────────────────────────────────────────────────
  return `${actor} · ${row.action} ${row.entity_type}${notes ? ` — ${notes}` : ''}.`;
}

function humanizeStateTransition(from: string, to: string, lang: AuditLang): string {
  if (to === 'PUBLISHED') return lang === 'es' ? 'publicó' : 'published';
  if (to === 'APPROVED') return lang === 'es' ? 'aprobó' : 'approved';
  if (to === 'PENDING_APPROVAL') return lang === 'es' ? 'envió a aprobación' : 'submitted for approval';
  if (to === 'DRAFT' && from === 'PENDING_APPROVAL') return lang === 'es' ? 'rechazó' : 'rejected';
  if (to === 'DRAFT') return lang === 'es' ? 'reabrió' : 'reopened';
  if (to === 'REJECTED') return lang === 'es' ? 'rechazó' : 'rejected';
  return lang === 'es' ? `cambió ${from} → ${to} en` : `changed ${from} → ${to} on`;
}
