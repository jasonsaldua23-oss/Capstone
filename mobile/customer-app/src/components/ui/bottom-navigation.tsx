// Extracted verbatim from App.tsx.
import { ClipboardList, Home, Package, User } from "lucide-react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { theme } from "../../theme";
import { styles } from "../../styles/app-styles";

export function BottomNavigation({
  items,
  activeTab,
  onSelect,
}: {
  items: Array<{ id: string; label: string; icon?: string }>;
  activeTab: string;
  onSelect: (tab: string) => void;
}) {
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const active = item.id === activeTab;
        const iconColor = active ? theme.colors.emeraldDark : "#334155";
        const icon = item.id === "home"
          ? <Home size={17} color={iconColor} />
          : item.id === "requests"
            ? <ClipboardList size={17} color={iconColor} />
            : item.id === "orders"
              ? <Package size={17} color={iconColor} />
              : <User size={17} color={iconColor} />;
        return (
          <Pressable key={item.id} style={[styles.bottomNavItem, active ? styles.bottomNavItemActive : null]} onPress={() => onSelect(item.id)}>
            <View style={[styles.bottomNavIconWrap, active ? styles.bottomNavIconWrapActive : null]}>
              {icon}
              <Text style={[styles.bottomNavGlyph, active ? styles.bottomNavGlyphActive : null]}>{item.icon}</Text>
            </View>
            <Text style={[styles.bottomNavLabel, active ? styles.bottomNavLabelActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
