/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Identidade Thera — tokens semânticos sobre variáveis CSS.
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        elevated: "rgb(var(--elevated) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        "fg-soft": "rgb(var(--fg-soft) / <alpha-value>)",
        primary: "rgb(var(--primary) / <alpha-value>)",
        "primary-fg": "rgb(var(--primary-fg) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "14px",
        md: "10px",
        sm: "7px",
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--primary) / 0.25), 0 8px 40px -12px rgb(var(--primary) / 0.45)",
        card: "0 1px 0 0 rgb(255 255 255 / 0.03) inset, 0 20px 50px -30px rgb(0 0 0 / 0.8)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseorb: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s cubic-bezier(0.22,1,0.36,1) both",
        pulseorb: "pulseorb 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
