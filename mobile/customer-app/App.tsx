import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { Poppins_400Regular } from "@expo-google-fonts/poppins/400Regular";
import { Poppins_500Medium } from "@expo-google-fonts/poppins/500Medium";
import { Poppins_600SemiBold } from "@expo-google-fonts/poppins/600SemiBold";
import { Poppins_700Bold } from "@expo-google-fonts/poppins/700Bold";
import { Poppins_800ExtraBold } from "@expo-google-fonts/poppins/800ExtraBold";
import {
  Bell,
  Check,
  ClipboardList,
  Eye,
  EyeOff,
  Home,
  Leaf,
  Lock,
  Mail,
  Package,
  Search,
  ShoppingCart,
  User,
} from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  cancelOrder,
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
  uploadCustomerAvatar,
  uploadReplacementEvidence,
  verifyPasswordResetOtp,
  type CustomerFeedbackItem,
  type CustomerProfileUpdateInput,
} from "./src/services/auth";
import { MixedCaseBuilder } from "./src/components/MixedCaseBuilder";
import { CustomerTrackingMap } from "./src/components/CustomerTrackingMap";
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
} from "./src/lib/customer-logic";
import { theme } from "./src/theme";
import { API_BASE_URL } from "./src/config/env";
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
} from "./src/types";

type CustomerTab = "home" | "cart" | "checkout" | "requests" | "orders" | "track" | "feedback" | "profile";
type CustomerProfileModal = "edit" | "security" | "notifications" | "address" | "empties" | null;
type AuthMode = "login" | "register";

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

export default function App() {
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
  const [orderStatusFilter, setOrderStatusFilter] = useState("ALL");
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");
  const [requestStatusFilter, setRequestStatusFilter] = useState("ALL");
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("ALL");
  const [cardQuantityByProductId, setCardQuantityByProductId] = useState<Record<string, number>>({});
  const [addressSearch, setAddressSearch] = useState("");
  const [addressSearchResults, setAddressSearchResults] = useState<Array<{ displayName: string; latitude: number; longitude: number }>>([]);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [feedbackOrderId, setFeedbackOrderId] = useState<string | null>(null);
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
  const [replacementQuantities, setReplacementQuantities] = useState<Record<string, string>>({});
  const [replacementReasons, setReplacementReasons] = useState<Record<string, string>>({});
  const [replacementDescription, setReplacementDescription] = useState("");
  const [replacementEvidence, setReplacementEvidence] = useState<string[]>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [submittingReplacement, setSubmittingReplacement] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<CustomerNotificationPreferences>(defaultNotificationPrefs);
  const [securityForm, setSecurityForm] = useState(initialSecurityForm);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
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
      setWelcomeVisible(true);
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
      setWelcomeVisible(true);
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
    setReplacementQuantities({});
    setReplacementReasons({});
    setReplacementDescription("");
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
      await placeOrder({
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
      // Fix: checkout removes only selected lines, matching the web cart behavior.
      setCart((current) => Object.fromEntries(Object.entries(current).filter(([productId]) => !selectedCartIds.has(productId))));
      setMixedCart((current) => current.filter((item) => !selectedCartIds.has(item.id)));
      setSelectedCartIds(new Set());
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

  async function handleSubmitReplacement() {
    if (!replacementOrder) return;
    const lines = (replacementOrder.items || []).flatMap((item) => {
      const quantity = Number(replacementQuantities[item.id] || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) return [];
      return [{
        originalOrderItemId: item.id,
        replacementProductId: item.product?.id,
        quantityToReplace: Math.floor(quantity),
        inputMode: "case" as const,
        reason: replacementReasons[item.id] || "",
        description: replacementDescription.trim() || undefined,
      }];
    });
    if (lines.length === 0) return setError("Enter a replacement quantity for at least one item.");
    if (lines.some((line) => !line.reason)) return setError("Select a replacement reason for each affected item.");
    const invalidLine = lines.find((line) => line.quantityToReplace > Number(replacementOrder.items?.find((item) => item.id === line.originalOrderItemId)?.quantity || 0));
    if (invalidLine) return setError("Replacement quantity cannot exceed the quantity in the delivered order.");
    if (replacementEvidence.length === 0) return setError("Attach at least one evidence photo.");
    setSubmittingReplacement(true);
    setError(null);
    try {
      await submitReplacementRequest({
        orderId: replacementOrder.id,
        numberDamagedItems: lines.reduce((sum, line) => sum + line.quantityToReplace, 0),
        damageType: lines[0].reason,
        description: replacementDescription.trim() || undefined,
        evidence: replacementEvidence,
        replacementLines: lines,
      });
      setReplacementOrder(null);
      setReplacementQuantities({});
      setReplacementReasons({});
      setReplacementDescription("");
      setReplacementEvidence([]);
      await refreshData(false, user?.userId);
      Alert.alert("Replacement Requested", "Your replacement request was submitted successfully.");
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
  const filteredRequests = useMemo(() => purchaseRequests.filter((order) => {
    const status = String(order.requestStatus || normalizeOrderStatus(order)).toUpperCase();
    const matchesStatus = requestStatusFilter === "ALL" || status === requestStatusFilter;
    const query = orderSearch.trim().toLowerCase();
    return matchesStatus && (!query || [order.purchaseRequestNumber, order.orderNumber, status].some((value) => String(value || "").toLowerCase().includes(query)));
  }), [orderSearch, purchaseRequests, requestStatusFilter]);
  const filteredOrders = useMemo(() => purchaseOrders.filter((order) => {
    const status = normalizeOrderStatus(order);
    const created = String(order.createdAt || "").slice(0, 10);
    const matchesStatus = orderStatusFilter === "ALL" || status === orderStatusFilter;
    const matchesFrom = !orderDateFrom || created >= orderDateFrom;
    const matchesTo = !orderDateTo || created <= orderDateTo;
    const query = orderSearch.trim().toLowerCase();
    return matchesStatus && matchesFrom && matchesTo && (!query || [order.purchaseOrderNumber, order.orderNumber, status].some((value) => String(value || "").toLowerCase().includes(query)));
  }), [orderDateFrom, orderDateTo, orderSearch, orderStatusFilter, purchaseOrders]);
  const customerInitials = getInitials(profile?.name || user?.name || "Customer");
  const profileAddress = formatAddress(profileForm);

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
        <ImageBackground
          source={require("../../public/customer-login-bg.png")}
          resizeMode="cover"
          style={styles.authBackground}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.authScrollContent}
            keyboardShouldPersistTaps="handled"
          >
          <View style={[styles.authCard, { width: Math.min(Math.max(width - 56, 280), 448) }]}>
            <View style={styles.authBrandHeader}>
              <Image source={require("../../public/aab-trading-shop.png")} style={styles.authLogo} resizeMode="contain" />
              <Text style={styles.authEyebrow}>ANN ANN'S BEVERAGES TRADING</Text>
              <Text style={styles.authTitleBlue}>AAB TRADING</Text>
              <Text style={styles.authTitleGreen}>SHOP</Text>
            </View>
            <View style={styles.authBody}>
              {authMode === "login" ? (
                <>
                  <View style={styles.leafDivider}>
                    <View style={styles.dividerLine} />
                    <Leaf size={16} color="#4aa13d" strokeWidth={2} />
                    <View style={styles.dividerLine} />
                  </View>
                  <Text style={styles.authTagline}>Track orders and manage deliveries from one place.</Text>
                </>
              ) : null}
            {authMode === "register" ? (
              <>
                <View style={styles.row}>
                  <View style={styles.authFieldColumn}>
                    <Text style={styles.authLabel}>First Name *</Text>
                    <TextInput style={styles.authInput} value={registration.firstName} onChangeText={(value) => setRegistration((current) => ({ ...current, firstName: value }))} placeholder="e.g. Juan" placeholderTextColor="#8a99b3" />
                  </View>
                  <View style={styles.authFieldColumn}>
                    <Text style={styles.authLabel}>Last Name *</Text>
                    <TextInput style={styles.authInput} value={registration.lastName} onChangeText={(value) => setRegistration((current) => ({ ...current, lastName: value }))} placeholder="e.g. Dela Cruz" placeholderTextColor="#8a99b3" />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={styles.authFieldColumn}>
                    <Text style={styles.authLabel}>Middle Name (Optional)</Text>
                    <TextInput style={styles.authInput} value={registration.middleName} onChangeText={(value) => setRegistration((current) => ({ ...current, middleName: value }))} placeholder="e.g. Santos" placeholderTextColor="#8a99b3" />
                  </View>
                  <View style={styles.authSuffixColumn}>
                    <Text style={styles.authLabel}>Suffix</Text>
                    <TextInput style={styles.authInput} value={registration.suffix} onChangeText={(value) => setRegistration((current) => ({ ...current, suffix: value }))} placeholder="Jr." placeholderTextColor="#8a99b3" />
                  </View>
                </View>
              </>
            ) : null}
            <View style={styles.authFieldGroup}>
              <Text style={styles.authLabel}>Email</Text>
              <View style={styles.authIconInputWrap}>
                <Mail size={16} color="#697a96" strokeWidth={2} />
                <TextInput style={styles.authIconInput} value={email} onChangeText={(value) => { setEmail(value); setEmailVerificationToken(""); }} autoCapitalize="none" keyboardType="email-address" placeholder="Enter email" placeholderTextColor="#8a99b3" />
              </View>
            </View>
            {authMode === "register" ? (
              <View style={styles.inlineActionRow}>
                <TextInput style={[styles.authInput, styles.inlineInput]} value={emailOtp} onChangeText={(value) => setEmailOtp(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" placeholder="6-digit OTP" placeholderTextColor="#8a99b3" />
                <Pressable style={styles.secondaryButtonCompact} onPress={emailVerificationToken ? undefined : handleRequestRegistrationOtp} disabled={sendingEmailOtp || Boolean(emailVerificationToken)}>
                  <Text style={styles.secondaryButtonText}>{emailVerificationToken ? "Verified" : sendingEmailOtp ? "Sending..." : "Send OTP"}</Text>
                </Pressable>
                {!emailVerificationToken && emailOtp.length === 6 ? (
                  <Pressable style={styles.secondaryButtonCompact} onPress={handleVerifyRegistrationOtp} disabled={verifyingEmailOtp}>
                    <Text style={styles.secondaryButtonText}>{verifyingEmailOtp ? "Verifying..." : "Verify"}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <View style={styles.authFieldGroup}>
              <Text style={styles.authLabel}>Password</Text>
              <View style={styles.authIconInputWrap}>
                <Lock size={16} color="#697a96" strokeWidth={2} />
                <TextInput style={styles.authIconInput} value={password} onChangeText={setPassword} secureTextEntry={!showPassword} placeholder="Enter password" placeholderTextColor="#8a99b3" />
                <Pressable style={styles.authEyeButton} onPress={() => setShowPassword((value) => !value)} accessibilityLabel={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff size={17} color="#697a96" /> : <Eye size={17} color="#697a96" />}
                </Pressable>
              </View>
            </View>
            {authMode === "register" ? (
              <View style={styles.authFieldGroup}>
                <Text style={styles.authLabel}>Confirm Password</Text>
                <TextInput style={styles.authInput} value={registration.confirmPassword} onChangeText={(value) => setRegistration((current) => ({ ...current, confirmPassword: value }))} secureTextEntry={!showPassword} placeholder="Confirm password" placeholderTextColor="#8a99b3" />
              </View>
            ) : (
              <Pressable style={styles.authRememberRow} onPress={() => setRememberMe((value) => !value)}>
                <View style={[styles.authCheckbox, rememberMe ? styles.authCheckboxChecked : null]}>
                  {rememberMe ? <Check size={12} color="#ffffff" strokeWidth={3} /> : null}
                </View>
                <Text style={styles.authRememberText}>Keep me logged in</Text>
              </Pressable>
            )}
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Pressable onPress={authMode === "login" ? handleLogin : handleRegister} disabled={loading}>
              <LinearGradient colors={["#3ca232", "#4aac35"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.authPrimaryButton, loading ? styles.disabledButton : null]}>
                <Text style={styles.authPrimaryButtonText}>{loading ? "Please wait..." : authMode === "login" ? "Log In" : "Create Account"}</Text>
              </LinearGradient>
            </Pressable>
            {authMode === "login" ? (
              <>
                <Pressable onPress={() => setForgotPasswordVisible(true)}>
                  <Text style={styles.authCenteredLink}>Forgot password?</Text>
                </Pressable>
                <View style={styles.continueDivider}>
                  <View style={styles.dividerLine} />
                  <View style={styles.continueLabel}>
                    <Leaf size={13} color="#4aa13d" />
                    <Text style={styles.continueLabelText}>OR CONTINUE WITH</Text>
                  </View>
                  <View style={styles.dividerLine} />
                </View>
                <Text style={styles.googleUnavailable}>Google sign-in is not configured yet.</Text>
                <View style={styles.authSwitchRow}>
                  <Text style={styles.authSwitchText}>Don&apos;t have an account? </Text>
                  <Pressable onPress={() => { setAuthMode("register"); setError(null); }}>
                    <Text style={styles.authSwitchLink}>Register</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.authSwitchRow}>
                <Text style={styles.authSwitchText}>Already have an account? </Text>
                <Pressable onPress={() => { setAuthMode("login"); setError(null); }}>
                  <Text style={styles.authSwitchLink}>Log In</Text>
                </Pressable>
              </View>
            )}
            </View>
          </View>
          </ScrollView>
          <ModalShell
            visible={forgotPasswordVisible}
            title="Reset Password"
            subtitle="Verify your email with OTP, then choose a new password."
            onClose={() => {
              setForgotPasswordVisible(false);
              resetSecurityState();
            }}
          >
            <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Account email" />
            <View style={styles.inlineActionRow}>
              <TextInput
                style={[styles.input, styles.inlineInput]}
                value={securityForm.otp}
                onChangeText={(value) => {
                  setSecurityForm((current) => ({ ...current, otp: value.replace(/\D/g, "").slice(0, 6) }));
                  setOtpVerified(false);
                }}
                keyboardType="number-pad"
                placeholder="6-digit OTP"
              />
              <Pressable style={styles.secondaryButtonCompact} onPress={handleRequestOtp} disabled={sendingOtp}>
                <Text style={styles.secondaryButtonText}>{sendingOtp ? "Sending..." : "Send OTP"}</Text>
              </Pressable>
            </View>
            <Pressable style={styles.modalOutlineButton} onPress={handleVerifyOtp} disabled={verifyingOtp || securityForm.otp.length !== 6}>
              <Text style={styles.outlineButtonText}>{verifyingOtp ? "Verifying..." : otpVerified ? "OTP Verified" : "Verify OTP"}</Text>
            </Pressable>
            <TextInput style={styles.input} value={securityForm.newPassword} onChangeText={(value) => setSecurityForm((current) => ({ ...current, newPassword: value }))} secureTextEntry placeholder="New password" />
            <TextInput style={styles.input} value={securityForm.confirmPassword} onChangeText={(value) => setSecurityForm((current) => ({ ...current, confirmPassword: value }))} secureTextEntry placeholder="Confirm password" />
            {!!error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable style={[styles.primaryButton, !otpVerified || resettingPassword ? styles.disabledButton : null]} onPress={handleChangePassword} disabled={!otpVerified || resettingPassword}>
              <Text style={styles.primaryButtonText}>{resettingPassword ? "Updating..." : "Reset Password"}</Text>
            </Pressable>
          </ModalShell>
        </ImageBackground>
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

            {activeTab === "home" ? (
              <>
                <View style={styles.catalogHeader}>
                  <View style={styles.catalogSearchWrap}>
                    <Search size={16} color="#64748b" />
                    <TextInput style={styles.catalogSearchInput} value={productSearch} onChangeText={setProductSearch} placeholder="Search products..." placeholderTextColor="#94a3b8" />
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    {categoryOptions.map((category) => (
                      <Pressable key={category} style={[styles.chip, productCategory === category ? styles.chipActive : null]} onPress={() => setProductCategory(category)}>
                        <Text style={[styles.chipText, productCategory === category ? styles.chipTextActive : null]}>{category === "ALL" ? "All categories" : category}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <View style={styles.catalogTitleRow}>
                    <View style={styles.flex}>
                      <Text style={styles.catalogTitle}>Product Catalog</Text>
                      <Text style={styles.catalogSubtitle}>Place your order and we&apos;ll deliver it to your store.</Text>
                    </View>
                    <Pressable style={styles.mixedCaseButton} onPress={() => openMixedCaseBuilder()}>
                      <Text style={styles.mixedCaseButtonText}>Build Mixed Case</Text>
                    </Pressable>
                  </View>
                </View>
                {visibleProducts.length === 0 ? <Text style={styles.emptyCatalogText}>No products match your search.</Text> : null}
                <View style={styles.productGrid}>
                  {visibleProducts.map((product) => {
                    const available = getAvailableQuantity(product);
                    const selectedQty = Math.min(available || 1, Math.max(1, cardQuantityByProductId[product.id] || 12));
                    const sizeLabel = Array.isArray(product.sizes) && product.sizes.length > 0 ? product.sizes.join(", ") : product.unit || "N/A";
                    return (
                      <View key={product.id} style={[styles.productCard, isDesktop ? styles.productCardDesktop : null]}>
                        <View style={styles.productSummaryRow}>
                          <View style={styles.productImageWrap}>
                            <Image source={{ uri: resolveImageUrl(product.imageUrl) }} style={styles.productImage} resizeMode="cover" />
                          </View>
                        <View style={styles.productInfo}>
                          <Text style={styles.productName}>{product.name}</Text>
                          <Text style={styles.subtle}>{product.sku} · {product.unit || "case"}</Text>
                          <Text style={styles.productPrice}>{formatPeso(Number(product.price || 0))}</Text>
                          <Text style={styles.productMeta}>Size: {sizeLabel}</Text>
                          <Text style={styles.productMeta}>Qty/Unit: {Number(product.quantityPerUnit || 0) > 0 ? product.quantityPerUnit : "N/A"}</Text>
                          <Text style={available > 0 ? styles.stockText : styles.outOfStockText}>{available > 0 ? `${available} available` : "Out of stock"}</Text>
                        </View>
                        </View>
                        <Text style={styles.quantityLabel}>Quantity</Text>
                        <View style={styles.productActions}>
                          <View style={styles.qtyControls}>
                            <Pressable style={styles.qtyButton} onPress={() => setCardQuantityByProductId((current) => ({ ...current, [product.id]: Math.max(1, selectedQty - 1) }))}>
                              <Text style={styles.qtyButtonText}>−</Text>
                            </Pressable>
                            <Text style={styles.qtyValue}>{selectedQty}</Text>
                            <Pressable style={styles.qtyButton} onPress={() => setCardQuantityByProductId((current) => ({ ...current, [product.id]: Math.min(available, selectedQty + 1) }))} disabled={selectedQty >= available}>
                              <Text style={styles.qtyButtonText}>+</Text>
                            </Pressable>
                          </View>
                        </View>
                        <View style={styles.quantityPresets}>
                          {[12, 24, 36, 48].map((quantity) => (
                            <Pressable key={quantity} style={[styles.quantityPreset, selectedQty === quantity ? styles.quantityPresetActive : null, quantity > available ? styles.disabledButton : null]} disabled={available <= 0 || quantity > available} onPress={() => setCardQuantityByProductId((current) => ({ ...current, [product.id]: quantity }))}>
                              <Text style={[styles.quantityPresetText, selectedQty === quantity ? styles.quantityPresetTextActive : null]}>{quantity}</Text>
                            </Pressable>
                          ))}
                        </View>
                        <Pressable style={[styles.addButton, available <= 0 ? styles.disabledButton : null]} onPress={() => updateCart(product.id, Math.min(available, (cart[product.id] || 0) + selectedQty))} disabled={available <= 0}>
                          <ShoppingCart size={13} color="#ffffff" />
                          <Text style={styles.primaryButtonText}>{available > 0 ? "Add to Order" : "Out of Stock"}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Cart summary</Text>
                  {selectedCartLineCount === 0 ? <Text style={styles.subtle}>No selected items. Go back to cart and select item(s) to checkout.</Text> : null}
                  {selectedStandardCartItems.map((item) => (
                    <View key={item.product.id} style={styles.cartRow}>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>{item.product.name}</Text>
                        <Text style={styles.subtle}>Qty {item.quantity}</Text>
                      </View>
                      <Text style={styles.listTitle}>{formatPeso(item.total)}</Text>
                    </View>
                  ))}
                  {selectedMixedCartItems.map((item) => (
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
                      <Text style={styles.listTitle}>{formatPeso(item.unitPrice * item.quantity)}</Text>
                    </View>
                  ))}
                  <Text style={styles.totalText}>Total: {formatPeso(allCartTotal)}</Text>
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
                  <View style={styles.sectionHeadingRow}>
                    <Text style={styles.sectionTitle}>My cart</Text>
                    {cartLineCount > 0 ? (
                      <Pressable onPress={() => setSelectedCartIds(selectedCartLineCount === cartLineCount ? new Set() : new Set([...cartItems.map((item) => item.product.id), ...mixedCart.map((item) => item.id)]))}>
                        <Text style={styles.authLink}>{selectedCartLineCount === cartLineCount ? "Clear all" : "Select all"}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {cartLineCount === 0 ? <Text style={styles.subtle}>Your cart is empty.</Text> : null}
                  {selectedStandardCartItems.map((item) => (
                    <View key={item.product.id} style={[styles.listItem, selectedCartIds.has(item.product.id) ? styles.listItemSelected : null]}>
                      <Pressable style={[styles.checkbox, selectedCartIds.has(item.product.id) ? styles.checkboxChecked : null]} onPress={() => toggleCartSelection(item.product.id)} accessibilityLabel={`Select ${item.product.name}`}>
                        <Text style={styles.checkboxText}>{selectedCartIds.has(item.product.id) ? "✓" : ""}</Text>
                      </Pressable>
                      <Image source={{ uri: resolveImageUrl(item.product.imageUrl) }} style={styles.cartImage} />
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
                  {selectedMixedCartItems.map((item) => (
                    <View key={item.id} style={[styles.listItem, selectedCartIds.has(item.id) ? styles.listItemSelected : null]}>
                      <Pressable style={[styles.checkbox, selectedCartIds.has(item.id) ? styles.checkboxChecked : null]} onPress={() => toggleCartSelection(item.id)} accessibilityLabel="Select mixed case">
                        <Text style={styles.checkboxText}>{selectedCartIds.has(item.id) ? "✓" : ""}</Text>
                      </Pressable>
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
                        <Pressable style={styles.qtyButton} onPress={() => removeMixedCartItem(item.id)}>
                          <Text style={styles.qtyButtonText}>×</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Cart total</Text>
                  <Text style={styles.totalText}>{formatPeso(selectedSubtotal)}</Text>
                  <Text style={styles.subtle}>{selectedCartLineCount} selected item(s)</Text>
                  <View style={styles.row}>
                    <Pressable style={styles.secondaryButton} onPress={() => setActiveTab("home")}>
                      <Text style={styles.secondaryButtonText}>Continue Shopping</Text>
                    </Pressable>
                    <Pressable style={[styles.primaryButton, selectedCartLineCount === 0 ? styles.disabledButton : null]} onPress={() => setActiveTab("checkout")} disabled={selectedCartLineCount === 0}>
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
                  <View style={styles.summaryLine}><Text style={styles.subtle}>Subtotal</Text><Text style={styles.listTitle}>{formatPeso(selectedSubtotal)}</Text></View>
                  {selectedDepositCharged > 0 ? <View style={styles.summaryLine}><Text style={styles.subtle}>New returnable-container deposit</Text><Text style={styles.listTitle}>+{formatPeso(selectedDepositCharged)}</Text></View> : null}
                  <View style={styles.summaryLine}><Text style={styles.subtle}>Discount</Text><Text style={styles.discountText}>-{formatPeso(totalDiscount)}</Text></View>
                  <Text style={styles.discountHint}>Discounts apply to orders totaling 50 cases or packs.</Text>
                  <Text style={styles.totalText}>Total: {formatPeso(checkoutTotal)}</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Delivery address</Text>
                  <InfoRow label="Recipient" value={profile?.name || user.name || ""} />
                  <InfoRow label="Phone" value={profile?.phone || ""} />
                  <InfoRow label="Address" value={profileAddress} />
                  <TextInput style={[styles.input, styles.multilineInput]} value={notes} onChangeText={setNotes} placeholder="Add note for delivery" multiline />
                  <Text style={styles.inputLabel}>Delivery date</Text>
                  <TextInput style={styles.input} value={deliveryDate} onChangeText={setDeliveryDate} placeholder="YYYY-MM-DD" />
                  <View style={styles.row}>
                    <Pressable style={styles.secondaryButton} onPress={() => openProfileModal("address")}>
                      <Text style={styles.secondaryButtonText}>Edit Address</Text>
                    </Pressable>
                    <Pressable style={[styles.primaryButton, placingOrder || selectedCartLineCount === 0 || deliveryDate < localDateInput() ? styles.disabledButton : null]} onPress={handlePlaceOrder} disabled={placingOrder || selectedCartLineCount === 0 || deliveryDate < localDateInput()}>
                      <Text style={styles.primaryButtonText}>{placingOrder ? "Placing Order..." : "Place Order"}</Text>
                    </Pressable>
                  </View>
                </View>
              </>
            ) : null}

            {activeTab === "requests" ? (
              <>
                <View style={styles.pageHeading}>
                  <Text style={styles.profilePageTitle}>Purchase Request</Text>
                  <Text style={styles.profilePageSubtitle}>Review submitted requests and warehouse approval status.</Text>
                </View>
                <View style={styles.card}>
                  <TextInput style={styles.input} value={orderSearch} onChangeText={setOrderSearch} placeholder="Search purchase requests..." />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    {["ALL", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].map((status) => (
                      <Pressable key={status} style={[styles.chip, requestStatusFilter === status ? styles.chipActive : null]} onPress={() => setRequestStatusFilter(status)}>
                        <Text style={[styles.chipText, requestStatusFilter === status ? styles.chipTextActive : null]}>{formatStatusLabel(status)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  {filteredRequests.length === 0 ? <Text style={styles.subtle}>No purchase requests found.</Text> : null}
                  {filteredRequests.map((order) => (
                    <Pressable key={order.id} style={[styles.orderCard, selectedOrderId === order.id ? styles.listItemSelected : null]} onPress={() => setSelectedOrderId(order.id)}>
                      <View style={styles.sectionHeadingRow}>
                        <Text style={styles.featureTitle}>{order.purchaseRequestNumber || order.orderNumber}</Text>
                        <StatusBadge status={order.requestStatus || order.status} />
                      </View>
                      <Text style={styles.subtle}>{formatDate(order.createdAt)}</Text>
                      <Text style={styles.totalText}>{formatPeso(Number(order.totalAmount || 0))}</Text>
                      {isOrderCancellable(order) ? (
                        <Pressable style={styles.outlineActionButton} onPress={() => setPendingCancellationOrder(order)}>
                          <Text style={styles.outlineActionButtonText}>Cancel Request</Text>
                        </Pressable>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
                {selectedOrder && purchaseRequests.some((order) => order.id === selectedOrder.id) ? (
                  <OrderDetailCard order={selectedOrder} replacements={replacements} onTrack={() => setActiveTab("track")} onCancel={() => setPendingCancellationOrder(selectedOrder)} />
                ) : null}
              </>
            ) : null}

            {activeTab === "orders" ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.profilePageTitle}>Purchase Order</Text>
                  <TextInput style={styles.input} value={orderSearch} onChangeText={setOrderSearch} placeholder="Search orders..." />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    {["ALL", "PENDING", "PROCESSING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].map((status) => (
                      <Pressable key={status} style={[styles.chip, orderStatusFilter === status ? styles.chipActive : null]} onPress={() => setOrderStatusFilter(status)}>
                        <Text style={[styles.chipText, orderStatusFilter === status ? styles.chipTextActive : null]}>{formatStatusLabel(status)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <View style={styles.row}>
                    <TextInput style={[styles.input, styles.flexInput]} value={orderDateFrom} onChangeText={setOrderDateFrom} placeholder="Date from YYYY-MM-DD" />
                    <TextInput style={[styles.input, styles.flexInput]} value={orderDateTo} onChangeText={setOrderDateTo} placeholder="Date to YYYY-MM-DD" />
                  </View>
                  {filteredOrders.length === 0 ? <Text style={styles.subtle}>No purchase orders found.</Text> : null}
                  {filteredOrders.map((order) => (
                    <Pressable
                      key={order.id}
                      style={[styles.listItem, selectedOrder?.id === order.id ? styles.listItemSelected : null]}
                      onPress={() => setSelectedOrderId(order.id)}
                    >
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>{order.purchaseOrderNumber || order.orderNumber}</Text>
                        <StatusBadge status={order.status} />
                      </View>
                      <Text style={styles.listTitle}>{formatPeso(Number(order.totalAmount || 0))}</Text>
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
                      {isOrderCancellable(selectedOrder) ? (
                        <Pressable style={styles.secondaryButton} onPress={() => setPendingCancellationOrder(selectedOrder)}>
                          <Text style={styles.secondaryButtonText}>Cancel Order</Text>
                        </Pressable>
                      ) : null}
                      <Pressable style={[styles.primaryButton, !isOrderTrackable(selectedOrder) ? styles.disabledButton : null]} onPress={() => setActiveTab("track")} disabled={!isOrderTrackable(selectedOrder)}>
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
                      <Pressable style={styles.outlineActionButton} onPress={() => setReceiptOrder(selectedOrder)}>
                        <Text style={styles.outlineActionButtonText}>View Receipt</Text>
                      </Pressable>
                      {String(selectedOrder.status || "").toUpperCase() === "DELIVERED" ? (
                        <Pressable style={styles.outlineActionButton} onPress={() => handleBuyAgain(selectedOrder)}>
                          <Text style={styles.outlineActionButtonText}>Buy Again</Text>
                        </Pressable>
                      ) : null}
                      {String(selectedOrder.status || "").toUpperCase() === "DELIVERED" && !replacements.some((record) => record.orderId === selectedOrder.id || record.orderNumber === selectedOrder.orderNumber) ? (
                        <Pressable style={styles.outlineActionButton} onPress={() => setReplacementOrder(selectedOrder)}>
                          <Text style={styles.outlineActionButtonText}>Request Replacement</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            {activeTab === "track" ? (
              <View style={styles.card}>
                <View style={styles.sectionHeadingRow}>
                  <Pressable onPress={() => setActiveTab("orders")}><Text style={styles.authLink}>‹ Orders</Text></Pressable>
                  <Text style={styles.sectionTitle}>Track Your Order</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {tracking.map((item) => (
                    <Pressable key={item.orderId} style={[styles.chip, selectedTracking?.orderId === item.orderId ? styles.chipActive : null]} onPress={() => setSelectedOrderId(item.orderId)}>
                      <Text style={[styles.chipText, selectedTracking?.orderId === item.orderId ? styles.chipTextActive : null]}>{item.orderNumber}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {tracking.length === 0 ? <Text style={styles.subtle}>No tracking updates yet.</Text> : null}
                {selectedTracking ? (
                  <View style={styles.trackCard}>
                    <View style={styles.sectionHeadingRow}>
                      <View><Text style={styles.featureTitle}>{selectedTracking.orderNumber}</Text><StatusBadge status={selectedTracking.orderStatus || selectedTracking.status || ""} /></View>
                      {selectedTracking.etaMinutes ? <Text style={styles.etaText}>{selectedTracking.etaMinutes} min ETA</Text> : null}
                    </View>
                    <View style={styles.timeline}>
                      {["Order Confirmed", "Preparing Order", "Out for Delivery", "Delivered"].map((label, index) => {
                        const active = index <= getOrderStageIndex(orders.find((order) => order.id === selectedTracking.orderId) || { id: selectedTracking.orderId, orderNumber: selectedTracking.orderNumber, status: selectedTracking.orderStatus || selectedTracking.status || "PENDING", totalAmount: 0, createdAt: selectedTracking.updatedAt });
                        return <View key={label} style={styles.timelineRow}><View style={[styles.timelineDot, active ? styles.timelineDotActive : null]} /><Text style={[styles.timelineText, active ? styles.timelineTextActive : null]}>{label}</Text></View>;
                      })}
                    </View>
                    <CustomerTrackingMap tracking={selectedTracking} />
                    {selectedTracking.driverName ? <InfoRow label="Driver" value={selectedTracking.driverName} /> : null}
                    {selectedTracking.driverPhone ? <InfoRow label="Phone" value={selectedTracking.driverPhone} /> : null}
                    {selectedTracking.tripNumber || selectedTracking.trip?.tripNumber ? <InfoRow label="Trip" value={selectedTracking.tripNumber || selectedTracking.trip?.tripNumber || ""} /> : null}
                    <Text style={styles.subtle}>Updated: {formatDate(selectedTracking.updatedAt)}</Text>
                  </View>
                ) : null}
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
                          <Text style={styles.subtle}>Rate delivery, then select at least one required feedback reason.</Text>
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
                          <Pressable
                            style={[styles.primaryButton, selectedFeedbackOptions.length === 0 ? { opacity: 0.5 } : null]}
                            onPress={handleSubmitFeedback}
                            disabled={submittingFeedback || selectedFeedbackOptions.length === 0}
                          >
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
            ) : null}
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

function formatStatusLabel(value?: string | null) {
  return String(value || "Pending")
    .trim()
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function resolveImageUrl(value?: string | null) {
  const path = String(value || "").trim();
  // Added: relative media paths returned by Django must resolve against the configured mobile API host.
  if (!path) return `${API_BASE_URL}/email-assets/ann-anns-logo.png`;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function StatusBadge({ status }: { status?: string | null }) {
  const normalized = String(status || "PENDING").toUpperCase();
  const success = ["APPROVED", "DELIVERED", "COMPLETED", "RESOLVED"].includes(normalized);
  const danger = ["CANCELLED", "REJECTED", "FAILED"].includes(normalized);
  const active = ["PROCESSING", "PREPARING", "OUT_FOR_DELIVERY", "IN_TRANSIT"].includes(normalized);
  return (
    <View style={[styles.statusBadge, success ? styles.statusBadgeSuccess : danger ? styles.statusBadgeDanger : active ? styles.statusBadgeActive : null]}>
      <Text style={[styles.statusBadgeText, success ? styles.statusBadgeTextSuccess : danger ? styles.statusBadgeTextDanger : active ? styles.statusBadgeTextActive : null]}>
        {formatStatusLabel(normalized)}
      </Text>
    </View>
  );
}

function OrderDetailCard({
  order,
  replacements,
  onTrack,
  onCancel,
}: {
  order: CustomerOrder;
  replacements: CustomerReplacement[];
  onTrack: () => void;
  onCancel: () => void;
}) {
  const linkedReplacement = replacements.find((record) => record.orderId === order.id || record.orderNumber === order.orderNumber);
  return (
    <View style={styles.card}>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.flex}>
          <Text style={styles.sectionTitle}>Order details</Text>
          <Text style={styles.featureTitle}>{order.purchaseOrderNumber || order.purchaseRequestNumber || order.orderNumber}</Text>
        </View>
        <StatusBadge status={order.requestStatus || order.status} />
      </View>
      <InfoRow label="Created" value={formatDate(order.createdAt)} />
      {order.deliveryDate ? <InfoRow label="Delivery date" value={formatDate(order.deliveryDate)} /> : null}
      {order.shippingAddress ? <InfoRow label="Delivery address" value={order.shippingAddress} /> : null}
      {(order.items || []).map((item) => (
        <View key={item.id} style={styles.cartRow}>
          <View style={styles.flex}>
            <Text style={styles.listTitle}>{item.itemType === "MIXED_CASE" ? `Mixed Case (${item.caseCapacity || 0} units)` : item.product?.name || "Product"}</Text>
            <Text style={styles.subtle}>Quantity: {item.quantity}</Text>
          </View>
          <Text style={styles.listTitle}>{formatPeso(Number(item.totalPrice || 0))}</Text>
        </View>
      ))}
      {order.notes ? <InfoRow label="Notes" value={order.notes} /> : null}
      {order.cancellationReason ? <View style={styles.cancellationBanner}><Text style={styles.statusBadgeTextDanger}>{order.cancellationReason}</Text></View> : null}
      {linkedReplacement ? (
        <View style={styles.replacementSummary}>
          <Text style={styles.listTitle}>{linkedReplacement.replacementNumber || "Replacement request"}</Text>
          <StatusBadge status={linkedReplacement.status} />
          <Text style={styles.subtle}>{linkedReplacement.reason || linkedReplacement.description || "Replacement request submitted."}</Text>
        </View>
      ) : null}
      <View style={styles.summaryLine}><Text style={styles.sectionTitle}>Total</Text><Text style={styles.totalText}>{formatPeso(Number(order.totalAmount || 0))}</Text></View>
      <View style={styles.row}>
        {isOrderCancellable(order) ? <Pressable style={styles.secondaryButton} onPress={onCancel}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable> : null}
        {isOrderTrackable(order) ? <Pressable style={styles.primaryButton} onPress={onTrack}><Text style={styles.primaryButtonText}>Track Order</Text></Pressable> : null}
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
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: "#cbd5e1", true: theme.colors.emerald }} thumbColor="#ffffff" />
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
  items: Array<{ id: string; label: string; icon?: string }>;
  activeTab: string;
  onSelect: (tab: string) => void;
}) {
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const active = item.id === activeTab;
        const iconColor = active ? theme.colors.emeraldDark : "#334155";
        const icon = item.id === "home"
          ? <Home size={17} color={iconColor} />
          : item.id === "requests"
            ? <ClipboardList size={17} color={iconColor} />
            : item.id === "orders"
              ? <Package size={17} color={iconColor} />
              : <User size={17} color={iconColor} />;
        return (
          <Pressable key={item.id} style={[styles.bottomNavItem, active ? styles.bottomNavItemActive : null]} onPress={() => onSelect(item.id)}>
            <View style={[styles.bottomNavIconWrap, active ? styles.bottomNavIconWrapActive : null]}>
              {icon}
              <Text style={[styles.bottomNavGlyph, active ? styles.bottomNavGlyphActive : null]}>{item.icon}</Text>
            </View>
            <Text style={[styles.bottomNavLabel, active ? styles.bottomNavLabelActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SideNavigation({ activeTab, onSelect }: { activeTab: string; onSelect: (tab: string) => void }) {
  const items = [
    { id: "home", label: "Home", icon: Home },
    { id: "requests", label: "Purchase Request", icon: ClipboardList },
    { id: "orders", label: "Purchase Order", icon: Package },
    { id: "profile", label: "Profile", icon: User },
  ];

  return (
    <View style={styles.sideNav}>
      {items.map((item) => {
        const active = item.id === activeTab;
        const Icon = item.icon;
        return (
          <Pressable key={item.id} style={[styles.sideNavItem, active ? styles.sideNavItemActive : null]} onPress={() => onSelect(item.id)}>
            <Icon size={17} color={active ? theme.colors.emeraldDark : "#475569"} />
            <Text style={[styles.sideNavLabel, active ? styles.sideNavLabelActive : null]}>{item.label}</Text>
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

function escapeReceiptHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildReceiptHtml(order: CustomerOrder) {
  const itemRows = (order.items || []).map((item) => `
    <tr>
      <td>${escapeReceiptHtml(item.product?.name || (item.itemType === "MIXED_CASE" ? "Mixed Case" : "Product"))}</td>
      <td style="text-align:center">${Number(item.quantity || 0)}</td>
      <td style="text-align:right">${escapeReceiptHtml(formatPeso(Number(item.totalPrice || 0)))}</td>
    </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;color:#0f172a;padding:28px}h1{color:#123e73;margin:0}small{color:#64748b}
    .meta{margin:22px 0;line-height:1.65}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left}
    .total{font-size:20px;font-weight:800;text-align:right;margin-top:20px;color:#047857}
  </style></head><body><h1>AAB TRADING SHOP</h1><small>Ann Ann's Beverages Trading · Official Delivery Receipt</small>
    <div class="meta"><strong>Receipt:</strong> RCT-${escapeReceiptHtml(order.orderNumber)}<br><strong>Customer:</strong> ${escapeReceiptHtml(order.shippingName)}<br><strong>Address:</strong> ${escapeReceiptHtml(order.shippingAddress)}<br><strong>Date:</strong> ${escapeReceiptHtml(formatDate(order.createdAt))}</div>
    <table><thead><tr><th>Product</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div class="total">Total: ${escapeReceiptHtml(formatPeso(Number(order.totalAmount || 0)))}</div></body></html>`;
}

function formatAddress(form: CustomerProfileUpdateInput) {
  return [form.address, form.city, form.province, form.zipCode].filter((value) => value && value.trim()).join(", ");
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.canvas },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: theme.colors.canvas },
  authBackground: { flex: 1, width: "100%" },
  authScrollContent: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, paddingVertical: 12 },
  authCard: {
    width: "100%",
    maxWidth: 448,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#d9e4e5",
    borderRadius: 20,
    backgroundColor: "#ffffff",
    shadowColor: "#0f435e",
    shadowOpacity: 0.12,
    shadowRadius: 23,
    shadowOffset: { width: 0, height: 18 },
    elevation: 7,
  },
  authBrandHeader: { alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#e7eded", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  authLogo: { width: 84, height: 84 },
  authEyebrow: { marginTop: 6, color: "#3e9a35", fontSize: 8, fontFamily: "Poppins_600SemiBold", letterSpacing: 1.45 },
  authTitleBlue: { marginTop: 2, color: "#1452a1", fontSize: 22, lineHeight: 24, fontFamily: "Poppins_800ExtraBold", letterSpacing: -0.4 },
  authTitleGreen: { color: "#3f9a35", fontSize: 22, lineHeight: 23, fontFamily: "Poppins_800ExtraBold", letterSpacing: -0.4 },
  authBody: { gap: 7, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  leafDivider: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4 },
  dividerLine: { height: 1, flex: 1, backgroundColor: "#dce5e6" },
  authTagline: { paddingHorizontal: 4, textAlign: "center", color: "#5d6d88", fontSize: 13, lineHeight: 17, fontFamily: "Poppins_400Regular" },
  authFieldGroup: { gap: 6 },
  authFieldColumn: { flex: 1, minWidth: 140, gap: 6 },
  authSuffixColumn: { width: 92, gap: 6 },
  authLabel: { color: "#324766", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  authInput: { height: 44, borderWidth: 1, borderColor: "#d5dee4", borderRadius: 12, backgroundColor: "#ffffff", paddingHorizontal: 12, color: "#0f172a", fontSize: 15, fontFamily: "Poppins_400Regular" },
  authIconInputWrap: { height: 44, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: "#d5dee4", borderRadius: 12, backgroundColor: "#ffffff", paddingLeft: 12 },
  authIconInput: { flex: 1, height: "100%", paddingRight: 38, color: "#0f172a", fontSize: 15, fontFamily: "Poppins_400Regular", outlineStyle: "none" } as any,
  authEyeButton: { position: "absolute", right: 0, top: 0, bottom: 0, width: 40, alignItems: "center", justifyContent: "center" },
  authRememberRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  authCheckbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
  authCheckboxChecked: { borderColor: "#3e9f34", backgroundColor: "#3e9f34" },
  authRememberText: { color: "#4e5f79", fontSize: 12, fontFamily: "Poppins_400Regular" },
  authPrimaryButton: { height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", shadowColor: "#3f9637", shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  authPrimaryButtonText: { color: "#ffffff", fontSize: 14, fontFamily: "Poppins_700Bold" },
  authCenteredLink: { textAlign: "center", color: "#3f9a35", fontSize: 12, fontFamily: "Poppins_400Regular" },
  continueDivider: { marginVertical: 4, flexDirection: "row", alignItems: "center" },
  continueLabel: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, backgroundColor: "#ffffff" },
  continueLabelText: { color: "#7f8fa5", fontSize: 10, fontFamily: "Poppins_600SemiBold", letterSpacing: 0.8 },
  googleUnavailable: { textAlign: "center", color: "#64748b", fontSize: 12, fontFamily: "Poppins_400Regular" },
  authSwitchRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  authSwitchText: { color: "#475569", fontSize: 12, fontFamily: "Poppins_400Regular" },
  authSwitchLink: { color: "#3f9a35", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  heroCard: {
    backgroundColor: theme.colors.brandBlue,
    borderRadius: 28,
    padding: 22,
    gap: 8,
  },
  appHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
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
    backgroundColor: theme.colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
  },
  logoBadgeText: { color: theme.colors.white, fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  headerEyebrow: { color: "#64748b", fontSize: 8, fontFamily: "Poppins_400Regular", letterSpacing: 1.1 },
  appHeaderTitle: { color: theme.colors.brandBlue, fontSize: 20, lineHeight: 24, fontFamily: "Poppins_800ExtraBold", letterSpacing: -0.4 },
  appHeaderShop: { color: theme.colors.brandGreen },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerCartButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: theme.colors.brandBlue,
    shadowOpacity: 0,
    elevation: 0,
  },
  headerCartBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.colors.brandGreen,
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
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: theme.colors.brandBlue,
    shadowOpacity: 0,
    elevation: 0,
  },
  headerAvatarImage: { display: "none", width: 0, height: 0 },
  headerNotificationBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.rose,
  },
  headerGlyph: { display: "none" },
  eyebrow: { color: "#bbf7d0", fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  title: { color: theme.colors.white, fontSize: 28, fontWeight: "800" },
  subtle: { color: "#78716c", fontSize: 14 },
  subtleOnDark: { color: "#d1fae5", fontSize: 14, lineHeight: 20 },
  bodyText: { color: "#44403c", fontSize: 14, lineHeight: 20 },
  pageHeading: {
    paddingHorizontal: 18,
    gap: 6,
  },
  profilePageTitle: { fontSize: 28, fontWeight: "800", color: theme.colors.brandBlue },
  profilePageSubtitle: { fontSize: 14, color: "#78716c", lineHeight: 20 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginHorizontal: 8,
    padding: 16,
    gap: 12,
    shadowOpacity: 0,
    elevation: 0,
  },
  summaryCard: {
    backgroundColor: "#fffdf8",
    borderRadius: 24,
    marginHorizontal: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: theme.colors.brandBlue,
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  summaryAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryAvatarText: { color: theme.colors.brandBlue, fontSize: 26, fontWeight: "800" },
  summaryAvatarImage: { width: 72, height: 72, borderRadius: 36, resizeMode: "cover" },
  summaryContent: { flex: 1, gap: 6 },
  summaryName: { fontSize: 21, fontWeight: "800", color: theme.colors.brandBlue },
  summaryMeta: { fontSize: 14, color: "#57534e" },
  roleBadge: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.emeraldSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  roleBadgeText: { color: theme.colors.emeraldDark, fontWeight: "700", fontSize: 12 },
  sectionTitle: { fontSize: 18, fontFamily: "Poppins_700Bold", color: "#0f172a" },
  featureTitle: { fontSize: 20, fontWeight: "800", color: theme.colors.brandBlue },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
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
    backgroundColor: theme.colors.emerald,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonCompact: {
    backgroundColor: theme.colors.emerald,
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
    backgroundColor: theme.colors.emeraldSoft,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonCompact: {
    backgroundColor: theme.colors.emeraldSoft,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 110,
  },
  secondaryButtonText: { color: theme.colors.emeraldDark, fontWeight: "700" },
  outlineActionButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffdf8",
  },
  outlineActionButtonText: { color: theme.colors.brandBlue, fontWeight: "700" },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  flexInput: { flex: 1, minWidth: 140 },
  shortInput: { width: 100 },
  authTabs: { flexDirection: "row", padding: 4, borderRadius: 14, backgroundColor: theme.colors.surfaceMuted },
  authTab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 11 },
  authTabActive: { backgroundColor: theme.colors.surface },
  authTabText: { color: theme.colors.textMuted, fontWeight: "700" },
  authTabTextActive: { color: theme.colors.emeraldDark },
  passwordWrap: { position: "relative", justifyContent: "center" },
  passwordInput: { paddingRight: 66 },
  passwordToggle: { position: "absolute", right: 12, padding: 8 },
  passwordToggleText: { color: theme.colors.emeraldDark, fontWeight: "700", fontSize: 12 },
  authLink: { color: theme.colors.emeraldDark, fontWeight: "700" },
  dangerLink: { color: theme.colors.danger, fontWeight: "700" },
  chipRow: { gap: 8, paddingVertical: 2 },
  chip: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: theme.colors.surface },
  chipActive: { borderColor: theme.colors.emerald, backgroundColor: theme.colors.emeraldSoft },
  chipText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: theme.colors.emeraldDark },
  portalBody: { flex: 1, flexDirection: "row", minHeight: 0 },
  scrollContent: { paddingTop: 0, paddingBottom: 96, gap: 12 },
  catalogHeader: { marginHorizontal: 8, marginTop: 12, padding: 12, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "#d1fae5", backgroundColor: "#ffffff" },
  catalogSearchWrap: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#f9fbfa", paddingHorizontal: 12 },
  catalogSearchInput: { flex: 1, height: 40, color: "#334155", fontSize: 14, fontFamily: "Poppins_400Regular", outlineStyle: "none" } as any,
  catalogTitleRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  catalogTitle: { color: "#0f172a", fontSize: 24, lineHeight: 28, fontFamily: "Poppins_800ExtraBold", letterSpacing: -0.5 },
  catalogSubtitle: { marginTop: 4, color: "#64748b", fontSize: 14, fontFamily: "Poppins_400Regular" },
  mixedCaseButton: { borderRadius: 12, backgroundColor: "#0284c7", paddingHorizontal: 14, paddingVertical: 10 },
  mixedCaseButtonText: { color: "#ffffff", fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  emptyCatalogText: { marginHorizontal: 12, color: "#64748b", fontSize: 14, fontFamily: "Poppins_400Regular" },
  productGrid: { marginHorizontal: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: 8 },
  productCard: { width: "48.8%", borderWidth: 1, borderColor: "#d1fae5", borderRadius: 8, padding: 6, paddingBottom: 10, gap: 4, backgroundColor: theme.colors.surface, shadowColor: "#101828", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  productCardDesktop: { width: "31.9%", borderRadius: 16, padding: 14, gap: 8 },
  productSummaryRow: { flexDirection: "row", gap: 6 },
  productImageWrap: { width: "48%", borderRadius: 8, overflow: "hidden", backgroundColor: "#f3f8f3" },
  productImage: { width: "100%", height: 92, borderRadius: 6, resizeMode: "cover", backgroundColor: "#f3f8f3" },
  productInfo: { minWidth: 0, flex: 1, gap: 1 },
  productName: { color: "#0f172a", fontSize: 16, lineHeight: 19, fontFamily: "Poppins_600SemiBold" },
  productPrice: { color: "#0f172a", fontSize: 15, lineHeight: 18, fontFamily: "Poppins_700Bold" },
  productMeta: { color: "#64748b", fontSize: 11, lineHeight: 15, fontFamily: "Poppins_400Regular" },
  stockText: { color: theme.colors.emeraldDark, fontSize: 11, fontFamily: "Poppins_500Medium" },
  outOfStockText: { color: theme.colors.danger },
  quantityLabel: { color: "#334155", fontSize: 11, fontFamily: "Poppins_600SemiBold" },
  productActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  quantityPresets: { flexDirection: "row", gap: 4 },
  quantityPreset: { flex: 1, borderRadius: 4, paddingVertical: 4, alignItems: "center", backgroundColor: "#f1f5f9" },
  quantityPresetActive: { backgroundColor: "#059669" },
  quantityPresetText: { color: "#475569", fontSize: 10, fontFamily: "Poppins_500Medium" },
  quantityPresetTextActive: { color: "#ffffff" },
  addButton: { minHeight: 28, flexDirection: "row", gap: 4, backgroundColor: theme.colors.emerald, borderRadius: 6, paddingVertical: 6, alignItems: "center", justifyContent: "center" },
  disabledButton: { opacity: 0.45 },
  sectionHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface },
  checkboxChecked: { borderColor: theme.colors.emerald, backgroundColor: theme.colors.emerald },
  checkboxText: { color: theme.colors.white, fontWeight: "900" },
  cartImage: { width: 54, height: 54, borderRadius: 10, resizeMode: "contain", backgroundColor: theme.colors.surfaceSoft },
  summaryLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  discountText: { color: theme.colors.emeraldDark, fontWeight: "800" },
  discountHint: { color: theme.colors.textMuted, fontSize: 12 },
  multilineInput: { minHeight: 90, textAlignVertical: "top" },
  inputLabel: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
  orderCard: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 14, gap: 8, backgroundColor: theme.colors.surface },
  listItem: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  listItemSelected: {
    borderColor: "#ea580c",
    backgroundColor: theme.colors.emeraldSoft,
  },
  listTitle: { fontSize: 15, fontWeight: "700", color: theme.colors.brandBlue },
  qtyControls: { width: "100%", minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "#d1fae5", borderRadius: 6, paddingHorizontal: 4, backgroundColor: "#ffffff" },
  cartActions: { alignItems: "center", gap: 8 },
  cartEditButton: {
    borderWidth: 1,
    borderColor: theme.colors.borderGreen,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.colors.emeraldSoft,
  },
  cartEditButtonText: { color: theme.colors.emeraldDark, fontWeight: "700", fontSize: 12 },
  qtyButton: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  qtyButtonText: { color: theme.colors.emeraldDark, fontWeight: "800", fontSize: 18 },
  qtyValue: { minWidth: 20, textAlign: "center", color: "#44403c", fontWeight: "700" },
  cartRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  totalText: { fontSize: 18, fontWeight: "800", color: theme.colors.emeraldDark },
  trackCard: {
    backgroundColor: theme.colors.emeraldSoft,
    borderRadius: 18,
    padding: 14,
    gap: 4,
  },
  etaText: { color: theme.colors.emeraldDark, fontWeight: "800" },
  timeline: { gap: 0, marginVertical: 4 },
  timelineRow: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 12 },
  timelineDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: theme.colors.border },
  timelineDotActive: { backgroundColor: theme.colors.emerald },
  timelineText: { color: theme.colors.textMuted, fontSize: 13 },
  timelineTextActive: { color: theme.colors.text, fontWeight: "700" },
  mapPlaceholder: { minHeight: 150, borderRadius: 16, padding: 16, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.colors.blueSoft, borderWidth: 1, borderColor: "#bfdbfe" },
  mapTitle: { color: theme.colors.brandBlue, fontWeight: "800" },
  mapCoordinates: { color: theme.colors.brandBlue, fontVariant: ["tabular-nums"] },
  statusBadge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: theme.colors.amberSoft },
  statusBadgeSuccess: { backgroundColor: theme.colors.emeraldSoft },
  statusBadgeDanger: { backgroundColor: theme.colors.roseSoft },
  statusBadgeActive: { backgroundColor: theme.colors.blueSoft },
  statusBadgeText: { color: "#92400e", fontSize: 11, fontWeight: "800" },
  statusBadgeTextSuccess: { color: theme.colors.emeraldDark },
  statusBadgeTextDanger: { color: theme.colors.danger },
  statusBadgeTextActive: { color: theme.colors.brandBlue },
  cancellationBanner: { borderRadius: 12, padding: 12, backgroundColor: theme.colors.roseSoft },
  replacementSummary: { borderRadius: 14, padding: 12, gap: 7, backgroundColor: theme.colors.surfaceMuted },
  replacementLine: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 12, gap: 9, backgroundColor: theme.colors.surfaceSoft },
  evidenceRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  evidenceImage: { width: 74, height: 74, borderRadius: 12, backgroundColor: theme.colors.surfaceMuted },
  removeEvidenceButton: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.danger },
  removeEvidenceText: { color: theme.colors.white, fontSize: 10, fontWeight: "900" },
  receiptHeader: { alignItems: "center", gap: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  feedbackHistoryCard: {
    backgroundColor: theme.colors.emeraldSoft,
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
    borderColor: theme.colors.border,
    backgroundColor: "#fffdf8",
    alignItems: "center",
    justifyContent: "center",
  },
  ratingButtonActive: {
    backgroundColor: "#f59e0b",
    borderColor: "#f59e0b",
  },
  ratingButtonText: {
    color: theme.colors.brandBlue,
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
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fffdf8",
  },
  feedbackOptionRowActive: {
    backgroundColor: theme.colors.emeraldSoft,
    borderColor: "#fb923c",
  },
  feedbackOptionText: {
    color: theme.colors.brandBlue,
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
  infoValue: { color: theme.colors.brandBlue, fontSize: 14, fontWeight: "700", flex: 1, textAlign: "right" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 14,
  },
  menuIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  menuIconWrapDanger: {
    backgroundColor: "#fee2e2",
  },
  menuLabel: { color: theme.colors.brandBlue, fontSize: 15, fontWeight: "700" },
  menuLabelDanger: { color: "#b91c1c" },
  menuDescription: { color: "#78716c", fontSize: 13, marginTop: 2 },
  menuGlyph: { color: theme.colors.brandBlue, fontSize: 11, fontWeight: "800" },
  menuGlyphDanger: { color: "#b91c1c" },
  chevronText: { color: "#a8a29e", fontSize: 18, fontWeight: "700" },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 62,
    backgroundColor: "rgba(237,240,244,0.98)",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    shadowOpacity: 0,
    elevation: 6,
  },
  bottomNavItem: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 12,
  },
  bottomNavItemActive: { backgroundColor: "#ecfdf5" },
  bottomNavIconWrap: {
    height: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomNavIconWrapActive: {
    backgroundColor: "transparent",
  },
  bottomNavGlyph: { display: "none" },
  bottomNavGlyphActive: { display: "none" },
  bottomNavLabel: { color: "#334155", fontSize: 10, fontFamily: "Poppins_500Medium" },
  bottomNavLabelActive: { color: theme.colors.emeraldDark },
  sideNav: { width: 240, flexShrink: 0, gap: 6, borderRightWidth: 1, borderRightColor: "#e2e8f0", backgroundColor: "#ffffff", padding: 12 },
  sideNavItem: { height: 40, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 8, paddingHorizontal: 12 },
  sideNavItemActive: { backgroundColor: "#ecfdf5" },
  sideNavLabel: { color: "#475569", fontSize: 14, fontFamily: "Poppins_500Medium" },
  sideNavLabelActive: { color: theme.colors.emeraldDark },
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
  modalBackdropCentered: { flex: 1, padding: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(15, 23, 42, 0.45)" },
  welcomeCard: { width: "100%", maxWidth: 430, alignItems: "center", gap: 14, borderRadius: 26, padding: 24, backgroundColor: theme.colors.surface },
  welcomeIcon: { width: 68, height: 68, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.brandBlue },
  welcomeIconText: { color: theme.colors.white, fontSize: 18, fontWeight: "900" },
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
    borderBottomColor: theme.colors.border,
    gap: 12,
  },
  modalTitle: { color: theme.colors.brandBlue, fontSize: 20, fontWeight: "800" },
  closeGlyph: { color: "#78716c", fontSize: 16, fontWeight: "800" },
  modalBody: { padding: 18, gap: 14 },
  modalHelpText: { color: "#78716c", fontSize: 13, lineHeight: 18 },
  inlineActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inlineInput: { flex: 1 },
  searchResult: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 12, backgroundColor: theme.colors.surfaceSoft },
  notificationCard: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 12, gap: 5, backgroundColor: theme.colors.surface },
  notificationUnread: { borderColor: theme.colors.emerald, backgroundColor: theme.colors.emeraldSoft },
  reasonOption: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 12, backgroundColor: theme.colors.surface },
  reasonOptionSelected: { borderColor: theme.colors.emerald, backgroundColor: theme.colors.emeraldSoft },
  avatarEditor: { alignItems: "center", gap: 10 },
  profileAvatarImage: { width: 92, height: 92, borderRadius: 46, resizeMode: "cover", backgroundColor: theme.colors.surfaceMuted, borderWidth: 3, borderColor: theme.colors.emeraldSoft },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
  modalGhostButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 108,
  },
  modalGhostButtonText: { color: theme.colors.brandBlue, fontWeight: "700" },
  modalOutlineButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButtonText: { color: theme.colors.brandBlue, fontWeight: "700" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 18,
    padding: 14,
  },
});
