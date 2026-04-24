'use client';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useIsStandaloneIOS } from './useStandalone';

interface Props {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

const THRESHOLD = 80;

export default function PullToRefresh({ onRefresh, children }: Props) {
  const isStandalone = useIsStandaloneIOS();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pulling, setPulling] = useState(false);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const active = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const el = containerRef.current;
    if (!el || refreshing) return;
    if (el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    active.current = true;
  }, [refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!active.current) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy < 0) { active.current = false; setPullY(0); setPulling(false); return; }
    setPulling(true);
    setPullY(Math.min(dy * 0.5, THRESHOLD * 1.5));
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!active.current && !pulling) return;
    active.current = false;
    if (pullY >= THRESHOLD) {
      setRefreshing(true);
      setPullY(THRESHOLD * 0.6);
      try { await onRefresh(); } catch {}
      setRefreshing(false);
    }
    setPullY(0);
    setPulling(false);
  }, [pullY, pulling, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isStandalone) return;
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd);
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isStandalone, handleTouchStart, handleTouchMove, handleTouchEnd]);

  if (!isStandalone) return <>{children}</>;

  const progress = Math.min(pullY / THRESHOLD, 1);

  return (
    <div ref={containerRef} className="relative overflow-y-auto h-full">
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
        style={{ height: pulling || refreshing ? `${pullY}px` : 0 }}
      >
        <svg
          className={`w-6 h-6 text-gray-400 dark:text-gray-500 ${refreshing ? 'animate-spin' : ''}`}
          style={{ opacity: progress, transform: `rotate(${progress * 360}deg)` }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </div>
      {children}
    </div>
  );
}
