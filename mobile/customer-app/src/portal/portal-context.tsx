// Phase 0: all customer-portal state, effects and handlers moved verbatim out of
// App.tsx so screens can consume them through one hook instead of prop drilling.
// This mirrors the web portal's useCustomerPortalState hook.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useFonts } from "expo-font";
import { Poppins_400Regular } from "@expo-google-fonts/poppins/400Regular";
import { Poppins_500Medium } from "@expo-google-fonts/poppins/500Medium";
import { Poppins_600SemiBold } from "@expo-google-fonts/poppins/600SemiBold";
import { Poppins_700Bold } from "@expo-google-fonts/poppins/700Bold";
import { Poppins_800ExtraBold } from "@expo-google-fonts/poppins/800ExtraBold";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, AppState, BackHandler, useWindowDimensions } from "react-native";
import {
  cancelOrder,
  cancelReplacementRequest,
  clearNotifications,
  confirmEmailVerification,
  fetchAuthMe,
  fetchCustomerFeedback,
  fetchCustomerOrders,
  fetchCustomerProfile,
  fetchCustomerReplacements,
  fetchCustomerTracking,
  fetchEligibleEmptyItems,
  fetchNotifications,
  fetchProducts,
  getStoredUser,
  login,
  logout,
  markNotificationsRead,
  placeOrder,
  recordEmptyBottles,
  registerCustomer,
  requestEmailVerification,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  submitCustomerFeedback,
  submitReplacementRequest,
  updateCustomerProfile,
  updateSecuritySetting,
  uploadCustomerAvatar,
  uploadReplacementEvidence,
  verifyPasswordResetOtp,
  type CustomerFeedbackItem,
  type CustomerProfileUpdateInput,
} from "../services/auth";
import {
  CUSTOMER_ORDER_REASONS,
  REPLACEMENT_REASONS,
  formatPeso,
  getAvailableQuantity,
  getOrderStageIndex,
  isOrderCancellable,
  isOrderTrackable,
  isPurchaseRequest,
  isValidPhilippinePhone,
  localDateInput,
  normalizeOrderStatus,
  validatePasswordPolicy,
  withinNegrosOccidental,
} from "../lib/customer-logic";
import { buildReceiptHtml, formatAddress, getInitials } from "../lib/format";
import {
  composeShippingAddress,
  getAutomaticEmptyCredit,
  getLineDepositAmounts,
  OTP_EXPIRY_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  SERVICE_AREA_MESSAGE,
} from "../lib/shared";
import { theme } from "../theme";
import { API_BASE_URL } from "../config/env";
import type {
  CustomerNotification,
  CustomerOrder,
  CustomerProfile,
  CustomerReplacement,
  CustomerTrackingItem,
  CustomerUser,
  EligibleEmptyItem,
  MobileMixedCaseCartItem,
  Product,
} from "../types";

type CustomerTab = "home" | "cart" | "checkout" | "requests" | "orders" | "track" | "feedback" | "profile";
type CustomerProfileModal = "edit" | "security" | "notifications" | "address" | "empties" | null;
type AuthMode = "login" | "register";

// Detail views the web portal reaches through `activeView`.
export type PortalRoute =
  | { name: "order-detail"; orderId: string }
  | { name: "purchase-request-detail"; orderId: string }
  | { name: "replacement-detail"; replacementId: string }
  | { name: "edit-address" };

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
// Same key the web portal uses in localStorage.
const CUSTOMER_REMEMBER_DEVICE_KEY = "customer_remember_device_enabled";
const customerCartKey = (userId: string) => `customer_cart_${userId}`;

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

export type { CustomerTab, CustomerProfileModal, AuthMode, CustomerNotificationPreferences };

function useCustomerPortalState() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false);
  const [registration, setRegistration] = useState({ firstName: "", middleName: "", lastName: "", suffix: "", confirmPassword: "" });
  const [emailOtp, setEmailOtp] = useState("");
  const [emailVerificationToken, setEmailVerificationToken] = useState("");
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [verifyingEmailOtp, setVerifyingEmailOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [tracking, setTracking] = useState<CustomerTrackingItem[]>([]);
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [replacements, setReplacements] = useState<CustomerReplacement[]>([]);
  const [eligibleEmptyItems, setEligibleEmptyItems] = useState<EligibleEmptyItem[]>([]);
  const [emptyCasesByProductId, setEmptyCasesByProductId] = useState<Record<string, number>>({});
  const [recordingEmptyProductId, setRecordingEmptyProductId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CustomerTab>("home");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [ordersTab, setOrdersTab] = useState<"ALL" | "DELIVERED" | "TO_REVIEW" | "REPLACEMENT">("ALL");
  const [filterDialogVisible, setFilterDialogVisible] = useState(false);
  const [orderFilterStatus, setOrderFilterStatus] = useState("ALL");
  const [orderFilterDateFrom, setOrderFilterDateFrom] = useState("");
  const [orderFilterDateTo, setOrderFilterDateTo] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("ALL");
  const [cardQuantityByProductId, setCardQuantityByProductId] = useState<Record<string, number>>({});
  // Structured delivery address, matching the web portal's shipping* fields.
  const [addressForm, setAddressForm] = useState({
    name: "",
    phone: "",
    houseNumber: "",
    streetName: "",
    subdivision: "",
    barangay: "",
    city: "",
    province: "Negros Occidental",
    zipCode: "",
    country: "Philippines",
    latitude: null as number | null,
    longitude: null as number | null,
  });
  const [resolvingPinnedAddress, setResolvingPinnedAddress] = useState(false);
  const [addressSearch, setAddressSearch] = useState("");
  const [addressSearchResults, setAddressSearchResults] = useState<Array<{ displayName: string; latitude: number; longitude: number }>>([]);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [feedbackOrderId, setFeedbackOrderId] = useState<string | null>(null);
  const [ratingDialogOrder, setRatingDialogOrder] = useState<CustomerOrder | null>(null);
  const [deliveryRatingValue, setDeliveryRatingValue] = useState(5);
  const [feedbackItems, setFeedbackItems] = useState<CustomerFeedbackItem[]>([]);
  const [feedbackRatingValue, setFeedbackRatingValue] = useState(5);
  const [selectedFeedbackOptions, setSelectedFeedbackOptions] = useState<string[]>([]);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [mixedCart, setMixedCart] = useState<MobileMixedCaseCartItem[]>([]);
  const [selectedCartIds, setSelectedCartIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(localDateInput());
  const [mixedCaseBuilderVisible, setMixedCaseBuilderVisible] = useState(false);
  const [editingMixedCase, setEditingMixedCase] = useState<MobileMixedCaseCartItem | null>(null);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<CustomerProfileUpdateInput>(initialProfileForm);
  const [activeProfileModal, setActiveProfileModal] = useState<CustomerProfileModal>(null);
  const [confirmLogoutVisible, setConfirmLogoutVisible] = useState(false);
  const [pendingCancellationOrder, setPendingCancellationOrder] = useState<CustomerOrder | null>(null);
  const [selectedCancellationReasons, setSelectedCancellationReasons] = useState<string[]>([]);
  const [otherCancellationReason, setOtherCancellationReason] = useState("");
  const [receiptOrder, setReceiptOrder] = useState<CustomerOrder | null>(null);
  const [sharingReceipt, setSharingReceipt] = useState(false);
  const [replacementOrder, setReplacementOrder] = useState<CustomerOrder | null>(null);
  const [replacementEvidence, setReplacementEvidence] = useState<string[]>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [submittingReplacement, setSubmittingReplacement] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // Mirrors the web's sessionStorage `customer_welcome_state`: null = closed,
  // "new" after registration, "existing" after login.
  const [welcomeMode, setWelcomeMode] = useState<"new" | "existing" | null>(null);
  const [pendingCancelReplacement, setPendingCancelReplacement] = useState<CustomerReplacement | null>(null);
  const [cancellingReplacement, setCancellingReplacement] = useState(false);
  const [orderConfirmationVisible, setOrderConfirmationVisible] = useState(false);
  const [lastPlacedOrderNumber, setLastPlacedOrderNumber] = useState("");
  const [notificationPrefs, setNotificationPrefs] = useState<CustomerNotificationPreferences>(defaultNotificationPrefs);
  const [securityForm, setSecurityForm] = useState(initialSecurityForm);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [loginAlertsEnabled, setLoginAlertsEnabled] = useState(false);
  // The web keeps this one on the device, not the account.
  const [rememberDeviceEnabled, setRememberDeviceEnabled] = useState(true);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpExpiry, setOtpExpiry] = useState(OTP_EXPIRY_SECONDS);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  const pendingCheckoutRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const cartHydratedRef = useRef(false);
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const screenTranslateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const stored = await getStoredUser();
      if (stored) {
        setUser(stored);
        await hydrateStoredCart(stored.userId);
        await refreshData(false, stored.userId);
        await loadNotificationPreferences();
        await loadRememberDevicePreference();
      }
      setBooting(false);
    })();
  }, []);

  useEffect(() => {
    if (!user || !cartHydratedRef.current) return;
    // Added: preserve standard and mixed-case lines under the same per-customer key as the web portal.
    void AsyncStorage.setItem(customerCartKey(user.userId), JSON.stringify({ cart, mixedCart }));
  }, [cart, mixedCart, user]);

  useEffect(() => {
    // Added: reproduce the web portal's 220 ms fade-and-lift transition between customer views.
    screenOpacity.setValue(0);
    screenTranslateY.setValue(14);
    Animated.parallel([
      Animated.timing(screenOpacity, { toValue: 1, duration: theme.motion.screenMs, useNativeDriver: true }),
      Animated.timing(screenTranslateY, { toValue: 0, duration: theme.motion.screenMs, useNativeDriver: true }),
    ]).start();
  }, [activeTab, screenOpacity, screenTranslateY]);

  useEffect(() => {
    if (!user || !["requests", "orders", "track"].includes(activeTab)) return;
    let mounted = true;
    const refreshOperationalData = async () => {
      try {
        const [nextOrders, nextTracking, nextReplacements] = await Promise.all([
          fetchCustomerOrders(),
          fetchCustomerTracking(),
          fetchCustomerReplacements(),
        ]);
        if (!mounted) return;
        setOrders(nextOrders);
        setTracking(nextTracking);
        setReplacements(nextReplacements);
      } catch {
        // Best effort polling mirrors the web behavior without replacing the last good snapshot.
      }
    };
    const timer = setInterval(() => void refreshOperationalData(), 4_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshOperationalData();
    });
    return () => {
      mounted = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [activeTab, user]);

  async function hydrateStoredCart(userId: string) {
    try {
      const raw = await AsyncStorage.getItem(customerCartKey(userId));
      const stored = raw ? JSON.parse(raw) : null;
      const nextCart = stored?.cart && typeof stored.cart === "object" ? stored.cart : {};
      const nextMixed = Array.isArray(stored?.mixedCart) ? stored.mixedCart : [];
      setCart(nextCart);
      setMixedCart(nextMixed);
      setSelectedCartIds(new Set([...Object.keys(nextCart), ...nextMixed.map((item: MobileMixedCaseCartItem) => item.id)]));
    } catch {
      setCart({});
      setMixedCart([]);
      setSelectedCartIds(new Set());
    } finally {
      cartHydratedRef.current = true;
    }
  }

  function hydrateAddressForm(nextProfile: CustomerProfile) {
    setAddressForm((current) => ({
      ...current,
      name: nextProfile.name || "",
      phone: nextProfile.phone || "",
      city: nextProfile.city || "",
      province: nextProfile.province || "Negros Occidental",
      zipCode: nextProfile.zipCode || "",
      country: nextProfile.country || "Philippines",
      latitude: typeof nextProfile.latitude === "number" ? nextProfile.latitude : current.latitude,
      longitude: typeof nextProfile.longitude === "number" ? nextProfile.longitude : current.longitude,
      // The API returns one composed line; the structured parts are filled by
      // pinning or by hand until the backend exposes them separately.
      streetName: current.streetName || String(nextProfile.address || ""),
    }));
  }

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
      firstName: nextProfile.firstName || "",
      middleName: nextProfile.middleName || "",
      lastName: nextProfile.lastName || "",
      suffix: nextProfile.suffix || "",
      avatar: nextProfile.avatar || null,
    });
  }

  async function loadRememberDevicePreference() {
    try {
      const raw = await AsyncStorage.getItem(CUSTOMER_REMEMBER_DEVICE_KEY);
      setRememberDeviceEnabled(raw === null ? true : Boolean(JSON.parse(raw)));
    } catch {
      setRememberDeviceEnabled(true);
    }
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
      const [nextProfile, nextProducts, nextOrders, nextTracking, nextNotifications, nextReplacements, nextEligibleEmpties] = await Promise.all([
        fetchCustomerProfile(customerId),
        fetchProducts(),
        fetchCustomerOrders(),
        fetchCustomerTracking(),
        fetchNotifications().catch(() => ({ notifications: [], unreadCount: 0 })),
        fetchCustomerReplacements().catch(() => []),
        fetchEligibleEmptyItems().catch(() => []),
      ]);
      const nextFeedback = await fetchCustomerFeedback().catch(() => []);
      setUser(currentUser);
      setProfile(nextProfile);
      setProducts(nextProducts);
      setOrders(nextOrders);
      setTracking(nextTracking);
      setNotifications(nextNotifications.notifications || []);
      setUnreadNotifications(Number(nextNotifications.unreadCount || 0));
      setReplacements(nextReplacements);
      setEligibleEmptyItems(nextEligibleEmpties);
      setFeedbackItems(nextFeedback);
      hydrateProfileForm(nextProfile);
      hydrateAddressForm(nextProfile);
      setTwoFactorEnabled(Boolean(currentUser.twoFactorEnabled ?? nextProfile.twoFactorEnabled));
      setLoginAlertsEnabled(Boolean(currentUser.loginAlertsEnabled ?? nextProfile.loginAlertsEnabled));
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
      await hydrateStoredCart(loggedIn.userId);
      await refreshData(false, loggedIn.userId);
      await loadNotificationPreferences();
      setWelcomeMode("existing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRegistrationOtp() {
    if (!email.trim()) return setError("Email is required.");
    setSendingEmailOtp(true);
    setError(null);
    try {
      await requestEmailVerification(email.trim().toLowerCase());
      Alert.alert("Verification Code Sent", "Enter the six-digit code sent to your email.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send verification code.");
    } finally {
      setSendingEmailOtp(false);
    }
  }

  async function handleVerifyRegistrationOtp() {
    setVerifyingEmailOtp(true);
    setError(null);
    try {
      const token = await confirmEmailVerification(email.trim().toLowerCase(), emailOtp.trim());
      setEmailVerificationToken(token);
      Alert.alert("Email Verified", "Your email is ready for registration.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify the code.");
    } finally {
      setVerifyingEmailOtp(false);
    }
  }

  async function handleRegister() {
    if (!registration.firstName.trim() || !registration.lastName.trim()) return setError("First name and last name are required.");
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) return setError(passwordError);
    if (registration.confirmPassword !== password) return setError("Passwords do not match.");
    if (!emailVerificationToken) return setError("Verify your email with OTP before creating your account.");
    setLoading(true);
    setError(null);
    try {
      const registered = await registerCustomer({
        ...registration,
        email: email.trim().toLowerCase(),
        password,
        emailVerificationToken,
      });
      setUser(registered);
      await hydrateStoredCart(registered.userId);
      await refreshData(false, registered.userId);
      setWelcomeMode("new");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed.");
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
    setSelectedCartIds(new Set());
    cartHydratedRef.current = false;
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
    setNotifications([]);
    setUnreadNotifications(0);
    setReplacements([]);
    setEligibleEmptyItems([]);
    setReceiptOrder(null);
    setReplacementOrder(null);
    setReplacementEvidence([]);
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
      else {
        nextCart[productId] = normalized;
        setSelectedCartIds((selected) => new Set(selected).add(productId));
      }
      if (normalized === 0) {
        setSelectedCartIds((selected) => {
          const next = new Set(selected);
          next.delete(productId);
          return next;
        });
      }
      return nextCart;
    });
  }

  function toggleCartSelection(itemId: string) {
    setSelectedCartIds((selected) => {
      const next = new Set(selected);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function removeMixedCartItem(itemId: string) {
    setMixedCart((current) => current.filter((entry) => entry.id !== itemId));
    setSelectedCartIds((selected) => {
      const next = new Set(selected);
      next.delete(itemId);
      return next;
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
    setSelectedCartIds((selected) => {
      const next = new Set(selected);
      if (editingMixedCase) next.delete(editingMixedCase.id);
      next.add(item.id);
      return next;
    });
  }

  async function handlePlaceOrder() {
    if (!profile) return;
    if (!profileForm.address.trim()) return setError("Add a delivery address before checkout.");
    if (!isValidPhilippinePhone(profileForm.phone)) return setError("Enter a valid Philippine mobile number before checkout.");
    const standardCartItems = Object.entries(cart)
      .filter(([productId]) => selectedCartIds.has(productId))
      .map(([productId, quantity]) => {
        const product = products.find((entry) => entry.id === productId);
        if (!product || quantity <= 0) return null;
        return { itemType: "STANDARD_CASE" as const, productId, quantity };
      })
      .filter((item): item is { itemType: "STANDARD_CASE"; productId: string; quantity: number } => Boolean(item));
    const mixedCartItems = mixedCart.filter((item) => selectedCartIds.has(item.id)).map((item) => ({
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
      shippingName: profileForm.name,
      shippingPhone: profileForm.phone,
      shippingCountry: "Philippines",
      notes,
      deliveryDate,
        items: orderItems,
      });
      if (pendingCheckoutRef.current?.fingerprint !== checkoutFingerprint) {
        pendingCheckoutRef.current = {
          fingerprint: checkoutFingerprint,
          requestId: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
      }
      const placedOrder = await placeOrder({
        shippingAddress: profileForm.address,
        shippingCity: profileForm.city,
        shippingProvince: profileForm.province,
        shippingZipCode: profileForm.zipCode,
        shippingLatitude: latitude,
        shippingLongitude: longitude,
        shippingName: profileForm.name,
        shippingPhone: profileForm.phone,
        shippingCountry: "Philippines",
        notes,
        deliveryDate,
        requestId: pendingCheckoutRef.current.requestId,
        items: orderItems,
      });
      pendingCheckoutRef.current = null;
      setLastPlacedOrderNumber(
        String(placedOrder?.purchaseRequestNumber || placedOrder?.orderNumber || placedOrder?.id || "").trim()
      );
      setOrderConfirmationVisible(true);
      // Fix: checkout removes only selected lines, matching the web cart behavior.
      setCart((current) => Object.fromEntries(Object.entries(current).filter(([productId]) => !selectedCartIds.has(productId))));
      setMixedCart((current) => current.filter((item) => !selectedCartIds.has(item.id)));
      setSelectedCartIds(new Set());
      await refreshData(false, profile.userId);
      setOrderSearch("");
      setOrdersTab("ALL");
      setOrderFilterStatus("ALL");
      // The web lands on purchase requests: a new order is pending warehouse approval.
      setActiveTab("requests");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to place order.");
    } finally {
      setPlacingOrder(false);
    }
  }

  async function confirmCancelReplacement() {
    const replacementId = String(pendingCancelReplacement?.id || "").trim();
    if (!replacementId) return;
    setCancellingReplacement(true);
    setError(null);
    try {
      await cancelReplacementRequest(replacementId);
      setPendingCancelReplacement(null);
      if (user) await refreshData(false, user.userId);
    } catch (e) {
      // A 409 means staff already moved it to Under Review; refresh so the
      // customer sees the state that blocked them, matching the web.
      setError(e instanceof Error ? e.message : "Failed to cancel replacement request.");
      if (user) await refreshData(false, user.userId);
    } finally {
      setCancellingReplacement(false);
    }
  }

  async function saveSecuritySetting(field: "twoFactorEnabled" | "loginAlertsEnabled", value: boolean) {
    if (!user) return;
    setSavingSecurity(true);
    setError(null);
    try {
      const nextCustomer = await updateSecuritySetting(user.userId, field, value);
      if (field === "twoFactorEnabled") setTwoFactorEnabled(value);
      else setLoginAlertsEnabled(value);
      if (nextCustomer) setProfile((current) => ({ ...(current || {}), ...nextCustomer }) as CustomerProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save security setting.");
    } finally {
      setSavingSecurity(false);
    }
  }

  async function persistRememberDevice(value: boolean) {
    setRememberDeviceEnabled(value);
    await AsyncStorage.setItem(CUSTOMER_REMEMBER_DEVICE_KEY, JSON.stringify(value));
  }

  function setAddressField(field: keyof typeof addressForm, value: string) {
    setAddressForm((current) => ({ ...current, [field]: value }));
  }

  function clearAddressForm() {
    setAddressForm((current) => ({
      ...current,
      houseNumber: "",
      streetName: "",
      subdivision: "",
      barangay: "",
      city: "",
      province: "Negros Occidental",
      zipCode: "",
      latitude: null,
      longitude: null,
    }));
  }

  function handleOutsideServiceArea() {
    setError(SERVICE_AREA_MESSAGE);
  }

  // Reverse-geocodes a pinned point, exactly as the web portal does.
  async function handlePinnedLocation(lat: number, lng: number) {
    setAddressForm((current) => ({ ...current, latitude: lat, longitude: lng }));
    setResolvingPinnedAddress(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&countrycodes=ph&zoom=18`,
        { headers: { Accept: "application/json" } }
      );
      if (!response.ok) throw new Error("Reverse geocoding failed");
      const payload = await response.json();
      const address = payload?.address || {};
      setAddressForm((current) => ({
        ...current,
        houseNumber: String(address.house_number || current.houseNumber || ""),
        streetName: String(address.road || current.streetName || ""),
        subdivision: String(address.neighbourhood || address.suburb || current.subdivision || ""),
        barangay: String(address.village || address.quarter || address.suburb || current.barangay || ""),
        city: String(address.city || address.town || address.municipality || current.city || ""),
        province: String(address.state || current.province || "Negros Occidental"),
        zipCode: String(address.postcode || current.zipCode || ""),
      }));
    } catch {
      // Keep the pin; the customer can still fill the fields by hand.
    } finally {
      setResolvingPinnedAddress(false);
    }
  }

  async function useCurrentLocation() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError("Location permission is required to use your current location.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      await handlePinnedLocation(position.coords.latitude, position.coords.longitude);
    } catch {
      setError("Could not read your current location.");
    }
  }

  async function handleSaveAddress() {
    if (!user) return;
    if (addressForm.phone.trim() && !isValidPhilippinePhone(addressForm.phone)) {
      setError("Please enter a valid Philippine mobile number (e.g., 09171234567 or 639171234567).");
      return;
    }
    setSavingProfile(true);
    setError(null);
    try {
      const composed = composeShippingAddress({
        houseNumber: addressForm.houseNumber,
        streetName: addressForm.streetName,
        subdivision: addressForm.subdivision,
        barangay: addressForm.barangay,
        city: addressForm.city,
        province: addressForm.province,
        zipCode: addressForm.zipCode,
      });
      const nextProfile = await updateCustomerProfile(user.userId, {
        ...profileForm,
        name: addressForm.name || profileForm.name,
        phone: addressForm.phone || profileForm.phone,
        address: composed,
        city: addressForm.city,
        province: addressForm.province,
        zipCode: addressForm.zipCode,
        latitude: addressForm.latitude === null ? "" : String(addressForm.latitude),
        longitude: addressForm.longitude === null ? "" : String(addressForm.longitude),
      });
      setProfile(nextProfile);
      hydrateProfileForm(nextProfile);
      popRoute();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save address.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function submitRating(selectedFeedbackOptions: string[]): Promise<boolean> {
    const order = ratingDialogOrder;
    if (!order) return false;
    if (selectedFeedbackOptions.length === 0) return false;
    setSubmittingFeedback(true);
    setError(null);
    try {
      // Same payload the web builds: type derived from the rating, reasons as a
      // bullet list, subject naming the order.
      const overallRating = Math.max(1, Math.min(5, Math.round(deliveryRatingValue)));
      await submitCustomerFeedback({
        orderId: order.id,
        rating: overallRating,
        type: overallRating <= 2 ? "COMPLAINT" : overallRating === 3 ? "SUGGESTION" : "COMPLIMENT",
        subject: `Order Review - ${order.orderNumber}`,
        message: selectedFeedbackOptions.map((reason) => `- ${reason}`).join("\n"),
      });
      if (user) await refreshData(false, user.userId);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit review.");
      return false;
    } finally {
      setSubmittingFeedback(false);
    }
  }

  useEffect(() => {
    // Mirrors the web: both counters run while the OTP step is on screen.
    if (activeProfileModal !== "security" || (otpExpiry <= 0 && otpResendCooldown <= 0)) return;
    const timer = setInterval(() => {
      setOtpExpiry((prev) => (prev > 0 ? prev - 1 : 0));
      setOtpResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeProfileModal, otpExpiry, otpResendCooldown]);

  function resetOtpTimers() {
    setOtpExpiry(OTP_EXPIRY_SECONDS);
    setOtpResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
  }

  async function handleSaveProfile() {
    if (!user) return;
    if (profileForm.phone.trim() && !isValidPhilippinePhone(profileForm.phone)) {
      setError("Enter a valid Philippine mobile number (09XXXXXXXXX or 63XXXXXXXXXX).");
      return;
    }
    const latitude = Number(profileForm.latitude);
    const longitude = Number(profileForm.longitude);
    if ((profileForm.latitude.trim() || profileForm.longitude.trim()) && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !withinNegrosOccidental(latitude, longitude))) {
      setError("Delivery coordinates must be inside the supported Negros Occidental area.");
      return;
    }
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

  async function handleCancelOrder(orderId: string, reason: string) {
    setError(null);
    try {
      await cancelOrder(orderId, reason);
      await refreshData(false, user?.userId);
      setPendingCancellationOrder(null);
      setSelectedCancellationReasons([]);
      setOtherCancellationReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel order.");
    }
  }

  function confirmPendingCancellation() {
    if (!pendingCancellationOrder) return;
    const reasons = selectedCancellationReasons
      .filter((reason) => reason !== "Other")
      .concat(selectedCancellationReasons.includes("Other") && otherCancellationReason.trim() ? [otherCancellationReason.trim()] : []);
    if (reasons.length === 0) {
      setError("Select or enter a cancellation reason.");
      return;
    }
    // Added: submit the same explicit, human-readable cancellation reason required by the web flow and backend.
    void handleCancelOrder(pendingCancellationOrder.id, reasons.join("; "));
  }

  function handleBuyAgain(order: CustomerOrder) {
    const standardItems = (order.items || []).filter((item) => {
      if (item.itemType === "MIXED_CASE" || !item.product?.id) return false;
      const product = products.find((entry) => entry.id === item.product?.id);
      return Boolean(product && getAvailableQuantity(product) > 0);
    });
    const mixedItems = (order.items || []).filter((item) => item.itemType === "MIXED_CASE" && (item.components || []).length > 0);
    const mixedAdditions = mixedItems.map((item, index) => ({
      id: `mixed-repeat-${order.id}-${Date.now()}-${index}`,
      itemType: "MIXED_CASE" as const,
      caseCapacity: Number(item.caseCapacity || 0),
      quantity: Number(item.quantity || 1),
      unitPrice: Number(item.unitPrice || 0),
      components: item.components || [],
    }));
    const addedIds = [...standardItems.map((item) => item.product!.id), ...mixedAdditions.map((item) => item.id)];
    setCart((current) => {
      const next = { ...current };
      standardItems.forEach((item) => {
        const productId = item.product!.id;
        const product = products.find((entry) => entry.id === productId);
        if (!product || getAvailableQuantity(product) <= 0) return;
        next[productId] = Math.min(getAvailableQuantity(product), Number(next[productId] || 0) + Number(item.quantity || 0));
      });
      return next;
    });
    setMixedCart((current) => [...current, ...mixedAdditions]);
    setSelectedCartIds((current) => new Set([...current, ...addedIds]));
    setActiveTab("cart");
  }

  async function handleShareReceipt(order: CustomerOrder) {
    setSharingReceipt(true);
    setError(null);
    try {
      // Added: generate a native PDF from the same order data shown in the web receipt preview.
      const file = await Print.printToFileAsync({ html: buildReceiptHtml(order) });
      if (!(await Sharing.isAvailableAsync())) throw new Error("Receipt sharing is not available on this device.");
      await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: `Receipt ${order.orderNumber}`, UTI: "com.adobe.pdf" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create the receipt.");
    } finally {
      setSharingReceipt(false);
    }
  }

  async function handlePickAvatar() {
    if (!user) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return setError("Photo library permission is required to update your profile picture.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.82 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploadingAvatar(true);
    setError(null);
    try {
      const avatar = await uploadCustomerAvatar({ uri: asset.uri, name: asset.fileName || `avatar-${Date.now()}.jpg`, type: asset.mimeType || "image/jpeg" });
      const nextProfile = await updateCustomerProfile(user.userId, { ...profileForm, avatar });
      setProfile(nextProfile);
      setUser(nextProfile);
      hydrateProfileForm(nextProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload profile picture.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handlePickReplacementEvidence() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return setError("Photo library permission is required to attach replacement evidence.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 5, quality: 0.82 });
    if (result.canceled) return;
    setUploadingEvidence(true);
    setError(null);
    try {
      const urls: string[] = [];
      for (const asset of result.assets) {
        urls.push(await uploadReplacementEvidence({ uri: asset.uri, name: asset.fileName || `replacement-${Date.now()}.jpg`, type: asset.mimeType || "image/jpeg" }));
      }
      setReplacementEvidence((current) => Array.from(new Set([...current, ...urls])).slice(0, 5));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload replacement evidence.");
    } finally {
      setUploadingEvidence(false);
    }
  }

  async function handleSubmitReplacement(built: {
    lines: any[];
    totalDamagedItems: number;
    combinedReason: string;
    combinedDescription: string;
  }) {
    if (!replacementOrder) return;
    setSubmittingReplacement(true);
    setError(null);
    try {
      await submitReplacementRequest({
        orderId: replacementOrder.id,
        numberDamagedItems: built.totalDamagedItems,
        damageType: built.combinedReason,
        description: built.combinedDescription || undefined,
        evidence: replacementEvidence,
        replacementLines: built.lines,
      });
      setReplacementOrder(null);
      setReplacementEvidence([]);
      if (user) await refreshData(false, user.userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit replacement request.");
    } finally {
      setSubmittingReplacement(false);
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
    const selectedReasons = Array.from(new Set(selectedFeedbackOptions.map((item) => String(item || "").trim()).filter(Boolean)));
    // Added: mobile reviews require at least one feedback reason before submission.
    if (selectedReasons.length === 0) {
      setError("Select at least one feedback option before submitting your review.");
      return;
    }
    setSubmittingFeedback(true);
    setError(null);
    try {
      const overallRating = Math.max(1, Math.min(5, Math.round(feedbackRatingValue)));
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
    if (modal === "notifications") {
      void fetchNotifications().then((data) => {
        setNotifications(data.notifications || []);
        setUnreadNotifications(Number(data.unreadCount || 0));
      }).catch(() => undefined);
    }
    if (modal === "empties") {
      void fetchEligibleEmptyItems().then(setEligibleEmptyItems).catch(() => undefined);
    }
  }

  async function handleMarkAllNotificationsRead() {
    try {
      await markNotificationsRead();
      setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnreadNotifications(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark notifications as read.");
    }
  }

  async function handleClearNotifications() {
    try {
      await clearNotifications();
      setNotifications([]);
      setUnreadNotifications(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear notifications.");
    }
  }

  function handleNotificationPress(notification: CustomerNotification) {
    if (!notification.isRead) {
      void markNotificationsRead([notification.id]).then(setUnreadNotifications).catch(() => undefined);
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, isRead: true } : item));
    }
    const referenceType = String(notification.referenceType || "").toLowerCase();
    const referenceId = String(notification.referenceId || "");
    const matchedOrder = orders.find((order) => order.id === referenceId || order.orderNumber === referenceId || order.purchaseRequestNumber === referenceId || order.purchaseOrderNumber === referenceId);
    closeProfileModal();
    if (matchedOrder) setSelectedOrderId(matchedOrder.id);
    if (referenceType.includes("purchase")) setActiveTab("requests");
    else if (referenceType === "trip") setActiveTab("track");
    else setActiveTab("orders");
  }

  async function handleRecordEmptyCases(item: EligibleEmptyItem) {
    const cases = Math.max(1, Number(emptyCasesByProductId[item.productId] || 1));
    setRecordingEmptyProductId(item.productId);
    setError(null);
    try {
      const message = await recordEmptyBottles(item.productId, cases);
      Alert.alert("Empties Recorded", message);
      const [nextEligible, nextProfile] = await Promise.all([
        fetchEligibleEmptyItems(),
        user ? fetchCustomerProfile(user.userId) : Promise.resolve(profile),
      ]);
      setEligibleEmptyItems(nextEligible);
      if (nextProfile) setProfile(nextProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record empty bottles.");
    } finally {
      setRecordingEmptyProductId(null);
    }
  }

  async function handleSearchAddress() {
    const query = addressSearch.trim();
    if (!query) return setError("Type an address to search.");
    setSearchingAddress(true);
    setError(null);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ph&limit=15&addressdetails=1&q=${encodeURIComponent(`${query}, Negros Occidental, Philippines`)}`);
      if (!response.ok) throw new Error("Address search failed.");
      const rows = await response.json();
      const next = (Array.isArray(rows) ? rows : []).map((row: any) => ({
        displayName: String(row.display_name || ""),
        latitude: Number(row.lat),
        longitude: Number(row.lon),
      })).filter((row: { latitude: number; longitude: number }) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && withinNegrosOccidental(row.latitude, row.longitude));
      setAddressSearchResults(next);
      if (next.length === 0) setError("No matching address was found inside the supported Negros Occidental area.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Address search failed.");
    } finally {
      setSearchingAddress(false);
    }
  }

  function selectAddressSearchResult(result: { displayName: string; latitude: number; longitude: number }) {
    setProfileForm((current) => ({
      ...current,
      address: result.displayName.split(",").slice(0, -3).join(",").trim() || result.displayName,
      latitude: String(result.latitude),
      longitude: String(result.longitude),
    }));
    setAddressSearchResults([]);
    setAddressSearch(result.displayName);
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
    const accountEmail = (profile?.email || user?.email || email).trim();
    if (!accountEmail) {
      setError("No email is available for this customer account.");
      return;
    }
    setSendingOtp(true);
    setError(null);
    try {
      await requestPasswordResetOtp(accountEmail);
      resetOtpTimers();
      setOtpVerified(false);
      Alert.alert("OTP Sent", "A verification code was sent to your email.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send OTP.");
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleVerifyOtp() {
    const accountEmail = (profile?.email || user?.email || email).trim();
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
    const accountEmail = (profile?.email || user?.email || email).trim();
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
      setForgotPasswordVisible(false);
      Alert.alert("Password Updated", "Your password was changed. Please log in again.");
      if (user) await handleLogout();
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

  const selectedStandardCartItems = useMemo(
    () => cartItems.filter((item) => selectedCartIds.has(item.product.id)),
    [cartItems, selectedCartIds]
  );
  const selectedMixedCartItems = useMemo(
    () => mixedCart.filter((item) => selectedCartIds.has(item.id)),
    [mixedCart, selectedCartIds]
  );
  // One list over standard and mixed-case lines, shaped like the web portal's `cart`
  // array so the cart and checkout screens can render it the same way. Empty-container
  // credit is attached here, matching the web's applyAutomaticEmptyCredit at add time.
  const unifiedCartItems = useMemo(() => {
    const standard = cartItems.map((item) => {
      const sizes = Array.isArray(item.product.sizes)
        ? item.product.sizes.map((size) => String(size).trim()).filter(Boolean)
        : [];
      // Same precedence as the web's getProductSizeLabel: sizes first, then the
      // size fields, then the unit. Cart lines fall back to the unit ("case");
      // the catalog card falls back to "N/A" instead.
      const sizeLabel =
        (sizes.length > 0 ? sizes.join(", ") : "") ||
        String(item.product.sizeLabel || item.product.size || "").trim() ||
        String(item.product.unit || "").trim() ||
        "case";
      const unitLabel = String(item.product.unit || "case").trim().toLowerCase() || "case";
      const depositSource = {
        ...item.product,
        itemType: "STANDARD_CASE" as const,
        unit: item.product.unit,
        quantity: item.quantity,
      };
      const credit = getAutomaticEmptyCredit(depositSource, item.quantity, profile?.bottleBalances);
      return {
        id: item.product.id,
        name: item.product.name,
        sizeLabel,
        unitLabel,
        category: String(item.product.category || "").trim(),
        imageUrl: item.product.imageUrl || null,
        quantity: item.quantity,
        unitPrice: Number(item.product.price || 0),
        lineTotal: item.total,
        isMixedCase: false as const,
        components: null as any,
        source: { ...depositSource, ...credit },
        availableEmptyBottles: credit.availableEmptyBottles,
        availableDepositBalance: credit.availableDepositBalance,
        emptyReturnedQuantity: credit.emptyReturnedQuantity,
      };
    });

    const mixed = mixedCart.map((item) => ({
      id: item.id,
      name: "Mixed Case",
      sizeLabel: "",
      unitLabel: "case",
      category: "",
      imageUrl: null as string | null,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice || 0),
      lineTotal: Number(item.unitPrice || 0) * item.quantity,
      isMixedCase: true as const,
      components: item.components,
      source: item,
      availableEmptyBottles: 0,
      availableDepositBalance: 0,
      emptyReturnedQuantity: 0,
    }));

    return [...standard, ...mixed];
  }, [cartItems, mixedCart, profile?.bottleBalances]);

  const selectedUnifiedCartItems = useMemo(
    () => unifiedCartItems.filter((item) => selectedCartIds.has(item.id)),
    [selectedCartIds, unifiedCartItems]
  );

  // How much of the new deposit the customer's existing empties already cover.
  const selectedDepositRefunded = useMemo(
    () =>
      selectedUnifiedCartItems.reduce(
        (sum, item) => (item.isMixedCase ? sum : sum + getLineDepositAmounts(item.source).refunded),
        0
      ),
    [selectedUnifiedCartItems]
  );

  const cartTotal = cartItems.reduce((sum, item) => sum + item.total, 0);
  const mixedCartTotal = mixedCart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const allCartTotal = cartTotal + mixedCartTotal;
  const selectedSubtotal = selectedStandardCartItems.reduce((sum, item) => sum + item.total, 0)
    + selectedMixedCartItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discountCasesAffected = selectedStandardCartItems.reduce((sum, item) => {
    const unit = String(item.product.unit || "").toLowerCase();
    return unit === "case" || unit === "pack" ? sum + item.quantity : sum;
  }, 0) + selectedMixedCartItems.reduce((sum, item) => sum + item.quantity, 0);
  const configuredDiscountPercent = String(profile?.discountStatus || "").toUpperCase() === "ACTIVE"
    ? Number(profile?.discountPercent || String(profile?.discountOption || "").match(/\d+/)?.[0] || 0)
    : 0;
  const totalDiscount = discountCasesAffected >= 50 ? selectedSubtotal * (configuredDiscountPercent / 100) : 0;
  const selectedDepositCharged = selectedStandardCartItems.reduce((sum, item) => {
    if (item.product.depositExempt || String(item.product.packagingType || "").toUpperCase() !== "RETURNABLE") return sum;
    const unit = String(item.product.unit || "").toLowerCase();
    const deposit = unit === "case" ? Number(item.product.caseDepositAmount || 0) : Number(item.product.depositAmount || 0);
    return sum + item.quantity * deposit;
  }, 0);
  // The web total lets the backend reconcile returnable-container deposits; mirror that displayed calculation.
  const checkoutTotal = Math.max(0, selectedSubtotal - totalDiscount);
  const cartLineCount = cartItems.length + mixedCart.length;
  // The header badge counts units, not lines: the web uses
  // cart.reduce((sum, i) => sum + i.quantity, 0).
  const cartUnitCount = cartItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    + mixedCart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const selectedCartLineCount = selectedStandardCartItems.length + selectedMixedCartItems.length;
  const deliveredOrders = useMemo(
    () => orders.filter((order) => String(order.status || "").toUpperCase() === "DELIVERED"),
    [orders]
  );
  const selectedTracking = useMemo(
    () => tracking.find((item) => item.orderId === selectedOrderId) || tracking[0] || null,
    [selectedOrderId, tracking]
  );
  const categoryOptions = useMemo(
    () => ["ALL", ...Array.from(new Set(products.map((product) => String(product.category || "").trim()).filter(Boolean))).sort()],
    [products]
  );
  const visibleProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = productCategory === "ALL" || String(product.category || "") === productCategory;
      const matchesSearch = !query || [product.name, product.sku, product.category].some((value) => String(value || "").toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [productCategory, productSearch, products]);
  const purchaseRequests = useMemo(() => orders.filter(isPurchaseRequest), [orders]);
  const purchaseOrders = useMemo(() => orders.filter((order) => !isPurchaseRequest(order) || Boolean(order.purchaseOrderNumber)), [orders]);
  const customerInitials = getInitials(profile?.name || user?.name || "Customer");
  const profileAddress = formatAddress(profileForm);

  // Phase 0 navigation stack. The web portal pushes `order-detail`,
  // `purchase-request-detail` and `edit-address` as full views; these primitives
  // give the app the same model. Phases 4 and 7 add the screens that push them.
  const [routeStack, setRouteStack] = useState<PortalRoute[]>([]);
  const currentRoute = routeStack.length > 0 ? routeStack[routeStack.length - 1] : null;

  function pushRoute(route: PortalRoute) {
    setRouteStack((current) => [...current, route]);
  }

  function popRoute() {
    setRouteStack((current) => current.slice(0, -1));
  }

  function resetToTab(tab: CustomerTab) {
    setRouteStack([]);
    setActiveTab(tab);
  }

  useEffect(() => {
    // Android hardware back pops the detail stack instead of leaving the app.
    if (routeStack.length === 0) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setRouteStack((current) => current.slice(0, -1));
      return true;
    });
    return () => subscription.remove();
  }, [routeStack.length]);

  return {
    otpExpiry,
    otpResendCooldown,
    resetOtpTimers,
    ratingDialogOrder,
    setRatingDialogOrder,
    deliveryRatingValue,
    setDeliveryRatingValue,
    submitRating,
    addressForm,
    setAddressField,
    clearAddressForm,
    handlePinnedLocation,
    handleOutsideServiceArea,
    useCurrentLocation,
    resolvingPinnedAddress,
    handleSaveAddress,
    twoFactorEnabled,
    loginAlertsEnabled,
    rememberDeviceEnabled,
    savingSecurity,
    saveSecuritySetting,
    persistRememberDevice,
    pendingCancelReplacement,
    setPendingCancelReplacement,
    cancellingReplacement,
    confirmCancelReplacement,
    cartUnitCount,
    ordersTab,
    setOrdersTab,
    filterDialogVisible,
    setFilterDialogVisible,
    orderFilterStatus,
    setOrderFilterStatus,
    orderFilterDateFrom,
    setOrderFilterDateFrom,
    orderFilterDateTo,
    setOrderFilterDateTo,
    orderConfirmationVisible,
    setOrderConfirmationVisible,
    lastPlacedOrderNumber,
    unifiedCartItems,
    selectedUnifiedCartItems,
    selectedDepositRefunded,
    routeStack,
    currentRoute,
    pushRoute,
    popRoute,
    resetToTab,
    fontsLoaded,
    width,
    isDesktop,
    booting,
    setBooting,
    loading,
    setLoading,
    refreshing,
    setRefreshing,
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
    setSendingEmailOtp,
    verifyingEmailOtp,
    setVerifyingEmailOtp,
    error,
    setError,
    rememberMe,
    setRememberMe,
    user,
    setUser,
    profile,
    setProfile,
    products,
    setProducts,
    orders,
    setOrders,
    tracking,
    setTracking,
    notifications,
    setNotifications,
    unreadNotifications,
    setUnreadNotifications,
    replacements,
    setReplacements,
    eligibleEmptyItems,
    setEligibleEmptyItems,
    emptyCasesByProductId,
    setEmptyCasesByProductId,
    recordingEmptyProductId,
    setRecordingEmptyProductId,
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
    setAddressSearchResults,
    searchingAddress,
    setSearchingAddress,
    feedbackOrderId,
    setFeedbackOrderId,
    feedbackItems,
    setFeedbackItems,
    feedbackRatingValue,
    setFeedbackRatingValue,
    selectedFeedbackOptions,
    setSelectedFeedbackOptions,
    submittingFeedback,
    setSubmittingFeedback,
    cart,
    setCart,
    mixedCart,
    setMixedCart,
    selectedCartIds,
    setSelectedCartIds,
    notes,
    setNotes,
    deliveryDate,
    setDeliveryDate,
    mixedCaseBuilderVisible,
    setMixedCaseBuilderVisible,
    editingMixedCase,
    setEditingMixedCase,
    placingOrder,
    setPlacingOrder,
    savingProfile,
    setSavingProfile,
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
    setSharingReceipt,
    replacementOrder,
    setReplacementOrder,
    replacementEvidence,
    setReplacementEvidence,
    uploadingEvidence,
    setUploadingEvidence,
    submittingReplacement,
    setSubmittingReplacement,
    uploadingAvatar,
    setUploadingAvatar,
    welcomeMode,
    setWelcomeMode,
    notificationPrefs,
    setNotificationPrefs,
    securityForm,
    setSecurityForm,
    sendingOtp,
    setSendingOtp,
    verifyingOtp,
    setVerifyingOtp,
    resettingPassword,
    setResettingPassword,
    otpVerified,
    setOtpVerified,
    pendingCheckoutRef,
    cartHydratedRef,
    screenOpacity,
    screenTranslateY,
    hydrateStoredCart,
    hydrateProfileForm,
    loadNotificationPreferences,
    persistNotificationPreferences,
    refreshData,
    handleLogin,
    handleRequestRegistrationOtp,
    handleVerifyRegistrationOtp,
    handleRegister,
    resetSessionState,
    handleLogout,
    updateCart,
    toggleCartSelection,
    removeMixedCartItem,
    openMixedCaseBuilder,
    closeMixedCaseBuilder,
    saveMixedCase,
    handlePlaceOrder,
    handleSaveProfile,
    handleCancelOrder,
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
    feedbackByOrderId,
    reviewedOrderIds,
    currentFeedback,
    visibleFeedbackOptions,
    cartItems,
    selectedStandardCartItems,
    selectedMixedCartItems,
    cartTotal,
    mixedCartTotal,
    allCartTotal,
    selectedSubtotal,
    discountCasesAffected,
    configuredDiscountPercent,
    totalDiscount,
    selectedDepositCharged,
    checkoutTotal,
    cartLineCount,
    selectedCartLineCount,
    deliveredOrders,
    selectedTracking,
    categoryOptions,
    visibleProducts,
    purchaseRequests,
    purchaseOrders,
    customerInitials,
    profileAddress,
  };
}

export type CustomerPortalValue = ReturnType<typeof useCustomerPortalState>;

const CustomerPortalContext = createContext<CustomerPortalValue | null>(null);

export function CustomerPortalProvider({ children }: { children: React.ReactNode }) {
  const value = useCustomerPortalState();
  return <CustomerPortalContext.Provider value={value}>{children}</CustomerPortalContext.Provider>;
}

export function useCustomerPortal(): CustomerPortalValue {
  const value = useContext(CustomerPortalContext);
  if (!value) throw new Error("useCustomerPortal must be used inside CustomerPortalProvider");
  return value;
}
