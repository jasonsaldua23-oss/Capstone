import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import {
  Check,
  Eye,
  EyeOff,
  Leaf,
  Lock,
  Mail,
  Search,
  ShoppingCart,
} from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { MixedCaseBuilder } from "./src/components/MixedCaseBuilder";
import { CustomerTrackingMap } from "./src/components/CustomerTrackingMap";
import { AppHeader } from "./src/components/ui/app-header";
import { BottomNavigation } from "./src/components/ui/bottom-navigation";
import { ConfirmationModal } from "./src/components/ui/confirmation-modal";
import { InfoRow } from "./src/components/ui/info-row";
import { MenuRow } from "./src/components/ui/menu-row";
import { ModalShell } from "./src/components/ui/modal-shell";
import { SideNavigation } from "./src/components/ui/side-navigation";
import { StatusBadge } from "./src/components/ui/status-badge";
import { ToggleRow } from "./src/components/ui/toggle-row";
import {
  CUSTOMER_ORDER_REASONS,
  REPLACEMENT_REASONS,
  formatPeso,
  getAvailableQuantity,
  getOrderStageIndex,
  isOrderCancellable,
  isOrderTrackable,
  localDateInput,
} from "./src/lib/customer-logic";
import { formatDate, formatStatusLabel, resolveImageUrl } from "./src/lib/format";
import { getActiveNavId, type NavItemId } from "./src/components/ui/nav-items";
import { CustomerPortalProvider, useCustomerPortal, type CustomerTab } from "./src/portal/portal-context";
import { AuthScreen } from "./src/screens/auth/auth-screen";
import { PortalModals } from "./src/portal/portal-modals";
import { OrderDetailScreen } from "./src/screens/orders/order-detail-screen";
import { ReplacementDetailScreen } from "./src/screens/orders/replacement-detail-screen";
import { PurchaseRequestDetailScreen } from "./src/screens/purchase-requests/request-detail-screen";
import { HomeScreen } from "./src/screens/home/home-screen";
import { CartScreen, CartActionBar } from "./src/screens/cart/cart-screen";
import { CheckoutScreen, CheckoutActionBar } from "./src/screens/checkout/checkout-screen";
import { PurchaseRequestsScreen } from "./src/screens/purchase-requests/requests-screen";
import { OrdersScreen } from "./src/screens/orders/orders-screen";
import { TrackScreen } from "./src/screens/track/track-screen";
import { FeedbackScreen } from "./src/screens/feedback/feedback-screen";
import { ProfileScreen } from "./src/screens/profile/profile-screen";
import { EditAddressScreen } from "./src/screens/profile/edit-address-screen";
import { PasswordOtpScreen } from "./src/screens/profile/password-otp-screen";
import { styles } from "./src/styles/app-styles";
import { theme } from "./src/theme";

function CustomerPortalScreens() {
  const {
    fontsLoaded,
    width,
    currentRoute,
    cartUnitCount,
    resetToTab,
    isDesktop,
    booting,
    loading,
    refreshing,
    email,
    setEmail,
    password,
    setPassword,
    authMode,
    setAuthMode,
    showPassword,
    setShowPassword,
    forgotPasswordVisible,
    setForgotPasswordVisible,
    registration,
    setRegistration,
    emailOtp,
    setEmailOtp,
    emailVerificationToken,
    setEmailVerificationToken,
    sendingEmailOtp,
    verifyingEmailOtp,
    error,
    setError,
    rememberMe,
    setRememberMe,
    user,
    profile,
    products,
    orders,
    tracking,
    notifications,
    unreadNotifications,
    replacements,
    eligibleEmptyItems,
    emptyCasesByProductId,
    setEmptyCasesByProductId,
    recordingEmptyProductId,
    activeTab,
    setActiveTab,
    selectedOrderId,
    setSelectedOrderId,
    orderSearch,
    setOrderSearch,
    productSearch,
    setProductSearch,
    productCategory,
    setProductCategory,
    cardQuantityByProductId,
    setCardQuantityByProductId,
    addressSearch,
    setAddressSearch,
    addressSearchResults,
    searchingAddress,
    setFeedbackOrderId,
    feedbackItems,
    feedbackRatingValue,
    setFeedbackRatingValue,
    selectedFeedbackOptions,
    setSelectedFeedbackOptions,
    submittingFeedback,
    cart,
    mixedCart,
    selectedCartIds,
    setSelectedCartIds,
    notes,
    setNotes,
    deliveryDate,
    setDeliveryDate,
    mixedCaseBuilderVisible,
    editingMixedCase,
    placingOrder,
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
    screenOpacity,
    screenTranslateY,
    persistNotificationPreferences,
    refreshData,
    handleLogin,
    handleRequestRegistrationOtp,
    handleVerifyRegistrationOtp,
    handleRegister,
    handleLogout,
    updateCart,
    toggleCartSelection,
    removeMixedCartItem,
    openMixedCaseBuilder,
    closeMixedCaseBuilder,
    saveMixedCase,
    handlePlaceOrder,
    handleSaveProfile,
    confirmPendingCancellation,
    handleBuyAgain,
    handleShareReceipt,
    handlePickAvatar,
    handlePickReplacementEvidence,
    handleSubmitReplacement,
    handleSubmitFeedback,
    openProfileModal,
    handleMarkAllNotificationsRead,
    handleClearNotifications,
    handleNotificationPress,
    handleRecordEmptyCases,
    handleSearchAddress,
    selectAddressSearchResult,
    resetSecurityState,
    closeProfileModal,
    handleRequestOtp,
    handleVerifyOtp,
    handleChangePassword,
    selectedOrder,
    feedbackOrder,
    currentFeedback,
    visibleFeedbackOptions,
    cartItems,
    selectedStandardCartItems,
    selectedMixedCartItems,
    allCartTotal,
    selectedSubtotal,
    totalDiscount,
    selectedDepositCharged,
    checkoutTotal,
    cartLineCount,
    selectedCartLineCount,
    selectedTracking,
    categoryOptions,
    visibleProducts,
    purchaseRequests,
    customerInitials,
    profileAddress,
  } = useCustomerPortal();

  const activeNavId = getActiveNavId(activeTab, currentRoute);

  // Matches the web nav's handleNav: clear the open detail before switching destination.
  function handleNav(id: NavItemId) {
    setSelectedOrderId(null);
    resetToTab(id as CustomerTab);
  }

  if (booting || !fontsLoaded) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.emerald} />
        <Text style={styles.subtle}>Starting customer app...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      {!user ? (
        <AuthScreen />
      ) : activeProfileModal === "change-password-otp" ? (
        // Full screen, like registration's: no app header and no bottom nav over it.
        <PasswordOtpScreen />
      ) : (
        <View style={styles.flex}>
          <AppHeader
            title="AAB TRADING SHOP"
            subtitle="ANN ANN'S BEVERAGES TRADING"
            cartCount={cartUnitCount}
            isCartActive={activeTab === "cart"}
            onCartPress={() => resetToTab("cart")}
            unreadCount={unreadNotifications}
            onNotificationsPress={() => {
              // resetToTab clears any open section first, so select the tab before
              // asking for the list. openProfileModal also refreshes it.
              resetToTab("profile");
              openProfileModal("notification-list");
            }}
          />

          <View style={styles.portalBody}>
          {isDesktop ? <SideNavigation activeId={activeNavId} onSelect={handleNav} /> : null}
          <Animated.View style={[styles.flex, { opacity: screenOpacity, transform: [{ translateY: screenTranslateY }] }]}>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scrollContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshData(false, user.userId)} colors={[theme.colors.emerald]} tintColor={theme.colors.emerald} />}
            >
            {/* The banner used to be dead text. A customer who hit a stalled refresh
                was left looking at an empty catalog with no visible way back -
                pull-to-refresh is the only recovery and nothing on screen says so. */}
            {!!error && (
              <View style={styles.errorBannerRow}>
                <Text style={styles.errorBannerText}>{error}</Text>
                <Pressable
                  style={styles.errorBannerAction}
                  onPress={() => refreshData(false, user.userId)}
                  disabled={refreshing}
                  accessibilityRole="button"
                  accessibilityLabel="Try loading again"
                >
                  {refreshing ? (
                    <ActivityIndicator size="small" color="#991b1b" />
                  ) : (
                    <Text style={styles.errorBannerActionText}>Try again</Text>
                  )}
                </Pressable>
              </View>
            )}

            {currentRoute ? (
              <>
                {currentRoute.name === "order-detail" ? <OrderDetailScreen orderId={currentRoute.orderId} /> : null}
                {currentRoute.name === "purchase-request-detail" ? (
                  <PurchaseRequestDetailScreen orderId={currentRoute.orderId} />
                ) : null}
                {currentRoute.name === "replacement-detail" ? (
                  <ReplacementDetailScreen replacementId={currentRoute.replacementId} />
                ) : null}
                {currentRoute.name === "edit-address" ? <EditAddressScreen /> : null}
              </>
            ) : (
              <>
            {activeTab === "home" ? <HomeScreen /> : null}

            {activeTab === "cart" ? <CartScreen /> : null}

            {activeTab === "checkout" ? <CheckoutScreen /> : null}

            {activeTab === "requests" ? <PurchaseRequestsScreen /> : null}

            {activeTab === "orders" ? <OrdersScreen /> : null}

            {activeTab === "track" ? <TrackScreen /> : null}

            {activeTab === "feedback" ? <FeedbackScreen /> : null}

            {activeTab === "profile" ? <ProfileScreen /> : null}
              </>
            )}
            </ScrollView>

            {/* Pinned above the bottom nav, matching the web's sticky bars. */}
            {!currentRoute && activeTab === "cart" ? (
              <View style={isDesktop ? null : styles.pinnedBarOffset}>
                <CartActionBar />
              </View>
            ) : null}
            {!currentRoute && activeTab === "checkout" ? (
              <View style={isDesktop ? null : styles.pinnedBarOffset}>
                <CheckoutActionBar />
              </View>
            ) : null}
          </Animated.View>

          {!isDesktop ? <BottomNavigation activeId={activeNavId} onSelect={handleNav} /> : null}
          </View>

          <PortalModals />
        </View>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <CustomerPortalProvider>
      <CustomerPortalScreens />
    </CustomerPortalProvider>
  );
}
