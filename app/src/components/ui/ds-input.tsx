import * as React from 'react';
import { cn } from '@/lib/utils';

export interface DsInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const DsInput = React.forwardRef<HTMLInputElement, DsInputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-on-surface"
          >
            {label}
          </label>
        )}
        <input
          id={inputId}
          className={cn(
            'w-full px-5 py-4 bg-surface-container-high/50 border-none rounded-[0.75rem] focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all duration-200 text-on-surface placeholder:text-outline outline-none',
            error && 'ring-2 ring-error/40 focus:ring-error/40',
            className
          )}
          ref={ref}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error && inputId ? `${inputId}-error` : undefined}
          {...props}
        />
        {error && (
          <p
            id={inputId ? `${inputId}-error` : undefined}
            className="text-xs text-error"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    );
  }
);
DsInput.displayName = 'DsInput';

export { DsInput };
