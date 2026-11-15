import { animate, useMotionValue, useTransform, motion } from 'framer-motion';
import { useEffect } from 'react';
import { formatNumber } from '@/lib/format';

export function AnimatedNumber({
  value,
  format = formatNumber,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.6, ease: 'easeOut' });
    return () => controls.stop();
  }, [mv, value]);
  return <motion.span className={className}>{text}</motion.span>;
}
