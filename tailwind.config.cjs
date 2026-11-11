module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      colors: { brand: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d' }, ink: { 900: '#111114', 700: '#3f3f46', 500: '#71717a', 400: '#a1a1aa', 200: '#e4e4e7', 100: '#f4f4f5', 50: '#fafafa' } },
      fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'Inter', 'system-ui', 'sans-serif'], mono: ['"SF Mono"', 'ui-monospace', 'Menlo', 'monospace'] },
      boxShadow: { card: '0 1px 2px rgba(17,17,20,.05), 0 4px 16px -4px rgba(17,17,20,.08)', pop: '0 12px 40px -8px rgba(17,17,20,.25)', glow: '0 0 0 4px rgba(220,38,38,.12)' },
      keyframes: { shake: { '0%,100%': { transform: 'translateX(0)' }, '20%,60%': { transform: 'translateX(-8px)' }, '40%,80%': { transform: 'translateX(8px)' } }, pulseDot: { '0%': { boxShadow: '0 0 0 0 rgba(34,197,94,.55)' }, '100%': { boxShadow: '0 0 0 8px rgba(34,197,94,0)' } } },
      animation: { shake: 'shake .4s ease', pulseDot: 'pulseDot 1.8s ease-out infinite' },
    },
  },
}
