// Extracted verbatim from App.tsx.
import React from "react";
import { Switch, Text, View } from "react-native";

import { theme } from "../../theme";
import { styles } from "../../styles/app-styles";

export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flex}>
        <Text style={styles.listTitle}>{label}</Text>
        <Text style={styles.subtle}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: "#cbd5e1", true: theme.colors.emerald }} thumbColor="#ffffff" />
    </View>
  );
}
