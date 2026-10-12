/** Kestrion "Hover Badge" logo (CLAUDE.md §1). `inverted` = for dark backgrounds. */
export function LogoMark({ size = 36, inverted = false }: { size?: number; inverted?: boolean }) {
  const bg = inverted ? '#C6FF00' : '#0A0A0A';
  const fg = inverted ? '#0A0A0A' : '#C6FF00';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill={bg} />
      <path d="M11 36 L32 17 L53 36 L45 40 L32 28.5 L19 40 Z" fill={fg} />
      <circle cx="32" cy="47" r="4.5" fill={fg} />
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="font-display text-[23px] font-bold tracking-[-0.035em]">Kestrion</span>
    </span>
  );
}
