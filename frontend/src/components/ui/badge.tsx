import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold [&_svg]:h-3.5 [&_svg]:w-3.5',
  {
    variants: {
      variant: {
        neutral: 'border-transparent bg-secondary text-secondary-foreground',
        safe: 'border-green-600/30 bg-green-600/15 text-green-700 dark:text-green-400',
        warning: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300',
        danger: 'border-red-600/40 bg-red-600/15 text-red-700 dark:text-red-400',
        info: 'border-blue-600/30 bg-blue-600/15 text-blue-700 dark:text-blue-300',
        outline: 'border-border text-foreground',
        solidDanger: 'border-transparent bg-danger text-white',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
