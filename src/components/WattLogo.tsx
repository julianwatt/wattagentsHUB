'use client';

interface Props {
  className?: string;
  bigW?: boolean;
}

export default function WattLogo({ className = 'h-10 w-auto', bigW = false }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      aria-label="Watt Distributors"
      style={{ maxHeight: '100%' }}
    >
      {/* W glyph — gold, no background */}
      <span
        style={{
          fontFamily: 'var(--font-playfair), Georgia, serif',
          fontWeight: 800,
          fontSize: bigW ? '2.2em' : '1.1em',
          color: '#c2994b',
          lineHeight: 1,
          letterSpacing: '-0.03em',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        W
      </span>

      {/* Text */}
      <span style={{ lineHeight: 1, flexShrink: 0 }}>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-playfair), Georgia, serif',
            fontWeight: 700,
            fontSize: '0.95em',
            letterSpacing: '0.06em',
            color: '#c2994b',
            lineHeight: 1,
          }}
        >
          WATT
        </span>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-inter), sans-serif',
            fontWeight: 500,
            fontSize: '0.46em',
            letterSpacing: '0.2em',
            color: 'white',
            lineHeight: 1.3,
            opacity: 0.85,
          }}
        >
          DISTRIBUTORS
        </span>
      </span>
    </span>
  );
}
