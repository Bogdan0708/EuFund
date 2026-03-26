import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const dsCardVariants = cva('rounded-[1rem] p-8 shadow-[0_20px_40px_rgba(0,0,0,0.04)]', {
  variants: {
    variant: {
      standard: 'bg-surface-container-lowest',
      glass: 'glass-card border border-white/20',
    },
  },
  defaultVariants: {
    variant: 'standard',
  },
});

export interface DsCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof dsCardVariants> {}

const DsCard = React.forwardRef<HTMLDivElement, DsCardProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <div
        className={cn(dsCardVariants({ variant, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
DsCard.displayName = 'DsCard';

export { DsCard, dsCardVariants };
