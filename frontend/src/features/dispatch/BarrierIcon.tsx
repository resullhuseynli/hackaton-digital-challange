import { ArrowDownToLine, ArrowRightLeft, Ban, Mountain, SquareDashedBottom } from 'lucide-react';
import type { BarrierType } from '@/types/api';

/** Stairs (Lucide has no stairs icon; emoji 🪜 is missing on older Windows fonts). */
function Stairs({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 20h5v-5h5v-5h5V5h3" />
    </svg>
  );
}

const ICONS: Record<BarrierType, (p: { className?: string }) => JSX.Element> = {
  stairs: Stairs,
  underpass: (p) => <ArrowDownToLine {...p} aria-hidden />,
  steep: (p) => <Mountain {...p} aria-hidden />,
  curb: (p) => <SquareDashedBottom {...p} aria-hidden />,
  narrow: (p) => <ArrowRightLeft {...p} aria-hidden />,
  inaccessible: (p) => <Ban {...p} aria-hidden />,
};

/** Decorative barrier glyph — always paired with the barrier name in text or aria-label. */
export function BarrierIcon({
  type,
  className = 'h-3.5 w-3.5',
}: {
  type: BarrierType;
  className?: string;
}) {
  const Icon = ICONS[type];
  return <Icon className={className} />;
}
