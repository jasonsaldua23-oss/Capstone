// Extracted from App.tsx during the Phase 0 split.
// Every dialog rendered above the authenticated shell.
import React from "react";
import { Search } from "lucide-react-native";
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { CUSTOMER_ORDER_REASONS, REPLACEMENT_REASONS, formatPeso } from "../lib/customer-logic";
import { formatDate, resolveImageUrl } from "../lib/format";
import { InfoRow } from "../components/ui/info-row";
import { ToggleRow } from "../components/ui/toggle-row";
import { ModalShell } from "../components/ui/modal-shell";
import { ConfirmationModal } from "../components/ui/confirmation-modal";
import { MixedCaseBuilder } from "../components/MixedCaseBuilder";
import { styles } from "../styles/app-styles";
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
    replacementOrder,
    setReplacementOrder,
    replacementQuantities,
    setReplacementQuantities,
    replacementReasons,
    setReplacementReasons,
    replacementDescription,
    setReplacementDescription,
    replacementEvidence,
    setReplacementEvidence,
    uploadingEvidence,
    submittingReplacement,
    uploadingAvatar,
    welcomeVisible,
    setWelcomeVisible,
    notificationPrefs,
    securityForm,
    setSecurityForm,
    sendingOtp,
    verifyingOtp,
    resettingPassword,
    otpVerified,
    setOtpVerified,
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
  } = useCustomerPortal();

  return (
    <>
      <Modal visible={welcomeVisible} transparent animationType="fade" onRequestClose={() => setWelcomeVisible(false)}>
        <View style={styles.modalBackdropCentered}>
          <View style={styles.welcomeCard}>
            <View style={styles.welcomeIcon}><Text style={styles.welcomeIconText}>AAB</Text></View>
            <Text style={styles.profilePageTitle}>Welcome, {profile?.firstName || user?.name?.split(" ")[0] || "Customer"}!</Text>
            <Text style={styles.profilePageSubtitle}>You are signed in to AAB Trading Shop. Browse products or check your latest order.</Text>
            <Pressable style={styles.primaryButton} onPress={() => setWelcomeVisible(false)}><Text style={styles.primaryButtonText}>Start Shopping</Text></Pressable>
          </View>
        </View>
      </Modal>

      <ModalShell
        visible={activeProfileModal === "edit"}
        title="Edit Profile"
        subtitle="Update your basic customer information."
        onClose={closeProfileModal}
      >
        <View style={styles.avatarEditor}>
          <Image source={{ uri: resolveImageUrl(profileForm.avatar) }} style={styles.profileAvatarImage} />
          <Pressable style={styles.secondaryButtonCompact} onPress={handlePickAvatar} disabled={uploadingAvatar}>
            <Text style={styles.secondaryButtonText}>{uploadingAvatar ? "Uploading..." : "Change Photo"}</Text>
          </Pressable>
        </View>
        <View style={styles.row}>
          <TextInput style={[styles.input, styles.flexInput]} value={profileForm.firstName || ""} onChangeText={(value) => setProfileForm((current) => ({ ...current, firstName: value }))} placeholder="First name" />
          <TextInput style={[styles.input, styles.flexInput]} value={profileForm.lastName || ""} onChangeText={(value) => setProfileForm((current) => ({ ...current, lastName: value }))} placeholder="Last name" />
        </View>
        <View style={styles.row}>
          <TextInput style={[styles.input, styles.flexInput]} value={profileForm.middleName || ""} onChangeText={(value) => setProfileForm((current) => ({ ...current, middleName: value }))} placeholder="Middle name" />
          <TextInput style={[styles.input, styles.shortInput]} value={profileForm.suffix || ""} onChangeText={(value) => setProfileForm((current) => ({ ...current, suffix: value }))} placeholder="Suffix" />
        </View>
        <TextInput
          style={styles.input}
          value={profileForm.name}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, name: value }))}
          placeholder="Full name"
        />
        <TextInput
          style={styles.input}
          value={profileForm.phone}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, phone: value }))}
          placeholder="Phone"
        />
        <TextInput style={[styles.input, styles.disabledInput]} value={profile?.email || user?.email || ""} editable={false} placeholder="Email" />
        <Text style={styles.modalHelpText}>Address details are managed in the separate Address section.</Text>
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
        title="Account & Security"
        subtitle="Change your password using the OTP sent to your account email."
        onClose={closeProfileModal}
      >
        <TextInput style={[styles.input, styles.disabledInput]} value={profile?.email || user?.email || ""} editable={false} placeholder="Email" />
        <View style={styles.inlineActionRow}>
          <TextInput
            style={[styles.input, styles.inlineInput]}
            value={securityForm.otp}
            onChangeText={(value) => {
              setSecurityForm((current) => ({ ...current, otp: value }));
              setOtpVerified(false);
            }}
            placeholder="Enter OTP"
          />
          <Pressable style={styles.secondaryButtonCompact} onPress={handleRequestOtp} disabled={sendingOtp}>
            <Text style={styles.secondaryButtonText}>{sendingOtp ? "Sending..." : "Send OTP"}</Text>
          </Pressable>
        </View>
        <Pressable style={styles.modalOutlineButton} onPress={handleVerifyOtp} disabled={verifyingOtp || !securityForm.otp.trim()}>
          <Text style={styles.outlineButtonText}>{verifyingOtp ? "Verifying..." : otpVerified ? "OTP Verified" : "Verify OTP"}</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={securityForm.newPassword}
          onChangeText={(value) => setSecurityForm((current) => ({ ...current, newPassword: value }))}
          placeholder="New password"
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          value={securityForm.confirmPassword}
          onChangeText={(value) => setSecurityForm((current) => ({ ...current, confirmPassword: value }))}
          placeholder="Confirm password"
          secureTextEntry
        />
        <Text style={styles.modalHelpText}>
          Password must be at least 8 characters and include uppercase, lowercase, number, and special character, with no spaces.
        </Text>
        <View style={styles.modalActions}>
          <Pressable style={styles.modalGhostButton} onPress={closeProfileModal}>
            <Text style={styles.modalGhostButtonText}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.primaryButtonCompact} onPress={handleChangePassword} disabled={resettingPassword}>
            <Text style={styles.primaryButtonText}>{resettingPassword ? "Updating..." : "Change Password"}</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={activeProfileModal === "notifications"}
        title="Notifications"
        subtitle="Choose which customer alerts you want to receive."
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
          description="Get notified when your order status changes."
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
          description="Receive driver and delivery progress updates."
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
          description="Receive important customer system announcements."
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
        subtitle="Record eligible returnable containers from products you purchased."
        onClose={closeProfileModal}
      >
        {(profile?.bottleBalances || []).map((balance, index) => (
          <View key={`${balance.containerTypeId || "balance"}-${index}`} style={styles.notificationCard}>
            <Text style={styles.listTitle}>{balance.containerTypeName || "Returnable container"}</Text>
            <InfoRow label="Outstanding bottles" value={String(balance.bottlesOutstanding || 0)} />
            <InfoRow label="Deposit balance" value={formatPeso(Number(balance.depositBalance || 0))} />
          </View>
        ))}
        <Text style={styles.sectionTitle}>Available Empty Containers</Text>
        {eligibleEmptyItems.length === 0 ? <Text style={styles.subtle}>No eligible empty containers are available.</Text> : null}
        {eligibleEmptyItems.map((item) => {
          const cases = Math.max(1, emptyCasesByProductId[item.productId] || 1);
          return (
            <View key={item.productId} style={styles.notificationCard}>
              <Text style={styles.listTitle}>{item.productName}</Text>
              <Text style={styles.subtle}>Up to {item.availableCasesToReturn} case(s) · {item.containersPerCase} bottles/case</Text>
              <Text style={styles.subtle}>Deposit per case: {formatPeso(item.caseDeposit)}</Text>
              <View style={styles.sectionHeadingRow}>
                <View style={styles.qtyControls}>
                  <Pressable style={styles.qtyButton} onPress={() => setEmptyCasesByProductId((current) => ({ ...current, [item.productId]: Math.max(1, cases - 1) }))}><Text style={styles.qtyButtonText}>−</Text></Pressable>
                  <Text style={styles.qtyValue}>{cases}</Text>
                  <Pressable style={styles.qtyButton} onPress={() => setEmptyCasesByProductId((current) => ({ ...current, [item.productId]: Math.min(item.availableCasesToReturn, cases + 1) }))}><Text style={styles.qtyButtonText}>+</Text></Pressable>
                </View>
                <Pressable style={styles.primaryButtonCompact} onPress={() => handleRecordEmptyCases(item)} disabled={recordingEmptyProductId === item.productId}>
                  <Text style={styles.primaryButtonText}>{recordingEmptyProductId === item.productId ? "Recording..." : "Record Empties"}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ModalShell>

      <ModalShell
        visible={activeProfileModal === "address"}
        title="Address"
        subtitle="View and update your saved delivery address."
        onClose={closeProfileModal}
      >
        {/* Added: address search mirrors the web portal's Negros Occidental delivery-area lookup. */}
        <View style={styles.inlineActionRow}>
          <TextInput style={[styles.input, styles.inlineInput]} value={addressSearch} onChangeText={setAddressSearch} placeholder="Search address in Negros Occidental" />
          <Pressable style={styles.secondaryButtonCompact} onPress={handleSearchAddress} disabled={searchingAddress}>
            <Text style={styles.secondaryButtonText}>{searchingAddress ? "Searching..." : "Search"}</Text>
          </Pressable>
        </View>
        {addressSearchResults.map((result) => (
          <Pressable key={`${result.latitude}-${result.longitude}`} style={styles.searchResult} onPress={() => selectAddressSearchResult(result)}>
            <Text style={styles.bodyText}>{result.displayName}</Text>
          </Pressable>
        ))}
        <TextInput
          style={styles.input}
          value={profileForm.address}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, address: value }))}
          placeholder="Address"
        />
        <TextInput
          style={styles.input}
          value={profileForm.city}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, city: value }))}
          placeholder="City"
        />
        <TextInput
          style={styles.input}
          value={profileForm.province}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, province: value }))}
          placeholder="Province"
        />
        <TextInput
          style={styles.input}
          value={profileForm.zipCode}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, zipCode: value }))}
          placeholder="ZIP Code"
        />
        <TextInput
          style={styles.input}
          value={profileForm.latitude}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, latitude: value }))}
          placeholder="Latitude"
          keyboardType="decimal-pad"
        />
        <TextInput
          style={styles.input}
          value={profileForm.longitude}
          onChangeText={(value) => setProfileForm((current) => ({ ...current, longitude: value }))}
          placeholder="Longitude"
          keyboardType="decimal-pad"
        />
        <View style={styles.modalActions}>
          <Pressable style={styles.modalGhostButton} onPress={closeProfileModal}>
            <Text style={styles.modalGhostButtonText}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.primaryButtonCompact} onPress={handleSaveProfile} disabled={savingProfile}>
            <Text style={styles.primaryButtonText}>{savingProfile ? "Saving..." : "Save Address"}</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={Boolean(receiptOrder)}
        title="Receipt Preview"
        subtitle="Official delivery receipt from Ann Ann's Beverages Trading."
        onClose={() => setReceiptOrder(null)}
      >
        {receiptOrder ? (
          <>
            <View style={styles.receiptHeader}>
              <Text style={styles.featureTitle}>AAB TRADING SHOP</Text>
              <Text style={styles.subtle}>Receipt No. RCT-{receiptOrder.orderNumber}</Text>
            </View>
            <InfoRow label="Customer" value={receiptOrder.shippingName || profile?.name || user?.name || ""} />
            <InfoRow label="Order" value={receiptOrder.purchaseOrderNumber || receiptOrder.orderNumber} />
            <InfoRow label="Date" value={formatDate(receiptOrder.createdAt)} />
            {(receiptOrder.items || []).map((item) => (
              <View key={item.id} style={styles.cartRow}>
                <View style={styles.flex}><Text style={styles.listTitle}>{item.product?.name || (item.itemType === "MIXED_CASE" ? "Mixed Case" : "Product")}</Text><Text style={styles.subtle}>Qty {item.quantity}</Text></View>
                <Text style={styles.listTitle}>{formatPeso(Number(item.totalPrice || 0))}</Text>
              </View>
            ))}
            <View style={styles.summaryLine}><Text style={styles.sectionTitle}>Total</Text><Text style={styles.totalText}>{formatPeso(Number(receiptOrder.totalAmount || 0))}</Text></View>
            <Pressable style={styles.primaryButton} onPress={() => void handleShareReceipt(receiptOrder)} disabled={sharingReceipt}>
              <Text style={styles.primaryButtonText}>{sharingReceipt ? "Preparing PDF..." : "Download or Share Receipt"}</Text>
            </Pressable>
          </>
        ) : null}
      </ModalShell>

      <ModalShell
        visible={Boolean(replacementOrder)}
        title="Request Replacement"
        subtitle={`Report affected items from ${replacementOrder?.orderNumber || "this delivered order"}.`}
        onClose={() => {
          setReplacementOrder(null);
          setReplacementQuantities({});
          setReplacementReasons({});
          setReplacementDescription("");
          setReplacementEvidence([]);
        }}
      >
        {(replacementOrder?.items || []).map((item) => (
          <View key={item.id} style={styles.replacementLine}>
            <Text style={styles.listTitle}>{item.product?.name || (item.itemType === "MIXED_CASE" ? "Mixed Case" : "Product")}</Text>
            <Text style={styles.subtle}>Delivered quantity: {item.quantity}</Text>
            <TextInput
              style={styles.input}
              value={replacementQuantities[item.id] || ""}
              onChangeText={(value) => setReplacementQuantities((current) => ({ ...current, [item.id]: value.replace(/\D/g, "") }))}
              keyboardType="number-pad"
              placeholder="Quantity to replace"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {REPLACEMENT_REASONS.map((reason) => (
                <Pressable key={reason} style={[styles.chip, replacementReasons[item.id] === reason ? styles.chipActive : null]} onPress={() => setReplacementReasons((current) => ({ ...current, [item.id]: reason }))}>
                  <Text style={[styles.chipText, replacementReasons[item.id] === reason ? styles.chipTextActive : null]}>{reason}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ))}
        <TextInput style={[styles.input, styles.multilineInput]} value={replacementDescription} onChangeText={setReplacementDescription} multiline placeholder="Describe the issue" />
        <Pressable style={styles.secondaryButton} onPress={handlePickReplacementEvidence} disabled={uploadingEvidence || replacementEvidence.length >= 5}>
          <Text style={styles.secondaryButtonText}>{uploadingEvidence ? "Uploading..." : `Attach Evidence (${replacementEvidence.length}/5)`}</Text>
        </Pressable>
        <View style={styles.evidenceRow}>
          {replacementEvidence.map((url) => (
            <View key={url}>
              <Image source={{ uri: resolveImageUrl(url) }} style={styles.evidenceImage} />
              <Pressable style={styles.removeEvidenceButton} onPress={() => setReplacementEvidence((current) => current.filter((item) => item !== url))}><Text style={styles.removeEvidenceText}>X</Text></Pressable>
            </View>
          ))}
        </View>
        {!!error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={[styles.primaryButton, submittingReplacement ? styles.disabledButton : null]} onPress={handleSubmitReplacement} disabled={submittingReplacement}>
          <Text style={styles.primaryButtonText}>{submittingReplacement ? "Submitting..." : "Submit Replacement Request"}</Text>
        </Pressable>
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
        {selectedCancellationReasons.includes("Other") ? (
          <TextInput style={[styles.input, styles.multilineInput]} value={otherCancellationReason} onChangeText={setOtherCancellationReason} multiline placeholder="Enter your reason" />
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
