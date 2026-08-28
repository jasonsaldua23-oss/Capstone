/**
 * Design tokens matching the web driver portal (Tailwind + Shadcn UI)
 * Single source of truth for all visual styling in the Expo app.
 */

// ── Colours ──────────────────────────────────────────────────────
export const colors = {
  // Backgrounds
  bgMobile: '#dff0ea',
  bgDesktop: '#dceff0',
  bgSidebar: '#eff7fb',
  bgHeader: '#edf5fb',
  bgHomeDash: 'rgba(205, 228, 243, 0.85)',
  bgStatCard: '#f8f8f2',
  bgProfile: '#f8f9fa',
  bgNotifUnread: '#f4f8fc',
  bgWhite: '#ffffff',

  // Brand
  brandNavy: '#0f3d72',
  brandGreen: '#2f9a34',
  brandBlue: '#0d61ad',
  brandBlueHover: '#0b579c',
  bellBlue: '#0e5aa8',
  bellBlueHover: '#0d4f92',
  navInactive: '#0e4f92',

  // Text
  textHeading: '#0a1435',
  textTitle: '#0f172a',
  textSlate900: '#0f172a',
  textSlate800: '#1e293b',
  textSlate700: '#334155',
  textSlate600: '#475569',
  textSlate500: '#64748b',
  textSlate400: '#94a3b8',
  textSlate300: '#cbd5e1',
  textNavy: '#17365d',
  textSubtle: '#5f7390',
  textDashSubtitle: '#223c5d',
  textDashHeading: '#1f3558',
  textMetricLabel: '#1f4d79',
  textStatIcon: '#0f4f8f',

  // Status
  emerald700: '#047857',
  emerald800: '#065f46',
  emerald600: '#059669',
  sky700: '#0369a1',
  sky800: '#075985',
  red500: '#ef4444',
  red600: '#dc2626',

  // Borders
  borderSky200_70: 'rgba(186, 230, 253, 0.70)',
  borderSky100: '#e0f2fe',
  borderSlate200: '#e2e8f0',
  borderSlate200_70: 'rgba(226, 232, 240, 0.70)',
  borderSlate200_80: 'rgba(226, 232, 240, 0.80)',
  borderSlate100: '#f1f5f9',
  borderWhite70: 'rgba(255, 255, 255, 0.70)',
} as const;

// ── Border Radii ─────────────────────────────────────────────────
export const radii = {
  '3xl': 24,     // rounded-3xl
  '2xl': 16,     // rounded-2xl
  xl: 12,        // rounded-xl
  lg: 8,         // rounded-lg
  full: 9999,    // rounded-full
  homeDash: 25.6, // rounded-[1.6rem]
} as const;

// ── Shadows (RN equivalents of Tailwind box-shadows) ─────────────
export const shadows = {
  header: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  homeDash: {
    shadowColor: '#0e7490',
    shadowOpacity: 0.16,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  statCard: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  tripCard: {
    shadowColor: '#0284c7',
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  searchInput: {
    shadowColor: '#0284c7',
    shadowOpacity: 0.08,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  actionButton: {
    shadowColor: '#0284c7',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  profileCard: {
    shadowColor: '#000000',
    shadowOpacity: 0.015,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  historyCard: {
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  avatar: {
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;
