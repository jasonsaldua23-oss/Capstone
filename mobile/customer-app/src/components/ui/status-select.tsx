// The Filter dialog's status <select> from CustomerPortal.tsx, as a native sheet.
import { ChevronDown } from "lucide-react-native";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

const OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "PROCESSING", label: "Processing" },
  { value: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function StatusSelect({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = OPTIONS.find((option) => option.value === value) || OPTIONS[0];

  return (
    <>
      <Pressable
        style={styles.categorySelect}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Order status filter"
        accessibilityValue={{ text: current.label }}
      >
        <Text style={styles.categorySelectText}>{current.label}</Text>
        <ChevronDown size={16} color={theme.colors.textMuted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.categorySheetOverlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.categorySheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.categorySheetTitle}>Order status filter</Text>
            <ScrollView>
              {OPTIONS.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.categorySheetOption, active ? styles.categorySheetOptionActive : null]}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.categorySheetOptionText, active ? styles.categorySheetOptionTextActive : null]}>
                      {option.label}
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
