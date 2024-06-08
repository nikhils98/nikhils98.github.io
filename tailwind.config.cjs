/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        handwriting: ["Dancing Script", "Allison", "cursive"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
