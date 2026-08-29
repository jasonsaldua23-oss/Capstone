// Extracted verbatim from App.tsx.
import React from "react";
import { Text, View } from "react-native";

import { formatStatusLabel } from "../../lib/format";
import { styles } from "../../styles/app-styles";

export function StatusBadge({ status }: { status?: string | null }) {
  const normalized = String(status || "PENDING").toUpperCase();
  const success = ["APPROVED", "DELIVERED", "COMPLETED", "RESOLVED"].includes(normalized);
  const danger = ["CANCELLED", "REJECTED", "FAILED"].includes(normalized);
  const active = ["PROCESSING", "PREPARING", "OUT_FOR_DELIVERY", "IN_TRANSIT"].includes(normalized);
  return (
    <View style={[styles.statusBadge, success ? styles.statusBadgeSuccess : danger ? styles.statusBadgeDanger : active ? styles.statusBadgeActive : null]}>
      <Text style={[styles.statusBadgeText, success ? styles.statusBadgeTextSuccess : danger ? styles.statusBadgeTextDanger : active ? styles.statusBadgeTextActive : null]}>
        {formatStatusLabel(normalized)}
      </Text>
    </View>
  );
}
