// Added: mobile design tokens mirror the customer web portal's customer-facing palette.
export const theme = {
  colors: {
    canvas: "#d7dce3",
    surface: "#ffffff",
    surfaceMuted: "#f5f8f6",
    surfaceSoft: "#f8fafc",
    border: "#e2e8f0",
    borderGreen: "#d1fae5",
    text: "#0f172a",
    textMuted: "#64748b",
    brandBlue: "#123e73",
    brandGreen: "#2f9a34",
    emerald: "#059669",
    emeraldDark: "#047857",
    emeraldSoft: "#ecfdf5",
    rose: "#f43f5e",
    roseSoft: "#fff1f2",
    amber: "#f59e0b",
    amberSoft: "#fffbeb",
    blueSoft: "#eff6ff",
    danger: "#dc2626",
    white: "#ffffff",
  },
  radius: {
    small: 8,
    medium: 12,
    large: 16,
    pill: 999,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  motion: {
    screenMs: 220,
    dialogMs: 220,
    addToCartMs: 240,
  },
} as const;

