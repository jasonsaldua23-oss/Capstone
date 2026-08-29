// Extracted verbatim from App.tsx.
import { ClipboardList, Home, Package, User } from "lucide-react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { theme } from "../../theme";
import { styles } from "../../styles/app-styles";

export function SideNavigation({ activeTab, onSelect }: { activeTab: string; onSelect: (tab: string) => void }) {
  const items = [
    { id: "home", label: "Home", icon: Home },
    { id: "requests", label: "Purchase Request", icon: ClipboardList },
    { id: "orders", label: "Purchase Order", icon: Package },
    { id: "profile", label: "Profile", icon: User },
  ];

  return (
    <View style={styles.sideNav}>
      {items.map((item) => {
        const active = item.id === activeTab;
        const Icon = item.icon;
        return (
          <Pressable key={item.id} style={[styles.sideNavItem, active ? styles.sideNavItemActive : null]} onPress={() => onSelect(item.id)}>
            <Icon size={17} color={active ? theme.colors.emeraldDark : "#475569"} />
            <Text style={[styles.sideNavLabel, active ? styles.sideNavLabelActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
