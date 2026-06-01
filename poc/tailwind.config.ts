/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Status colors mapped to task states
        status: {
          waiting:    "#9ca3af", // gray-400
          ready:      "#3b82f6", // blue-500
          claimed:    "#f59e0b", // amber-500
          progress:   "#f97316", // orange-500
          done:       "#10b981", // emerald-500
          failed:     "#ef4444", // red-500
          skipped:    "#a78bfa", // violet-400
          blocked:    "#7c3aed", // violet-600
          cancelled:  "#64748b", // slate-500
        },
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(59,130,246,0.6)" },
          "50%":      { boxShadow: "0 0 0 8px rgba(59,130,246,0)" },
        },
        shake: {
          "0%,100%": { transform: "translateX(0)" },
          "25%":     { transform: "translateX(-2px)" },
          "75%":     { transform: "translateX(2px)" },
        },
      },
      animation: {
        pulseGlow: "pulseGlow 1.8s ease-in-out infinite",
        shake:     "shake 0.4s ease-in-out 1",
      },
    },
  },
  plugins: [],
};
