'use client';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export default function ToggleSwitch({ checked, onChange, disabled = false, size = 'sm' }: ToggleSwitchProps) {
  const w = size === 'md' ? 'w-10' : 'w-8';
  const h = size === 'md' ? 'h-5' : 'h-4';
  const dot = size === 'md' ? 'w-4 h-4' : 'w-3 h-3';
  const translate = size === 'md' ? 'translate-x-5' : 'translate-x-4';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`${w} ${h} rounded-full relative transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0`}
      style={{ backgroundColor: checked ? '#10b981' : '#ef4444' }}
    >
      <span
        className={`${dot} bg-white rounded-full shadow-sm absolute top-0.5 left-0.5 transition-transform duration-200 ease-in-out ${checked ? translate : 'translate-x-0'}`}
      />
    </button>
  );
}
