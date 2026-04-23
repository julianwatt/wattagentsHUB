'use client';
import { useState, useRef, useEffect } from 'react';

interface Props {
  text: string;
  className?: string;
}

export default function InfoTooltip({ text, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClickOut);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOut);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Más información"
        aria-expanded={open}
        className="w-4 h-4 inline-flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 w-60 px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-[11px] leading-snug shadow-lg normal-case tracking-normal font-normal"
        >
          {text}
        </span>
      )}
    </span>
  );
}
