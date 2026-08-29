// The web checkout uses <input type="date"> with a `min` of today, which on a phone
// opens the platform date picker. This is that control natively; on web the RN-Web
// build of the picker renders the same native input.
import { CalendarDays } from "lucide-react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

export function DateField({
  value,
  minimumDate,
  onChange,
  accessibilityLabel,
}: {
  value: string;
  minimumDate?: Date;
  onChange: (next: string) => void;
  accessibilityLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);

  return (
    <View>
      <Pressable
        style={styles.dateField}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || "Select date"}
        accessibilityValue={{ text: value }}
      >
        <Text style={value ? styles.dateFieldText : styles.dateFieldPlaceholder}>{value || "Select a date"}</Text>
        <CalendarDays size={16} color={theme.colors.slate500} />
      </Pressable>
      {open ? (
        <DateTimePicker
          value={selected}
          mode="date"
          minimumDate={minimumDate}
          // iOS keeps the picker inline until dismissed; Android closes on pick.
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={(event, nextDate) => {
            if (Platform.OS !== "ios") setOpen(false);
            if (event.type === "dismissed") return;
            if (nextDate) onChange(toIsoDate(nextDate));
          }}
        />
      ) : null}
      {open && Platform.OS === "ios" ? (
        <Pressable style={styles.dateFieldDone} onPress={() => setOpen(false)} accessibilityRole="button">
          <Text style={styles.dateFieldDoneText}>Done</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
