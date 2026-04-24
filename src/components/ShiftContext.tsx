'use client';
import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
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
}

const ShiftCtx = createContext<ShiftContextValue>({
  shiftState: 'idle',
  events: [],
  store: null,
  loading: true,
  refresh: async () => {},
  pushEvent: () => {},
  clockInTime: null,
});

export function useShift() {
  return useContext(ShiftCtx);
}

// ── Provider ──
export function ShiftProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [shiftState, setShiftState] = useState<ShiftState>('idle');
  const [events, setEvents] = useState<ShiftEvent[]>([]);
  const [store, setStore] = useState<ShiftStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [clockInTime, setClockInTime] = useState<number | null>(null);
  const fetchedRef = useRef(false);

  const userId = session?.user?.id;
  const role = (session?.user?.role as string) ?? '';

  // Only fetch for roles that have shifts
  const isShiftRole = ['agent', 'jr_manager', 'sr_manager'].includes(role);

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

        // Determine state
        const lastEvt = data.events[data.events.length - 1];
        if (lastEvt.event_type === 'lunch_start') {
          setShiftState('break');
        } else {
          setShiftState('active');
        }

        // Clock-in time for chronometer
        const clockIn = data.events.find((e: ShiftEvent) => e.event_type === 'clock_in');
        if (clockIn) setClockInTime(new Date(clockIn.event_time).getTime());
      } else {
        setShiftState('idle');
        setEvents(data.events ?? []);
        setStore(null);
        setClockInTime(null);
      }
    } catch (err) {
      console.error('[ShiftContext] refresh error:', err);
    }
    setLoading(false);
  }, [userId, isShiftRole]);

  // Fetch on mount
  useEffect(() => {
    if (!userId) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    refresh();
  }, [userId, refresh]);

  // Re-fetch when tab becomes visible (handles browser tab switching)
  useEffect(() => {
    if (!userId || !isShiftRole) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
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
    <ShiftCtx.Provider value={{ shiftState, events, store, loading, refresh, pushEvent, clockInTime }}>
      {children}
    </ShiftCtx.Provider>
  );
}
