// The underlined tab row used by Purchase Orders and Purchase Requests
// (orders-view.tsx / purchase-request-view.tsx): icon + label, emerald underline
// when active, horizontally scrollable.
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export type TabOption<T extends string> = {
  id: T;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
};

export function TabBar<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<TabOption<T>>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
      {options.map((option) => {
        const active = option.id === value;
        const Icon = option.Icon;
        return (
          <Pressable
            key={option.id}
            style={[styles.tabItem, active ? styles.tabItemActive : null]}
            onPress={() => onChange(option.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <View style={styles.tabItemRow}>
              <Icon size={16} color={active ? theme.colors.emeraldDark : theme.colors.slate500} />
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{option.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
