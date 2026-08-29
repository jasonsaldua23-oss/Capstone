// Mirrors the mobile half of
// src/components/portals/customer/sections/layout/bottom-nav.tsx.
import { ClipboardList, Home, Package, User } from "lucide-react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";
import { NAV_ITEMS, type NavItemId } from "./nav-items";

export function BottomNavigation({
  activeId,
  onSelect,
}: {
  activeId: NavItemId | null;
  onSelect: (id: NavItemId) => void;
}) {
  return (
    <View style={styles.bottomNav}>
      {NAV_ITEMS.map((item) => {
        const active = item.id === activeId;
        const iconColor = active ? theme.colors.emeraldDark : theme.colors.textBody;
        const Icon =
          item.id === "home" ? Home : item.id === "requests" ? ClipboardList : item.id === "orders" ? Package : User;
        return (
          <Pressable
            key={item.id}
            style={[styles.bottomNavItem, active ? styles.bottomNavItemActive : null]}
            onPress={() => onSelect(item.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.shortLabel}
          >
            <Icon size={16} color={iconColor} />
            <Text style={[styles.bottomNavLabel, active ? styles.bottomNavLabelActive : null]}>{item.shortLabel}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
