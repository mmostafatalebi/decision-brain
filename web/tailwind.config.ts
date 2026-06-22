import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      colors: {
        bg: "var(--bg)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        tp: "var(--tp)",
        ts: "var(--ts)",
        tm: "var(--tm)",
        tg: "var(--tg)",
        em: "var(--em)",
        "em-deep": "var(--em-deep)",
        amber: "var(--amber)",
        rose: "var(--rose)",
        cyan: "var(--cyan)",
      },
      borderColor: {
        line: "var(--line)",
        "line-2": "var(--line-2)",
      },
    },
  },
  plugins: [],
} satisfies Config;
