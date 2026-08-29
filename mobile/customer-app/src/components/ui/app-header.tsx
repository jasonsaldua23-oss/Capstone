// Mirrors src/components/portals/customer/sections/layout/portal-header.tsx.
// The web header carries only the wordmark, a cart button and a bell — no avatar.
import { Bell, ShoppingCart } from "lucide-react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export function AppHeader({
  title,
  subtitle,
  cartCount,
  isCartActive,
  onCartPress,
  unreadCount,
  onNotificationsPress,
}: {
  title: string;
  subtitle: string;
  cartCount: number;
  isCartActive: boolean;
  onCartPress: () => void;
  unreadCount: number;
  onNotificationsPress: () => void;
}) {
  return (
    <View style={styles.appHeader}>
      <View style={styles.logoWrap}>
        <View style={styles.flex}>
          <Text style={styles.headerEyebrow}>{subtitle}</Text>
          <Text style={styles.appHeaderTitle}>
            {title.replace(/\s+SHOP$/i, "")}
            <Text style={styles.appHeaderShop}> SHOP</Text>
          </Text>
        </View>
      </View>
      <View style={styles.headerActions}>
        <Pressable
          style={[styles.headerIconButton, isCartActive ? styles.headerIconButtonActive : null]}
          onPress={onCartPress}
          accessibilityRole="button"
          accessibilityLabel="Open cart"
        >
          <ShoppingCart
            size={20}
            color={isCartActive ? theme.colors.emeraldDark : theme.colors.textBody}
            strokeWidth={2}
          />
          {cartCount > 0 ? (
            <View style={styles.headerCartBadge}>
              <Text style={styles.headerCartBadgeText}>{cartCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          style={styles.headerIconButton}
          onPress={onNotificationsPress}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
        >
          <Bell size={20} color={theme.colors.textBody} strokeWidth={2} />
          {unreadCount > 0 ? (
            <View style={styles.headerNotificationBadge}>
              <Text style={styles.headerNotificationBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}
