// Mirrors the desktop sidebar in
// src/components/portals/customer/sections/layout/bottom-nav.tsx.
import { ClipboardList, Home, Package, User } from "lucide-react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";
import { NAV_ITEMS, type NavItemId } from "./nav-items";

export function SideNavigation({
  activeId,
  onSelect,
}: {
  activeId: NavItemId | null;
  onSelect: (id: NavItemId) => void;
}) {
  return (
    <View style={styles.sideNav}>
      {NAV_ITEMS.map((item) => {
        const active = item.id === activeId;
        const Icon =
          item.id === "home" ? Home : item.id === "requests" ? ClipboardList : item.id === "orders" ? Package : User;
        return (
          <Pressable
            key={item.id}
            style={[styles.sideNavItem, active ? styles.sideNavItemActive : null]}
            onPress={() => onSelect(item.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
          >
            <Icon size={16} color={active ? theme.colors.emeraldDark : theme.colors.textSubtle} />
            <Text style={[styles.sideNavLabel, active ? styles.sideNavLabelActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
