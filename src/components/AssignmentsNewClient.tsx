'use client';
import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import AssignmentForm, { AssignmentFormPreset } from './AssignmentForm';
import RecentAssignmentsList from './RecentAssignmentsList';

/**
 * Client-side wrapper for the "Asignar" tab. Holds the shared state between
 * the form and the recent-list:
 *   - presetVersion: bumped when the user clicks "Reasignar" so the form
 *     re-applies the preset values even if it was already mounted.
 *   - refreshKey: bumped after a successful create so the list re-fetches.
 *
 * Also supports `?reassign=<assignmentId>` query param: when present, the
 * referenced assignment is fetched and its values are applied as the form's
 * preset. Used by the "Hoy" panel's reassign quick action.
 */
export default function AssignmentsNewClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [preset, setPreset] = useState<AssignmentFormPreset | null>(null);
  const [presetVersion, setPresetVersion] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleReassign = useCallback((p: AssignmentFormPreset) => {
    setPreset(p);
    setPresetVersion((v) => v + 1);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleCreated = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setPreset(null);
  }, []);

  // ?reassign=<id> → load that assignment, preload form, then strip the param
  useEffect(() => {
    const reassignId = searchParams?.get('reassign');
    if (!reassignId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/assignments?limit=1`, { cache: 'no-store' });
        if (!res.ok) return;
        // The list endpoint accepts arbitrary filters; here we just want this
        // specific row. We re-use it instead of adding a single-id GET.
        const all = await fetch('/api/assignments?limit=500', { cache: 'no-store' }).then((r) => r.json());
        if (cancelled) return;
        const a = (all?.assignments ?? []).find((x: { id: string }) => x.id === reassignId);
        if (!a) return;
        handleReassign({
          agent_id: a.agent_id,
          store_id: a.store_id,
          shift_date: a.shift_date,
          scheduled_start_time: (a.scheduled_start_time as string).slice(0, 5),
          expected_duration_min: a.expected_duration_min,
        });
      } catch {
        /* silent */
      }
      // Strip the query param so refreshing doesn't re-trigger
      router.replace('/assignments/new');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="space-y-5">
      <AssignmentForm
        preset={preset}
        presetVersion={presetVersion}
        onCreated={handleCreated}
      />
      <RecentAssignmentsList refreshKey={refreshKey} onReassign={handleReassign} />
    </div>
  );
}
