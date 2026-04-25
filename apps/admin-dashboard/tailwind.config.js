/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef9ff",
          100: "#d9f1ff",
          200: "#bce6ff",
          300: "#8ed6ff",
          400: "#58bbff",
          500: "#329dff",
          600: "#1c7df0",
          700: "#1865d0",
          800: "#1a55a8",
          900: "#1c4884",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
