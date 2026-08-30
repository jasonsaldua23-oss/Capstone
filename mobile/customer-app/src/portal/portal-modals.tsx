// Extracted from App.tsx during the Phase 0 split.
// Every dialog rendered above the authenticated shell.
import React from "react";
import { Check, MapPin, Search } from "lucide-react-native";
import { Image, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { CUSTOMER_ORDER_REASONS, REPLACEMENT_REASONS, formatPeso } from "../lib/customer-logic";
import { formatDate, resolveImageUrl } from "../lib/format";
import { InfoRow } from "../components/ui/info-row";
import { ToggleRow } from "../components/ui/toggle-row";
import { DateField } from "../components/ui/date-field";
import { EmptiesDeposits } from "../components/ui/empties-deposits";
import { ModalShell } from "../components/ui/modal-shell";
import { RatingDialog } from "../components/ui/rating-dialog";
import { ReceiptDialog } from "../components/ui/receipt-dialog";
import { ReplacementRequestForm } from "../components/ui/replacement-request-form";
import { StatusSelect } from "../components/ui/status-select";
import { ConfirmationModal } from "../components/ui/confirmation-modal";
import { MixedCaseBuilder } from "../components/MixedCaseBuilder";
import { OTHER_ORDER_REASON } from "../lib/customer-logic";
import { composeShippingAddress, formatOtpCountdown, getPasswordRequirementState } from "../lib/shared";
import { styles } from "../styles/app-styles";
import { theme } from "../theme";
import { useCustomerPortal } from "./portal-context";

export function PortalModals() {
  const {
    email,
    password,
    error,
    user,
    profile,
    products,
    notifications,
    unreadNotifications,
    eligibleEmptyItems,
    emptyCasesByProductId,
    setEmptyCasesByProductId,
    recordingEmptyProductId,
    addressSearch,
    setAddressSearch,
    addressSearchResults,
    searchingAddress,
    mixedCaseBuilderVisible,
    editingMixedCase,
    savingProfile,
    profileForm,
    setProfileForm,
    addressForm,
    pushRoute,
    activeProfileModal,
    confirmLogoutVisible,
    setConfirmLogoutVisible,
    pendingCancellationOrder,
    setPendingCancellationOrder,
    selectedCancellationReasons,
    setSelectedCancellationReasons,
    otherCancellationReason,
    setOtherCancellationReason,
    receiptOrder,
    setReceiptOrder,
    sharingReceipt,
    replacements,
    replacementOrder,
    setReplacementOrder,
    replacementEvidence,
    setReplacementEvidence,
    uploadingEvidence,
    submittingReplacement,
    uploadingAvatar,
    notificationPrefs,
    securityForm,
    setSecurityForm,
    sendingOtp,
    verifyingOtp,
    resettingPassword,
    otpVerified,
    setOtpVerified,
    otpExpiry,
    otpResendCooldown,
    persistNotificationPreferences,
    handleLogout,
    closeMixedCaseBuilder,
    saveMixedCase,
    handleSaveProfile,
    confirmPendingCancellation,
    handleShareReceipt,
    handlePickAvatar,
    handlePickReplacementEvidence,
    handleSubmitReplacement,
    handleMarkAllNotificationsRead,
    handleClearNotifications,
    handleNotificationPress,
    handleRecordEmptyCases,
    handleSearchAddress,
    selectAddressSearchResult,
    closeProfileModal,
    handleRequestOtp,
    handleVerifyOtp,
    handleChangePassword,
    orderConfirmationVisible,
    setOrderConfirmationVisible,
    lastPlacedOrderNumber,
    filterDialogVisible,
    setFilterDialogVisible,
    orderFilterStatus,
    setOrderFilterStatus,
    orderFilterDateFrom,
    setOrderFilterDateFrom,
    orderFilterDateTo,
    setOrderFilterDateTo,
    pendingCancelReplacement,
    setPendingCancelReplacement,
    cancellingReplacement,
    confirmCancelReplacement,
    twoFactorEnabled,
    loginAlertsEnabled,
    rememberDeviceEnabled,
    savingSecurity,
    saveSecuritySetting,
    persistRememberDevice,
  } = useCustomerPortal();

  return (
    <>
      <RatingDialog />
      <ReceiptDialog />

      <ConfirmationModal
        visible={Boolean(pendingCancelReplacement)}
        title="Cancel Replacement Request?"
        message={`Cancel ${pendingCancelReplacement?.replacementNumber || "this replacement request"}? This cannot be undone.`}
        confirmLabel={cancellingReplacement ? "Cancelling..." : "Cancel Replacement"}
        danger
        onCancel={() => setPendingCancelReplacement(null)}
        onConfirm={() => void confirmCancelReplacement()}
      />

      <ModalShell
        visible={filterDialogVisible}
        title="Filter Orders"
        subtitle="Refine the list by status and date range."
        onClose={() => setFilterDialogVisible(false)}
      >
        <Text style={styles.checkoutFieldLabel}>Status</Text>
        <StatusSelect value={orderFilterStatus} onChange={setOrderFilterStatus} />
        <Text style={styles.checkoutFieldLabel}>Date from</Text>
        <DateField value={orderFilterDateFrom} onChange={setOrderFilterDateFrom} accessibilityLabel="Date from" />
        <Text style={styles.checkoutFieldLabel}>Date to</Text>
        <DateField value={orderFilterDateTo} onChange={setOrderFilterDateTo} accessibilityLabel="Date to" />
        <View style={styles.modalActions}>
          <Pressable
            style={styles.modalGhostButton}
            onPress={() => {
              setOrderFilterStatus("ALL");
              setOrderFilterDateFrom("");
              setOrderFilterDateTo("");
            }}
          >
            <Text style={styles.modalGhostButtonText}>Clear</Text>
          </Pressable>
          <Pressable style={styles.primaryButtonCompact} onPress={() => setFilterDialogVisible(false)}>
            <Text style={styles.primaryButtonText}>Apply</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={orderConfirmationVisible}
        title="Purchase Request Submitted"
        subtitle={
          lastPlacedOrderNumber
            ? `Your purchase request ${lastPlacedOrderNumber} has been submitted and is currently pending review by warehouse staff.`
            : "Your purchase request has been submitted and is currently pending review by warehouse staff."
        }
        onClose={() => setOrderConfirmationVisible(false)}
      >
        <View style={styles.modalActions}>
          <Pressable style={styles.primaryButtonCompact} onPress={() => setOrderConfirmationVisible(false)}>
            <Text style={styles.primaryButtonText}>OK</Text>
          </Pressable>
        </View>
      </ModalShell>


      <ModalShell
        visible={activeProfileModal === "edit"}
        title="Edit Profile"
        onClose={closeProfileModal}
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
      </ModalShell>

      <ModalShell
        visible={activeProfileModal === "security"}
        title="Account Security"
        subtitle="Update your password with OTP verification"
        onClose={closeProfileModal}
      >
        <TextInput style={[styles.input, styles.disabledInput]} value={profile?.email || user?.email || ""} editable={false} placeholder="Email" />
        <View style={styles.otpCard}>
          <Text style={styles.otpCardTitle}>Security Verification</Text>
          <Text style={styles.otpCardSubtitle}>OTP verification is required to change password.</Text>
          <Text style={styles.otpCardSubtitle}>
            We sent a 6-digit verification code to{" "}
            <Text style={styles.otpCountdownValue}>{profile?.email || user?.email || "your email"}</Text>
          </Text>

          {otpVerified ? (
            <View style={styles.otpVerifiedRow}>
              <Check size={18} color={theme.colors.emerald} />
              <Text style={styles.otpVerifiedText}>OTP Verified Successfully</Text>
            </View>
          ) : (
            <>
              <View style={styles.inlineActionRow}>
                <TextInput
                  style={[styles.input, styles.inlineInput]}
                  value={securityForm.otp}
                  onChangeText={(value) => {
                    setSecurityForm((current) => ({ ...current, otp: value.replace(/\D/g, "").slice(0, 6) }));
                    setOtpVerified(false);
                  }}
                  keyboardType="number-pad"
                  placeholder="Enter Verification Code"
                  placeholderTextColor={theme.colors.textFaint}
                />
                <Pressable style={styles.secondaryButtonCompact} onPress={handleRequestOtp} disabled={sendingOtp}>
                  <Text style={styles.secondaryButtonText}>
                    {sendingOtp ? "Sending..." : "Send Verification OTP"}
                  </Text>
                </Pressable>
              </View>

              {otpExpiry > 0 ? (
                <Text style={styles.otpCountdown}>
                  Code expires in <Text style={styles.otpCountdownValue}>{formatOtpCountdown(otpExpiry)}</Text>
                </Text>
              ) : (
                <Text style={styles.otpExpired}>Verification code has expired.</Text>
              )}

              <Pressable
                style={[styles.modalOutlineButton, otpExpiry === 0 ? styles.disabledButton : null]}
                onPress={handleVerifyOtp}
                disabled={verifyingOtp || securityForm.otp.length < 6 || otpExpiry === 0}
              >
                <Text style={styles.outlineButtonText}>{verifyingOtp ? "Verifying Code..." : "Verify Code"}</Text>
              </Pressable>

              {otpResendCooldown > 0 ? (
                <Text style={styles.otpResendHint}>
                  Resend code in <Text style={styles.otpResendValue}>{otpResendCooldown}s</Text>
                </Text>
              ) : (
                <Pressable onPress={handleRequestOtp} disabled={sendingOtp} accessibilityRole="button">
                  <Text style={styles.otpResendLink}>Resend Code</Text>
                </Pressable>
              )}
            </>
          )}
        </View>

        <Text style={styles.addressFieldLabel}>New Password</Text>
        <TextInput
          style={styles.input}
          value={securityForm.newPassword}
          onChangeText={(value) => setSecurityForm((current) => ({ ...current, newPassword: value }))}
          placeholder="New password"
          secureTextEntry
        />
        <Text style={styles.addressFieldLabel}>Confirm Password</Text>
        <TextInput
          style={styles.input}
          value={securityForm.confirmPassword}
          onChangeText={(value) => setSecurityForm((current) => ({ ...current, confirmPassword: value }))}
          placeholder="Confirm password"
          secureTextEntry
        />
        <Text style={styles.modalHelpText}>
          OTP verification is required to change password.
        </Text>
        <View style={styles.modalActions}>
          <Pressable style={styles.modalGhostButton} onPress={closeProfileModal}>
            <Text style={styles.modalGhostButtonText}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.primaryButtonCompact} onPress={handleChangePassword} disabled={resettingPassword}>
            <Text style={styles.primaryButtonText}>{resettingPassword ? "Updating..." : "Change Password"}</Text>
          </Pressable>
        </View>

        <View style={styles.passwordRequirementsBox}>
          <Text style={styles.passwordRequirementsTitle}>Password Requirements</Text>
          <View style={styles.passwordRequirementsGrid}>
            {getPasswordRequirementState(securityForm.newPassword).map((rule) => (
              <View key={rule.label} style={styles.passwordRequirementRow}>
                {rule.met ? (
                  <Check size={12} color={theme.colors.emerald} />
                ) : (
                  <View style={styles.passwordRequirementDot} />
                )}
                <Text style={rule.met ? styles.passwordRequirementMet : styles.passwordRequirementText}>
                  {rule.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.securitySectionTitle}>Security Settings</Text>
        <View style={styles.securityToggleRow}>
          <View style={styles.flex}>
            <Text style={styles.securityToggleLabel}>Two-Factor Authentication (2FA)</Text>
            <Text style={styles.securityToggleHint}>
              Require a 6-digit OTP code when logging in to secure your account.
            </Text>
          </View>
          <Switch
            value={twoFactorEnabled}
            disabled={savingSecurity}
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
            disabled={savingSecurity}
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
            onValueChange={(value) => void persistRememberDevice(value)}
            trackColor={{ true: "#14532d", false: theme.colors.slate200 }}
            thumbColor={theme.colors.white}
          />
        </View>
      </ModalShell>

      <ModalShell
        visible={activeProfileModal === "notifications"}
        title="Notifications"
        subtitle="Notification Settings"
        onClose={closeProfileModal}
      >
        <View style={styles.sectionHeadingRow}>
          <Text style={styles.listTitle}>{unreadNotifications} unread</Text>
          <View style={styles.row}>
            <Pressable onPress={handleMarkAllNotificationsRead}><Text style={styles.authLink}>Mark all read</Text></Pressable>
            <Pressable onPress={handleClearNotifications}><Text style={styles.dangerLink}>Clear all</Text></Pressable>
          </View>
        </View>
        {notifications.length === 0 ? <Text style={styles.subtle}>All caught up! No notifications available.</Text> : null}
        {notifications.map((notification) => (
          <Pressable key={notification.id} style={[styles.notificationCard, !notification.isRead ? styles.notificationUnread : null]} onPress={() => handleNotificationPress(notification)}>
            <Text style={styles.listTitle}>{notification.title || "Notification"}</Text>
            <Text style={styles.bodyText}>{notification.message}</Text>
            <Text style={styles.subtle}>{formatDate(notification.createdAt)}</Text>
          </Pressable>
        ))}
        <Text style={styles.sectionTitle}>Notification Settings</Text>
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
      </ModalShell>

      <ModalShell
        visible={activeProfileModal === "empties"}
        title="Empties & Deposits"
        onClose={closeProfileModal}
      >
        <EmptiesDeposits />
      </ModalShell>

      
      
      <ModalShell
        visible={Boolean(replacementOrder)}
        title="Request Replacement"
        subtitle={`Report affected items from ${replacementOrder?.orderNumber || "this delivered order"}.`}
        onClose={() => {
          setReplacementOrder(null);
          setReplacementEvidence([]);
        }}
      >
        {replacementOrder ? (
          <ReplacementRequestForm
            order={replacementOrder}
            evidence={replacementEvidence}
            uploadingEvidence={uploadingEvidence}
            onPickEvidence={handlePickReplacementEvidence}
            onRemoveEvidence={(url) => setReplacementEvidence((current) => current.filter((item) => item !== url))}
            submitting={submittingReplacement}
            blockedMessage={
              replacements.some(
                (record) =>
                  record.orderId === replacementOrder.id || record.orderNumber === replacementOrder.orderNumber
              )
                ? "A replacement request is already in progress or completed for this order."
                : null
            }
            onSubmit={(built) => void handleSubmitReplacement(built)}
          />
        ) : null}
      </ModalShell>

      <ModalShell
        visible={Boolean(pendingCancellationOrder)}
        title="Cancel Order"
        subtitle={`Tell us why you are cancelling ${pendingCancellationOrder?.purchaseRequestNumber || pendingCancellationOrder?.orderNumber || "this order"}.`}
        onClose={() => {
          setPendingCancellationOrder(null);
          setSelectedCancellationReasons([]);
          setOtherCancellationReason("");
        }}
      >
        {CUSTOMER_ORDER_REASONS.map((reason) => {
          const selected = selectedCancellationReasons.includes(reason);
          return (
            <Pressable
              key={reason}
              style={[styles.reasonOption, selected ? styles.reasonOptionSelected : null]}
              onPress={() => setSelectedCancellationReasons((current) => selected ? current.filter((item) => item !== reason) : [...current, reason])}
            >
              <View style={[styles.checkbox, selected ? styles.checkboxChecked : null]}><Text style={styles.checkboxText}>{selected ? "✓" : ""}</Text></View>
              <Text style={styles.bodyText}>{reason}</Text>
            </Pressable>
          );
        })}
        {selectedCancellationReasons.includes(OTHER_ORDER_REASON) ? (
          <TextInput style={[styles.input, styles.multilineInput]} value={otherCancellationReason} onChangeText={setOtherCancellationReason} multiline placeholder="Type your reason" />
        ) : null}
        <Text style={styles.modalHelpText}>This action cannot be undone.</Text>
        <View style={styles.modalActions}>
          <Pressable style={styles.modalGhostButton} onPress={() => setPendingCancellationOrder(null)}><Text style={styles.modalGhostButtonText}>Keep Order</Text></Pressable>
          <Pressable style={[styles.primaryButtonCompact, styles.dangerButton]} onPress={confirmPendingCancellation}><Text style={styles.primaryButtonText}>Cancel Order</Text></Pressable>
        </View>
      </ModalShell>

      <ConfirmationModal
        visible={confirmLogoutVisible}
        title="Log Out Account?"
        message="Are you sure you want to log out of your account?"
        confirmLabel="Log Out"
        danger
        onCancel={() => setConfirmLogoutVisible(false)}
        onConfirm={() => {
          setConfirmLogoutVisible(false);
          void handleLogout();
        }}
      />
      <MixedCaseBuilder
        visible={mixedCaseBuilderVisible}
        products={products}
        editingItem={editingMixedCase}
        onClose={closeMixedCaseBuilder}
        onSave={saveMixedCase}
      />
    </>
  );
}
