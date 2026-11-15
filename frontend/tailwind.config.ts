import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        safe: '#16A34A',
        warning: '#F59E0B',
        danger: '#DC2626',
        info: '#2563EB',
        sos: {
          fire: '#EA580C',
          collapse: '#78716C',
          flood: '#2563EB',
          medical: '#DC2626',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        soft: '0 1px 2px rgb(15 23 42 / 0.04), 0 8px 24px -6px rgb(15 23 42 / 0.14)',
        lift: '0 4px 12px rgb(15 23 42 / 0.08), 0 24px 48px -12px rgb(15 23 42 / 0.28)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.6)', opacity: '0.9' },
          '100%': { transform: 'scale(2.4)', opacity: '0' },
        },
        'alert-border': {
          '0%, 100%': {
            boxShadow: 'inset 0 0 0 4px rgb(220 38 38 / 0.95), inset 0 0 60px rgb(220 38 38 / 0.45)',
          },
          '50%': {
            boxShadow: 'inset 0 0 0 8px rgb(220 38 38 / 0.5), inset 0 0 120px rgb(220 38 38 / 0.2)',
          },
        },
        'row-flash': {
          '0%': { backgroundColor: 'rgb(220 38 38 / 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
        'alert-border': 'alert-border 1.2s ease-in-out infinite',
        'row-flash': 'row-flash 2.5s ease-out',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
