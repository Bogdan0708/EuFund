import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export type ChipStatus = 'draft' | 'in-progress' | 'submitted' | 'approved' | 'rejected';

const statusStyles: Record<ChipStatus, string> = {
  draft: 'bg-surface-container-high text-on-surface-variant',
  'in-progress': 'bg-primary-fixed text-primary',
  submitted: 'bg-secondary-fixed text-secondary',
  approved: 'bg-tertiary-container/20 text-tertiary',
  rejected: 'bg-error-container text-on-error-container',
};

const dsChipVariants = cva('inline-flex items-center gap-1.5 text-sm font-medium', {
  variants: {
    variant: {
      default:
        'bg-surface-container-high text-on-surface-variant px-4 py-2 rounded-full cursor-pointer hover:bg-surface-container-highest transition-all',
      selected: 'bg-primary-container text-on-primary px-4 py-2 rounded-full',
      status: 'px-4 py-2 rounded-full',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface DsChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof dsChipVariants> {
  status?: ChipStatus;
}

const DsChip = React.forwardRef<HTMLSpanElement, DsChipProps>(
  ({ className, variant, status, ...props }, ref) => {
    const statusClass = variant === 'status' && status ? statusStyles[status] : '';

    return (
      <span
        className={cn(dsChipVariants({ variant, className }), statusClass)}
        ref={ref}
        {...props}
      />
    );
  }
);
DsChip.displayName = 'DsChip';

export { DsChip, dsChipVariants };
