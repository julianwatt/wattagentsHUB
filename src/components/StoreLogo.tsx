'use client';
import { useState } from 'react';

/**
 * Single source of truth for what to render next to a store name. Maps
 * each STORE_TYPE → either an SVG file in /public/store-logos/ or a fixed
 * emoji. Both render at the same visual height so cards stay aligned.
 *
 *   HEB / Walmart / El Rancho → SVG
 *   Other / Test Location / Office → emoji
 *
 * If an SVG is configured but the file is missing (404), <img onError>
 * swaps in the fallback emoji so the card never breaks.
 */
interface StoreLogoProps {
  /** The store's `name` column value — must match a STORE_TYPES entry. */
  type: string | null | undefined;
  /** Pixel height. Logos are wider than tall so width auto-fits. */
  size?: number;
  className?: string;
}

interface LogoConfig {
  src?: string;     // SVG path under /public
  emoji: string;    // emoji-based fallback (and primary, when no src)
  alt: string;      // accessibility label
}

const LOGO_BY_TYPE: Record<string, LogoConfig> = {
  'HEB':           { src: '/store-logos/heb.svg',       emoji: '🏪', alt: 'HEB' },
  'Walmart':       { src: '/store-logos/walmart.svg',   emoji: '🏪', alt: 'Walmart' },
  'El Rancho':     { src: '/store-logos/el-rancho.svg', emoji: '🏪', alt: 'El Rancho' },
  'Other':         { emoji: '🏪', alt: 'Other' },
  'Test Location': { emoji: '🧪', alt: 'Test Location' },
  'Office':        { emoji: '🏢', alt: 'Office' },
};

export default function StoreLogo({ type, size = 28, className }: StoreLogoProps) {
  const cfg = (type && LOGO_BY_TYPE[type]) || { emoji: '🏪', alt: type ?? 'Store' };
  const [imgFailed, setImgFailed] = useState(false);

  if (cfg.src && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cfg.src}
        alt={cfg.alt}
        height={size}
        style={{ height: size, width: 'auto' }}
        className={`object-contain flex-shrink-0 ${className ?? ''}`}
        onError={() => setImgFailed(true)}
      />
    );
  }
  // Emoji rendered at slightly smaller font-size to match the SVG's visual
  // weight (emojis read "bigger" than vector logos at the same px height).
  return (
    <span
      role="img"
      aria-label={cfg.alt}
      style={{ fontSize: Math.round(size * 0.85), lineHeight: `${size}px` }}
      className={`inline-flex items-center justify-center flex-shrink-0 ${className ?? ''}`}
    >
      {cfg.emoji}
    </span>
  );
}
