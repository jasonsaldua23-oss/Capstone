// A generic <select> equivalent, following the same sheet-of-options pattern as
// CategorySelect. The Mixed Case screenshots present product size and case capacity
// as dropdowns rather than chips, and chips do not scale once a compatibility group
// has more than a couple of sizes.
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export type SelectOption<T> = { value: T; label: string };

type OptionSelectProps<T> = {
  value: T;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  placeholder?: string;
  title?: string;
  accessibilityLabel?: string;
};

export function OptionSelect<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = "Select",
  title,
  accessibilityLabel,
}: OptionSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <>
      <Pressable
        style={styles.optionSelectField}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
      >
        <Text style={current ? styles.optionSelectValue : styles.optionSelectPlaceholder} numberOfLines={1}>
          {current?.label || placeholder}
        </Text>
        <ChevronDown size={18} color={theme.colors.textSubtle} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.optionSelectBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.optionSelectSheet} onPress={(event) => event.stopPropagation()}>
            {title ? <Text style={styles.optionSelectSheetTitle}>{title}</Text> : null}
            <ScrollView bounces={false}>
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <Pressable
                    key={String(option.value)}
                    style={[styles.optionSelectRow, selected && styles.optionSelectRowActive]}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={selected ? styles.optionSelectRowTextActive : styles.optionSelectRowText}>
                      {option.label}
                    </Text>
                    {selected ? <Check size={16} color={theme.colors.emerald} /> : null}
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
