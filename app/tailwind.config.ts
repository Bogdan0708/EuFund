import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ["class"],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#003399',
          600: '#002b80',
          700: '#002266',
        },
        success: '#16a34a',
        warning: '#ea580c',
        danger: '#dc2626',
        'g-surface': 'var(--bg-surface)',
        'g-surface-hover': 'var(--bg-surface-hover)',
        'g-glass': 'var(--bg-glass)',
        'g-border': 'var(--border-subtle)',
        'g-border-focus': 'var(--border-focus)',
        'g-text': 'var(--text-primary)',
        'g-text-secondary': 'var(--text-secondary)',
        'g-text-tertiary': 'var(--text-tertiary)',
        'g-accent': 'var(--accent)',
        'g-accent-soft': 'var(--accent-soft)',
        'g-success': 'var(--success)',
        'g-warning': 'var(--warning)',
        'g-danger': 'var(--danger)',
      },
      backdropBlur: {
        glass: '16px',
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        glass: '16px',
        btn: '12px',
        input: '10px',
        badge: '6px',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
export default config;
