'use client';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /**
   * `sm`  — compact (32×16px) for inline lists.
   * `md`  — standard (40×20px) for forms.
   * `lg`  — touch-friendly (48×28px), hits the 44px tap-target rule on mobile.
   */
  size?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
}

/**
 * iOS-style toggle: capsule pill, animated thumb (~200ms), shadow on the
 * thumb for depth. Active = success-green background with thumb on the
 * right; inactive = neutral-gray background with thumb on the left.
 *
 * This is the project-wide standard for any boolean activation control —
 * teams, agents, stores, settings — so visual + a11y stay consistent.
 */
export default function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  size = 'sm',
  ariaLabel,
}: ToggleSwitchProps) {
  const dims = {
    sm: { w: 'w-8',  h: 'h-4', dot: 'w-3 h-3', translate: 'translate-x-4' },
    md: { w: 'w-10', h: 'h-5', dot: 'w-4 h-4', translate: 'translate-x-5' },
    lg: { w: 'w-12', h: 'h-7', dot: 'w-6 h-6', translate: 'translate-x-5' },
  }[size];

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`${dims.w} ${dims.h} rounded-full relative transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0`}
      style={{
        backgroundColor: checked
          ? '#10b981'      // emerald-500 — affirmative
          : '#d1d5db',     // gray-300 — neutral inactive (was red, intentionally toned down)
      }}
    >
      <span
        className={`${dims.dot} bg-white rounded-full shadow-md absolute top-0.5 left-0.5 transition-transform duration-200 ease-in-out ${checked ? dims.translate : 'translate-x-0'}`}
      />
    </button>
  );
}
