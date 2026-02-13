import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#003399', // EU blue
          600: '#002b80',
          700: '#002266',
        },
        success: '#16a34a',
        warning: '#ea580c',
        danger: '#dc2626',
      },
    },
  },
  plugins: [],
};
export default config;
