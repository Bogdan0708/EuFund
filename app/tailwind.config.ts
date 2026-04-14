import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

/** Helper: wrap CSS var as rgb() with alpha support */
const c = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: ['variant', '[data-theme="dark"] &'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: c('surface'),
          dim: c('surface-dim'),
          bright: c('surface-bright'),
          'container-lowest': c('surface-container-lowest'),
          'container-low': c('surface-container-low'),
          container: c('surface-container'),
          'container-high': c('surface-container-high'),
          'container-highest': c('surface-container-highest'),
          variant: c('surface-variant'),
          tint: c('surface-tint'),
        },
        background: c('background'),
        'on-surface': {
          DEFAULT: c('on-surface'),
          variant: c('on-surface-variant'),
        },
        'on-background': c('on-background'),
        primary: {
          DEFAULT: c('primary'),
          container: c('primary-container'),
          fixed: c('primary-fixed'),
          'fixed-dim': c('primary-fixed-dim'),
        },
        'on-primary': {
          DEFAULT: c('on-primary'),
          container: c('on-primary-container'),
          fixed: c('on-primary-fixed'),
        },
        secondary: {
          DEFAULT: c('secondary'),
          container: c('secondary-container'),
          fixed: c('secondary-fixed'),
          'fixed-dim': c('secondary-fixed-dim'),
        },
        'on-secondary': {
          DEFAULT: c('on-secondary'),
          container: c('on-secondary-container'),
        },
        tertiary: {
          DEFAULT: c('tertiary'),
          container: c('tertiary-container'),
        },
        'on-tertiary': c('on-tertiary'),
        error: {
          DEFAULT: c('error'),
          container: c('error-container'),
        },
        'on-error': {
          DEFAULT: c('on-error'),
          container: c('on-error-container'),
        },
        outline: {
          DEFAULT: c('outline'),
          variant: c('outline-variant'),
        },
        'inverse-surface': c('inverse-surface'),
        'inverse-on-surface': c('inverse-on-surface'),
        'inverse-primary': c('inverse-primary'),
      },
      fontFamily: {
        headline: ['Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        label: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '1rem',
        lg: '2rem',
        xl: '3rem',
        full: '9999px',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
