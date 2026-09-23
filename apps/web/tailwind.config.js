/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-be-vietnam-pro, "Be Vietnam Pro")', "Be Vietnam Pro", "sans-serif"],
        mono: ['var(--font-be-vietnam-pro, "Be Vietnam Pro")', "Be Vietnam Pro", "sans-serif"]
      }
    }
  },
  plugins: []
};
