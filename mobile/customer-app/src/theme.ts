import { boxShadow } from "./styles/shadow";

// Design tokens transcribed from the web customer portal
// (src/components/portals/customer/**). Screens must read from here rather than
// hardcoding values, so a change on the web side has exactly one place to land.
export const theme = {
  colors: {
    // Portal surfaces
    canvas: "#d7dce3",
    surface: "#ffffff",
    surfaceMuted: "#f5f8f6",
    surfaceSoft: "#f8fafc",
    surfaceTrack: "#f7faf8",
    surfaceField: "#f9fbfa",
    surfaceNav: "#edf0f4",
    surfaceWelcome: "#eaf8f1",
    surfaceProductTile: "#f3f8f3",
    surfaceProductPlaceholder: "#edf7ef",

    border: "#e2e8f0",
    borderGreen: "#d1fae5",
    borderRose: "#fecdd3",

    text: "#0f172a",
    textMuted: "#64748b",
    textBody: "#334155",
    textSubtle: "#475569",
    textFaint: "#94a3b8",

    // Brand
    brandBlue: "#123e73",
    brandGreen: "#2f9a34",
    trackStripBg: "#14532d",

    // Accents
    emerald: "#059669",
    emeraldDark: "#047857",
    emeraldSoft: "#ecfdf5",
    emeraldBorder: "#d1fae5",
    emeraldBright: "#10b981",
    emeraldLine: "#34d399",
    rose: "#f43f5e",
    roseSoft: "#fff1f2",
    roseText: "#be123c",
    amber: "#f59e0b",
    amberSoft: "#fffbeb",
    blueSoft: "#eff6ff",
    danger: "#dc2626",
    white: "#ffffff",

    // Neutral ramp (Tailwind slate), used by badges and dividers
    slate100: "#f1f5f9",
    slate200: "#e2e8f0",
    slate300: "#cbd5e1",
    slate500: "#64748b",
    slate600: "#475569",
    slate700: "#334155",
    slate900: "#0f172a",
  },

  // Badge palettes, keyed by the shared ReplacementTone plus the order-card badges.
  // Values mirror the Tailwind pairs used by the web portal one for one.
  badge: {
    neutral: { background: "#f1f5f9", text: "#334155" },
    muted: { background: "#f1f5f9", text: "#475569" },
    info: { background: "#dbeafe", text: "#1d4ed8" },
    success: { background: "#d1fae5", text: "#047857" },
    danger: { background: "#ffe4e6", text: "#be123c" },
    warning: { background: "#fef3c7", text: "#92400e" },
    accent: { background: "#e0f2fe", text: "#0369a1" },
    rescheduled: { background: "#fef3c7", text: "#b45309" },
    replacement: { background: "#dbeafe", text: "#1d4ed8" },
  },

  // Type scale. `phone` is the base; `desktop` is the md: step where the portal
  // changes size, applied when the layout is in its wide form.
  type: {
    wordmark: { phone: 20, desktop: 26, weight: "800" as const, letterSpacing: -0.5 },
    eyebrow: { phone: 8, desktop: 9, weight: "500" as const, letterSpacing: 1.15 },
    pageTitle: { phone: 24.8, desktop: 20, weight: "800" as const, letterSpacing: -0.5 },
    sectionTitle: { phone: 16, desktop: 16, weight: "600" as const },
    screenTitle: { phone: 20, desktop: 20, weight: "700" as const },
    orderNumber: { phone: 18, desktop: 18, weight: "600" as const, letterSpacing: -0.18 },
    productName: { phone: 16, desktop: 23.2, weight: "600" as const },
    productPrice: { phone: 15.2, desktop: 21.6, weight: "700" as const },
    productMeta: { phone: 11, desktop: 14, weight: "400" as const },
    body: { phone: 14, desktop: 14, weight: "400" as const },
    caption: { phone: 12, desktop: 12, weight: "400" as const },
    navLabel: { phone: 10, desktop: 14, weight: "500" as const },
    total: { phone: 24, desktop: 24, weight: "800" as const },
  },

  radius: {
    small: 8,
    medium: 12,
    large: 16,
    pill: 999,
    // Named to match the portal's Tailwind steps
    md: 6,
    lg: 8,
    xl: 12,
    xxl: 16,
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },

  // Product cards use a lifted shadow that darkens on hover; native has no hover,
  // so `raised` is the resting state and `lifted` is used for pressed/active cards.
  shadow: {
    raised: boxShadow({ color: "#101828", opacity: 0.08, radius: 20, offsetY: 8 }),
    lifted: boxShadow({ color: "#101828", opacity: 0.12, radius: 24, offsetY: 12 }),
  },

  motion: {
    screenMs: 220,
    dialogMs: 220,
    addToCartMs: 240,
  },
} as const;

export type BadgeTone = keyof typeof theme.badge;
