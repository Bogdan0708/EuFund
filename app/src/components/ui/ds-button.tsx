import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const dsButtonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-primary-container text-on-primary font-bold rounded-full hover:bg-primary hover:-translate-y-[1px] active:scale-[0.98] transition-all duration-250',
        secondary:
          'text-primary font-bold rounded-full hover:bg-primary-fixed transition-all duration-250',
        ghost:
          'text-on-surface-variant font-medium rounded-full hover:bg-surface-container-high transition-all duration-250',
      },
      size: {
        sm: 'px-4 py-2 text-xs',
        md: 'px-6 py-3 text-sm',
        lg: 'px-8 py-4 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface DsButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof dsButtonVariants> {
  asChild?: boolean;
}

const DsButton = React.forwardRef<HTMLButtonElement, DsButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(dsButtonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
DsButton.displayName = 'DsButton';

export { DsButton, dsButtonVariants };
