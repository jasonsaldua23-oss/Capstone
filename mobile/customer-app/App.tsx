import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  cancelOrder,
  fetchAuthMe,
  fetchCustomerFeedback,
  fetchCustomerOrders,
  fetchCustomerProfile,
  fetchCustomerTracking,
  fetchProducts,
  getStoredUser,
  login,
  logout,
  placeOrder,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  submitCustomerFeedback,
  updateCustomerProfile,
  verifyPasswordResetOtp,
  type CustomerFeedbackItem,
  type CustomerProfileUpdateInput,
} from "./src/services/auth";
import { MixedCaseBuilder } from "./src/components/MixedCaseBuilder";
import type { CustomerOrder, CustomerProfile, CustomerTrackingItem, CustomerUser, MobileMixedCaseCartItem, Product } from "./src/types";

type CustomerTab = "home" | "cart" | "checkout" | "orders" | "track" | "feedback" | "profile";
type CustomerProfileModal = "edit" | "security" | "notifications" | "address" | null;

type CustomerNotificationPreferences = {
  orderUpdates: boolean;
  deliveryUpdates: boolean;
  systemAlerts: boolean;
};

const FEEDBACK_OPTIONS_BY_RATING: Record<number, string[]> = {
  1: ["Missing items", "Damaged unit", "Wrong order", "Poor driver attitude"],
  2: ["Packaging issue", "Incomplete order", "Hard to contact driver", "Item condition problem"],
  3: ["Minor packaging issue", "Communication could improve", "Acceptable service", "Minor inconvenience"],
  4: ["Friendly driver", "Good unit", "Accurate order", "Smooth transaction"],
  5: ["Professional driver", "Perfect packaging", "Complete order", "Great overall experience"],
};

const CUSTOMER_NOTIFICATION_PREFS_KEY = "customer_notification_preferences";

const initialProfileForm: CustomerProfileUpdateInput = {
  name: "",
  phone: "",
  address: "",
  city: "",
  province: "Negros Occidental",
  zipCode: "",
  latitude: "",
  longitude: "",
};

const initialSecurityForm = {
  otp: "",
  newPassword: "",
  confirmPassword: "",
};

const defaultNotificationPrefs: CustomerNotificationPreferences = {
  orderUpdates: true,
  deliveryUpdates: true,
  systemAlerts: true,
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState("customer@example.com");
  const [password, setPassword] = useState("customer123");
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [tracking, setTracking] = useState<CustomerTrackingItem[]>([]);
  const [activeTab, setActiveTab] = useState<CustomerTab>("home");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [feedbackOrderId, setFeedbackOrderId] = useState<string | null>(null);
  const [feedbackItems, setFeedbackItems] = useState<CustomerFeedbackItem[]>([]);
  const [feedbackRatingValue, setFeedbackRatingValue] = useState(5);
  const [selectedFeedbackOptions, setSelectedFeedbackOptions] = useState<string[]>([]);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [mixedCart, setMixedCart] = useState<MobileMixedCaseCartItem[]>([]);
  const [mixedCaseBuilderVisible, setMixedCaseBuilderVisible] = useState(false);
  const [editingMixedCase, setEditingMixedCase] = useState<MobileMixedCaseCartItem | null>(null);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<CustomerProfileUpdateInput>(initialProfileForm);
  const [activeProfileModal, setActiveProfileModal] = useState<CustomerProfileModal>(null);
  const [confirmLogoutVisible, setConfirmLogoutVisible] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<CustomerNotificationPreferences>(defaultNotificationPrefs);
  const [securityForm, setSecurityForm] = useState(initialSecurityForm);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const pendingCheckoutRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  useEffect(() => {
    (async () => {
      const stored = await getStoredUser();
      if (stored) {
        setUser(stored);
        await refreshData(false, stored.userId);
        await loadNotificationPreferences();
      }
      setBooting(false);
    })();
  }, []);

  function hydrateProfileForm(nextProfile: CustomerProfile) {
    setProfileForm({
      name: nextProfile.name || "",
      phone: nextProfile.phone || "",
      address: nextProfile.address || "",
      city: nextProfile.city || "",
      province: nextProfile.province || "Negros Occidental",
      zipCode: nextProfile.zipCode || "",
      latitude: nextProfile.latitude !== null && nextProfile.latitude !== undefined ? String(nextProfile.latitude) : "",
      longitude: nextProfile.longitude !== null && nextProfile.longitude !== undefined ? String(nextProfile.longitude) : "",
    });
  }

  async function loadNotificationPreferences() {
    try {
      const raw = await AsyncStorage.getItem(CUSTOMER_NOTIFICATION_PREFS_KEY);
      if (!raw) {
        setNotificationPrefs(defaultNotificationPrefs);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<CustomerNotificationPreferences>;
      setNotificationPrefs({
        orderUpdates: parsed.orderUpdates ?? true,
        deliveryUpdates: parsed.deliveryUpdates ?? true,
        systemAlerts: parsed.systemAlerts ?? true,
      });
    } catch {
      setNotificationPrefs(defaultNotificationPrefs);
    }
  }

  async function persistNotificationPreferences(nextPrefs: CustomerNotificationPreferences) {
    setNotificationPrefs(nextPrefs);
    await AsyncStorage.setItem(CUSTOMER_NOTIFICATION_PREFS_KEY, JSON.stringify(nextPrefs));
  }

  async function refreshData(showLoader = true, knownUserId?: string) {
    if (showLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const currentUser = await fetchAuthMe();
      const customerId = knownUserId || currentUser.userId;
      const [nextProfile, nextProducts, nextOrders, nextTracking] = await Promise.all([
        fetchCustomerProfile(customerId),
        fetchProducts(),
        fetchCustomerOrders(),
        fetchCustomerTracking(),
      ]);
      const nextFeedback = await fetchCustomerFeedback().catch(() => []);
      setUser(currentUser);
      setProfile(nextProfile);
      setProducts(nextProducts);
      setOrders(nextOrders);
      setTracking(nextTracking);
      setFeedbackItems(nextFeedback);
      hydrateProfileForm(nextProfile);
      if (!selectedOrderId && nextOrders.length > 0) {
        setSelectedOrderId(nextOrders[0].id);
      } else if (selectedOrderId && !nextOrders.some((order) => order.id === selectedOrderId)) {
        setSelectedOrderId(nextOrders[0]?.id || null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load customer data.");
    } finally {
      if (showLoader) setLoading(false);
      else setRefreshing(false);
    }
  }

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const loggedIn = await login(email.trim(), password, rememberMe);
      setUser(loggedIn);
      await refreshData(false, loggedIn.userId);
      await loadNotificationPreferences();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  function resetSessionState() {
    setUser(null);
    setProfile(null);
    setProducts([]);
    setOrders([]);
    setTracking([]);
    setCart({});
    setMixedCart([]);
    setMixedCaseBuilderVisible(false);
    setEditingMixedCase(null);
    pendingCheckoutRef.current = null;
    setActiveTab("home");
    setSelectedOrderId(null);
    setFeedbackOrderId(null);
    setProfileForm(initialProfileForm);
    setActiveProfileModal(null);
    setConfirmLogoutVisible(false);
    setNotificationPrefs(defaultNotificationPrefs);
    setSecurityForm(initialSecurityForm);
    setOtpVerified(false);
  }

  async function handleLogout() {
    setLoading(true);
    try {
      await logout();
      resetSessionState();
    } finally {
      setLoading(false);
    }
  }

  function updateCart(productId: string, nextQty: number) {
    setCart((current) => {
      const normalized = Math.max(0, nextQty);
      const nextCart = { ...current };
      if (normalized === 0) delete nextCart[productId];
      else nextCart[productId] = normalized;
      return nextCart;
    });
  }

  function openMixedCaseBuilder(item: MobileMixedCaseCartItem | null = null) {
    setEditingMixedCase(item);
    setMixedCaseBuilderVisible(true);
  }

  function closeMixedCaseBuilder() {
    setMixedCaseBuilderVisible(false);
    setEditingMixedCase(null);
  }

  function saveMixedCase(item: MobileMixedCaseCartItem) {
    setMixedCart((current) =>
      editingMixedCase
        ? current.map((entry) => (entry.id === editingMixedCase.id ? item : entry))
        : [...current, item]
    );
  }

  async function handlePlaceOrder() {
    if (!profile) return;
    const standardCartItems = Object.entries(cart)
      .map(([productId, quantity]) => {
        const product = products.find((entry) => entry.id === productId);
        if (!product || quantity <= 0) return null;
        return { itemType: "STANDARD_CASE" as const, productId, quantity };
      })
      .filter((item): item is { itemType: "STANDARD_CASE"; productId: string; quantity: number } => Boolean(item));
    const mixedCartItems = mixedCart.map((item) => ({
      itemType: "MIXED_CASE" as const,
      caseCapacity: item.caseCapacity,
      quantity: item.quantity,
      components: item.components.map((component) => ({ productId: component.productId, quantity: component.quantityPerCase })),
    }));
    const orderItems = [...standardCartItems, ...mixedCartItems];

    if (orderItems.length === 0) {
      setError("Add at least one product to the cart.");
      return;
    }

    const latitude = Number(profileForm.latitude);
    const longitude = Number(profileForm.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError("Enter valid latitude and longitude before checkout.");
      setActiveTab("profile");
      return;
    }

    setPlacingOrder(true);
    setError(null);
    try {
      const checkoutFingerprint = JSON.stringify({
        customerId: profile.userId,
        shippingAddress: profileForm.address,
        shippingCity: profileForm.city,
        shippingProvince: profileForm.province,
        shippingZipCode: profileForm.zipCode,
        shippingLatitude: latitude,
        shippingLongitude: longitude,
        items: orderItems,
      });
      if (pendingCheckoutRef.current?.fingerprint !== checkoutFingerprint) {
        pendingCheckoutRef.current = {
          fingerprint: checkoutFingerprint,
          requestId: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
      }
      await placeOrder({
        shippingAddress: profileForm.address,
        shippingCity: profileForm.city,
        shippingProvince: profileForm.province,
        shippingZipCode: profileForm.zipCode,
        shippingLatitude: latitude,
        shippingLongitude: longitude,
        requestId: pendingCheckoutRef.current.requestId,
        items: orderItems,
      });
      pendingCheckoutRef.current = null;
      setCart({});
      setMixedCart([]);
      await refreshData(false, profile.userId);
      setActiveTab("orders");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to place order.");
    } finally {
      setPlacingOrder(false);
    }
  }

  async function handleSaveProfile() {
    if (!user) return;
    setSavingProfile(true);
    setError(null);
    try {
      const nextProfile = await updateCustomerProfile(user.userId, profileForm);
      setProfile(nextProfile);
      setUser(nextProfile);
      hydrateProfileForm(nextProfile);
      setActiveProfileModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleCancelOrder(orderId: string) {
    setError(null);
    try {
      await cancelOrder(orderId);
      await refreshData(false, user?.userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel order.");
    }
  }

  async function handleSubmitFeedback() {
    if (!feedbackOrder) {
      setError("Select a delivered order to review.");
      return;
    }
    if (reviewedOrderIds.has(feedbackOrder.id)) {
      setError("You already rated this order.");
      return;
    }
    setSubmittingFeedback(true);
    setError(null);
    try {
      const overallRating = Math.max(1, Math.min(5, Math.round(feedbackRatingValue)));
      const selectedReasons = Array.from(new Set(selectedFeedbackOptions.map((item) => String(item || "").trim()).filter(Boolean)));
      const composedMessage = selectedReasons.map((reason) => `- ${reason}`).join("\n");
      await submitCustomerFeedback({
        orderId: feedbackOrder.id,
        rating: overallRating,
        type: overallRating <= 2 ? "COMPLAINT" : overallRating === 3 ? "SUGGESTION" : "COMPLIMENT",
        subject: `Order Review - ${feedbackOrder.orderNumber}`,
        message: composedMessage,
      });
      await refreshData(false, user?.userId);
      setSelectedFeedbackOptions([]);
      setFeedbackRatingValue(5);
      Alert.alert("Review Submitted", "Your feedback was submitted successfully.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit feedback.");
    } finally {
      setSubmittingFeedback(false);
    }
  }

  function openProfileModal(modal: Exclude<CustomerProfileModal, null>) {
    setError(null);
    setActiveProfileModal(modal);
  }

  function resetSecurityState() {
    setSecurityForm(initialSecurityForm);
    setOtpVerified(false);
  }

  function closeProfileModal() {
    setActiveProfileModal(null);
    resetSecurityState();
  }

  async function handleRequestOtp() {
    const accountEmail = (profile?.email || user?.email || "").trim();
    if (!accountEmail) {
      setError("No email is available for this customer account.");
      return;
    }
    setSendingOtp(true);
    setError(null);
    try {
      await requestPasswordResetOtp(accountEmail);
      Alert.alert("OTP Sent", "A verification code was sent to your email.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send OTP.");
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleVerifyOtp() {
    const accountEmail = (profile?.email || user?.email || "").trim();
    if (!securityForm.otp.trim()) {
      setError("Enter the OTP before verifying.");
      return;
    }
    setVerifyingOtp(true);
    setError(null);
    try {
      await verifyPasswordResetOtp(accountEmail, securityForm.otp.trim());
      setOtpVerified(true);
      Alert.alert("OTP Verified", "You can now update your password.");
    } catch (e) {
      setOtpVerified(false);
      setError(e instanceof Error ? e.message : "Failed to verify OTP.");
    } finally {
      setVerifyingOtp(false);
    }
  }

  async function handleChangePassword() {
    const accountEmail = (profile?.email || user?.email || "").trim();
    if (!securityForm.newPassword || !securityForm.confirmPassword || !securityForm.otp.trim()) {
      setError("Fill in the OTP, new password, and confirmation.");
      return;
    }
    if (securityForm.newPassword !== securityForm.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    const passwordError = validatePasswordPolicy(securityForm.newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (!otpVerified) {
      setError("Verify the OTP before changing your password.");
      return;
    }
    setResettingPassword(true);
    setError(null);
    try {
      await resetPasswordWithOtp(accountEmail, securityForm.otp.trim(), securityForm.newPassword);
      closeProfileModal();
      Alert.alert("Password Updated", "Your password was changed. Please log in again.");
      await handleLogout();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update password.");
    } finally {
      setResettingPassword(false);
    }
  }

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) || orders[0] || null,
    [orders, selectedOrderId]
  );
  const feedbackOrder = useMemo(
    () => orders.find((order) => order.id === feedbackOrderId) || null,
    [orders, feedbackOrderId]
  );
  const feedbackByOrderId = useMemo(
    () =>
      feedbackItems.reduce<Record<string, CustomerFeedbackItem>>((acc, item) => {
        if (!item.orderId) return acc;
        const existing = acc[item.orderId];
        const existingTime = new Date(existing?.createdAt || 0).getTime();
        const nextTime = new Date(item.createdAt || 0).getTime();
        if (!existing || nextTime >= existingTime) {
          acc[item.orderId] = item;
        }
        return acc;
      }, {}),
    [feedbackItems]
  );
  const reviewedOrderIds = useMemo(() => new Set(feedbackItems.map((item) => item.orderId).filter(Boolean)), [feedbackItems]);
  const currentFeedback = feedbackOrderId ? feedbackByOrderId[feedbackOrderId] || null : null;
  const visibleFeedbackOptions = useMemo(
    () => FEEDBACK_OPTIONS_BY_RATING[Math.max(1, Math.min(5, Math.round(feedbackRatingValue || 0)))] || [],
    [feedbackRatingValue]
  );

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([productId, quantity]) => {
          const product = products.find((entry) => entry.id === productId);
          if (!product || quantity <= 0) return null;
          return {
            product,
            quantity,
            total: quantity * Number(product.price || 0),
          };
        })
        .filter((item): item is { product: Product; quantity: number; total: number } => Boolean(item)),
    [cart, products]
  );

  const cartTotal = cartItems.reduce((sum, item) => sum + item.total, 0);
  const mixedCartTotal = mixedCart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const checkoutTotal = cartTotal + mixedCartTotal;
  const cartLineCount = cartItems.length + mixedCart.length;
  const deliveredOrders = useMemo(
    () => orders.filter((order) => String(order.status || "").toUpperCase() === "DELIVERED"),
    [orders]
  );
  const customerInitials = getInitials(profile?.name || user?.name || "Customer");
  const profileAddress = formatAddress(profileForm);

  if (booting) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#7c2d12" />
        <Text style={styles.subtle}>Starting customer app...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      {!user ? (
        <View style={styles.authShell}>
          <View style={styles.heroCard}>
            <Text style={styles.eyebrow}>Customer Mobile Portal</Text>
            <Text style={styles.title}>Shop, order, and track deliveries</Text>
            <Text style={styles.subtleOnDark}>
              Use the native customer app to place orders and monitor delivery status in one place.
            </Text>
          </View>
          <View style={styles.card}>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="Email" />
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" />
            <View style={styles.rememberRow}>
              <View style={styles.flex}>
                <Text style={styles.listTitle}>Keep me logged in</Text>
                <Text style={styles.subtle}>Stay signed in after closing the app.</Text>
              </View>
              <Switch value={rememberMe} onValueChange={setRememberMe} trackColor={{ false: "#d6d3d1", true: "#fdba74" }} thumbColor="#ffffff" />
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Pressable style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
              <Text style={styles.primaryButtonText}>{loading ? "Logging in..." : "Log In"}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.flex}>
          <AppHeader
            title="AAB TRADING SHOP"
            subtitle={activeTab === "profile" ? "Customer account profile" : `Orders: ${orders.length}`}
            cartCount={cartLineCount}
            onCartPress={() => setActiveTab("cart")}
          />

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshData(false, user.userId)} />}
          >
            {!!error && <Text style={styles.errorBanner}>{error}</Text>}

            {activeTab === "home" ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Product catalog</Text>
                  <Pressable style={styles.secondaryButton} onPress={() => openMixedCaseBuilder()}>
                    <Text style={styles.secondaryButtonText}>Build a Mixed Case</Text>
                  </Pressable>
                  {products.map((product) => {
                    const qty = cart[product.id] || 0;
                    return (
                      <View key={product.id} style={styles.listItem}>
                        <View style={styles.flex}>
                          <Text style={styles.listTitle}>{product.name}</Text>
                          <Text style={styles.subtle}>{product.sku}</Text>
                          <Text style={styles.subtle}>
                            PHP {Number(product.price || 0).toFixed(2)} | Available {product.availableQuantity ?? 0}
                          </Text>
                        </View>
                        <View style={styles.qtyControls}>
                          <Pressable style={styles.qtyButton} onPress={() => updateCart(product.id, qty - 1)}>
                            <Text style={styles.qtyButtonText}>-</Text>
                          </Pressable>
                          <Text style={styles.qtyValue}>{qty}</Text>
                          <Pressable style={styles.qtyButton} onPress={() => updateCart(product.id, qty + 1)}>
                            <Text style={styles.qtyButtonText}>+</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Cart summary</Text>
                  {cartLineCount === 0 ? <Text style={styles.subtle}>Your cart is empty.</Text> : null}
                  {cartItems.map((item) => (
                    <View key={item.product.id} style={styles.cartRow}>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>{item.product.name}</Text>
                        <Text style={styles.subtle}>Qty {item.quantity}</Text>
                      </View>
                      <Text style={styles.listTitle}>PHP {item.total.toFixed(2)}</Text>
                    </View>
                  ))}
                  {mixedCart.map((item) => (
                    <View key={item.id} style={styles.cartRow}>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>Mixed Case ({item.caseCapacity} units)</Text>
                        {item.components.map((component) => (
                          <Text key={component.id || component.productId} style={styles.subtle}>
                            {component.productName}: {component.quantityPerCase}/case · PHP {Number(component.componentSubtotal || 0).toFixed(2)} subtotal
                          </Text>
                        ))}
                        <Text style={styles.subtle}>Qty {item.quantity} case(s)</Text>
                      </View>
                      <Text style={styles.listTitle}>PHP {(item.unitPrice * item.quantity).toFixed(2)}</Text>
                    </View>
                  ))}
                  <Text style={styles.totalText}>Total: PHP {checkoutTotal.toFixed(2)}</Text>
                  <Text style={styles.subtle}>Review your cart and proceed to checkout from the next screen.</Text>
                  <Pressable style={styles.primaryButton} onPress={() => setActiveTab("cart")} disabled={cartLineCount === 0}>
                    <Text style={styles.primaryButtonText}>Open Cart</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {activeTab === "cart" ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>My cart</Text>
                  {cartLineCount === 0 ? <Text style={styles.subtle}>Your cart is empty.</Text> : null}
                  {cartItems.map((item) => (
                    <View key={item.product.id} style={styles.listItem}>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>{item.product.name}</Text>
                        <Text style={styles.subtle}>Qty {item.quantity}</Text>
                        <Text style={styles.subtle}>PHP {Number(item.product.price || 0).toFixed(2)} each</Text>
                      </View>
                      <View style={styles.qtyControls}>
                        <Pressable style={styles.qtyButton} onPress={() => updateCart(item.product.id, item.quantity - 1)}>
                          <Text style={styles.qtyButtonText}>-</Text>
                        </Pressable>
                        <Text style={styles.qtyValue}>{item.quantity}</Text>
                        <Pressable style={styles.qtyButton} onPress={() => updateCart(item.product.id, item.quantity + 1)}>
                          <Text style={styles.qtyButtonText}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                  {mixedCart.map((item) => (
                    <View key={item.id} style={styles.listItem}>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>Mixed Case ({item.caseCapacity} units)</Text>
                        {item.components.map((component) => (
                          <Text key={component.id || component.productId} style={styles.subtle}>
                            {component.productName}: {component.quantityPerCase}/case · PHP {Number(component.componentSubtotal || 0).toFixed(2)} subtotal
                          </Text>
                        ))}
                        <Text style={styles.subtle}>{item.quantity} case(s) · PHP {item.unitPrice.toFixed(2)} each</Text>
                      </View>
                      <View style={styles.cartActions}>
                        <Pressable style={styles.cartEditButton} onPress={() => openMixedCaseBuilder(item)}>
                          <Text style={styles.cartEditButtonText}>Edit</Text>
                        </Pressable>
                        <Pressable style={styles.qtyButton} onPress={() => setMixedCart((current) => current.filter((entry) => entry.id !== item.id))}>
                          <Text style={styles.qtyButtonText}>×</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Cart total</Text>
                  <Text style={styles.totalText}>PHP {checkoutTotal.toFixed(2)}</Text>
                  <Text style={styles.subtle}>Checkout uses the saved address from your profile.</Text>
                  <View style={styles.row}>
                    <Pressable style={styles.secondaryButton} onPress={() => setActiveTab("home")}>
                      <Text style={styles.secondaryButtonText}>Continue Shopping</Text>
                    </Pressable>
                    <Pressable style={styles.primaryButton} onPress={() => setActiveTab("checkout")} disabled={cartLineCount === 0}>
                      <Text style={styles.primaryButtonText}>Proceed to Checkout</Text>
                    </Pressable>
                  </View>
                </View>
              </>
            ) : null}

            {activeTab === "checkout" ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Checkout</Text>
                  {cartLineCount === 0 ? <Text style={styles.subtle}>Your cart is empty.</Text> : null}
                  {cartItems.map((item) => (
                    <View key={item.product.id} style={styles.cartRow}>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>{item.product.name}</Text>
                        <Text style={styles.subtle}>Qty {item.quantity}</Text>
                      </View>
                      <Text style={styles.listTitle}>PHP {item.total.toFixed(2)}</Text>
                    </View>
                  ))}
                  {mixedCart.map((item) => (
                    <View key={item.id} style={styles.cartRow}>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>Mixed Case ({item.caseCapacity} units)</Text>
                        {item.components.map((component) => (
                          <Text key={component.id || component.productId} style={styles.subtle}>
                            {component.productName}: {component.quantityPerCase}/case · PHP {Number(component.componentSubtotal || 0).toFixed(2)} subtotal
                          </Text>
                        ))}
                        <Text style={styles.subtle}>Qty {item.quantity} case(s)</Text>
                      </View>
                      <Text style={styles.listTitle}>PHP {(item.unitPrice * item.quantity).toFixed(2)}</Text>
                    </View>
                  ))}
                  <Text style={styles.totalText}>Total: PHP {checkoutTotal.toFixed(2)}</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Delivery address</Text>
                  <InfoRow label="Recipient" value={profile?.name || user.name || ""} />
                  <InfoRow label="Phone" value={profile?.phone || ""} />
                  <InfoRow label="Address" value={profileAddress} />
                  <View style={styles.row}>
                    <Pressable style={styles.secondaryButton} onPress={() => openProfileModal("address")}>
                      <Text style={styles.secondaryButtonText}>Edit Address</Text>
                    </Pressable>
                    <Pressable style={styles.primaryButton} onPress={handlePlaceOrder} disabled={placingOrder || cartLineCount === 0}>
                      <Text style={styles.primaryButtonText}>{placingOrder ? "Placing Order..." : "Place Order"}</Text>
                    </Pressable>
                  </View>
                </View>
              </>
            ) : null}

            {activeTab === "orders" ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>My orders</Text>
                  {orders.length === 0 ? <Text style={styles.subtle}>No orders yet.</Text> : null}
                  {orders.map((order) => (
                    <Pressable
                      key={order.id}
                      style={[styles.listItem, selectedOrder?.id === order.id ? styles.listItemSelected : null]}
                      onPress={() => setSelectedOrderId(order.id)}
                    >
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>{order.orderNumber}</Text>
                        <Text style={styles.subtle}>{order.status}</Text>
                      </View>
                      <Text style={styles.listTitle}>PHP {Number(order.totalAmount || 0).toFixed(2)}</Text>
                    </Pressable>
                  ))}
                </View>

                {selectedOrder ? (
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Order details</Text>
                    <Text style={styles.featureTitle}>{selectedOrder.orderNumber}</Text>
                    <Text style={styles.subtle}>Status: {selectedOrder.status}</Text>
                    <Text style={styles.subtle}>Created: {formatDate(selectedOrder.createdAt)}</Text>
                    {selectedOrder.shippingAddress ? <Text style={styles.bodyText}>{selectedOrder.shippingAddress}</Text> : null}
                    {(selectedOrder.items || []).map((item) => {
                      const isMixedCase = item.itemType === "MIXED_CASE";
                      return (
                        <View key={item.id} style={styles.cartRow}>
                          <View style={styles.flex}>
                            <Text style={styles.listTitle}>
                              {isMixedCase ? `Mixed Case (${item.caseCapacity || 0} units)` : item.product?.name || "Product"}
                            </Text>
                            <Text style={styles.subtle}>Qty {item.quantity}</Text>
                            {isMixedCase
                              ? (item.components || []).map((component) => (
                                  <Text key={component.id || component.productId} style={styles.subtle}>
                                    {component.productName}: {component.quantityPerCase}/case · PHP {Number(component.componentSubtotal || 0).toFixed(2)} subtotal
                                  </Text>
                                ))
                              : null}
                          </View>
                          <Text style={styles.listTitle}>PHP {Number(item.totalPrice || 0).toFixed(2)}</Text>
                        </View>
                      );
                    })}
                    <View style={styles.row}>
                      {selectedOrder.status === "PENDING" ? (
                        <Pressable style={styles.secondaryButton} onPress={() => handleCancelOrder(selectedOrder.id)}>
                          <Text style={styles.secondaryButtonText}>Cancel Order</Text>
                        </Pressable>
                      ) : null}
                      <Pressable style={styles.primaryButton} onPress={() => setActiveTab("track")}>
                        <Text style={styles.primaryButtonText}>Track Order</Text>
                      </Pressable>
                      {String(selectedOrder.status || "").toUpperCase() === "DELIVERED" ? (
                        <Pressable
                          style={styles.outlineActionButton}
                          onPress={() => {
                            setFeedbackOrderId(selectedOrder.id);
                            setFeedbackRatingValue(5);
                            setSelectedFeedbackOptions([]);
                            setActiveTab("feedback");
                          }}
                        >
                          <Text style={styles.outlineActionButtonText}>Feedback</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            {activeTab === "track" ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Delivery tracking</Text>
                {tracking.length === 0 ? <Text style={styles.subtle}>No tracking updates yet.</Text> : null}
                {tracking.map((item) => (
                  <View key={item.orderId} style={styles.trackCard}>
                    <Text style={styles.listTitle}>{item.orderNumber}</Text>
                    <Text style={styles.subtle}>Status: {item.orderStatus || item.status || ""}</Text>
                    {item.trip ? <Text style={styles.subtle}>Trip: {item.trip.tripNumber} | {item.trip.status}</Text> : null}
                    {item.etaMinutes ? <Text style={styles.subtle}>ETA: {item.etaMinutes} mins</Text> : null}
                    {item.latitude !== null && item.latitude !== undefined && item.longitude !== null && item.longitude !== undefined ? (
                      <Text style={styles.subtle}>
                        Driver GPS: {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
                      </Text>
                    ) : (
                      <Text style={styles.subtle}>No live GPS coordinates available.</Text>
                    )}
                    <Text style={styles.subtle}>Updated: {formatDate(item.updatedAt)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {activeTab === "feedback" ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Order feedback</Text>
                  {feedbackOrder ? (
                    <>
                      <Text style={styles.featureTitle}>{feedbackOrder.orderNumber}</Text>
                      <Text style={styles.subtle}>Status: {feedbackOrder.status}</Text>
                      {currentFeedback ? (
                        <View style={styles.feedbackHistoryCard}>
                          <Text style={styles.listTitle}>Submitted review</Text>
                          <Text style={styles.subtle}>Rating: {currentFeedback.rating}/5</Text>
                          <Text style={styles.bodyText}>{currentFeedback.message || "No feedback message."}</Text>
                          <Text style={styles.subtle}>Submitted: {formatDate(currentFeedback.createdAt)}</Text>
                        </View>
                      ) : (
                        <>
                          <Text style={styles.subtle}>Rate delivery, then select optional feedback reasons.</Text>
                          <View style={styles.ratingRow}>
                            {[1, 2, 3, 4, 5].map((value) => (
                              <Pressable
                                key={value}
                                style={[styles.ratingButton, feedbackRatingValue >= value ? styles.ratingButtonActive : null]}
                                onPress={() => {
                                  setFeedbackRatingValue(value);
                                  setSelectedFeedbackOptions([]);
                                }}
                              >
                                <Text style={[styles.ratingButtonText, feedbackRatingValue >= value ? styles.ratingButtonTextActive : null]}>
                                  {value}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                          <View style={styles.feedbackOptionsCard}>
                            {visibleFeedbackOptions.map((option) => {
                              const selected = selectedFeedbackOptions.includes(option);
                              return (
                                <Pressable
                                  key={option}
                                  style={[styles.feedbackOptionRow, selected ? styles.feedbackOptionRowActive : null]}
                                  onPress={() =>
                                    setSelectedFeedbackOptions((current) =>
                                      selected ? current.filter((item) => item !== option) : [...current, option]
                                    )
                                  }
                                >
                                  <Text style={[styles.feedbackOptionText, selected ? styles.feedbackOptionTextActive : null]}>{option}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          <Pressable style={styles.primaryButton} onPress={handleSubmitFeedback} disabled={submittingFeedback}>
                            <Text style={styles.primaryButtonText}>{submittingFeedback ? "Submitting..." : "Submit Review"}</Text>
                          </Pressable>
                        </>
                      )}
                    </>
                  ) : (
                    <Text style={styles.subtle}>Select a delivered order from Orders to open feedback.</Text>
                  )}
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Feedback history</Text>
                  {feedbackItems.length === 0 ? <Text style={styles.subtle}>No feedback submitted yet.</Text> : null}
                  {feedbackItems.map((item) => (
                    <View key={item.id} style={styles.feedbackHistoryCard}>
                      <Text style={styles.listTitle}>{item.subject || "Order Review"}</Text>
                      <Text style={styles.subtle}>Rating: {item.rating}/5</Text>
                      <Text style={styles.bodyText}>{item.message || "No feedback message."}</Text>
                      <Text style={styles.subtle}>Submitted: {formatDate(item.createdAt)}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {activeTab === "profile" ? (
              <>
                <View style={styles.pageHeading}>
                  <Text style={styles.profilePageTitle}>My Profile</Text>
                  <Text style={styles.profilePageSubtitle}>Manage your customer details, address, notifications, and account security.</Text>
                </View>

                <View style={styles.summaryCard}>
                  <View style={styles.summaryAvatar}>
                    <Text style={styles.summaryAvatarText}>{customerInitials}</Text>
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
                    icon="LO"
                    label="Log Out"
                    description="Sign out of the customer mobile app."
                    onPress={() => setConfirmLogoutVisible(true)}
                    danger
                  />
                </View>
              </>
            ) : null}
          </ScrollView>

          <BottomNavigation
            items={[
              { id: "home", label: "Home", icon: "HM" },
              { id: "orders", label: "Orders", icon: "OR" },
              { id: "track", label: "Track", icon: "TR" },
              { id: "profile", label: "Profile", icon: "PR" },
            ]}
            activeTab={activeTab}
            onSelect={(tab) => setActiveTab(tab as CustomerTab)}
          />

          <ModalShell
            visible={activeProfileModal === "edit"}
            title="Edit Profile"
            subtitle="Update your basic customer information."
            onClose={closeProfileModal}
          >
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
            visible={activeProfileModal === "address"}
            title="Address"
            subtitle="View and update your saved delivery address."
            onClose={closeProfileModal}
          >
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
        </View>
      )}
    </SafeAreaView>
  );
}

function AppHeader({
  title,
  subtitle,
  cartCount,
  onCartPress,
}: {
  title: string;
  subtitle: string;
  cartCount: number;
  onCartPress: () => void;
}) {
  return (
    <View style={styles.appHeader}>
      <View style={styles.logoWrap}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoBadgeText}>AAB</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.appHeaderTitle}>{title}</Text>
          <Text style={styles.subtle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.headerActions}>
        <Pressable style={styles.headerCartButton} onPress={onCartPress}>
          <Text style={styles.headerGlyph}>C</Text>
          {cartCount > 0 ? (
            <View style={styles.headerCartBadge}>
              <Text style={styles.headerCartBadgeText}>{cartCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerGlyph}>U</Text>
        </View>
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  description,
  onPress,
  danger = false,
}: {
  icon: string;
  label: string;
  description: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <View style={[styles.menuIconWrap, danger ? styles.menuIconWrapDanger : null]}>
        <Text style={[styles.menuGlyph, danger ? styles.menuGlyphDanger : null]}>{icon}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={[styles.menuLabel, danger ? styles.menuLabelDanger : null]}>{label}</Text>
        <Text style={styles.menuDescription}>{description}</Text>
      </View>
      <Text style={[styles.chevronText, danger ? styles.menuGlyphDanger : null]}>{">"}</Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flex}>
        <Text style={styles.listTitle}>{label}</Text>
        <Text style={styles.subtle}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: "#d6d3d1", true: "#fdba74" }} thumbColor="#ffffff" />
    </View>
  );
}

function ModalShell({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.flex}>
              <Text style={styles.modalTitle}>{title}</Text>
              <Text style={styles.subtle}>{subtitle}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.closeGlyph}>X</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ConfirmationModal({
  visible,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  danger = false,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  danger?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.confirmCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.subtle}>{message}</Text>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalGhostButton} onPress={onCancel}>
              <Text style={styles.modalGhostButtonText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.primaryButtonCompact, danger ? styles.dangerButton : null]} onPress={onConfirm}>
              <Text style={styles.primaryButtonText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function BottomNavigation({
  items,
  activeTab,
  onSelect,
}: {
  items: Array<{ id: string; label: string; icon: string }>;
  activeTab: string;
  onSelect: (tab: string) => void;
}) {
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const active = item.id === activeTab;
        return (
          <Pressable key={item.id} style={styles.bottomNavItem} onPress={() => onSelect(item.id)}>
            <View style={[styles.bottomNavIconWrap, active ? styles.bottomNavIconWrapActive : null]}>
              <Text style={[styles.bottomNavGlyph, active ? styles.bottomNavGlyphActive : null]}>{item.icon}</Text>
            </View>
            <Text style={[styles.bottomNavLabel, active ? styles.bottomNavLabelActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatAddress(form: CustomerProfileUpdateInput) {
  return [form.address, form.city, form.province, form.zipCode].filter((value) => value && value.trim()).join(", ");
}

function validatePasswordPolicy(nextPassword: string) {
  if (nextPassword.length < 8) return "Password must be at least 8 characters long.";
  if (/\s/.test(nextPassword)) return "Password cannot contain spaces.";
  if (!/[A-Z]/.test(nextPassword)) return "Password must include at least one uppercase letter.";
  if (!/[a-z]/.test(nextPassword)) return "Password must include at least one lowercase letter.";
  if (!/\d/.test(nextPassword)) return "Password must include at least one number.";
  if (!/[^A-Za-z0-9\s]/.test(nextPassword)) return "Password must include at least one special character.";
  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5efe5" },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#f5efe5" },
  authShell: { flex: 1, padding: 20, justifyContent: "center", gap: 16 },
  heroCard: {
    backgroundColor: "#7c2d12",
    borderRadius: 28,
    padding: 22,
    gap: 8,
  },
  appHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
  },
  logoWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  logoBadge: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#7c2d12",
    alignItems: "center",
    justifyContent: "center",
  },
  logoBadgeText: { color: "#fff7ed", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  appHeaderTitle: { color: "#7c2d12", fontSize: 16, fontWeight: "800", letterSpacing: 0.4 },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerCartButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#fffdf8",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7c2d12",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  headerCartBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  headerCartBadgeText: {
    color: "#fffdf8",
    fontSize: 10,
    fontWeight: "800",
  },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#fffdf8",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7c2d12",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  headerGlyph: { color: "#7c2d12", fontSize: 14, fontWeight: "800" },
  eyebrow: { color: "#fdba74", fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#fff7ed", fontSize: 28, fontWeight: "800" },
  subtle: { color: "#78716c", fontSize: 14 },
  subtleOnDark: { color: "#fed7aa", fontSize: 14, lineHeight: 20 },
  bodyText: { color: "#44403c", fontSize: 14, lineHeight: 20 },
  pageHeading: {
    paddingHorizontal: 18,
    gap: 6,
  },
  profilePageTitle: { fontSize: 28, fontWeight: "800", color: "#7c2d12" },
  profilePageSubtitle: { fontSize: 14, color: "#78716c", lineHeight: 20 },
  card: {
    backgroundColor: "#fffdf8",
    borderRadius: 24,
    marginHorizontal: 16,
    padding: 16,
    gap: 12,
    shadowColor: "#7c2d12",
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  summaryCard: {
    backgroundColor: "#fffdf8",
    borderRadius: 24,
    marginHorizontal: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "#7c2d12",
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  summaryAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#ffedd5",
    alignItems: "center",
    justifyContent: "center",
  },
  summaryAvatarText: { color: "#c2410c", fontSize: 26, fontWeight: "800" },
  summaryContent: { flex: 1, gap: 6 },
  summaryName: { fontSize: 21, fontWeight: "800", color: "#7c2d12" },
  summaryMeta: { fontSize: 14, color: "#57534e" },
  roleBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#fed7aa",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  roleBadgeText: { color: "#9a3412", fontWeight: "700", fontSize: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#7c2d12" },
  featureTitle: { fontSize: 20, fontWeight: "800", color: "#9a3412" },
  input: {
    borderWidth: 1,
    borderColor: "#e7d7c5",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: "#ffffff",
    color: "#292524",
  },
  disabledInput: {
    backgroundColor: "#f5f0e8",
    color: "#78716c",
  },
  primaryButton: {
    backgroundColor: "#9a3412",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonCompact: {
    backgroundColor: "#9a3412",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 132,
  },
  dangerButton: { backgroundColor: "#b91c1c" },
  primaryButtonText: { color: "#ffffff", fontWeight: "700" },
  secondaryButton: {
    backgroundColor: "#ffedd5",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonCompact: {
    backgroundColor: "#ffedd5",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 110,
  },
  secondaryButtonText: { color: "#9a3412", fontWeight: "700" },
  outlineActionButton: {
    borderWidth: 1,
    borderColor: "#e7d7c5",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffdf8",
  },
  outlineActionButtonText: { color: "#7c2d12", fontWeight: "700" },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  scrollContent: { paddingTop: 8, paddingBottom: 120, gap: 16 },
  listItem: {
    borderWidth: 1,
    borderColor: "#f1e5d5",
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  listItemSelected: {
    borderColor: "#ea580c",
    backgroundColor: "#fff7ed",
  },
  listTitle: { fontSize: 15, fontWeight: "700", color: "#7c2d12" },
  qtyControls: { flexDirection: "row", alignItems: "center", gap: 10 },
  cartActions: { alignItems: "center", gap: 8 },
  cartEditButton: {
    borderWidth: 1,
    borderColor: "#fdba74",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff7ed",
  },
  cartEditButtonText: { color: "#9a3412", fontWeight: "700", fontSize: 12 },
  qtyButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#fed7aa",
    alignItems: "center",
    justifyContent: "center",
  },
  qtyButtonText: { color: "#9a3412", fontWeight: "800", fontSize: 18 },
  qtyValue: { minWidth: 20, textAlign: "center", color: "#44403c", fontWeight: "700" },
  cartRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  totalText: { fontSize: 18, fontWeight: "800", color: "#9a3412" },
  trackCard: {
    backgroundColor: "#fff7ed",
    borderRadius: 18,
    padding: 14,
    gap: 4,
  },
  feedbackHistoryCard: {
    backgroundColor: "#fff7ed",
    borderRadius: 18,
    padding: 14,
    gap: 6,
  },
  ratingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  ratingButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#f1e5d5",
    backgroundColor: "#fffdf8",
    alignItems: "center",
    justifyContent: "center",
  },
  ratingButtonActive: {
    backgroundColor: "#f59e0b",
    borderColor: "#f59e0b",
  },
  ratingButtonText: {
    color: "#7c2d12",
    fontWeight: "800",
  },
  ratingButtonTextActive: {
    color: "#fffdf8",
  },
  feedbackOptionsCard: {
    gap: 8,
  },
  feedbackOptionRow: {
    borderWidth: 1,
    borderColor: "#f1e5d5",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fffdf8",
  },
  feedbackOptionRowActive: {
    backgroundColor: "#ffedd5",
    borderColor: "#fb923c",
  },
  feedbackOptionText: {
    color: "#7c2d12",
    fontSize: 14,
  },
  feedbackOptionTextActive: {
    fontWeight: "700",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 6,
  },
  infoLabel: { color: "#78716c", fontSize: 14, flex: 1 },
  infoValue: { color: "#7c2d12", fontSize: 14, fontWeight: "700", flex: 1, textAlign: "right" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#f1e5d5",
    borderRadius: 18,
    padding: 14,
  },
  menuIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
  },
  menuIconWrapDanger: {
    backgroundColor: "#fee2e2",
  },
  menuLabel: { color: "#7c2d12", fontSize: 15, fontWeight: "700" },
  menuLabelDanger: { color: "#b91c1c" },
  menuDescription: { color: "#78716c", fontSize: 13, marginTop: 2 },
  menuGlyph: { color: "#7c2d12", fontSize: 11, fontWeight: "800" },
  menuGlyphDanger: { color: "#b91c1c" },
  chevronText: { color: "#a8a29e", fontSize: 18, fontWeight: "700" },
  bottomNav: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    backgroundColor: "#fffdf8",
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    shadowColor: "#7c2d12",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  bottomNavIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomNavIconWrapActive: {
    backgroundColor: "#9a3412",
  },
  bottomNavGlyph: { color: "#78716c", fontSize: 11, fontWeight: "800" },
  bottomNavGlyphActive: { color: "#fffdf8" },
  bottomNavLabel: { color: "#78716c", fontSize: 12, fontWeight: "700" },
  bottomNavLabelActive: { color: "#7c2d12" },
  error: { color: "#b91c1c", fontWeight: "600" },
  errorBanner: {
    color: "#991b1b",
    backgroundColor: "#fee2e2",
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 12,
    fontWeight: "600",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(68, 64, 60, 0.4)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#fffdf8",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "88%",
    paddingTop: 10,
  },
  confirmCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    backgroundColor: "#fffdf8",
    borderRadius: 24,
    padding: 20,
    gap: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1e5d5",
    gap: 12,
  },
  modalTitle: { color: "#7c2d12", fontSize: 20, fontWeight: "800" },
  closeGlyph: { color: "#78716c", fontSize: 16, fontWeight: "800" },
  modalBody: { padding: 18, gap: 14 },
  modalHelpText: { color: "#78716c", fontSize: 13, lineHeight: 18 },
  inlineActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inlineInput: { flex: 1 },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
  modalGhostButton: {
    borderWidth: 1,
    borderColor: "#e7d7c5",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 108,
  },
  modalGhostButtonText: { color: "#7c2d12", fontWeight: "700" },
  modalOutlineButton: {
    borderWidth: 1,
    borderColor: "#e7d7c5",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButtonText: { color: "#7c2d12", fontWeight: "700" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff7ed",
    borderRadius: 18,
    padding: 14,
  },
});
