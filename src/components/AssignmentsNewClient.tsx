'use client';
import { useState, useCallback } from 'react';
import AssignmentForm, { AssignmentFormPreset } from './AssignmentForm';
import RecentAssignmentsList from './RecentAssignmentsList';

/**
 * Client-side wrapper for the "Asignar" tab. Holds the shared state between
 * the form and the recent-list:
 *   - presetVersion: bumped when the user clicks "Reasignar" so the form
 *     re-applies the preset values even if it was already mounted.
 *   - refreshKey: bumped after a successful create so the list re-fetches.
 */
export default function AssignmentsNewClient() {
  const [preset, setPreset] = useState<AssignmentFormPreset | null>(null);
  const [presetVersion, setPresetVersion] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleReassign = useCallback((p: AssignmentFormPreset) => {
    setPreset(p);
    setPresetVersion((v) => v + 1);
    // Scroll the form back into view on small screens
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleCreated = useCallback(() => {
    setRefreshKey((k) => k + 1);
    // Clear preset after a successful create so subsequent ones start fresh
    setPreset(null);
  }, []);

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
