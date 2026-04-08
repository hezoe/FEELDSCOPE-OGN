/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI"', '"Meiryo"', '"Yu Gothic UI"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
