'use client';
import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { useSession } from 'next-auth/react';

// ── Types ──
export interface ShiftEvent {
  id: string;
  event_type: 'clock_in' | 'lunch_start' | 'lunch_end' | 'clock_out';
  event_time: string;
  is_at_location: boolean | null;
  distance_meters: number | null;
}

export interface ShiftStore {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  geofence_radius_meters: number;
}

export type ShiftState = 'idle' | 'active' | 'break';

interface ShiftContextValue {
  /** Current shift state */
  shiftState: ShiftState;
  /** Today's shift events */
  events: ShiftEvent[];
  /** The store associated with the active shift (from clock_in) */
  store: ShiftStore | null;
  /** Whether initial load is in progress */
  loading: boolean;
  /** Re-fetch shift data from DB */
  refresh: () => Promise<void>;
  /** Add an event locally (called after successful API POST) */
  pushEvent: (event: ShiftEvent, newState: ShiftState, store?: ShiftStore | null) => void;
  /** Clock-in timestamp for chronometer */
  clockInTime: number | null;
  /** Total completed break time in ms (for chronometer offset) */
  totalBreakMs: number;
}

const ShiftCtx = createContext<ShiftContextValue>({
  shiftState: 'idle',
  events: [],
  store: null,
  loading: true,
  refresh: async () => {},
  pushEvent: () => {},
  clockInTime: null,
  totalBreakMs: 0,
});

export function useShift() {
  return useContext(ShiftCtx);
}

// ── Helper: compute total completed break time from events ──
function computeBreakMs(events: ShiftEvent[]): number {
  let total = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].event_type === 'lunch_start') {
      const endEvt = events.slice(i + 1).find((e) => e.event_type === 'lunch_end');
      if (endEvt) {
        total += new Date(endEvt.event_time).getTime() - new Date(events[i].event_time).getTime();
      }
    }
  }
  return total;
}

// ── Provider ──
export function ShiftProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [shiftState, setShiftState] = useState<ShiftState>('idle');
  const [events, setEvents] = useState<ShiftEvent[]>([]);
  const [store, setStore] = useState<ShiftStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [clockInTime, setClockInTime] = useState<number | null>(null);
  const [fetched, setFetched] = useState(false);

  const userId = session?.user?.id;
  const role = (session?.user?.role as string) ?? '';

  // Only fetch for roles that have shifts
  const isShiftRole = ['agent', 'jr_manager', 'sr_manager'].includes(role);

  // Memoize total break time from events
  const totalBreakMs = useMemo(() => computeBreakMs(events), [events]);

  const refresh = useCallback(async () => {
    if (!userId || !isShiftRole) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/shift', { cache: 'no-store' });
      if (!res.ok) { setLoading(false); return; }

      const data = await res.json();

      if (data.active && data.events?.length > 0) {
        setEvents(data.events);
        setStore(data.store ?? null);

        // Determine state from last event of current shift
        const lastEvt = data.events[data.events.length - 1];
        if (lastEvt.event_type === 'lunch_start') {
          setShiftState('break');
        } else {
          setShiftState('active');
        }

        // Use the FIRST clock_in of the current shift as the canonical start.
        // The API already restricts events to the current shift only.
        const clockIn = data.events.find((e: ShiftEvent) => e.event_type === 'clock_in');
        if (clockIn) {
          setClockInTime(new Date(clockIn.event_time).getTime());
        } else {
          // No clock_in in current shift events (corrupted data) — fall back
          // to the first event's time so the chronometer shows something
          // sensible instead of 1970.
          setClockInTime(new Date(data.events[0].event_time).getTime());
        }
      } else {
        setShiftState('idle');
        setEvents([]);
        setStore(null);
        setClockInTime(null);
      }
    } catch (err) {
      console.error('[ShiftContext] refresh error:', err);
    }
    setLoading(false);
  }, [userId, isShiftRole]);

  // Always fetch from DB on mount / when userId becomes available
  useEffect(() => {
    if (!userId) return;
    if (fetched) return;
    setFetched(true);
    refresh();
  }, [userId, refresh, fetched]);

  // Reset fetched flag when userId changes (logout → login as different user)
  useEffect(() => {
    setFetched(false);
  }, [userId]);

  // Re-fetch on tab visibility + window focus (handles tab switch, PWA resume, alt-tab)
  useEffect(() => {
    if (!userId || !isShiftRole) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onFocus = () => refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [userId, isShiftRole, refresh]);

  const pushEvent = useCallback((event: ShiftEvent, newState: ShiftState, newStore?: ShiftStore | null) => {
    setEvents((prev) => [...prev, event]);
    setShiftState(newState);
    if (newStore !== undefined) setStore(newStore);
    if (event.event_type === 'clock_in') {
      setClockInTime(new Date(event.event_time).getTime());
    }
    if (newState === 'idle') {
      setClockInTime(null);
    }
  }, []);

  return (
    <ShiftCtx.Provider value={{ shiftState, events, store, loading, refresh, pushEvent, clockInTime, totalBreakMs }}>
      {children}
    </ShiftCtx.Provider>
  );
}
