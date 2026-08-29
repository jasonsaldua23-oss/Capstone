// Extracted verbatim from App.tsx.
import React from "react";
import { Pressable, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";

export function MenuRow({
  icon,
  label,
  description,
  onPress,
  danger = false,
}: {
  icon: string;
  label: string;
  description: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <View style={[styles.menuIconWrap, danger ? styles.menuIconWrapDanger : null]}>
        <Text style={[styles.menuGlyph, danger ? styles.menuGlyphDanger : null]}>{icon}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={[styles.menuLabel, danger ? styles.menuLabelDanger : null]}>{label}</Text>
        <Text style={styles.menuDescription}>{description}</Text>
      </View>
      <Text style={[styles.chevronText, danger ? styles.menuGlyphDanger : null]}>{">"}</Text>
    </Pressable>
  );
}
