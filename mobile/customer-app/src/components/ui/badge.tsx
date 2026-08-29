// Badge with the web portal's tone palette (theme.badge mirrors the Tailwind pairs).
import React from "react";
import { Text, View } from "react-native";

import { styles } from "../../styles/app-styles";
import { theme, type BadgeTone } from "../../theme";

export function Badge({ label, tone = "neutral" }: { label: string; tone?: BadgeTone }) {
  const palette = theme.badge[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.background }]}>
      <Text style={[styles.badgeText, { color: palette.text }]}>{label}</Text>
    </View>
  );
}
