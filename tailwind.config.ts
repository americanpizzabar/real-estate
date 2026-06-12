import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // プロツール向けのダーク・トレーディング系パレット
        base: {
          900: "#0b0f17",
          800: "#111827",
          700: "#1a2130",
          600: "#232c3d",
          500: "#2e3a4f",
        },
        accent: {
          DEFAULT: "#4f9cf9",
          green: "#2dd4a7",
          amber: "#f5b14c",
          red: "#f56c6c",
        },
      },
      fontFamily: {
        sans: ['"Inter"', '"Hiragino Sans"', '"Noto Sans JP"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"SFMono-Regular"', "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
