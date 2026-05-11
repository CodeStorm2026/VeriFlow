/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      boxShadow: {
        glow: "0 0 30px rgba(14, 165, 164, 0.25)",
      },
    },
  },
  plugins: [],
};
