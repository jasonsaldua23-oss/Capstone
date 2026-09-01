// The web driver portal picks the licence restriction from a <select>. React Native
// has no native select, so this is the equivalent control: a field showing the
// current value that opens a sheet of options.
//
// This matters beyond styling: the field used to be a free-text input, and the API
// rejects any restriction outside A, A1, B, B1, B2, C, D, BE and CE, so a typo was
// guaranteed to fail on save.
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function OptionSelect({
  value,
  options,
  onChange,
  placeholder = "Select an option",
  accessibilityLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <Pressable
        style={selectStyles.field}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || placeholder}
      >
        <Text style={selected ? selectStyles.value : selectStyles.placeholder}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#64748b" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={selectStyles.backdrop} onPress={() => setOpen(false)}>
          <View style={selectStyles.sheet}>
            <Text style={selectStyles.sheetTitle}>{placeholder}</Text>
            <ScrollView>
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    style={[selectStyles.option, active ? selectStyles.optionActive : null]}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                  >
                    <Text style={[selectStyles.optionText, active ? selectStyles.optionTextActive : null]}>
                      {option.label}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={16} color="#0369a1" /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const selectStyles = StyleSheet.create({
  field: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dbe3ef",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  value: { flex: 1, color: "#0f172a", fontSize: 14, fontFamily: "Poppins_500Medium" },
  placeholder: { flex: 1, color: "#94a3b8", fontSize: 14, fontFamily: "Poppins_400Regular" },
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "70%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 6,
  },
  sheetTitle: { color: "#0f172a", fontSize: 15, fontFamily: "Poppins_700Bold", marginBottom: 6 },
  option: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionActive: { backgroundColor: "#e0f2fe" },
  optionText: { color: "#334155", fontSize: 14, fontFamily: "Poppins_500Medium" },
  optionTextActive: { color: "#0369a1", fontFamily: "Poppins_600SemiBold" },
});

// Mirrors src/lib/driver-license-restrictions.ts; the API accepts only these codes.
export const DRIVER_LICENSE_RESTRICTIONS = [
  { value: "A", label: "A" },
  { value: "A1", label: "A1" },
  { value: "B", label: "B" },
  { value: "B1", label: "B1" },
  { value: "B2", label: "B2" },
  { value: "C", label: "C" },
  { value: "D", label: "D" },
  { value: "BE", label: "BE" },
  { value: "CE", label: "CE" },
];
