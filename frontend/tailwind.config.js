/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // `brand` is the app's single primary/accent color token — every component uses
        // bg-brand-*/text-brand-*/ring-brand-* instead of a hardcoded color family. The actual
        // RGB values are CSS custom properties (see src/index.css) driven by the selected
        // accent theme (Purple by default) and swapped instantly via a `data-accent` attribute
        // on <html> — see src/context/ThemeContext.jsx. The `rgb(var(...) / <alpha-value>)`
        // pattern is what makes Tailwind's opacity modifiers (e.g. bg-brand-600/30) keep working.
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
        },
        // `ink` is the neutral scale. The values are CSS variables (src/index.css, adjusted by src/theme/personalization.css for the contrast levels), so Personalization can
        // strengthen text and borders without any component knowing about it. The defaults are the original slate colours.
        ink: {
          50: 'rgb(var(--ink-50) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          950: 'rgb(var(--ink-950) / <alpha-value>)',
        },
      },
      // Shadows and corner radii follow the Personalization choices: --shadow-scale (0 = none) multiplies every shadow's strength, --radius-scale multiplies every corner radius.
      boxShadow: {
        sm: '0 1px 2px 0 rgb(15 23 42 / calc(0.05 * var(--shadow-scale, 1)))',
        DEFAULT: '0 1px 3px 0 rgb(15 23 42 / calc(0.1 * var(--shadow-scale, 1))), 0 1px 2px -1px rgb(15 23 42 / calc(0.1 * var(--shadow-scale, 1)))',
        md: '0 4px 6px -1px rgb(15 23 42 / calc(0.1 * var(--shadow-scale, 1))), 0 2px 4px -2px rgb(15 23 42 / calc(0.1 * var(--shadow-scale, 1)))',
        lg: '0 10px 15px -3px rgb(15 23 42 / calc(0.1 * var(--shadow-scale, 1))), 0 4px 6px -4px rgb(15 23 42 / calc(0.1 * var(--shadow-scale, 1)))',
        xl: '0 20px 25px -5px rgb(15 23 42 / calc(0.1 * var(--shadow-scale, 1))), 0 8px 10px -6px rgb(15 23 42 / calc(0.1 * var(--shadow-scale, 1)))',
        '2xl': '0 25px 50px -12px rgb(15 23 42 / calc(0.25 * var(--shadow-scale, 1)))',
        card: '0 1px 2px 0 rgb(15 23 42 / calc(0.04 * var(--shadow-scale, 1))), 0 1px 3px 0 rgb(15 23 42 / calc(0.06 * var(--shadow-scale, 1)))',
        'card-hover': '0 4px 12px -2px rgb(15 23 42 / calc(0.08 * var(--shadow-scale, 1))), 0 2px 4px -2px rgb(15 23 42 / calc(0.05 * var(--shadow-scale, 1)))',
        popover: '0 12px 32px -4px rgb(15 23 42 / calc(0.14 * var(--shadow-scale, 1))), 0 4px 10px -4px rgb(15 23 42 / calc(0.08 * var(--shadow-scale, 1)))',
      },
      borderRadius: {
        sm: 'calc(0.125rem * var(--radius-scale, 1))',
        DEFAULT: 'calc(0.25rem * var(--radius-scale, 1))',
        md: 'calc(0.375rem * var(--radius-scale, 1))',
        lg: 'calc(0.5rem * var(--radius-scale, 1))',
        xl: 'calc(0.875rem * var(--radius-scale, 1))',
        '2xl': 'calc(1.125rem * var(--radius-scale, 1))',
        '3xl': 'calc(1.5rem * var(--radius-scale, 1))',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
        shimmer: 'shimmer 1.6s infinite linear',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideUp: { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '-700px 0' }, '100%': { backgroundPosition: '700px 0' } },
      },
    },
  },
  plugins: [],
}
