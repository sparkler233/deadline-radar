/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        panel: "0 18px 50px rgba(23, 31, 27, 0.08)"
      }
    }
  },
  plugins: []
};
