// Mirrors src/components/portals/customer/sections/profile/profile-view.tsx.
// The web menu is five titled rows plus Log Out, with no descriptions.
import { Bell, Camera, ChevronRight, CreditCard, LogOut, MapPin, PencilLine, Phone, ShieldCheck } from "lucide-react-native";
import React from "react";
import { Image, Pressable, Text, View } from "react-native";

import { getInitials, resolveImageUrl } from "../../lib/format";
import { useCustomerPortal } from "../../portal/portal-context";
import { ProfileSections } from "./profile-sections";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export function ProfileScreen() {
  const {
    user,
    profile,
    activeProfileModal,
    openProfileModal,
    setConfirmLogoutVisible,
    handlePickAvatar,
    uploadingAvatar,
    pushRoute,
  } = useCustomerPortal();

  // Screens only render inside the authenticated shell.
  if (!user) return null;

  // The web swaps the menu for the chosen section in place rather than opening a
  // dialog over it, so the app does the same. ("address" is a route of its own.)
  if (activeProfileModal && activeProfileModal !== "address") return <ProfileSections />;

  const avatarUrl = profile?.avatar || user.avatar || null;
  const fullName = String(profile?.name || user.name || "").trim();
  const nameDetails =
    [
      profile?.firstName,
      profile?.middleName ? `${String(profile.middleName).replace(/\.+$/, "").charAt(0).toUpperCase()}.` : "",
      profile?.lastName,
      profile?.suffix,
    ]
      .filter(Boolean)
      .join(" ") || "Name details not set";

  const menuItems = [
    { key: "edit", title: "Edit Profile", Icon: PencilLine, onPress: () => openProfileModal("edit") },
    { key: "empties", title: "Empties & Deposits", Icon: CreditCard, onPress: () => openProfileModal("empties") },
    { key: "security", title: "Account Security", Icon: ShieldCheck, onPress: () => openProfileModal("security") },
    { key: "notifications", title: "Notification Settings", Icon: Bell, onPress: () => openProfileModal("notifications") },
    { key: "address", title: "Address", Icon: MapPin, onPress: () => pushRoute({ name: "edit-address" }) },
  ];

  return (
    <View style={styles.profileSection}>
      <Text style={styles.profileHeading}>Profile</Text>

      <View style={styles.profileIdentityRow}>
        <View>
          <View style={styles.profileAvatar}>
            {avatarUrl ? (
              <Image source={{ uri: resolveImageUrl(avatarUrl) }} style={styles.profileAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.profileAvatarInitials}>{getInitials(fullName || "Customer")}</Text>
            )}
          </View>
          <Pressable
            style={styles.profileAvatarButton}
            onPress={handlePickAvatar}
            disabled={uploadingAvatar}
            accessibilityRole="button"
            accessibilityLabel="Upload profile photo"
          >
            <Camera size={14} color={theme.colors.white} />
          </Pressable>
        </View>
        <View style={styles.flex}>
          <Text style={styles.profileName} numberOfLines={1}>
            {fullName}
          </Text>
          <Text style={styles.profileMeta} numberOfLines={1}>
            {nameDetails}
          </Text>
          <Text style={styles.profileMeta} numberOfLines={1}>
            {profile?.email || user.email || ""}
          </Text>
          <View style={styles.profilePhoneChip}>
            <Phone size={12} color="#14532d" />
            <Text style={styles.profilePhoneChipText}>
              {profile?.phone || user.phone || "No phone number"}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.profileMenuCard}>
        {menuItems.map((item, index) => {
          const Icon = item.Icon;
          return (
            <Pressable
              key={item.key}
              style={[styles.profileMenuRow, index < menuItems.length - 1 ? styles.profileMenuRowDivided : null]}
              onPress={item.onPress}
              accessibilityRole="button"
            >
              <Icon size={20} color="#14532d" />
              <Text style={styles.profileMenuTitle}>{item.title}</Text>
              <ChevronRight size={20} color={theme.colors.slate300} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.profileLogoutCard}>
        <Pressable
          style={styles.profileMenuRow}
          onPress={() => setConfirmLogoutVisible(true)}
          accessibilityRole="button"
        >
          <LogOut size={20} color="#ef4444" />
          <Text style={styles.profileLogoutTitle}>Log Out</Text>
          <ChevronRight size={20} color={theme.colors.slate300} />
        </Pressable>
      </View>
    </View>
  );
}
