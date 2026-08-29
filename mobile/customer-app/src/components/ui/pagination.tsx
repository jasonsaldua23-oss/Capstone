// "Showing X to Y of N orders" with prev / current / next, matching the web lists.
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export function Pagination({
  startIndex,
  endIndex,
  total,
  currentPage,
  totalPages,
  onChange,
  noun = "orders",
}: {
  startIndex: number;
  endIndex: number;
  total: number;
  currentPage: number;
  totalPages: number;
  onChange: (next: number) => void;
  noun?: string;
}) {
  const atStart = currentPage <= 1;
  const atEnd = currentPage >= totalPages;
  return (
    <View style={styles.paginationRow}>
      <Text style={styles.paginationLabel}>
        Showing {startIndex} to {endIndex} of {total} {noun}
      </Text>
      <View style={styles.paginationControls}>
        <Pressable
          style={[styles.paginationButton, atStart ? styles.paginationButtonDisabled : null]}
          disabled={atStart}
          onPress={() => onChange(Math.max(1, currentPage - 1))}
          accessibilityRole="button"
          accessibilityLabel="Previous page"
        >
          <ChevronLeft size={16} color={theme.colors.textFaint} />
        </Pressable>
        <View style={styles.paginationCurrent} accessibilityLabel={`Current page ${currentPage}`}>
          <Text style={styles.paginationCurrentText}>{currentPage}</Text>
        </View>
        <Pressable
          style={[styles.paginationButton, atEnd ? styles.paginationButtonDisabled : null]}
          disabled={atEnd}
          onPress={() => onChange(Math.min(totalPages, currentPage + 1))}
          accessibilityRole="button"
          accessibilityLabel="Next page"
        >
          <ChevronRight size={16} color={theme.colors.textFaint} />
        </Pressable>
      </View>
    </View>
  );
}
