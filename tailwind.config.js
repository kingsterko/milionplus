/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0D0C",
        surface: "#111412",
        border: "#262B28",
        text: "#E8E6DD",
        muted: "#8A9088",
        green: "#3DFF7A",
        amber: "#FFB020",
        red: "#E23D28",
      },
      fontFamily: {
        display: ["Oswald", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
        sans: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
