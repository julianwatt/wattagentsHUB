'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { saleStatusLabel } from '@/lib/payroll/labels';
import { detectFileType, nextFridayOnOrAfter, ALLOWED_FILE_EXTENSIONS, MAX_UPLOAD_BYTES } from '@/lib/payroll/uploadConfig';
import type {
  PayrollUpload,
  PayrollUploadProcessingStatus,
  PayrollUploadRowError,
} from '@/types/payroll';
import type { SaleStatus } from '@/lib/payroll/constants';

/**
 * Pendientes tab — block 04.
 *
 * Admin/CEO upload weekly JE files. Each upload triggers synchronous
 * parsing in POST /api/payroll/uploads. The table below shows past
 * uploads with their processing status and quick actions (view detail,
 * reprocess, delete).
 *
 * A second file with a different name (e.g. *Bonus*.xlsx) can share the
 * same cutoff_date / pay_week — both contribute rows into the same
 * weekly payfile that block 11 will publish.
 */

interface UploadListRow extends PayrollUpload {
  uploaded_by_name: string | null;
}

interface UploadDetail {
  upload: PayrollUpload;
  counts: Record<SaleStatus, number>;
  winback: number;
  bonusCount: number;
  residualCount: number;
  rowErrors: PayrollUploadRowError[];
}

export default function PendientesTab() {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<UploadListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch('/api/payroll/uploads');
    if (r.ok) setRows(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return <div className="text-center py-20 text-gray-400">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('payroll.pendientes.subtitle')}
        </p>
        <button
          onClick={() => setShowUpload(true)}
          className="px-4 py-2 rounded-xl text-white font-semibold text-sm whitespace-nowrap"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          + {t('payroll.pendientes.uploadBtn')}
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">
            {t('payroll.pendientes.listTitle')}
          </h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">
            {rows.length}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">
            {t('payroll.pendientes.empty')}
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {rows.map((row) => (
              <button
                key={row.id}
                onClick={() => setDetailId(row.id)}
                className="w-full text-left grid grid-cols-12 gap-2 items-center px-3 sm:px-5 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
              >
                <div className="col-span-12 sm:col-span-5 min-w-0">
                  <p className="text-xs font-mono font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {row.file_name}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {row.uploaded_by_name ?? '—'} · {formatDateTime(row.uploaded_at, lang)}
                  </p>
                </div>
                <div className="col-span-4 sm:col-span-2 flex items-center gap-1">
                  <FileTypeBadge type={row.file_type} lang={lang} />
                </div>
                <div className="col-span-4 sm:col-span-2 text-[11px] text-gray-600 dark:text-gray-300">
                  <div>{t('payroll.pendientes.cutoffShort')}: {row.cutoff_date}</div>
                  {row.pay_week && (
                    <div className="text-[10px] text-gray-400">PW: {row.pay_week}</div>
                  )}
                </div>
                <div className="col-span-4 sm:col-span-2 text-[11px]">
                  <ProcessingStatusBadge status={row.processing_status} lang={lang} />
                  {row.row_count > 0 && (
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {row.row_count} {t('payroll.pendientes.rowsShort')}
                      {row.error_count > 0 && (
                        <span className="text-rose-500 font-semibold"> · {row.error_count} {t('payroll.pendientes.errorsShort')}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="col-span-12 sm:col-span-1 text-[10px] text-gray-400 sm:text-right">
                  {t('common.viewDetail')} →
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showUpload && (
        <UploadFormModal
          onClose={() => setShowUpload(false)}
          onUploaded={() => {
            setShowUpload(false);
            refresh();
          }}
        />
      )}

      {detailId && (
        <UploadDetailModal
          uploadId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            refresh();
          }}
          onDeleted={() => {
            setDetailId(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTime(iso: string, lang: 'es' | 'en'): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(lang === 'es' ? 'es-MX' : 'en-US', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function FileTypeBadge({ type, lang }: { type: 'PRINCIPAL' | 'BONUS'; lang: 'es' | 'en' }) {
  const label = type === 'PRINCIPAL'
    ? (lang === 'es' ? 'Principal' : 'Main')
    : (lang === 'es' ? 'Bonos' : 'Bonus');
  const color = type === 'PRINCIPAL'
    ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
    : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>
  );
}

function ProcessingStatusBadge({ status, lang }: { status: PayrollUploadProcessingStatus; lang: 'es' | 'en' }) {
  const label =
    status === 'PENDING'   ? (lang === 'es' ? 'Pendiente' : 'Pending') :
    status === 'PROCESSING'? (lang === 'es' ? 'Procesando…' : 'Processing…') :
    status === 'PROCESSED' ? (lang === 'es' ? 'Procesado' : 'Processed') :
    status === 'PARTIAL'   ? (lang === 'es' ? 'Parcial' : 'Partial') :
    /* FAILED */             (lang === 'es' ? 'Falló' : 'Failed');
  const color =
    status === 'PROCESSED' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
    status === 'PARTIAL'   ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
    status === 'FAILED'    ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' :
                             'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>
  );
}

// ── Upload form modal ──────────────────────────────────────────────────────

function UploadFormModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [cutoffDate, setCutoffDate] = useState(today());
  const [payWeek, setPayWeek] = useState(nextFridayOnOrAfter(today()));
  const [fileType, setFileType] = useState<'PRINCIPAL' | 'BONUS'>('PRINCIPAL');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState<{ file_name: string; uploaded_at: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    setDuplicate(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setFile(null);
      return;
    }
    const ext = (f.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
    if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) {
      setError(t('payroll.pendientes.errExtension'));
      setFile(null);
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(t('payroll.pendientes.errSize').replace('{mb}', String(MAX_UPLOAD_BYTES / (1024 * 1024))));
      setFile(null);
      return;
    }
    setFile(f);
    setFileType(detectFileType(f.name));
  }

  function handleCutoffChange(value: string) {
    setCutoffDate(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setPayWeek(nextFridayOnOrAfter(value));
    }
  }

  async function submit(force = false) {
    if (!file || !cutoffDate) {
      setError(t('payroll.pendientes.errMissing'));
      return;
    }
    setError('');
    setSubmitting(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('cutoff_date', cutoffDate);
    fd.append('pay_week', payWeek);
    fd.append('file_type', fileType);
    if (notes) fd.append('notes', notes);
    if (force) fd.append('force', '1');

    const res = await fetch('/api/payroll/uploads', { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (res.status === 409 && j.error === 'duplicate_name') {
      setDuplicate(j.existing);
      return;
    }
    if (!res.ok && res.status !== 207) {
      setError(j.error || t('payroll.pendientes.errGeneric'));
      return;
    }
    if (res.status === 207) {
      // Upload row created but parse failed — still show as success-ish, user
      // can reprocess from the detail view.
      setError(j.error || t('payroll.pendientes.errParse'));
      onUploaded();
      return;
    }
    onUploaded();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h4 className="font-bold text-gray-800 dark:text-gray-100">
            {t('payroll.pendientes.uploadTitle')}
          </h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <Field label={t('payroll.pendientes.fileLabel')}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={handleFileChange}
              className="block w-full text-xs text-gray-700 dark:text-gray-200 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-gray-100 dark:file:bg-gray-800 file:text-gray-700 dark:file:text-gray-200 file:font-semibold cursor-pointer"
            />
            {file && (
              <p className="text-[10px] text-gray-500 mt-1 truncate">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
          </Field>

          <Field label={t('payroll.pendientes.cutoffLabel')}>
            <input
              type="date"
              value={cutoffDate}
              onChange={(e) => handleCutoffChange(e.target.value)}
              className={inputClass}
            />
            <p className="text-[10px] text-gray-400 mt-1">{t('payroll.pendientes.cutoffHint')}</p>
          </Field>

          <Field label={t('payroll.pendientes.payWeekLabel')}>
            <input
              type="date"
              value={payWeek}
              onChange={(e) => setPayWeek(e.target.value)}
              className={inputClass}
            />
            <p className="text-[10px] text-gray-400 mt-1">{t('payroll.pendientes.payWeekHint')}</p>
          </Field>

          <Field label={t('payroll.pendientes.typeLabel')}>
            <select value={fileType} onChange={(e) => setFileType(e.target.value as 'PRINCIPAL' | 'BONUS')} className={inputClass}>
              <option value="PRINCIPAL">{t('payroll.pendientes.typePrincipal')}</option>
              <option value="BONUS">{t('payroll.pendientes.typeBonus')}</option>
            </select>
          </Field>

          <Field label={t('payroll.pendientes.notesLabel')}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
          </Field>

          {duplicate && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                {t('payroll.pendientes.duplicateTitle')}
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                {t('payroll.pendientes.duplicateHint').replace('{name}', duplicate.file_name)}
              </p>
              <p className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">
                {duplicate.uploaded_at}
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setDuplicate(null)}
                  className="flex-1 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-200 font-semibold text-xs"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => submit(true)}
                  disabled={submitting}
                  className="flex-1 py-1.5 rounded-lg bg-amber-600 text-white font-semibold text-xs disabled:opacity-60"
                >
                  {t('payroll.pendientes.duplicateForce')}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm">
              {t('common.cancel')}
            </button>
            <button
              onClick={() => submit(false)}
              disabled={submitting || !file || !cutoffDate}
              className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-60"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {submitting ? t('payroll.pendientes.uploading') : t('payroll.pendientes.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Detail modal ───────────────────────────────────────────────────────────

function UploadDetailModal({
  uploadId,
  onClose,
  onChanged,
  onDeleted,
}: {
  uploadId: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { t, lang } = useLanguage();
  const [detail, setDetail] = useState<UploadDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchDetail = useCallback(async () => {
    const r = await fetch(`/api/payroll/uploads/${uploadId}`);
    if (r.ok) setDetail(await r.json());
  }, [uploadId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  async function handleReprocess() {
    setBusy(true);
    const r = await fetch(`/api/payroll/uploads/${uploadId}/reprocess`, { method: 'POST' });
    setBusy(false);
    if (r.ok) {
      await fetchDetail();
      onChanged();
    } else {
      const j = await r.json().catch(() => ({}));
      alert(j.error || t('payroll.pendientes.errGeneric'));
    }
  }

  async function handleDelete(force = false) {
    if (!confirm(t('payroll.pendientes.confirmDelete'))) return;
    setBusy(true);
    const url = `/api/payroll/uploads/${uploadId}${force ? '?force=1' : ''}`;
    const r = await fetch(url, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      onDeleted();
      return;
    }
    if (j.error === 'has_published_payfile') {
      if (confirm(t('payroll.pendientes.confirmForceDelete').replace('{count}', String(j.message)))) {
        await handleDelete(true);
      }
      return;
    }
    alert(j.error || t('payroll.pendientes.errGeneric'));
  }

  if (!detail) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 text-gray-400">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-bold text-gray-800 dark:text-gray-100 truncate text-sm">
              {detail.upload.file_name}
            </h4>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {detail.upload.cutoff_date} · PW {detail.upload.pay_week ?? '—'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <SummaryTile label={saleStatusLabel('PAYABLE', lang)} count={detail.counts.PAYABLE} accent="emerald" />
            <SummaryTile label={saleStatusLabel('PAYABLE_NEXT_WEEK', lang)} count={detail.counts.PAYABLE_NEXT_WEEK} accent="sky" />
            <SummaryTile label={saleStatusLabel('CHARGEBACK', lang)} count={detail.counts.CHARGEBACK} accent="rose" />
            <SummaryTile label={saleStatusLabel('VERIFY', lang)} count={detail.counts.VERIFY} accent="amber" />
            <SummaryTile label={saleStatusLabel('CANCELLED', lang)} count={detail.counts.CANCELLED} accent="gray" />
            <SummaryTile label={saleStatusLabel('WINBACK', lang)} count={detail.counts.WINBACK + detail.winback} accent="violet" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <SummaryTile label={t('payroll.pendientes.bonuses')} count={detail.bonusCount} accent="indigo" small />
            <SummaryTile label={t('payroll.pendientes.residuals')} count={detail.residualCount} accent="purple" small />
            <SummaryTile label={t('payroll.pendientes.errorsLong')} count={detail.upload.error_count} accent={detail.upload.error_count > 0 ? 'rose' : 'gray'} small />
          </div>

          {detail.rowErrors.length > 0 && (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-900/10 p-3 space-y-2">
              <p className="text-xs font-bold text-rose-700 dark:text-rose-300">
                {t('payroll.pendientes.rowErrorsTitle')} ({detail.rowErrors.length})
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {detail.rowErrors.map((e) => (
                  <div key={e.id} className="text-[11px] text-rose-700 dark:text-rose-300 bg-white dark:bg-gray-900 rounded-lg px-2 py-1.5 border border-rose-100 dark:border-rose-800">
                    <span className="font-mono font-semibold">#{e.row_number}</span> · {e.error_message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {detail.upload.notes && (
            <div className="text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 whitespace-pre-wrap">
              {detail.upload.notes}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={handleReprocess}
              disabled={busy}
              className="flex-1 min-w-[120px] py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm disabled:opacity-60"
            >
              {busy ? t('common.loading') : t('payroll.pendientes.reprocess')}
            </button>
            <button
              onClick={() => handleDelete(false)}
              disabled={busy}
              className="flex-1 min-w-[120px] py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm disabled:opacity-60"
            >
              {t('payroll.pendientes.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tiny shared bits ───────────────────────────────────────────────────────

function SummaryTile({ label, count, accent, small }: { label: string; count: number; accent: string; small?: boolean }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    sky:     'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    rose:    'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    amber:   'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    gray:    'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700',
    violet:  'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
    indigo:  'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    purple:  'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${colors[accent] ?? colors.gray}`}>
      <p className={`${small ? 'text-base' : 'text-xl'} font-extrabold leading-tight`}>{count}</p>
      <p className="text-[10px] uppercase tracking-wide opacity-80 mt-0.5">{label}</p>
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
