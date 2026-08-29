// Extracted verbatim from App.tsx.
import React from "react";
import { Text, View } from "react-native";

import { styles } from "../../styles/app-styles";

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}
