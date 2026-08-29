// The web catalog filters by category through a <select>. React Native has no
// native select, so this is the equivalent control: a field showing the current
// value that opens a sheet of options.
import { ChevronDown } from "lucide-react-native";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

function labelFor(category: string) {
  return category === "ALL" ? "All categories" : category;
}

export function CategorySelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        style={styles.categorySelect}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Filter by category"
        accessibilityValue={{ text: labelFor(value) }}
      >
        <Text style={styles.categorySelectText} numberOfLines={1}>
          {labelFor(value)}
        </Text>
        <ChevronDown size={16} color={theme.colors.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.categorySheetOverlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.categorySheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.categorySheetTitle}>Filter by category</Text>
            <ScrollView>
              {options.map((option) => {
                const active = option === value;
                return (
                  <Pressable
                    key={option}
                    style={[styles.categorySheetOption, active ? styles.categorySheetOptionActive : null]}
                    onPress={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[styles.categorySheetOptionText, active ? styles.categorySheetOptionTextActive : null]}
                    >
                      {labelFor(option)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
