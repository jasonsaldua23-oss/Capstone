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
import { OrderDetailCard } from "./src/components/ui/order-detail-card";
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
import { CustomerPortalProvider, useCustomerPortal, type CustomerTab } from "./src/portal/portal-context";
import { AuthScreen } from "./src/screens/auth/auth-screen";
import { PortalModals } from "./src/portal/portal-modals";
import { HomeScreen } from "./src/screens/home/home-screen";
import { CartScreen } from "./src/screens/cart/cart-screen";
import { CheckoutScreen } from "./src/screens/checkout/checkout-screen";
import { PurchaseRequestsScreen } from "./src/screens/purchase-requests/requests-screen";
import { OrdersScreen } from "./src/screens/orders/orders-screen";
import { TrackScreen } from "./src/screens/track/track-screen";
import { FeedbackScreen } from "./src/screens/feedback/feedback-screen";
import { ProfileScreen } from "./src/screens/profile/profile-screen";
import { styles } from "./src/styles/app-styles";
import { theme } from "./src/theme";

function CustomerPortalScreens() {
  const {
    fontsLoaded,
    width,
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
    orderStatusFilter,
    setOrderStatusFilter,
    orderDateFrom,
    setOrderDateFrom,
    orderDateTo,
    setOrderDateTo,
    requestStatusFilter,
    setRequestStatusFilter,
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
    setActiveProfileModal,
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
    filteredRequests,
    filteredOrders,
    customerInitials,
    profileAddress,
  } = useCustomerPortal();

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
      ) : (
        <View style={styles.flex}>
          <AppHeader
            title="AAB TRADING SHOP"
            subtitle="ANN ANN'S BEVERAGES TRADING"
            cartCount={cartLineCount}
            onCartPress={() => setActiveTab("cart")}
            unreadCount={unreadNotifications}
            avatarUrl={profile?.avatar || user.avatar || null}
            onNotificationsPress={() => {
              setActiveProfileModal("notifications");
              setActiveTab("profile");
            }}
          />

          <View style={styles.portalBody}>
          {isDesktop ? <SideNavigation activeTab={activeTab} onSelect={(tab) => setActiveTab(tab as CustomerTab)} /> : null}
          <Animated.View style={[styles.flex, { opacity: screenOpacity, transform: [{ translateY: screenTranslateY }] }]}>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scrollContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshData(false, user.userId)} colors={[theme.colors.emerald]} tintColor={theme.colors.emerald} />}
            >
            {!!error && <Text style={styles.errorBanner}>{error}</Text>}

            {activeTab === "home" ? <HomeScreen /> : null}

            {activeTab === "cart" ? <CartScreen /> : null}

            {activeTab === "checkout" ? <CheckoutScreen /> : null}

            {activeTab === "requests" ? <PurchaseRequestsScreen /> : null}

            {activeTab === "orders" ? <OrdersScreen /> : null}

            {activeTab === "track" ? <TrackScreen /> : null}

            {activeTab === "feedback" ? <FeedbackScreen /> : null}

            {activeTab === "profile" ? <ProfileScreen /> : null}
            </ScrollView>
          </Animated.View>

          {!isDesktop ? <BottomNavigation
            items={[
              { id: "home", label: "Home", icon: "⌂" },
              { id: "requests", label: "Purchase Req.", icon: "▤" },
              { id: "orders", label: "Purchase Order", icon: "□" },
              { id: "profile", label: "Profile", icon: "○" },
            ]}
            activeTab={activeTab}
            onSelect={(tab) => setActiveTab(tab as CustomerTab)}
          /> : null}
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
