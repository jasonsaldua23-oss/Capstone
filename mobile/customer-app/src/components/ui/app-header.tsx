// Extracted verbatim from App.tsx.
import { Bell, ShoppingCart } from "lucide-react-native";
import React from "react";
import { Image, Pressable, Text, View } from "react-native";

import { resolveImageUrl } from "../../lib/format";
import { styles } from "../../styles/app-styles";

export function AppHeader({
  title,
  subtitle,
  cartCount,
  onCartPress,
  unreadCount,
  avatarUrl,
  onNotificationsPress,
}: {
  title: string;
  subtitle: string;
  cartCount: number;
  onCartPress: () => void;
  unreadCount: number;
  avatarUrl?: string | null;
  onNotificationsPress: () => void;
}) {
  return (
    <View style={styles.appHeader}>
      <View style={styles.logoWrap}>
        <View style={styles.flex}>
          <Text style={styles.headerEyebrow}>{subtitle}</Text>
          <Text style={styles.appHeaderTitle}>{title.replace(/\s+SHOP$/i, "")}<Text style={styles.appHeaderShop}> SHOP</Text></Text>
        </View>
      </View>
      <View style={styles.headerActions}>
        <Pressable style={styles.headerCartButton} onPress={onCartPress}>
          <ShoppingCart size={20} color="#334155" strokeWidth={2} />
          <Text style={styles.headerGlyph}>🛒</Text>
          {cartCount > 0 ? (
            <View style={styles.headerCartBadge}>
              <Text style={styles.headerCartBadgeText}>{cartCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable style={styles.headerAvatar} onPress={onNotificationsPress} accessibilityLabel="Notifications">
          <Bell size={20} color="#334155" strokeWidth={2} />
          {avatarUrl ? <Image source={{ uri: resolveImageUrl(avatarUrl) }} style={styles.headerAvatarImage} /> : <Text style={styles.headerGlyph}>🔔</Text>}
          {unreadCount > 0 ? (
            <View style={styles.headerNotificationBadge}><Text style={styles.headerCartBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text></View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}
