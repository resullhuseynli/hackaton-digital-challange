import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { tr } from '@/i18n';

export type SnapIndex = 0 | 1 | 2;

interface Props {
  header: ReactNode;
  children: ReactNode;
  /** Rendered just above the sheet (moves with it), e.g. the SOS button. */
  floating?: ReactNode;
  snap: SnapIndex;
  onSnapChange: (s: SnapIndex) => void;
  /** Visible height reporter, so the map can pad around the sheet. */
  onVisibleHeight?: (px: number) => void;
  /** Space reserved below the sheet (e.g. the tab bar), in px. */
  bottomOffset?: number;
  /** Visible height when collapsed (smaller while a route is shown, so the map stays readable). */
  collapsedHeight?: number;
}

const COLLAPSED = 176;

function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

/** Draggable bottom sheet with three snap points (collapsed / half / full). */
export function BottomSheet({
  header,
  children,
  floating,
  snap,
  onSnapChange,
  onVisibleHeight,
  bottomOffset = 0,
  collapsedHeight = COLLAPSED,
}: Props) {
  const vh = useViewportHeight();
  const avail = vh - bottomOffset;
  const sheetH = Math.round(avail * 0.9);
  const snaps = useMemo(
    () => [sheetH - collapsedHeight, sheetH - Math.round(avail * 0.5), 0] as const,
    [sheetH, avail, collapsedHeight],
  );
  const y = useMotionValue<number>(snaps[snap]);
  const controls = useDragControls();

  useEffect(() => {
    const a = animate(y, snaps[snap], { type: 'spring', stiffness: 380, damping: 38 });
    onVisibleHeight?.(sheetH - snaps[snap]);
    return () => a.stop();
  }, [snap, snaps, y, sheetH, onVisibleHeight]);

  const settle = useCallback(
    (velocity: number) => {
      const projected = y.get() + velocity * 0.18;
      let best: SnapIndex = 0;
      snaps.forEach((s, i) => {
        if (Math.abs(s - projected) < Math.abs(snaps[best] - projected)) best = i as SnapIndex;
      });
      if (best === snap) {
        animate(y, snaps[best], { type: 'spring', stiffness: 380, damping: 38 });
      }
      onSnapChange(best);
    },
    [snaps, snap, y, onSnapChange],
  );

  const cycle = () => onSnapChange(((snap + 1) % 3) as SnapIndex);

  return (
    <motion.section
      className="fixed inset-x-0 z-30 mx-auto flex max-w-xl flex-col rounded-t-3xl border border-b-0 bg-card shadow-lift"
      style={{
        height: sheetH,
        y,
        bottom: bottomOffset ? `calc(${bottomOffset}px + env(safe-area-inset-bottom))` : 0,
      }}
      drag="y"
      dragControls={controls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: snaps[0] }}
      dragElastic={0.08}
      dragMomentum={false}
      onDragEnd={(_, info) => settle(info.velocity.y)}
      aria-label={tr.citizen.nearest.title}
    >
      {floating && <FloatingSlot y={y}>{floating}</FloatingSlot>}
      <div
        className="cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(e) => controls.start(e)}
      >
        <button
          type="button"
          onClick={cycle}
          className="mx-auto mt-2 flex h-6 w-24 items-center justify-center rounded-full"
          aria-label={tr.citizen.sheet.handle}
        >
          <span className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
        </button>
        {header}
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {children}
      </div>
    </motion.section>
  );
}

function FloatingSlot({ y, children }: { y: MotionValue<number>; children: ReactNode }) {
  // Fade the floating slot slightly when the sheet is fully open.
  const opacity = useTransform(y, [0, 120], [0.95, 1]);
  return (
    <motion.div className="pointer-events-none absolute -top-[104px] right-4" style={{ opacity }}>
      <div className="pointer-events-auto">{children}</div>
    </motion.div>
  );
}
