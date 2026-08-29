// Extracted from App.tsx during the Phase 0 split.
// Rewritten for web parity in the per-screen phases.
import React from "react";
import { Image, Text, View } from "react-native";
import { resolveImageUrl } from "../../lib/format";
import { InfoRow } from "../../components/ui/info-row";
import { MenuRow } from "../../components/ui/menu-row";
import { styles } from "../../styles/app-styles";
import { useCustomerPortal } from "../../portal/portal-context";

export function ProfileScreen() {
  const {
    email,
    password,
    user,
    profile,
    notifications,
    setConfirmLogoutVisible,
    openProfileModal,
    customerInitials,
    profileAddress,
  } = useCustomerPortal();

  // Screens only render inside the authenticated shell.
  if (!user) return null;

  return (
    <>
      <>
        <View style={styles.pageHeading}>
          <Text style={styles.profilePageTitle}>My Profile</Text>
          <Text style={styles.profilePageSubtitle}>Manage your customer details, address, notifications, and account security.</Text>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryAvatar}>
            {profile?.avatar || user.avatar ? <Image source={{ uri: resolveImageUrl(profile?.avatar || user.avatar) }} style={styles.summaryAvatarImage} /> : <Text style={styles.summaryAvatarText}>{customerInitials}</Text>}
          </View>
          <View style={styles.summaryContent}>
            <Text style={styles.summaryName}>{profile?.name || user.name || ""}</Text>
            <Text style={styles.summaryMeta}>{profile?.email || user.email || ""}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>Customer</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Customer Information</Text>
          <InfoRow label="Phone" value={profile?.phone || ""} />
          <InfoRow label="Email" value={profile?.email || user.email || ""} />
          <InfoRow label="Address" value={profileAddress} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Profile Navigation</Text>
          <MenuRow
            icon="EP"
            label="Edit Profile"
            description="Update your name and contact details."
            onPress={() => openProfileModal("edit")}
          />
          <MenuRow
            icon="AS"
            label="Account & Security"
            description="Change your password and secure your account."
            onPress={() => openProfileModal("security")}
          />
          <MenuRow
            icon="NT"
            label="Notifications"
            description="Manage order, delivery, and system alerts."
            onPress={() => openProfileModal("notifications")}
          />
          <MenuRow
            icon="AD"
            label="Address"
            description="View and update your saved delivery address."
            onPress={() => openProfileModal("address")}
          />
          <MenuRow
            icon="ED"
            label="Empties & Deposits"
            description="Review and record eligible returnable containers."
            onPress={() => openProfileModal("empties")}
          />
          <MenuRow
            icon="LO"
            label="Log Out"
            description="Sign out of the customer mobile app."
            onPress={() => setConfirmLogoutVisible(true)}
            danger
          />
        </View>
      </>
    </>
  );
}
