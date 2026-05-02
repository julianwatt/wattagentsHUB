'use client';
import { useEffect, useState } from 'react';
import { useLanguage } from './LanguageContext';
import { fmtDistance } from '@/lib/geo';
import type { GeofenceEventType } from '@/lib/assignmentGeofence';

interface EventRow {
  id: string;
  event_type: GeofenceEventType;
  occurred_at: string;
  latitude: number | null;
  longitude: number | null;
  distance_meters: number | null;
  geo_method: string | null;
}

interface Props {
  assignmentId: string;
  agentName: string;
  storeName: string;
  onClose: () => void;
}

const EVENT_ICON: Record<GeofenceEventType, string> = {
  entered: '✅',
  exited_warn: '⚠️',
  exited_final: '🛑',
  reentered: '🔄',
};

const EVENT_COLOR: Record<GeofenceEventType, string> = {
  entered: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  exited_warn: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  exited_final: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  reentered: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
};

export default function AssignmentTimelineModal({ assignmentId, agentName, storeName, onClose }: Props) {
  const { t, lang } = useLanguage();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/assignments/${assignmentId}/events`, { cache: 'no-store' });
        if (!cancelled && res.ok) {
          const j = await res.json();
          setEvents(j.events ?? []);
        }
      } catch { /* silent */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [assignmentId]);

  const eventLabel = (type: GeofenceEventType) => {
    if (type === 'entered') return t('assignments.bellArrived');
    if (type === 'exited_warn') return t('assignments.bellExitedWarn');
    if (type === 'exited_final') return t('assignments.bellExitedFinal');
    return t('assignments.bellReentered');
  };

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'es' ? 'es-MX' : 'en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4">
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full sm:max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">
              {t('assignments.timelineTitle')}
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {agentName} · {storeName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="text-xs text-gray-400 text-center py-8">{t('common.loading')}</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">{t('assignments.timelineEmpty')}</p>
          ) : (
            <ol className="relative border-l-2 border-gray-200 dark:border-gray-700 ml-3 space-y-4 py-2">
              {events.map((ev) => (
                <li key={ev.id} className="ml-4">
                  <span className="absolute -left-[9px] mt-0.5 w-4 h-4 rounded-full bg-white dark:bg-gray-900 border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-[10px]">
                    {EVENT_ICON[ev.event_type]}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${EVENT_COLOR[ev.event_type]}`}>
                      {eventLabel(ev.event_type)}
                    </span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
                      {fmtTime(ev.occurred_at)}
                    </span>
                  </div>
                  {ev.distance_meters != null && (
                    <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">
                      {t('assignments.cardDistance')}: <strong>{fmtDistance(ev.distance_meters)}</strong>
                      {ev.geo_method && (
                        <span className="text-gray-400"> · {ev.geo_method}</span>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
