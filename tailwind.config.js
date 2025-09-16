/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './js/**/*.js',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#5E81AC', // Nord9 (light blue)
          dark: '#81A1C1',    // Nord10 (lighter blue for dark mode)
        },
        secondary: {
          DEFAULT: '#4C566A', // Nord3 (dark slate)
          dark: '#ECEFF4',    // Nord6 (light slate for dark mode)
        },
        accent: {
          DEFAULT: '#EBCB8B', // Nord13 (yellow)
          dark: '#D08770',    // Nord12 (orange for dark mode)
        },
        success: {
          DEFAULT: '#A3BE8C', // Nord14 (green)
          dark: '#8FBCBB',    // Nord7 (cyan-green for dark mode)
        },
        error: {
          DEFAULT: '#BF616A', // Nord11 (red)
          dark: '#B48EAD',    // Nord15 (purple-red for dark mode)
        }
      }
    }
  },
  plugins: [],
}