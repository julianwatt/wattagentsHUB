'use client';
import { useState, useEffect } from 'react';

export function useIsStandaloneIOS(): boolean {
  const [is, setIs] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    setIs(
      nav.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches,
    );
  }, []);
  return is;
}
