// react-native-web 0.21 deprecates the shadowColor / shadowOpacity / shadowRadius /
// shadowOffset props and warns once per StyleSheet.create that touches them, which is
// why loading app-styles.ts logged `"shadow*" style props are deprecated. Use
// "boxShadow"` on startup.
//
// React Native 0.86 implements boxShadow on iOS and Android as well as web, so this
// is a straight replacement rather than a web-only branch - no Platform.select, and
// no `elevation` alongside it (Android would otherwise paint both shadows).
//
// The blur radius maps 1:1 from the old shadowRadius, which is the same conversion
// react-native-web applied internally, so the rendered result is unchanged.

type ShadowSpec = {
  color: string;
  opacity: number;
  radius: number;
  offsetY: number;
  offsetX?: number;
};

function toRgba(hex: string, opacity: number): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value)) {
    // A non-hex colour (a named colour, or an rgb() string) cannot be given an alpha
    // channel by arithmetic. Fall back to the colour as authored rather than throwing
    // away the shadow entirely.
    return hex;
  }
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function boxShadow({ color, opacity, radius, offsetY, offsetX = 0 }: ShadowSpec): { boxShadow: string } {
  return { boxShadow: `${offsetX}px ${offsetY}px ${radius}px ${toRgba(color, opacity)}` };
}
