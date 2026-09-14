/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#17263A',
          50: '#eef1f4',
          100: '#d7dee5',
          200: '#aebcc9',
          300: '#8699ad',
          400: '#5d7791',
          500: '#3d5670',
          600: '#243b52',
          700: '#1d2f43',
          800: '#17263A',
          900: '#0f1926',
          950: '#0a1119',
        },
        brand: {
          DEFAULT: '#2F8C86',
          50: '#eafaf8',
          100: '#cdf0ec',
          200: '#9ce0d9',
          300: '#66cbc1',
          400: '#3fada3',
          500: '#2F8C86',
          600: '#25706b',
          700: '#1e5a56',
          800: '#194846',
          900: '#153b39',
        },
        positive: {
          DEFAULT: '#4F7B3E',
          50: '#f1f7ed',
          100: '#dcebd1',
          200: '#bcd8a8',
          300: '#96c078',
          400: '#71a352',
          500: '#4F7B3E',
          600: '#3f6231',
          700: '#334f28',
          800: '#2a4021',
          900: '#23351c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // Shrunk ~1-2px off every step of the default scale - this app
      // reads dense/data-table-heavy, not prose, so a slightly smaller
      // default type scale suits it better than Tailwind's stock sizes.
      fontSize: {
        xs: ['0.6875rem', { lineHeight: '0.9375rem' }],
        sm: ['0.8125rem', { lineHeight: '1.125rem' }],
        base: ['0.9375rem', { lineHeight: '1.375rem' }],
        lg: ['1.0625rem', { lineHeight: '1.5rem' }],
        xl: ['1.125rem', { lineHeight: '1.625rem' }],
        '2xl': ['1.3125rem', { lineHeight: '1.75rem' }],
        '3xl': ['1.625rem', { lineHeight: '2rem' }],
      },
    },
  },
  plugins: [],
};
