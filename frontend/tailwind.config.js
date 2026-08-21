/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          pink:   '#FF2D78',
          red:    '#CC0000',
          mint:   '#10B981',
          orange: '#F97316',
        },
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        pulsering: {
          '0%, 100%': { transform: 'scale(1)',    opacity: 1   },
          '50%':       { transform: 'scale(1.06)', opacity: 0.7 },
        },
      },
      animation: {
        shimmer:   'shimmer 3s linear infinite',
        pulsering: 'pulsering 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
