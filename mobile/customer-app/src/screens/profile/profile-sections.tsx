// Profile sub-pages: Edit Profile, Empties & Deposits, Account Security and
// Notification Settings.
//
// These used to be modals stacked over the profile tab. The web portal renders them
// as in-place sub-views instead (profile-view.tsx swaps a `subView` state between the
// menu and each section, with a back arrow in the header), so the app now does the
// same: the menu is replaced by the section, and Back returns to it. Nothing here
// floats over the tab any more.
import React from "react";
import { ArrowLeft, Bell, Check, ChevronRight, KeyRound, MapPin, Plus, ShieldCheck, X } from "lucide-react-native";
import { Image, Pressable, Switch, Text, TextInput, View } from "react-native";
import { EmptiesDeposits } from "../../components/ui/empties-deposits";
import { ToggleRow } from "../../components/ui/toggle-row";
import { composeShippingAddress, formatOtpCountdown, getPasswordRequirementState } from "../../lib/shared";
import { formatDate, resolveImageUrl } from "../../lib/format";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";
import { useCustomerPortal } from "../../portal/portal-context";

/** The section chrome: a back arrow and title above the section's own content. */
function ProfileSectionPage({
  title,
  subtitle,
  onBack,
  headerAction,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.profileSectionPage}>
      <View style={styles.profileSectionHeader}>
        <Pressable style={styles.profileSectionBack} onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back">
          <ArrowLeft size={20} color={theme.colors.slate700} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.profileSectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.profileSectionSubtitle}>{subtitle}</Text> : null}
        </View>
        {headerAction}
      </View>
      <View style={styles.profileSectionBody}>{children}</View>
    </View>
  );
}

/**
 * Renders whichever profile section is open, or null for the menu. The open section is
 * still tracked by `activeProfileModal` in the portal context, so every effect keyed to
 * it (the OTP countdown, the notification and empties fetches) is unchanged.
 */
export function ProfileSections() {
  const [editingSecurity, setEditingSecurity] = React.useState(false);
  const [recordEmptiesOpen, setRecordEmptiesOpen] = React.useState(false);
  const {
    user,
    profile,
    activeProfileModal,
    error,
    openProfileModal,
    closeProfileModal,
    pushRoute,
    profileForm,
    setProfileForm,
    addressForm,
    handlePickAvatar,
    uploadingAvatar,
    handleSaveProfile,
    savingProfile,
    securityForm,
    setSecurityForm,
    otpVerified,
    setOtpVerified,
    handleRequestOtp,
    sendingOtp,
    otpExpiry,
    otpResendCooldown,
    handleVerifyOtp,
    verifyingOtp,
    handleChangePassword,
    resettingPassword,
    twoFactorEnabled,
    loginAlertsEnabled,
    rememberDeviceEnabled,
    savingSecurity,
    saveSecuritySetting,
    persistRememberDevice,
    notifications,
    unreadNotifications,
    notificationPrefs,
    persistNotificationPreferences,
    handleMarkAllNotificationsRead,
    handleClearNotifications,
    handleNotificationPress,
  } = useCustomerPortal();

  // While a code is still valid this only opens the entry screen — asking for a new one
  // would restart the countdown the customer is already racing. A new code is requested
  // only when none is outstanding, and the screen opens only if one actually went out.
  const openCodeStep = async () => {
    if (otpExpiry > 0) {
      openProfileModal("change-password-otp");
      return;
    }
    const sent = await handleRequestOtp();
    if (sent) openProfileModal("change-password-otp");
  };


  if (activeProfileModal === "edit") {
    return (
    <ProfileSectionPage
      title="Edit Profile"
      onBack={closeProfileModal}
    >
        <View style={styles.avatarEditor}>
          <Image source={{ uri: resolveImageUrl(profileForm.avatar) }} style={styles.profileEditAvatarImage} />
          <Pressable style={styles.secondaryButtonCompact} onPress={handlePickAvatar} disabled={uploadingAvatar}>
            <Text style={styles.secondaryButtonText}>{uploadingAvatar ? "Uploading..." : "Change Avatar"}</Text>
          </Pressable>
        </View>

        <Text style={styles.addressFieldLabel}>First Name</Text>
        <TextInput
          style={styles.addressInput}
          value={profileForm.firstName || ""}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, firstName: value }))}
          placeholder="First name"
          placeholderTextColor={theme.colors.textFaint}
        />
        <Text style={styles.addressFieldLabel}>Middle Name</Text>
        <TextInput
          style={styles.addressInput}
          value={profileForm.middleName || ""}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, middleName: value }))}
          placeholder="Middle name"
          placeholderTextColor={theme.colors.textFaint}
        />
        <Text style={styles.addressFieldLabel}>Last Name</Text>
        <TextInput
          style={styles.addressInput}
          value={profileForm.lastName || ""}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, lastName: value }))}
          placeholder="Last name"
          placeholderTextColor={theme.colors.textFaint}
        />
        <Text style={styles.addressFieldLabel}>Suffix</Text>
        <TextInput
          style={styles.addressInput}
          value={profileForm.suffix || ""}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, suffix: value }))}
          placeholder="e.g. Jr., Sr., III"
          placeholderTextColor={theme.colors.textFaint}
        />
        <Text style={styles.addressFieldLabel}>Phone Number</Text>
        <TextInput
          style={styles.addressInput}
          value={profileForm.phone}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, phone: value }))}
          placeholder="09XX XXX XXXX"
          placeholderTextColor={theme.colors.textFaint}
          keyboardType="phone-pad"
        />
        <Text style={styles.addressFieldLabel}>Email Address</Text>
        <TextInput
          style={[styles.addressInput, styles.disabledInput]}
          value={profile?.email || user?.email || ""}
          editable={false}
          placeholder="Enter your email"
          placeholderTextColor={theme.colors.textFaint}
        />
        <View style={styles.deliveryAddressCard}>
          <Text style={styles.deliveryAddressLabel}>Delivery Address</Text>
          <Text style={styles.deliveryAddressValue}>
            {composeShippingAddress({
              houseNumber: addressForm.houseNumber,
              streetName: addressForm.streetName,
              subdivision: addressForm.subdivision,
              barangay: addressForm.barangay,
              city: addressForm.city || profileForm.city,
              province: addressForm.province || profileForm.province,
              zipCode: addressForm.zipCode || profileForm.zipCode,
            }) ||
              profileForm.address ||
              "Not set"}
          </Text>
          <Text style={styles.deliveryAddressMeta}>
            {addressForm.city || profileForm.city
              ? `${addressForm.city || profileForm.city}, ${addressForm.province || profileForm.province || "Negros Occidental"} ${addressForm.zipCode || profileForm.zipCode || ""}`.trim()
              : "City/Province not set"}
          </Text>
          <Pressable
            style={styles.deliveryAddressButton}
            onPress={() => {
              closeProfileModal();
              pushRoute({ name: "edit-address" });
            }}
            accessibilityRole="button"
          >
            <MapPin size={14} color="#14532d" />
            <Text style={styles.deliveryAddressButtonText}>Change Delivery Address</Text>
          </Pressable>
        </View>
        <View style={styles.modalActions}>
          <Pressable style={styles.modalGhostButton} onPress={closeProfileModal}>
            <Text style={styles.modalGhostButtonText}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.primaryButtonCompact} onPress={handleSaveProfile} disabled={savingProfile}>
            <Text style={styles.primaryButtonText}>{savingProfile ? "Saving..." : "Save Changes"}</Text>
          </Pressable>
        </View>
    </ProfileSectionPage>
    );
  }

  if (activeProfileModal === "empties") {
    return (
      <ProfileSectionPage
        title="Empties & Deposits"
        onBack={closeProfileModal}
        headerAction={
          <Pressable
            style={styles.emptiesHeaderButton}
            onPress={() => setRecordEmptiesOpen(true)}
            accessibilityRole="button"
          >
            <Plus size={14} color="#ffffff" />
            <Text style={styles.emptiesHeaderButtonText}>Record Empties</Text>
          </Pressable>
        }
      >
        <EmptiesDeposits recordOpen={recordEmptiesOpen} onRecordOpenChange={setRecordEmptiesOpen} />
      </ProfileSectionPage>
    );
  }

  // Account Security is a menu of two rows on the web (profile-view.tsx
  // `subView === 'account-security'`), not one long page. Change Password and Security
  // Settings each get their own sub-view, and Back from either returns here.
  if (activeProfileModal === "security") {
    return (
      <ProfileSectionPage title="Account Security" onBack={closeProfileModal}>
        <View style={styles.profileMenuCard}>
          <Pressable
            style={[styles.profileMenuRow, styles.profileMenuRowDivided]}
            onPress={() => openProfileModal("change-password")}
            accessibilityRole="button"
          >
            <KeyRound size={20} color="#14532d" />
            <View style={styles.flex}>
              <Text style={styles.profileMenuLabel}>Change Password</Text>
              <Text style={styles.profileMenuDescription}>Update your password with OTP verification</Text>
            </View>
            <ChevronRight size={20} color={theme.colors.slate300} />
          </Pressable>
          <Pressable
            style={styles.profileMenuRow}
            onPress={() => openProfileModal("security-settings")}
            accessibilityRole="button"
          >
            <ShieldCheck size={20} color="#14532d" />
            <View style={styles.flex}>
              <Text style={styles.profileMenuLabel}>Security Settings</Text>
              <Text style={styles.profileMenuDescription}>Configure 2FA login verification and security alerts</Text>
            </View>
            <ChevronRight size={20} color={theme.colors.slate300} />
          </Pressable>
        </View>
      </ProfileSectionPage>
    );
  }

  // Field order follows the web: new password and its checklist, then confirm, then the
  // verification card. The six-digit code is entered in a dialog there, not inline.
  if (activeProfileModal === "change-password") {
    return (
      <ProfileSectionPage title="Change Password" onBack={() => openProfileModal("security")}>
        <Text style={styles.addressFieldLabel}>New Password</Text>
        <TextInput
          style={styles.input}
          value={securityForm.newPassword}
          onChangeText={(value) => setSecurityForm((current) => ({ ...current, newPassword: value }))}
          placeholder="New password"
          placeholderTextColor={theme.colors.textFaint}
          secureTextEntry
        />
        <View style={styles.passwordRequirementsBox}>
          <Text style={styles.passwordRequirementsTitle}>Password Requirements</Text>
          <View style={styles.passwordRequirementsGrid}>
            {getPasswordRequirementState(securityForm.newPassword).map((rule) => (
              <View key={rule.label} style={styles.passwordRequirementRow}>
                {rule.met ? <Check size={12} color={theme.colors.emerald} /> : <X size={12} color="#dc2626" />}
                <Text style={rule.met ? styles.passwordRequirementMet : styles.passwordRequirementText}>
                  {rule.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <Text style={styles.addressFieldLabel}>Confirm Password</Text>
        <TextInput
          style={styles.input}
          value={securityForm.confirmPassword}
          onChangeText={(value) => setSecurityForm((current) => ({ ...current, confirmPassword: value }))}
          placeholder="Confirm password"
          placeholderTextColor={theme.colors.textFaint}
          secureTextEntry
        />

        <View style={styles.otpCard}>
          <Text style={styles.otpCardTitle}>Security Verification</Text>
          <Text style={styles.otpCardSubtitle}>OTP verification is required to change password.</Text>
          {otpVerified ? (
            <View style={styles.otpVerifiedRow}>
              <Check size={18} color={theme.colors.emerald} />
              <Text style={styles.otpVerifiedText}>OTP Verified Successfully</Text>
            </View>
          ) : (
            <Pressable
              style={styles.modalOutlineButton}
              onPress={() => void openCodeStep()}
              disabled={sendingOtp}
              accessibilityRole="button"
            >
              <Text style={styles.outlineButtonText}>
                {sendingOtp ? "Sending OTP..." : otpExpiry > 0 ? "Enter OTP" : "Request Verification OTP"}
              </Text>
            </Pressable>
          )}
        </View>

        <Pressable
          style={[styles.primaryButton, !otpVerified || resettingPassword ? styles.disabledButton : null]}
          onPress={handleChangePassword}
          disabled={!otpVerified || resettingPassword || !securityForm.newPassword || !securityForm.confirmPassword}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {resettingPassword ? "Updating Password..." : "Update Password"}
          </Text>
        </Pressable>

      </ProfileSectionPage>
    );
  }

  if (activeProfileModal === "security-settings") {
    return (
      <ProfileSectionPage title="Security Settings" onBack={() => openProfileModal("security")}>
        <View style={styles.securityToggleRow}>
          <View style={styles.flex}>
            <Text style={styles.securityToggleLabel}>Two-Factor Authentication (2FA)</Text>
            <Text style={styles.securityToggleHint}>
              Require a 6-digit OTP code when logging in to secure your account.
            </Text>
          </View>
          <Switch
            value={twoFactorEnabled}
            disabled={savingSecurity || !editingSecurity}
            onValueChange={(value) => void saveSecuritySetting("twoFactorEnabled", value)}
            trackColor={{ true: "#14532d", false: theme.colors.slate200 }}
            thumbColor={theme.colors.white}
          />
        </View>
        <View style={styles.securityToggleRow}>
          <View style={styles.flex}>
            <Text style={styles.securityToggleLabel}>Login Activity Alerts</Text>
            <Text style={styles.securityToggleHint}>
              Receive email notifications when your account is logged in from a new device.
            </Text>
          </View>
          <Switch
            value={loginAlertsEnabled}
            disabled={savingSecurity || !editingSecurity}
            onValueChange={(value) => void saveSecuritySetting("loginAlertsEnabled", value)}
            trackColor={{ true: "#14532d", false: theme.colors.slate200 }}
            thumbColor={theme.colors.white}
          />
        </View>
        <View style={styles.securityToggleRow}>
          <View style={styles.flex}>
            <Text style={styles.securityToggleLabel}>Remember Device Sessions</Text>
            <Text style={styles.securityToggleHint}>
              Keep trusted sessions active on your browser for faster access.
            </Text>
          </View>
          <Switch
            value={rememberDeviceEnabled}
            disabled={!editingSecurity}
            onValueChange={(value) => void persistRememberDevice(value)}
            trackColor={{ true: "#14532d", false: theme.colors.slate200 }}
            thumbColor={theme.colors.white}
          />
        </View>
        <Pressable
          style={[styles.primaryButton, !editingSecurity && styles.securityEditIdle]}
          onPress={() => setEditingSecurity((current) => !current)}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {editingSecurity ? "Save Security Settings" : "Edit Security Settings"}
          </Text>
        </Pressable>
      </ProfileSectionPage>
    );
  }

  // The web keeps these apart: the menu row opens Notification Settings (toggles only,
  // profile-view.tsx `subView === 'notifications'`) while the header bell opens the
  // Notifications list (`subView === 'real-notifications'`). They were one page here.
  if (activeProfileModal === "notification-list") {
    return (
      <ProfileSectionPage
        title="Notifications"
        onBack={closeProfileModal}
        headerAction={
          notifications.length > 0 ? (
            <View style={styles.profileSectionHeaderActions}>
              {unreadNotifications > 0 ? (
                <Pressable onPress={handleMarkAllNotificationsRead} accessibilityRole="button">
                  <Text style={styles.authLink}>Mark all read</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={handleClearNotifications} accessibilityRole="button">
                <Text style={styles.dangerLink}>Clear all</Text>
              </Pressable>
            </View>
          ) : null
        }
      >
        {notifications.length === 0 ? (
          <View style={styles.notificationsEmptyState}>
            <View style={styles.notificationsEmptyBadge}>
              <Bell size={28} color="#14532d" />
            </View>
            <Text style={styles.notificationsEmptyTitle}>All caught up!</Text>
            <Text style={styles.notificationsEmptyHint}>
              No new alerts right now. We will notify you when something important occurs.
            </Text>
          </View>
        ) : null}
        {notifications.map((notification) => (
          <Pressable key={notification.id} style={[styles.notificationCard, !notification.isRead ? styles.notificationUnread : null]} onPress={() => handleNotificationPress(notification)}>
            <Text style={styles.listTitle}>{notification.title || "Notification"}</Text>
            <Text style={styles.bodyText}>{notification.message}</Text>
            <Text style={styles.subtle}>{formatDate(notification.createdAt)}</Text>
          </Pressable>
        ))}
      </ProfileSectionPage>
    );
  }

  if (activeProfileModal === "notifications") {
    return (
      <ProfileSectionPage title="Notification Settings" onBack={closeProfileModal}>
        <ToggleRow
          label="Order Updates"
          description="Receive changes to request and order status."
          value={notificationPrefs.orderUpdates}
          onValueChange={(value) =>
            void persistNotificationPreferences({
              ...notificationPrefs,
              orderUpdates: value,
            })
          }
        />
        <ToggleRow
          label="Delivery Updates"
          description="Receive delivery and live tracking updates."
          value={notificationPrefs.deliveryUpdates}
          onValueChange={(value) =>
            void persistNotificationPreferences({
              ...notificationPrefs,
              deliveryUpdates: value,
            })
          }
        />
        <ToggleRow
          label="System Alerts"
          description="Receive important customer announcements."
          value={notificationPrefs.systemAlerts}
          onValueChange={(value) =>
            void persistNotificationPreferences({
              ...notificationPrefs,
              systemAlerts: value,
            })
          }
        />
      </ProfileSectionPage>
    );
  }

  return null;
}
