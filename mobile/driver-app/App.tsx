import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import Ionicons from "@expo/vector-icons/Ionicons";
// Must come first: patches an API expo-location still calls on web.
import "./src/lib/expo-location-web-shim";

import { Camera, CameraView } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFonts, Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold, Poppins_900Black } from "@expo-google-fonts/poppins";

import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
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
  fetchDriverProfile,
  fetchDriverTrips,
  fetchNotifications,
  clearNotifications,
  markAllNotificationsRead,
  getStoredUser,
  login,
  logout,
  pushDriverLocation,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  startTrip,
  updateTripStop,
  uploadPodImage,
  uploadProfileAvatar,
  updateDriverProfile,
  verifyLoginOtp,
  verifyPasswordResetOtp,
  type DriverProfileUpdateInput,
  type PodCaptureMetadata,
} from "./src/services/auth";
import { ApiError } from "./src/services/api";
import { API_BASE_URL } from "./src/config/env";
import { getTrackedTripId, startBackgroundTripTracking, stopBackgroundTripTracking } from "./src/services/background-location";
import { clearOfflineQueue, queueOfflineOperation, readOfflineQueue, syncOfflineQueue, type OfflineQueueItem } from "./src/services/offline-queue";
import { buildTripSearchText, getStartBlockedOrders, isUsableLocationSample, normalizeStatus } from "./src/lib/driver-logic";
import DriverNavigationMap from "./src/components/DriverNavigationMap";
import { ImagePreview } from "./src/components/ui/image-preview";
import { DRIVER_LICENSE_RESTRICTIONS, OptionSelect } from "./src/components/ui/option-select";
// Same timings the customer app and the web portal use, so a code expires and the
// resend unlocks on one schedule everywhere. src/lib/otp.test.ts holds this file to
// the shared source in shared/customer-logic.
import { OTP_EXPIRY_SECONDS, OTP_RESEND_COOLDOWN_SECONDS, formatOtpCountdown } from "./src/lib/otp";
import type { AuthUser, DriverNotification, DriverProfile, DriverTrip, DriverTripDropPoint, DriverTripLocation, DriverTripOrderItem } from "./src/types";

type DriverTab = "home" | "trips" | "history" | "profile";
type DriverProfileModal = "edit" | "security" | "notifications" | "notificationSettings" | "license" | null;
type StopActionMode = "complete" | "failed" | null;
type AuthModal = "login-otp" | "forgot-password" | null;
type ForgotPasswordStep = "email" | "otp" | "password";

type DriverNotificationPreferences = {
  tripNotifications: boolean;
  deliveryUpdates: boolean;
  systemAlerts: boolean;
};

type DriverSecurityPreferences = {
  twoFactorAuthentication: boolean;
  loginAlerts: boolean;
  rememberDevice: boolean;
};

const DRIVER_NOTIFICATION_PREFS_KEY = "driver_notification_preferences";
const DRIVER_SECURITY_PREFS_KEY = "driver_security_preferences";

const initialProfileForm: DriverProfileUpdateInput = {
  firstName: "",
  middleName: "",
  lastName: "",
  suffix: "",
  phone: "",
  emergencyContact: "",
  licenseNumber: "",
  licenseType: "",
  licenseExpiry: "",
};

const initialSecurityForm = {
  otp: "",
  newPassword: "",
  confirmPassword: "",
};

const defaultNotificationPrefs: DriverNotificationPreferences = {
  tripNotifications: true,
  deliveryUpdates: true,
  systemAlerts: true,
};

const defaultSecurityPrefs: DriverSecurityPreferences = {
  twoFactorAuthentication: false,
  loginAlerts: true,
  rememberDevice: true,
};

const HISTORY_PAGE_SIZE = 10;

// The driver portal's trip sheet snaps between these fractions of the viewport
// (mobileSheetSnapPoints in trip-detail-view.tsx). The app previously had a single
// fixed height, so the sheet could never be dragged up to a full-screen list and the
// stop actions at the bottom stayed cut off.
const TRIP_SHEET_SNAP_POINTS = [0.52, 0.88, 0.98];

// Same shape as the web portal's formatCurrency for order values.
function formatPeso(value: unknown): string {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPodDate(value: Date): string {
  return value.toLocaleDateString("en-PH", { day: "2-digit", month: "long", year: "numeric" });
}

function formatPodTime(value: Date): string {
  return value.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatDriverFullName(profile: DriverProfile | null, user: AuthUser | null): string {
  const fullName = [profile?.firstName, profile?.middleName, profile?.lastName, profile?.suffix]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  return fullName || String(profile?.name || user?.name || "Driver").trim() || "Driver";
}

function formatReverseGeocodeAddress(place: Location.LocationGeocodedAddress | undefined): string {
  if (!place) return "Location address unavailable";
  const parts = [place.name, place.street, place.district, place.subregion, place.city, place.region, place.postalCode, place.country];
  return [...new Set(parts.map((part) => String(part || "").trim()).filter(Boolean))].join(", ") || "Location address unavailable";
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
    Poppins_900Black,
  });

  const { height: viewportHeight } = useWindowDimensions();
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authModal, setAuthModal] = useState<AuthModal>(null);
  const [loginChallengeToken, setLoginChallengeToken] = useState("");
  const [loginOtp, setLoginOtp] = useState("");
  const [loginOtpLoading, setLoginOtpLoading] = useState(false);
  const [forgotPasswordStep, setForgotPasswordStep] = useState<ForgotPasswordStep>("email");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState("");
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [activeTab, setActiveTab] = useState<DriverTab>("home");
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  // Added: the web portal treats trip details as a dedicated mobile screen.
  const [isTripDetailOpen, setIsTripDetailOpen] = useState(false);
  const [isTripSheetOpen, setIsTripSheetOpen] = useState(false);
  const [historyTripId, setHistoryTripId] = useState<string | null>(null);
  const [historyPointId, setHistoryPointId] = useState<string | null>(null);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [startingTripId, setStartingTripId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<DriverProfileUpdateInput>(initialProfileForm);
  const [profileAvatarUri, setProfileAvatarUri] = useState<string | null>(null);
  const [activeProfileModal, setActiveProfileModal] = useState<DriverProfileModal>(null);
  const [confirmLogoutVisible, setConfirmLogoutVisible] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<DriverNotificationPreferences>(defaultNotificationPrefs);
  const [securityPrefs, setSecurityPrefs] = useState<DriverSecurityPreferences>(defaultSecurityPrefs);
  const [securityForm, setSecurityForm] = useState(initialSecurityForm);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [tripSearch, setTripSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  // Account Security is a menu in the driver portal: it opens Change Password or
  // Security Settings as their own screens rather than stacking both in one sheet.
  const [securitySubView, setSecuritySubView] = useState<"menu" | "password" | "settings" | "otp">("menu");
  // Starts at zero: a non-zero expiry is what "a code is live" means, and the
  // "Enter OTP" shortcut keys off it. Seeding it with the full duration made the
  // shortcut appear before any code had been requested.
  const [otpExpiry, setOtpExpiry] = useState(0);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  // The sheet is rendered at its tallest snap point and moved with translateY, so a
  // drag can follow the finger frame by frame and settle with a spring. Animating a
  // height instead re-lays-out the list on every frame, which is what made the old
  // version jump straight from one fixed height to another on release.
  const tripSheetMaxHeight = Math.round(viewportHeight * TRIP_SHEET_SNAP_POINTS[TRIP_SHEET_SNAP_POINTS.length - 1]);
  const tripSheetOffsets = useMemo(
    () => TRIP_SHEET_SNAP_POINTS.map((fraction) => Math.max(0, tripSheetMaxHeight - Math.round(viewportHeight * fraction))),
    [tripSheetMaxHeight, viewportHeight],
  );
  const tripSheetTranslate = useRef(new Animated.Value(0)).current;
  const isTripSheetOpenRef = useRef(isTripSheetOpen);
  isTripSheetOpenRef.current = isTripSheetOpen;
  const tripSheetOffsetsRef = useRef(tripSheetOffsets);
  tripSheetOffsetsRef.current = tripSheetOffsets;
  const tripSheetRestRef = useRef(0);

  const settleTripSheet = (offset: number) => {
    tripSheetRestRef.current = offset;
    Animated.spring(tripSheetTranslate, {
      toValue: offset,
      useNativeDriver: Platform.OS !== "web",
      // Enough damping to stop cleanly without the rubbery overshoot of a loose spring.
      damping: 26,
      stiffness: 240,
      mass: 0.9,
    }).start();
  };

  useEffect(() => {
    // Opening always rests at the smallest snap point.
    const initial = tripSheetOffsets[0] ?? 0;
    tripSheetRestRef.current = initial;
    tripSheetTranslate.setValue(initial);
  }, [isTripSheetOpen, tripSheetOffsets, tripSheetTranslate]);

  const tripSheetPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 3,
      onPanResponderMove: (_event, gesture) => {
        const offsets = tripSheetOffsetsRef.current;
        const lowest = offsets[0] ?? 0;
        const next = tripSheetRestRef.current + gesture.dy;
        // Past the lowest snap the sheet gets progressively harder to pull, so it
        // resists rather than tearing off the bottom of the screen.
        tripSheetTranslate.setValue(next > lowest ? lowest + (next - lowest) * 0.35 : Math.max(0, next));
      },
      onPanResponderRelease: (_event, gesture) => {
        const offsets = tripSheetOffsetsRef.current;
        if (Math.abs(gesture.dy) < 6) {
          setIsTripSheetOpen((open) => !open);
          return;
        }
        // Project where the flick was heading, then settle on the nearest snap point.
        // Dragging up from the collapsed peek opens the sheet; the peek has no
        // animated offset of its own to settle to.
        if (!isTripSheetOpenRef.current) {
          if (gesture.dy < 0 || gesture.vy < -0.35) setIsTripSheetOpen(true);
          return;
        }
        const projected = tripSheetRestRef.current + gesture.dy + gesture.vy * 90;
        const lowest = offsets[offsets.length - 1] ?? 0;
        if (projected > (offsets[0] ?? 0) + 90) {
          setIsTripSheetOpen(false);
          return;
        }
        const nearest = offsets.reduce(
          (best, offset) => (Math.abs(offset - projected) < Math.abs(best - projected) ? offset : best),
          offsets[0] ?? lowest,
        );
        settleTripSheet(nearest);
      },
    }),
  ).current;
  const [confirmedLoadTripId, setConfirmedLoadTripId] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<DriverTripLocation | null>(null);
  const lastLocationRef = useRef<DriverTripLocation | null>(null);
  const foregroundWatchRef = useRef<Location.LocationSubscription | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [trackingMode, setTrackingMode] = useState<"off" | "foreground-only" | "background">("off");
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [stopActionPoint, setStopActionPoint] = useState<DriverTripDropPoint | null>(null);
  const [stopActionMode, setStopActionMode] = useState<StopActionMode>(null);
  const [recipientName, setRecipientName] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [returnedEmpties, setReturnedEmpties] = useState<Record<string, number>>({});
  const [podImageUri, setPodImageUri] = useState<string | null>(null);
  const [podCaptureMetadata, setPodCaptureMetadata] = useState<PodCaptureMetadata | null>(null);
  const [podCameraOpen, setPodCameraOpen] = useState(false);
  const [podCameraNow, setPodCameraNow] = useState(() => new Date());
  const [podCameraLocation, setPodCameraLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [podCameraAddress, setPodCameraAddress] = useState("Resolving current address...");
  const [podCameraAddressResolving, setPodCameraAddressResolving] = useState(true);
  const [podCameraError, setPodCameraError] = useState<string | null>(null);
  const [podCameraCapturing, setPodCameraCapturing] = useState(false);
  const podCameraRef = useRef<CameraView | null>(null);
  const podCameraLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const podCameraGeocodeKeyRef = useRef("");
  const [failureReason, setFailureReason] = useState("");
  const [rescheduleWindow, setRescheduleWindow] = useState<"tomorrow" | "other_date" | "cancel">("tomorrow");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [stopActionLoading, setStopActionLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await getStoredUser();
      if (stored) {
        try {
          // Fix: a remembered session is restored only after the server validates its token.
          const [nextProfile, tripList] = await Promise.all([fetchDriverProfile(), fetchDriverTrips()]);
          setUser(nextProfile);
          setProfile(nextProfile);
          hydrateProfileForm(nextProfile);
          setTrips(tripList);
          setSelectedTripId(getPreferredOperationalTripId(tripList));
          await loadNotificationPreferences();
          await loadSecurityPreferences();
        } catch {
          await logout();
          setUser(null);
        }
      }
      setOfflineQueue(await readOfflineQueue());
      setBooting(false);
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(connected);
      if (connected && user) {
        void syncOfflineQueue().then((remaining) => {
          setOfflineQueue(remaining);
          if (remaining.length === 0) void refreshData(false);
        });
      }
    });
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (user) void loadNotifications();
  }, [user?.userId]);

  useEffect(() => {
    if (!user) return;
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshData(false);
        void syncOfflineQueue().then(setOfflineQueue);
      }
    });
    const refreshInterval = setInterval(() => {
      if (AppState.currentState === "active") void refreshData(false);
    }, 30_000);
    return () => {
      appStateSubscription.remove();
      clearInterval(refreshInterval);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const activeTrip = trips.find((trip) => normalizeStatus(trip.status) === "IN_PROGRESS");
    if (activeTrip) {
      void ensureForegroundTracking(activeTrip.id);
    } else {
      stopForegroundTracking();
      void getTrackedTripId().then((trackedTripId) => {
        if (trackedTripId) void stopBackgroundTripTracking();
      });
      setTrackingMode("off");
    }
    return () => {
      if (AppState.currentState === "active") stopForegroundTracking();
    };
  }, [user, trips.map((trip) => `${trip.id}:${trip.status}`).join("|")]);

  useEffect(() => {
    if (!podCameraOpen) return;
    setPodCameraNow(new Date());
    const timer = setInterval(() => setPodCameraNow(new Date()), 1_000);
    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) throw new Error("Location permission is required for proof of delivery.");
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Highest, timeInterval: 2_000, distanceInterval: 3 },
          (position) => {
            if (!active) return;
            const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
            podCameraLocationRef.current = next;
            setPodCameraLocation(next);
            const key = `${next.latitude.toFixed(4)},${next.longitude.toFixed(4)}`;
            if (podCameraGeocodeKeyRef.current === key) return;
            podCameraGeocodeKeyRef.current = key;
            setPodCameraAddressResolving(true);
            // Added: reverse-geocode the current camera location when it materially changes.
            void Location.reverseGeocodeAsync(next)
              .then((places) => { if (active) setPodCameraAddress(formatReverseGeocodeAddress(places[0])); })
              .catch(() => { if (active) setPodCameraAddress("Location address unavailable"); })
              .finally(() => { if (active) setPodCameraAddressResolving(false); });
          },
        );
      } catch (cameraLocationError) {
        if (active) setPodCameraError(cameraLocationError instanceof Error ? cameraLocationError.message : "Unable to get current GPS location.");
      }
    })();
    return () => {
      active = false;
      clearInterval(timer);
      subscription?.remove();
    };
  }, [podCameraOpen]);

  function hydrateProfileForm(nextProfile: DriverProfile) {
    const fallbackNameParts = String(nextProfile.name || "").trim().split(/\s+/).filter(Boolean);
    setProfileForm({
      firstName: nextProfile.firstName || fallbackNameParts[0] || "",
      middleName: nextProfile.middleName || "",
      lastName: nextProfile.lastName || fallbackNameParts.slice(1).join(" "),
      suffix: nextProfile.suffix || "",
      phone: nextProfile.phone || "",
      emergencyContact: nextProfile.emergencyContact || "",
      licenseNumber: nextProfile.licenseNumber || "",
      licenseType: nextProfile.licenseType || "",
      licenseExpiry: nextProfile.licenseExpiry ? String(nextProfile.licenseExpiry).slice(0, 10) : "",
    });
    // Security switches reflect server-backed account settings, not local-only placeholders.
    setSecurityPrefs((current) => ({
      ...current,
      twoFactorAuthentication: Boolean(nextProfile.twoFactorEnabled),
      loginAlerts: nextProfile.loginAlertsEnabled !== false,
    }));
  }

  async function loadNotificationPreferences() {
    try {
      const raw = await AsyncStorage.getItem(DRIVER_NOTIFICATION_PREFS_KEY);
      if (!raw) {
        setNotificationPrefs(defaultNotificationPrefs);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<DriverNotificationPreferences>;
      setNotificationPrefs({
        tripNotifications: parsed.tripNotifications ?? true,
        deliveryUpdates: parsed.deliveryUpdates ?? true,
        systemAlerts: parsed.systemAlerts ?? true,
      });
    } catch {
      setNotificationPrefs(defaultNotificationPrefs);
    }
  }

  async function persistNotificationPreferences(nextPrefs: DriverNotificationPreferences) {
    setNotificationPrefs(nextPrefs);
    await AsyncStorage.setItem(DRIVER_NOTIFICATION_PREFS_KEY, JSON.stringify(nextPrefs));
  }

  async function loadSecurityPreferences() {
    try {
      const raw = await AsyncStorage.getItem(DRIVER_SECURITY_PREFS_KEY);
      const parsed = raw ? JSON.parse(raw) as Partial<DriverSecurityPreferences> : {};
      // 2FA and login alerts come from the server profile; only the device preference is local.
      setSecurityPrefs((current) => ({
        ...current,
        rememberDevice: parsed.rememberDevice ?? true,
      }));
    } catch {
      setSecurityPrefs(defaultSecurityPrefs);
    }
  }

  async function persistSecurityPreferences(nextPrefs: DriverSecurityPreferences) {
    setSecurityPrefs(nextPrefs);
    await AsyncStorage.setItem(DRIVER_SECURITY_PREFS_KEY, JSON.stringify(nextPrefs));
  }

  async function refreshData(showLoader = true) {
    if (showLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [nextProfile, tripList] = await Promise.all([fetchDriverProfile(), fetchDriverTrips()]);
      setUser(nextProfile);
      setProfile(nextProfile);
      hydrateProfileForm(nextProfile);
      setTrips(tripList);
      if (!selectedTripId && tripList.length > 0) {
        setSelectedTripId(getPreferredOperationalTripId(tripList));
      } else if (selectedTripId && !tripList.some((trip) => trip.id === selectedTripId)) {
        setSelectedTripId(tripList[0]?.id || null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        stopForegroundTracking();
        await stopBackgroundTripTracking();
        await logout();
        resetSessionState();
        setError("Your session expired. Please log in again.");
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to load driver data.");
    } finally {
      if (showLoader) setLoading(false);
      else setRefreshing(false);
    }
  }

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError("Enter your driver email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await login(email.trim(), password, rememberMe);
      if (result.status === "OTP_REQUIRED") {
        setLoginChallengeToken(result.challengeToken);
        setLoginOtp("");
        setAuthModal("login-otp");
        return;
      }
      setUser(result.user);
      await refreshData(false);
      await loadNotificationPreferences();
      await loadSecurityPreferences();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyLoginOtp() {
    if (!loginOtp.trim()) {
      setError("Enter the verification code sent to your email.");
      return;
    }
    setLoginOtpLoading(true);
    setError(null);
    try {
      const loggedIn = await verifyLoginOtp(loginChallengeToken, loginOtp.trim(), rememberMe);
      setUser(loggedIn);
      setAuthModal(null);
      setLoginOtp("");
      await refreshData(false);
      await loadNotificationPreferences();
      await loadSecurityPreferences();
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : "Verification failed.");
    } finally {
      setLoginOtpLoading(false);
    }
  }

  async function handleResendLoginOtp() {
    setLoginOtpLoading(true);
    setError(null);
    try {
      const result = await login(email.trim(), password, rememberMe);
      if (result.status !== "OTP_REQUIRED") throw new Error("A new verification challenge was not returned.");
      setLoginChallengeToken(result.challengeToken);
      setLoginOtp("");
      Alert.alert("Code Sent", result.message);
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "Failed to resend the code.");
    } finally {
      setLoginOtpLoading(false);
    }
  }

  function openForgotPassword() {
    setForgotEmail(email.trim());
    setForgotOtp("");
    setForgotNewPassword("");
    setForgotConfirmPassword("");
    setForgotPasswordStep("email");
    setError(null);
    setAuthModal("forgot-password");
  }

  async function handleForgotPasswordNext() {
    setForgotPasswordLoading(true);
    setError(null);
    try {
      if (forgotPasswordStep === "email") {
        if (!forgotEmail.trim()) throw new Error("Enter your driver account email.");
        await requestPasswordResetOtp(forgotEmail.trim());
        setForgotPasswordStep("otp");
        return;
      }
      if (forgotPasswordStep === "otp") {
        if (!forgotOtp.trim()) throw new Error("Enter the verification code.");
        await verifyPasswordResetOtp(forgotEmail.trim(), forgotOtp.trim());
        setForgotPasswordStep("password");
        return;
      }
      if (forgotNewPassword !== forgotConfirmPassword) throw new Error("New password and confirmation do not match.");
      const passwordError = validatePasswordPolicy(forgotNewPassword);
      if (passwordError) throw new Error(passwordError);
      await resetPasswordWithOtp(forgotEmail.trim(), forgotOtp.trim(), forgotNewPassword);
      setAuthModal(null);
      Alert.alert("Password Updated", "Your password was reset. You can now log in.");
    } catch (forgotError) {
      setError(forgotError instanceof Error ? forgotError.message : "Password reset failed.");
    } finally {
      setForgotPasswordLoading(false);
    }
  }

  function resetSessionState() {
    setUser(null);
    setProfile(null);
    setTrips([]);
    setSelectedTripId(null);
    setActiveTab("home");
    setProfileForm(initialProfileForm);
    setActiveProfileModal(null);
    setConfirmLogoutVisible(false);
    setNotificationPrefs(defaultNotificationPrefs);
    setSecurityPrefs(defaultSecurityPrefs);
    setSecurityForm(initialSecurityForm);
    setOtpVerified(false);
    setAuthModal(null);
    setLoginChallengeToken("");
    setLoginOtp("");
  }

  async function handleLogout() {
    setLoading(true);
    try {
      stopForegroundTracking();
      await stopBackgroundTripTracking();
      await logout();
      await clearOfflineQueue();
      setOfflineQueue([]);
      resetSessionState();
    } finally {
      setLoading(false);
    }
  }

  async function submitLocation(position: Location.LocationObject, tripId: string) {
    const sample = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      recordedAt: position.timestamp,
    };
    const previous = lastLocationRef.current
      ? {
          latitude: lastLocationRef.current.latitude,
          longitude: lastLocationRef.current.longitude,
          accuracy: lastLocationRef.current.accuracy,
          recordedAt: lastLocationRef.current.recordedAt ? new Date(lastLocationRef.current.recordedAt).getTime() : undefined,
        }
      : null;
    if (!isUsableLocationSample(sample, previous)) return;

    const nextLocation: DriverTripLocation = {
      latitude: sample.latitude,
      longitude: sample.longitude,
      accuracy: position.coords.accuracy ?? null,
      heading: position.coords.heading ?? null,
      speed: position.coords.speed ?? null,
      recordedAt: new Date(position.timestamp).toISOString(),
    };
    lastLocationRef.current = nextLocation;
    setCurrentLocation(nextLocation);
    const body = {
      latitude: nextLocation.latitude,
      longitude: nextLocation.longitude,
      accuracy: nextLocation.accuracy,
      heading: nextLocation.heading,
      speed: nextLocation.speed,
      altitude: position.coords.altitude ?? null,
      tripId,
    };
    try {
      if (!isOnline) throw new ApiError("Offline", 0, null);
      await pushDriverLocation(body);
    } catch (locationError) {
      if (!(locationError instanceof ApiError) || locationError.status === 0 || locationError.status >= 500) {
        setOfflineQueue(await queueOfflineOperation({ kind: "LOCATION", method: "POST", path: "/api/driver/location", body }));
      }
    }
  }

  async function ensureForegroundTracking(tripId: string) {
    if (foregroundWatchRef.current) return;
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      setError("Location permission is required for an active delivery trip.");
      return;
    }
    foregroundWatchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5_000, distanceInterval: 5 },
      (position) => void submitLocation(position, tripId),
    );
    heartbeatRef.current = setInterval(() => {
      const latest = lastLocationRef.current;
      if (!latest) return;
      const body = { ...latest, tripId };
      void pushDriverLocation(body).catch(async () => {
        setOfflineQueue(await queueOfflineOperation({ kind: "LOCATION", method: "POST", path: "/api/driver/location", body }));
      });
    }, 5_000);
    setTrackingMode((current) => (current === "background" ? current : "foreground-only"));
  }

  function stopForegroundTracking() {
    foregroundWatchRef.current?.remove();
    foregroundWatchRef.current = null;
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
  }

  async function handleStartTrip(tripId: string) {
    const trip = trips.find((entry) => entry.id === tripId);
    if (!trip || normalizeStatus(trip.status) !== "PLANNED") {
      setError("Only a planned trip can be started.");
      return;
    }
    if (confirmedLoadTripId !== tripId) {
      setError("Confirm Load before starting the trip.");
      return;
    }
    const blockedOrders = getStartBlockedOrders(trip);
    if (blockedOrders.length > 0) {
      setError(`Trip cannot start. Orders not loaded: ${blockedOrders.slice(0, 3).join(", ")}`);
      return;
    }
    setStartingTripId(tripId);
    setError(null);
    let startLocation: { latitude: number; longitude: number } | null = null;
    let serverStartConfirmed = false;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Location permission is required to start a trip.");
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      startLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      if (!isOnline) throw new ApiError("Offline", 0, null);
      await startTrip(tripId, startLocation);
      serverStartConfirmed = true;
      let mode: "background" | "foreground-only" = "foreground-only";
      try {
        mode = await startBackgroundTripTracking(tripId);
      } catch {
        // Foreground tracking remains available when the platform blocks background permission.
      }
      setTrackingMode(mode);
      await ensureForegroundTracking(tripId);
      await submitLocation(position, tripId);
      await refreshData(false);
      setActiveTab("trips");
    } catch (e) {
      if (!serverStartConfirmed && startLocation && e instanceof ApiError && (e.status === 0 || e.status >= 500)) {
        setOfflineQueue(await queueOfflineOperation({
          kind: "START_TRIP",
          method: "POST",
          path: `/api/trips/${tripId}/start`,
          body: { ...startLocation, confirmLoad: true },
        }));
        setTrips((current) => current.map((entry) => entry.id === tripId ? { ...entry, status: "IN_PROGRESS", actualStartAt: new Date().toISOString() } : entry));
        let mode: "background" | "foreground-only" = "foreground-only";
        try {
          mode = await startBackgroundTripTracking(tripId);
        } catch {
          // The foreground watcher below remains the supported fallback.
        }
        setTrackingMode(mode);
        await ensureForegroundTracking(tripId);
        setActiveTab("trips");
        Alert.alert("Trip Started Offline", "Trip start is queued and will synchronize when the connection returns.");
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to start trip.");
    } finally {
      setStartingTripId(null);
    }
  }

  async function handleShareLocation() {
    const selectedTrip = trips.find((trip) => trip.id === selectedTripId) || trips[0];
    setSharingLocation(true);
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        throw new Error("Location permission is required on the driver app.");
      }
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        throw new Error("Device location services are turned off.");
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      if (!selectedTrip?.id) throw new Error("Select an assigned trip before sharing location.");
      await submitLocation(position, selectedTrip.id);
      await refreshData(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to share location.";
      setError(message);
      Alert.alert("Location Error", message);
    } finally {
      setSharingLocation(false);
    }
  }

  async function handleSaveProfile() {
    setSavingProfile(true);
    setError(null);
    try {
      const avatar = profileAvatarUri ? await uploadProfileAvatar(profileAvatarUri) : profile?.avatar;
      const nextProfile = await updateDriverProfile({ ...profileForm, avatar });
      setProfile(nextProfile);
      setUser(nextProfile);
      hydrateProfileForm(nextProfile);
      setProfileAvatarUri(null);
      setActiveProfileModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function chooseProfileAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission Required", "Allow photo library access to select a driver profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.75, allowsEditing: true, aspect: [1, 1] });
    if (!result.canceled && result.assets[0]?.uri) setProfileAvatarUri(result.assets[0].uri);
  }

  async function handleSecurityPreferenceChange(key: "twoFactorAuthentication" | "loginAlerts", value: boolean) {
    const previous = securityPrefs;
    const nextPrefs = { ...securityPrefs, [key]: value };
    setSecurityPrefs(nextPrefs);
    try {
      const nextProfile = await updateDriverProfile({
        ...profileForm,
        twoFactorEnabled: key === "twoFactorAuthentication" ? value : securityPrefs.twoFactorAuthentication,
        loginAlertsEnabled: key === "loginAlerts" ? value : securityPrefs.loginAlerts,
      });
      setProfile(nextProfile);
      setUser(nextProfile);
      await AsyncStorage.setItem(DRIVER_SECURITY_PREFS_KEY, JSON.stringify(nextPrefs));
    } catch (securityError) {
      setSecurityPrefs(previous);
      setError(securityError instanceof Error ? securityError.message : "Failed to update security settings.");
    }
  }

  async function loadNotifications() {
    setNotificationLoading(true);
    try {
      const data = await fetchNotifications();
      // Match the web Driver Portal: warehouse, inventory, and user-admin alerts are not driver notifications.
      const driverNotifications = (data.notifications || []).filter((notification) =>
        !["WAREHOUSE", "INVENTORY", "USER"].includes(String(notification.type || "").toUpperCase()),
      );
      setNotifications(driverNotifications);
      setUnreadNotifications(driverNotifications.filter((notification) => !notification.isRead).length);
    } catch (notificationError) {
      setError(notificationError instanceof Error ? notificationError.message : "Failed to load notifications.");
    } finally {
      setNotificationLoading(false);
    }
  }

  async function handleMarkAllNotificationsRead() {
    await markAllNotificationsRead();
    await loadNotifications();
  }

  async function handleClearNotifications() {
    await clearNotifications();
    setNotifications([]);
    setUnreadNotifications(0);
  }

  async function executeStopUpdate(point: DriverTripDropPoint, body: Parameters<typeof updateTripStop>[2]) {
    if (!selectedTrip) return;
    try {
      if (!isOnline) throw new ApiError("Offline", 0, null);
      await updateTripStop(selectedTrip.id, point.id, body);
      await refreshData(false);
    } catch (stopError) {
      if (!(stopError instanceof ApiError) || stopError.status === 0 || stopError.status >= 500) {
        setOfflineQueue(await queueOfflineOperation({
          kind: "UPDATE_STOP",
          method: "PATCH",
          path: `/api/trips/${selectedTrip.id}/drop-points/${point.id}`,
          body,
        }));
        Alert.alert("Saved Offline", "This stop update is queued and will sync when the connection returns.");
        return;
      }
      throw stopError;
    }
  }

  function confirmArrived(point: DriverTripDropPoint) {
    Alert.alert("Confirm Arrival", `Mark ${point.locationName || `Stop ${point.sequence || ""}`} as arrived?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "I Have Arrived",
        onPress: () => void executeStopUpdate(point, { status: "ARRIVED" }).catch((arriveError) => {
          setError(arriveError instanceof Error ? arriveError.message : "Failed to mark arrival.");
        }),
      },
    ]);
  }

  function openStopAction(point: DriverTripDropPoint, mode: Exclude<StopActionMode, null>) {
    setStopActionPoint(point);
    setStopActionMode(mode);
    setRecipientName(point.contactName || point.order?.shippingName || "");
    setDeliveryNotes(point.notes || "");
    setReturnedEmpties({});
    setPodImageUri(null);
    setPodCaptureMetadata(null);
    setFailureReason("");
    setRescheduleWindow("tomorrow");
    setRescheduleDate("");
  }

  function closeStopAction() {
    setStopActionMode(null);
    setStopActionPoint(null);
    setPodCameraOpen(false);
  }

  function closePodCamera() {
    setPodCameraOpen(false);
    // Fix: restore the delivery form after dismissing the full-screen native camera.
    if (stopActionPoint) setStopActionMode("complete");
  }

  async function choosePodImage(source: "camera" | "library") {
    if (source === "camera") {
      const permission = await Camera.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Required", "Allow camera access to attach proof of delivery.");
        return;
      }
      setPodCameraNow(new Date());
      setPodCameraLocation(null);
      podCameraLocationRef.current = null;
      setPodCameraAddress("Resolving current address...");
      setPodCameraAddressResolving(true);
      setPodCameraError(null);
      podCameraGeocodeKeyRef.current = "";
      // Avoid presenting a native camera modal on top of the delivery form modal.
      setStopActionMode(null);
      setPodCameraOpen(true);
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission Required", "Allow photo library access to attach proof of delivery.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.75 });
    if (!result.canceled && result.assets[0]?.uri) {
      setPodImageUri(result.assets[0].uri);
      setPodCaptureMetadata(null);
    }
  }

  async function capturePodCameraPhoto() {
    const location = podCameraLocationRef.current;
    if (!podCameraRef.current || !location) {
      setPodCameraError("Waiting for a fresh GPS location before capture.");
      return;
    }
    setPodCameraCapturing(true);
    setPodCameraError(null);
    try {
      const capturedAt = new Date();
      const photo = await podCameraRef.current.takePictureAsync({ quality: 0.9, exif: false, skipProcessing: false });
      if (!photo?.uri) throw new Error("The camera did not return a photo.");
      setPodImageUri(photo.uri);
      setPodCaptureMetadata({ capturedAt: capturedAt.toISOString(), ...location, address: podCameraAddress });
      closePodCamera();
    } catch (captureError) {
      setPodCameraError(captureError instanceof Error ? captureError.message : "Unable to capture proof photo.");
    } finally {
      setPodCameraCapturing(false);
    }
  }

  async function handleCompleteStop() {
    if (!stopActionPoint || !selectedTrip) return;
    if (!podImageUri) {
      setError("Capture or select a proof of delivery image first.");
      return;
    }
    if (!isOnline) {
      setError("Connect to the internet to upload the proof photo. Your selected photo is preserved.");
      return;
    }
    setStopActionLoading(true);
    setError(null);
    try {
      const imageUrl = await uploadPodImage(podImageUri, podCaptureMetadata || undefined);
      await executeStopUpdate(stopActionPoint, {
        status: "COMPLETED",
        recipientName: recipientName.trim() || "Customer",
        deliveryPhoto: imageUrl,
        notes: deliveryNotes.trim(),
        returnedEmpties: Object.entries(returnedEmpties).map(([containerTypeId, returnedQuantity]) => ({
          containerTypeId,
          returnedQuantity: Math.max(0, returnedQuantity),
        })),
      });
      closeStopAction();
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Failed to complete delivery.");
    } finally {
      setStopActionLoading(false);
    }
  }

  async function handleFailedStop(confirmed = false) {
    if (!stopActionPoint || !failureReason.trim()) {
      setError("Enter the failed-delivery reason.");
      return;
    }
    if (rescheduleWindow === "other_date" && !/^\d{4}-\d{2}-\d{2}$/.test(rescheduleDate.trim())) {
      setError("Enter the reschedule date as YYYY-MM-DD.");
      return;
    }
    if (!confirmed) {
      // Match the web workflow's final warning before inventory or route-planning state changes.
      Alert.alert(
        rescheduleWindow === "cancel" ? "Cancel this delivery?" : "Reschedule this delivery?",
        rescheduleWindow === "cancel"
          ? "This will release the reserved inventory and cannot be undone."
          : "This stop will be removed from the current route and returned to route planning.",
        [
          { text: "Go Back", style: "cancel" },
          { text: rescheduleWindow === "cancel" ? "Cancel Delivery" : "Confirm Reschedule", style: rescheduleWindow === "cancel" ? "destructive" : "default", onPress: () => void handleFailedStop(true) },
        ],
      );
      return;
    }
    setStopActionLoading(true);
    setError(null);
    try {
      await executeStopUpdate(stopActionPoint, {
        status: rescheduleWindow === "cancel" ? "CANCELLED" : "FAILED",
        notes: failureReason.trim(),
        failureReason: failureReason.trim(),
        failureNotes: deliveryNotes.trim(),
        releaseInventory: rescheduleWindow === "cancel",
        rescheduleRequested: rescheduleWindow !== "cancel",
        rescheduleWindow: rescheduleWindow === "cancel" ? undefined : rescheduleWindow,
        rescheduleDate:
          rescheduleWindow === "tomorrow"
            ? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
            : rescheduleWindow === "other_date"
              ? rescheduleDate.trim()
              : undefined,
      });
      closeStopAction();
    } catch (failedError) {
      setError(failedError instanceof Error ? failedError.message : "Failed to update the stop.");
    } finally {
      setStopActionLoading(false);
    }
  }

  // Both counters run while the OTP step is on screen, matching the customer app.
  useEffect(() => {
    const onOtpStep = activeProfileModal === "security" && (securitySubView === "otp" || securitySubView === "password");
    if (!onOtpStep || (otpExpiry <= 0 && otpResendCooldown <= 0)) return;
    const timer = setInterval(() => {
      setOtpExpiry((prev) => (prev > 0 ? prev - 1 : 0));
      setOtpResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeProfileModal, securitySubView, otpExpiry, otpResendCooldown]);

  useEffect(() => {
    // Verified means there is nothing left to type, so hand the form back.
    if (otpVerified && securitySubView === "otp") setSecuritySubView("password");
  }, [otpVerified, securitySubView]);

  function resetOtpTimers() {
    setOtpExpiry(OTP_EXPIRY_SECONDS);
    setOtpResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
  }

  function openProfileModal(modal: Exclude<DriverProfileModal, null>) {
    setSecuritySubView("menu");
    // No code has been sent yet on a freshly opened screen.
    setOtpExpiry(0);
    setOtpResendCooldown(0);
    setError(null);
    if (modal === "edit") setProfileAvatarUri(null);
    setActiveProfileModal(modal);
    if (modal === "notifications") void loadNotifications();
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
      setError("No email is available for this driver account.");
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
      Alert.alert("OTP Verified Successfully", "You can now update your password.");
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

  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) || trips[0] || null,
    [selectedTripId, trips]
  );
  const activeHomeTrip = useMemo(
    () => trips.find((trip) => normalizeStatus(trip.status) === "IN_PROGRESS") || null,
    [trips],
  );

  useEffect(() => {
    if (selectedTrip?.latestLocation && !currentLocation) {
      setCurrentLocation(selectedTrip.latestLocation);
      lastLocationRef.current = selectedTrip.latestLocation;
    }
  }, [selectedTrip?.id, selectedTrip?.latestLocation?.recordedAt]);

  const activeTrips = useMemo(
    () => trips.filter((trip) => normalizeStatus(trip.status) !== "COMPLETED" && buildTripSearchText(trip).includes(tripSearch.trim().toLowerCase())),
    [tripSearch, trips],
  );

  // The web history pages ten completed trips at a time; the app matches it.
  const completedTrips = useMemo(
    () => trips
      .filter((trip) => normalizeStatus(trip.status) === "COMPLETED")
      .filter((trip) => buildTripSearchText(trip).includes(historySearch.trim().toLowerCase())),
    [historySearch, trips],
  );

  const historyTotalPages = Math.max(1, Math.ceil(completedTrips.length / HISTORY_PAGE_SIZE));

  const dashboardMetrics = useMemo(() => {
    const today = new Date().toDateString();
    const todaysTrips = trips.filter((trip) => {
      const date = trip.tripSchedule || trip.plannedStartAt || trip.actualStartAt || trip.actualEndAt;
      if (!date) return normalizeStatus(trip.status) === "IN_PROGRESS";
      const parsed = new Date(date);
      return !Number.isNaN(parsed.getTime()) && parsed.toDateString() === today;
    });
    const inProgress = todaysTrips.filter((trip) => normalizeStatus(trip.status) === "IN_PROGRESS").length;
    const planned = todaysTrips.filter((trip) => normalizeStatus(trip.status) === "PLANNED").length;
    const completed = todaysTrips.filter((trip) => normalizeStatus(trip.status) === "COMPLETED").length;
    const remainingStops = todaysTrips.reduce((sum, trip) => {
      const total = Number(trip.totalDropPoints || trip.dropPoints?.length || 0);
      const done = Number(trip.completedDropPoints || 0);
      return sum + Math.max(total - done, 0);
    }, 0);
    return { inProgress, planned, completed, remainingStops };
  }, [trips]);

  // Fix: never render an unexplained black screen while release fonts initialize.
  // If loading fails, Android can fall back to its system font and keep the app usable.
  if (!fontsLoaded && !fontError) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#0f172a" />
        <Text style={styles.subtle}>Loading driver app...</Text>
      </SafeAreaView>
    );
  }

  const driverInitials = getInitials(profile?.name || user?.name || "Driver");
  const licenseStatus = getLicenseStatus(profile);

  if (booting) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#0f172a" />
        <Text style={styles.subtle}>Starting driver app...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      {!user ? (
        <ScrollView contentContainerStyle={styles.authShell} keyboardShouldPersistTaps="handled">
          <View style={styles.authCard}>
            <Image source={require("./assets/aab-trading-driver.png")} style={styles.authLogoImage} resizeMode="contain" accessibilityLabel="AAB Trading Driver logo" />
            <Text style={styles.authEyebrow}>ANN ANN&apos;S BEVERAGES TRADING</Text>
            <Text style={styles.authTitle}>AAB TRADING</Text>
            <View style={styles.authDriverRow}>
              <View style={styles.speedLines}><View style={styles.speedLineLong} /><View style={styles.speedLineShort} /><View style={styles.speedLineLong} /></View>
              <Text style={styles.authDriverTitle}>DRIVER</Text>
              <View style={[styles.speedLines, styles.speedLinesMirrored]}><View style={styles.speedLineLong} /><View style={styles.speedLineShort} /><View style={styles.speedLineLong} /></View>
            </View>
            <Text style={styles.authSubtitle}>Sign in to start routes and track drops in real time.</Text>

            <View style={styles.authForm}>
              <Text style={styles.inputLabel}>Email</Text>
              <View style={styles.authInputRow}>
                <Ionicons name="mail-outline" size={17} color="#8a99b3" />
                <TextInput
                  style={styles.authTextInput}
                  value={email}
                  onChangeText={(value) => { setEmail(value); setError(null); }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="Enter email"
                />
              </View>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.passwordInputRow}>
                <Ionicons name="lock-closed-outline" size={17} color="#8a99b3" style={styles.passwordLeadingIcon} />
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={(value) => { setPassword(value); setError(null); }}
                  secureTextEntry={!showPassword}
                  placeholder="Enter password"
                />
                <Pressable accessibilityLabel={showPassword ? "Hide password" : "Show password"} style={styles.passwordToggle} onPress={() => setShowPassword((value) => !value)}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color="#6f7b96" />
                </Pressable>
              </View>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable style={styles.rememberRow} onPress={() => setRememberMe((value) => !value)}>
                <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                  {rememberMe ? <Text style={styles.checkboxGlyph}>✓</Text> : null}
                </View>
                <Text style={styles.rememberText}>Keep me logged in</Text>
              </Pressable>
              <Pressable style={styles.loginButton} onPress={() => void handleLogin()} disabled={loading}>
                {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Log In</Text>}
              </Pressable>
              <Pressable style={styles.forgotButton} onPress={openForgotPassword}>
                <Text style={styles.forgotButtonText}>Forgot password?</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.flex}>
          {!isTripDetailOpen ? (
            <AppHeader
              title="AAB TRADING DRIVER"
              unreadCount={unreadNotifications}
              onOpenNotifications={() => openProfileModal("notifications")}
            />
          ) : null}

          <ScrollView
            style={styles.flex}
            scrollEnabled={!isTripDetailOpen}
            contentContainerStyle={[styles.scrollContent, activeTab === "profile" ? styles.profileScrollContent : null, isTripDetailOpen ? styles.tripDetailScrollContent : null]}
            refreshControl={!isTripDetailOpen ? <RefreshControl refreshing={refreshing} onRefresh={() => refreshData(false)} /> : undefined}
          >
            {!!error && <Text style={styles.errorBanner}>{error}</Text>}
            {!isOnline ? <Text style={styles.offlineBanner}>Offline — delivery updates will be queued.</Text> : null}
            {offlineQueue.length > 0 ? (
              <View style={styles.queueBanner}>
                <View style={styles.flex}>
                  <Text style={styles.queueText}>{offlineQueue.length} update(s) waiting to sync</Text>
                  {offlineQueue.find((item) => item.state === "FAILED")?.lastError ? (
                    <Text style={styles.queueError}>{offlineQueue.find((item) => item.state === "FAILED")!.lastError}</Text>
                  ) : null}
                </View>
                <Pressable onPress={() => void syncOfflineQueue().then(setOfflineQueue)} disabled={!isOnline}>
                  <Text style={styles.queueAction}>{isOnline ? "Sync Now" : "Waiting for connection"}</Text>
                </Pressable>
              </View>
            ) : null}

            {activeTab === "home" ? (
              <View style={{ position: "relative" }}>
                <View style={styles.ambientGlowSky} />
                <View style={styles.ambientGlowEmerald} />
                <View style={styles.homePanel}>
                <View style={styles.homeDashboardHeading}>
                  <Text style={styles.dashboardEyebrow}>DRIVER DASHBOARD</Text>
                  <Text style={styles.dashboardTitle}>Driver Dashboard</Text>
                  <Text style={styles.dashboardSubtitle}>Here is your delivery overview for today.</Text>
                </View>
                <View style={styles.homeMetricGrid}>
                  <MetricCard label="Total Trips" value={dashboardMetrics.inProgress + dashboardMetrics.planned + dashboardMetrics.completed} icon="map-outline" />
                  <MetricCard label="Planned" value={dashboardMetrics.planned} icon="calendar-outline" />
                  <MetricCard label="Completed" value={dashboardMetrics.completed} icon="trophy-outline" />
                  <MetricCard label="Pending Stops" value={dashboardMetrics.remainingStops} icon="refresh-outline" />
                </View>

                <View style={styles.homeAssignmentCard}>
                  <View style={{ flexDirection: "row", gap: 6, paddingBottom: 8 }}>
                    <Text style={[styles.sectionTitle, { color: "#0f4f8f" }]}>Current</Text>
                    <Text style={[styles.sectionTitle, { color: "#2f9a34" }]}>Assignment</Text>
                  </View>
                  {activeHomeTrip ? (
                    <>
                      <Text style={styles.featureTitle}>{activeHomeTrip.tripNumber}</Text>
                      <Text style={styles.subtle}>Status: {activeHomeTrip.status}</Text>
                      <Text style={styles.subtle}>Schedule: {formatDate(activeHomeTrip.tripSchedule || activeHomeTrip.plannedStartAt)}</Text>
                      <Text style={styles.subtle}>
                        Stops: {activeHomeTrip.completedDropPoints || 0} / {activeHomeTrip.totalDropPoints || activeHomeTrip.dropPoints?.length || 0}
                      </Text>
                      {activeHomeTrip.vehicle?.licensePlate ? (
                        <Text style={styles.subtle}>
                          Vehicle: {activeHomeTrip.vehicle.licensePlate} {activeHomeTrip.vehicle.type ? `(${activeHomeTrip.vehicle.type})` : ""}
                        </Text>
                      ) : null}
                      {currentLocation || activeHomeTrip.latestLocation ? (
                        <Text style={styles.subtle}>
                          Last GPS: {(currentLocation || activeHomeTrip.latestLocation)!.latitude.toFixed(5)}, {(currentLocation || activeHomeTrip.latestLocation)!.longitude.toFixed(5)}
                        </Text>
                      ) : (
                        <Text style={styles.subtle}>No GPS location sent yet.</Text>
                      )}
                      <Text style={styles.subtle}>Tracking: {trackingMode.replace("-", " ")}</Text>
                      <View style={styles.row}>
                        <Pressable style={styles.primaryButton} onPress={() => { setSelectedTripId(activeHomeTrip.id); setActiveTab("trips"); setIsTripSheetOpen(false); setIsTripDetailOpen(true); }}>
                          <Text style={styles.primaryButtonText}>Open Active Trip</Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.subtle}>No active trip right now.</Text>
                      <Pressable style={styles.primaryButton} onPress={() => setActiveTab("trips")}>
                        <Text style={styles.primaryButtonText}>View My Trips</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
              </View>
            ) : null}

            {activeTab === "trips" ? (
              <>
                {!isTripDetailOpen ? <View style={styles.tripsScreen}>
                  <Text style={styles.tripsEyebrow}>ASSIGNED ROUTES</Text>
                  <Text style={styles.tripsTitle}>My Deliveries</Text>
                  <View style={styles.searchField}>
                    <Ionicons name="search" size={18} color="#94a3b8" />
                    <TextInput style={styles.searchInput} value={tripSearch} onChangeText={setTripSearch} placeholder="Search deliveries" placeholderTextColor="#94a3b8" />
                  </View>
                  {activeTrips.length === 0 ? <Text style={styles.subtle}>No active assigned trips match your search.</Text> : null}
                  {activeTrips.map((trip) => (
                    <Pressable
                      key={trip.id}
                      style={styles.routeCard}
                      onPress={() => { setSelectedTripId(trip.id); setIsTripSheetOpen(false); setIsTripDetailOpen(true); }}
                    >
                      <View style={styles.routeCardTop}>
                        <Text style={styles.routeNumber}>{trip.tripNumber}</Text>
                        <View style={styles.viewDetailsButton}><Text style={styles.viewDetailsText}>View Details</Text></View>
                      </View>
                      <View style={[styles.tripStatusBadge, normalizeStatus(trip.status) === "IN_PROGRESS" ? styles.tripStatusActive : null]}><Text style={[styles.tripStatusText, normalizeStatus(trip.status) === "IN_PROGRESS" ? styles.tripStatusTextActive : null]}>{String(trip.status || "").replace(/_/g, " ")}</Text></View>
                      <Text style={styles.routeMeta}>Vehicle: {trip.vehicle?.licensePlate || "Not assigned"} | Driver: {profile?.name || user.name || "Assigned Driver"}</Text>
                      <Text style={styles.routeMeta}>Route: Warehouse {'->'} {trip.dropPoints?.at(-1)?.locationName || "Destination"}</Text>
                      <Text style={styles.routeMeta}>Schedule: {formatDateOnly(trip.tripSchedule)}</Text>
                    </Pressable>
                  ))}
                </View> : null}

                {selectedTrip && isTripDetailOpen ? (
                  <View style={[styles.tripDetailScreen, { height: Math.max(620, viewportHeight) }]}>
                    {/* Fix: Trip Details now uses the web portal's full-height map-first navigation layout. */}
                    <DriverNavigationMap trip={selectedTrip} currentLocation={currentLocation || selectedTrip.latestLocation || null} fullScreen />

                    <View style={styles.tripMapContextRow}>
                      <Pressable
                        style={styles.tripMapBackButton}
                        onPress={() => { setIsTripSheetOpen(false); setIsTripDetailOpen(false); }}
                        accessibilityLabel="Back to assigned trips"
                      >
                        <Ionicons name="chevron-back" size={21} color="#0f172a" />
                      </Pressable>
                      <View style={styles.tripMapChip}><Text style={styles.tripMapChipText}>Route Map</Text></View>
                      <View style={[styles.tripMapChip, styles.tripCoordinateChip]}>
                        <Text numberOfLines={1} style={styles.tripCoordinateText}>
                          Exact: {(currentLocation || selectedTrip.latestLocation)
                            ? `${Number((currentLocation || selectedTrip.latestLocation)!.latitude).toFixed(6)}, ${Number((currentLocation || selectedTrip.latestLocation)!.longitude).toFixed(6)}`
                            : "Unavailable"}
                        </Text>
                      </View>
                    </View>

                    {normalizeStatus(selectedTrip.status) === "PLANNED" ? (
                      <View style={styles.tripStartArea}>
                        {/* Added: the driver must confirm the physical load before Start Trip is enabled. */}
                        <Pressable
                          style={styles.tripLoadConfirm}
                          onPress={() => setConfirmedLoadTripId((current) => current === selectedTrip.id ? null : selectedTrip.id)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: confirmedLoadTripId === selectedTrip.id }}
                        >
                          <Ionicons name={confirmedLoadTripId === selectedTrip.id ? "checkbox" : "square-outline"} size={22} color="#1d4ed8" />
                          <Text style={styles.tripLoadConfirmText}>Confirm Load</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.tripStartButton, confirmedLoadTripId !== selectedTrip.id ? styles.tripStartButtonDisabled : null]}
                          onPress={() => void handleStartTrip(selectedTrip.id)}
                          disabled={startingTripId === selectedTrip.id || confirmedLoadTripId !== selectedTrip.id}
                        >
                          {startingTripId === selectedTrip.id ? <ActivityIndicator color="#ffffff" /> : <Ionicons name="play" size={19} color="#ffffff" />}
                          <Text style={styles.primaryButtonText}>Start Trip</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {!isTripSheetOpen ? (
                      <View
                        style={styles.tripSheetPeek}
                        accessibilityRole="button"
                        accessibilityLabel="Open trip drop points"
                        {...tripSheetPan.panHandlers}
                      >
                        <View style={styles.tripSheetHandle} />
                        <Text style={styles.tripSheetEyebrow}>DROP POINTS</Text>
                        <View style={styles.tripSheetSummaryRow}>
                          <View style={styles.flex}>
                            <Text style={styles.tripSheetTripNumber}>{selectedTrip.tripNumber}</Text>
                            <Text style={styles.tripSheetSchedule}>Schedule: {formatDateOnly(selectedTrip.tripSchedule || selectedTrip.plannedStartAt)}</Text>
                          </View>
                          <View style={styles.tripSheetSummaryRight}>
                            <Text style={styles.tripSheetSpeed}>{Math.max(0, Math.round(Number((currentLocation || selectedTrip.latestLocation)?.speed || 0) * 3.6))} km/h</Text>
                            <Text style={styles.tripSheetProgress}>
                              {Math.max(Number(selectedTrip.completedDropPoints || 0), (selectedTrip.dropPoints || []).filter((point) => ["COMPLETED", "DELIVERED", "FAILED", "SKIPPED", "CANCELLED"].includes(normalizeStatus(point.status))).length)}/{selectedTrip.totalDropPoints || selectedTrip.dropPoints?.length || 0} Delivered
                            </Text>
                          </View>
                        </View>
                      </View>
                    ) : (
                      <Animated.View
                        style={[
                          styles.tripBottomSheet,
                          { height: tripSheetMaxHeight, transform: [{ translateY: tripSheetTranslate }] },
                        ]}
                      >
                        <View
                          accessibilityRole="button"
                          accessibilityLabel="Collapse trip drop points"
                          style={styles.tripSheetGrip}
                          {...tripSheetPan.panHandlers}
                        >
                          <View style={styles.tripSheetHandle} />
                        </View>
                        <View style={styles.tripSheetExpandedHeader}>
                          <View style={styles.flex}>
                            <Text style={styles.tripSheetEyebrow}>DROP POINTS</Text>
                            <Text style={styles.tripSheetTripNumber}>{selectedTrip.tripNumber}</Text>
                          </View>
                          <View style={[styles.tripStatusBadge, normalizeStatus(selectedTrip.status) === "IN_PROGRESS" ? styles.tripStatusActive : null]}><Text style={[styles.tripStatusText, normalizeStatus(selectedTrip.status) === "IN_PROGRESS" ? styles.tripStatusTextActive : null]}>{String(selectedTrip.status || "").replace(/_/g, " ")}</Text></View>
                        </View>
                        <ScrollView style={styles.tripSheetScroll} contentContainerStyle={styles.tripSheetScrollContent} nestedScrollEnabled>
                          {selectedTrip.dropPoints?.length ? selectedTrip.dropPoints.map((point) => (
                            <DropPointCard
                              key={point.id}
                              point={point}
                              tripStatus={selectedTrip.status}
                              onArrive={() => confirmArrived(point)}
                              onComplete={() => openStopAction(point, "complete")}
                              onFailed={() => openStopAction(point, "failed")}
                            />
                          )) : <Text style={styles.subtle}>No stops are assigned to this trip.</Text>}
                        </ScrollView>
                      </Animated.View>
                    )}
                  </View>
                ) : null}
              </>
            ) : null}

            {activeTab === "history" ? (
              <View style={styles.historyScreen}>
                {!historyTripId ? (
                  <View>
                    <Text style={styles.historyTitle}>Delivery History</Text>
                    <Text style={styles.historySubtitle}>Completed delivery trips and fulfilled orders</Text>
                  </View>
                ) : null}
                {!historyTripId ? (
                  <View style={styles.searchField}>
                    <Ionicons name="search" size={18} color="#94a3b8" />
                    <TextInput
                      style={styles.searchInput}
                      value={historySearch}
                      onChangeText={(value) => { setHistorySearch(value); setHistoryPage(1); }}
                      placeholder="Search trip number, vehicle, order, or customer..."
                      placeholderTextColor="#94a3b8"
                    />
                  </View>
                ) : null}
                {!historyTripId && completedTrips.length === 0 ? (
                  <View style={styles.historyEmpty}>
                    <Ionicons name="time-outline" size={40} color="#cbd5f5" />
                    <Text style={styles.historyEmptyTitle}>No delivery history found</Text>
                    <Text style={styles.historyEmptyHint}>Completed trips will appear here.</Text>
                  </View>
                ) : null}
                {!historyTripId && completedTrips.length > 0 ? (
                  <Text style={styles.historyShowing}>
                    Showing {completedTrips.length} completed {completedTrips.length === 1 ? "trip" : "trips"}
                  </Text>
                ) : null}
                {!historyTripId ? completedTrips
                  .slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE)
                  .map((trip) => {
                    const stopCount = Number(trip.totalDropPoints || trip.dropPoints?.length || 0);
                    return (
                      <Pressable key={trip.id} style={styles.historyCard} onPress={() => setHistoryTripId(trip.id)}>
                        <View style={styles.historyCardHead}>
                          <View style={styles.flex}>
                            <Text style={styles.historyCardTitle}>{trip.tripNumber}</Text>
                            <Text style={styles.historyCardMeta}>
                              {trip.vehicle?.licensePlate || "Vehicle"} ({trip.vehicle?.type || "N/A"}) • {stopCount} {stopCount === 1 ? "Stop" : "Stops"}
                            </Text>
                            <Text style={styles.historyCardTime}>Completed: {formatDate(trip.actualEndAt || trip.updatedAt)}</Text>
                          </View>
                          <StatusPill status="COMPLETED" label="Completed" />
                        </View>
                        <View style={styles.historyCardFooter}>
                          <Text style={styles.historyInspect}>Inspect Purchase Orders</Text>
                          <View style={styles.historyViewDetails}>
                            <Text style={styles.historyViewDetailsText}>View Details</Text>
                            <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
                          </View>
                        </View>
                      </Pressable>
                    );
                  }) : null}
                {!historyTripId && historyTotalPages > 1 ? (
                  <View style={styles.historyPager}>
                    <Pressable
                      style={[styles.historyPagerButton, historyPage <= 1 ? styles.historyPagerButtonDisabled : null]}
                      disabled={historyPage <= 1}
                      onPress={() => setHistoryPage((page) => Math.max(1, page - 1))}
                    >
                      <Text style={styles.historyPagerText}>Previous</Text>
                    </Pressable>
                    <Text style={styles.historyPagerLabel}>Page {historyPage} of {historyTotalPages}</Text>
                    <Pressable
                      style={[styles.historyPagerButton, historyPage >= historyTotalPages ? styles.historyPagerButtonDisabled : null]}
                      disabled={historyPage >= historyTotalPages}
                      onPress={() => setHistoryPage((page) => Math.min(historyTotalPages, page + 1))}
                    >
                      <Text style={styles.historyPagerText}>Next</Text>
                    </Pressable>
                  </View>
                ) : null}
                {historyTripId ? (
                  <HistoryDetails
                    trip={trips.find((trip) => trip.id === historyTripId) || null}
                    selectedPointId={historyPointId}
                    onOpenPoint={setHistoryPointId}
                    onBack={() => { if (historyPointId) setHistoryPointId(null); else setHistoryTripId(null); }}
                  />
                ) : null}
              </View>
            ) : null}

            {activeTab === "profile" ? (
              <View style={styles.profileScreen}>
                <Text style={styles.profilePageTitle}>Profile</Text>
                <View style={styles.profileHero}>
                  <View style={{ position: "relative" }}>
                    <View style={styles.summaryAvatar}>
                      {profile?.avatar ? (
                        <Image source={{ uri: resolveMediaUrl(profile.avatar) }} style={styles.summaryAvatarImage} accessibilityLabel="Driver profile photo" />
                      ) : (
                        <Text style={styles.summaryAvatarText}>{driverInitials}</Text>
                      )}
                    </View>
                    <View style={styles.avatarCameraBadge}>
                      <Ionicons name="camera" size={14} color="#ffffff" />
                    </View>
                  </View>
                  <View style={styles.summaryContent}>
                    <Text style={styles.summaryName}>{profile?.name || user.name || ""}</Text>
                    <Text style={styles.summaryMeta}>{compactDriverName(profile)}</Text>
                    <Text style={styles.summaryMeta}>{profile?.email || user.email || ""}</Text>
                    {profile?.phone || user.phone ? (
                      <View style={styles.phonePill}>
                        <Ionicons name="call" size={12} color="#0369a1" />
                        <Text style={styles.phonePillText}>{profile?.phone || user.phone}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <View style={styles.profileMenuCard}>
                  <MenuRow
                    icon="pencil-outline"
                    label="Edit Profile"
                    description="Update your name and contact details."
                    onPress={() => openProfileModal("edit")}
                  />
                  <MenuRow
                    icon="shield-checkmark-outline"
                    label="Account Security"
                    description="Change your password and secure your account."
                    onPress={() => openProfileModal("security")}
                  />
                  <MenuRow
                    icon="notifications-outline"
                    label="Notification Settings"
                    description="Manage trip, delivery, and system alerts."
                    onPress={() => openProfileModal("notificationSettings")}
                  />
                  <MenuRow
                    icon="document-text-outline"
                    label="Driver License"
                    description="View and manage your license details."
                    onPress={() => openProfileModal("license")}
                  />
                </View>
                <View style={styles.profileLogoutCard}>
                  <MenuRow
                      icon="log-out-outline"
                      label="Log Out"
                      description="Sign out of the driver mobile app."
                      onPress={() => setConfirmLogoutVisible(true)}
                      danger
                    />
                </View>
              </View>
            ) : null}
          </ScrollView>

          {!isTripDetailOpen ? <BottomNavigation
            items={[
              { id: "home", label: "Home", icon: "home-outline", activeIcon: "home" },
              { id: "trips", label: "Trips", icon: "car-outline", activeIcon: "car" },
              { id: "history", label: "History", icon: "time-outline", activeIcon: "time" },
              { id: "profile", label: "Profile", icon: "person-outline", activeIcon: "person" },
            ]}
            activeTab={activeTab}
            onSelect={(tab) => {
              if (tab === "home") setSelectedTripId(getPreferredOperationalTripId(trips));
              if (tab !== "history") { setHistoryTripId(null); setHistoryPointId(null); }
              setIsTripSheetOpen(false);
              setIsTripDetailOpen(false);
              setActiveTab(tab as DriverTab);
            }}
          /> : null}

          <ModalShell
            visible={activeProfileModal === "edit"}
            fullScreen
            title="Edit Profile"
            subtitle="Update your basic driver information."
            onClose={closeProfileModal}
          >
            <View style={styles.profileHeroCard}>
              <Pressable style={styles.avatarPickWrap} onPress={() => void chooseProfileAvatar()} accessibilityRole="button" accessibilityLabel="Change Avatar">
                <View style={styles.summaryAvatar}>
                  {profileAvatarUri || profile?.avatar ? (
                    <Image source={{ uri: profileAvatarUri || resolveMediaUrl(profile?.avatar || "") }} style={styles.summaryAvatarImage} accessibilityLabel="Selected driver profile photo" />
                  ) : (
                    <Text style={styles.summaryAvatarText}>{driverInitials}</Text>
                  )}
                </View>
                <View style={styles.avatarCameraBadge}>
                  <Ionicons name="camera" size={14} color="#ffffff" />
                </View>
              </Pressable>
              <Text style={styles.profileHeroName}>{profile?.name || user.name || "Driver"}</Text>
            </View>

            <View style={styles.formCard}>
              <Field label="First Name" value={profileForm.firstName} placeholder="First name"
                onChangeText={(value) => setProfileForm((current) => ({ ...current, firstName: value }))} />
              <Field label="Last Name" value={profileForm.lastName} placeholder="Last name"
                onChangeText={(value) => setProfileForm((current) => ({ ...current, lastName: value }))} />
              <Field label="Middle Name" value={profileForm.middleName} placeholder="Middle name"
                onChangeText={(value) => setProfileForm((current) => ({ ...current, middleName: value }))} />
              <Field label="Suffix" optional value={profileForm.suffix} placeholder="e.g. Jr., Sr., III"
                onChangeText={(value) => setProfileForm((current) => ({ ...current, suffix: value }))} />
              <Field label="Phone Number" value={profileForm.phone} placeholder="09XX XXX XXXX"
                onChangeText={(value) => setProfileForm((current) => ({ ...current, phone: value }))} />
              <Field label="Emergency Contact" value={profileForm.emergencyContact} placeholder="Emergency contact"
                onChangeText={(value) => setProfileForm((current) => ({ ...current, emergencyContact: value }))} />
              <Field label="Email Address" value={profile?.email || user?.email || ""} editable={false}
                placeholder="Enter your Gmail address" onChangeText={() => {}} />
            </View>

            <Pressable style={styles.primaryWideButton} onPress={handleSaveProfile} disabled={savingProfile}>
              <Text style={styles.primaryWideButtonText}>{savingProfile ? "Saving..." : "Edit Profile"}</Text>
            </Pressable>
          </ModalShell>

          <ModalShell
            visible={activeProfileModal === "security"}
            fullScreen
            title={securitySubView === "password" ? "Change Password" : securitySubView === "settings" ? "Security Settings" : "Account Security"}
            subtitle="Update your password with OTP verification"
            onClose={() => (securitySubView === "menu" ? closeProfileModal() : setSecuritySubView("menu"))}
          >
            {securitySubView === "menu" ? (
              <View style={styles.profileMenuCard}>
                <MenuRow
                  icon="key-outline"
                  label="Change Password"
                  description="Update your password with OTP verification"
                  onPress={() => setSecuritySubView("password")}
                />
                <MenuRow
                  icon="shield-checkmark-outline"
                  label="Security Settings"
                  description="Configure 2FA login verification and security alerts"
                  onPress={() => setSecuritySubView("settings")}
                />
              </View>
            ) : null}

            {securitySubView === "password" ? (
              <>
                <View style={styles.formCard}>
                  <Field
                    label="New Password"
                    value={securityForm.newPassword}
                    placeholder=""
                    secureTextEntry
                    onChangeText={(value) => setSecurityForm((current) => ({ ...current, newPassword: value }))}
                  />
                  <PasswordRequirements password={securityForm.newPassword} />
                  <Field
                    label="Confirm Password"
                    value={securityForm.confirmPassword}
                    placeholder=""
                    secureTextEntry
                    onChangeText={(value) => setSecurityForm((current) => ({ ...current, confirmPassword: value }))}
                  />
                  <View style={styles.verificationPanel}>
                    <Text style={styles.verificationTitle}>Security Verification</Text>
                    <Text style={styles.verificationBody}>OTP verification is required to update password.</Text>
                    {/* Requesting is hidden while the resend cooldown runs, so the
                        panel offers exactly one useful action at a time: request a
                        code, then enter the one just sent, then request again once
                        the cooldown clears. A live code keeps "Enter OTP" available
                        alongside it until the code expires. */}
                    {otpResendCooldown <= 0 ? (
                      <Pressable
                        style={styles.primaryWideButton}
                        disabled={sendingOtp}
                        onPress={() => {
                          void (async () => {
                            await handleRequestOtp();
                            resetOtpTimers();
                            setSecuritySubView("otp");
                          })();
                        }}
                      >
                        <Text style={styles.primaryWideButtonText}>{sendingOtp ? "Sending..." : "Request Verification OTP"}</Text>
                      </Pressable>
                    ) : null}
                    {otpExpiry > 0 && !otpVerified ? (
                      <Pressable style={styles.modalOutlineButton} onPress={() => setSecuritySubView("otp")}>
                        <Text style={styles.outlineButtonText}>Enter OTP</Text>
                      </Pressable>
                    ) : null}
                    {otpResendCooldown > 0 ? (
                      <Text style={styles.verificationWaiting}>You can request a new code in {otpResendCooldown}s</Text>
                    ) : null}
                  </View>
                </View>
                <Pressable
                  style={[styles.primaryWideButton, !otpVerified ? styles.primaryWideButtonDisabled : null]}
                  onPress={handleChangePassword}
                  disabled={resettingPassword || !otpVerified}
                >
                  <Text style={styles.primaryWideButtonText}>{resettingPassword ? "Updating..." : "Update Password"}</Text>
                </Pressable>
              </>
            ) : null}

            {securitySubView === "otp" ? (
              <OtpScreen
                email={profile?.email || user?.email || "your email"}
                code={securityForm.otp}
                onChangeCode={(next) => { setSecurityForm((current) => ({ ...current, otp: next })); setOtpVerified(false); }}
                expirySeconds={otpExpiry}
                resendSeconds={otpResendCooldown}
                verifying={verifyingOtp}
                sending={sendingOtp}
                error={error}
                onVerify={handleVerifyOtp}
                onResend={() => {
                  void (async () => {
                    await handleRequestOtp();
                    resetOtpTimers();
                  })();
                }}
                onBack={() => setSecuritySubView("password")}
              />
            ) : null}

            {securitySubView === "settings" ? (
              <View style={styles.formCard}>
                <ToggleRow
                  label="Two-Factor Authentication (2FA)"
                  description="Require a 6-digit OTP code when logging in to protect your driver account."
                  value={securityPrefs.twoFactorAuthentication}
                  onValueChange={(value) => void handleSecurityPreferenceChange("twoFactorAuthentication", value)}
                />
                <ToggleRow
                  label="Login Activity Alerts"
                  description="Receive email notifications when your account is logged in from a new device."
                  value={securityPrefs.loginAlerts}
                  onValueChange={(value) => void handleSecurityPreferenceChange("loginAlerts", value)}
                />
                <ToggleRow
                  label="Remember Device Sessions"
                  description="Keep trusted sessions active on your browser for faster access."
                  value={securityPrefs.rememberDevice}
                  onValueChange={(value) => void persistSecurityPreferences({ ...securityPrefs, rememberDevice: value })}
                />
              </View>
            ) : null}
          </ModalShell>

          {/* The driver portal keeps these apart: the bell opens the feed, the profile
              row opens the switches. They were one screen here, so the bell landed on
              a page of toggles. */}
          <ModalShell
            visible={activeProfileModal === "notifications"}
            fullScreen
            title="Notifications"
            subtitle="Your latest driver alerts."
            onClose={closeProfileModal}
          >
            {/* Matches the portal's Notifications page: a "Clear all" action on the
                header row, then one card per alert. */}
            <View style={styles.notificationsHeaderRow}>
              <Text style={styles.notificationsCount}>
                {unreadNotifications > 0 ? `${unreadNotifications} unread` : "All caught up"}
              </Text>
              <View style={styles.notificationsHeaderActions}>
                {unreadNotifications > 0 ? (
                  <Pressable onPress={() => void handleMarkAllNotificationsRead()} accessibilityRole="button">
                    <Text style={styles.notificationsMarkRead}>Mark all read</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => Alert.alert("Clear Notifications", "Delete all of your notifications?", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Clear", style: "destructive", onPress: () => void handleClearNotifications() },
                  ])}
                >
                  <Text style={styles.notificationsClearAll}>Clear all</Text>
                </Pressable>
              </View>
            </View>

            {notificationLoading ? <ActivityIndicator color="#0f172a" /> : null}
            {!notificationLoading && notifications.length === 0 ? (
              <Text style={styles.subtle}>No notifications.</Text>
            ) : null}

            <View style={styles.formCard}>
              {notifications.map((notification) => (
                <View key={notification.id} style={styles.notificationRow}>
                  <View style={styles.notificationIcon}>
                    <Ionicons name="notifications-outline" size={16} color="#0369a1" />
                  </View>
                  <View style={styles.flex}>
                    <View style={styles.notificationTitleRow}>
                      <Text style={styles.notificationTitle}>{notification.title || "Notification"}</Text>
                      <Text style={styles.notificationDate}>{formatDateOnly(notification.createdAt)}</Text>
                    </View>
                    <Text style={styles.notificationBody}>{notification.message || ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color="#cbd5e1" />
                </View>
              ))}
            </View>
          </ModalShell>

          <ModalShell
            visible={activeProfileModal === "notificationSettings"}
            fullScreen
            title="Notification Settings"
            subtitle="Choose which driver alerts you want to receive."
            onClose={closeProfileModal}
          >
            <View style={styles.formCard}>
              <ToggleRow
                label="Trip Notifications"
                description="Receive updates for new or reassigned trips."
                value={notificationPrefs.tripNotifications}
                onValueChange={(value) => void persistNotificationPreferences({ ...notificationPrefs, tripNotifications: value })}
              />
              <ToggleRow
                label="Delivery Updates"
                description="Receive route progress and stop completion alerts."
                value={notificationPrefs.deliveryUpdates}
                onValueChange={(value) => void persistNotificationPreferences({ ...notificationPrefs, deliveryUpdates: value })}
              />
              <ToggleRow
                label="System Alerts"
                description="Receive important driver announcements."
                value={notificationPrefs.systemAlerts}
                onValueChange={(value) => void persistNotificationPreferences({ ...notificationPrefs, systemAlerts: value })}
              />
            </View>
          </ModalShell>

          <ModalShell
            visible={activeProfileModal === "license"}
            fullScreen
            title="Driver License"
            subtitle="Review and manage your license details."
            onClose={closeProfileModal}
          >
            <View style={styles.formCard}>
              <Field
                label="Driver License Number"
                value={profileForm.licenseNumber}
                placeholder="D09-22-000984"
                onChangeText={(value) => setProfileForm((current) => ({ ...current, licenseNumber: value }))}
              />
              <View>
                <Text style={styles.fieldLabel}>Restrictions</Text>
                <OptionSelect
                  value={String(profileForm.licenseType || "").toUpperCase()}
                  options={DRIVER_LICENSE_RESTRICTIONS}
                  onChange={(value) => setProfileForm((current) => ({ ...current, licenseType: value }))}
                  placeholder="Select restriction"
                  accessibilityLabel="Driver license restrictions"
                />
              </View>
              <Field
                label="License Expiry Date"
                value={profileForm.licenseExpiry}
                placeholder="YYYY-MM-DD"
                onChangeText={(value) => setProfileForm((current) => ({ ...current, licenseExpiry: value }))}
              />
              <InfoRow label="License Status" value={licenseStatus} />
            </View>
            <Pressable style={styles.primaryWideButton} onPress={handleSaveProfile} disabled={savingProfile}>
              <Text style={styles.primaryWideButtonText}>{savingProfile ? "Saving..." : "Save License"}</Text>
            </Pressable>
          </ModalShell>

          <ModalShell
            visible={stopActionMode === "complete"}
            title="Complete Delivery"
            subtitle={stopActionPoint?.locationName || `Stop ${stopActionPoint?.sequence || ""}`}
            onClose={closeStopAction}
          >
            {!!error && <Text style={styles.error}>{error}</Text>}
            <TextInput style={[styles.input, styles.multilineInput]} value={deliveryNotes} onChangeText={setDeliveryNotes} placeholder="Delivery notes (optional)" multiline />
            {getReturnableContainers(stopActionPoint).length ? (
              <View style={styles.orderItems}>
                <Text style={styles.listTitle}>Returned Empty Bottles</Text>
                {getReturnableContainers(stopActionPoint).map((container) => {
                  const quantity = returnedEmpties[container.id] || 0;
                  return (
                    <View key={container.id} style={styles.returnableRow}>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>{container.name}</Text>
                        <Text style={styles.subtle}>Expected: {container.expected}</Text>
                      </View>
                      <Pressable style={styles.quantityButton} onPress={() => setReturnedEmpties((current) => ({ ...current, [container.id]: Math.max(0, quantity - 1) }))}><Text style={styles.quantityButtonText}>−</Text></Pressable>
                      <Text style={styles.quantityValue}>{quantity}</Text>
                      <Pressable style={styles.quantityButton} onPress={() => setReturnedEmpties((current) => ({ ...current, [container.id]: quantity + 1 }))}><Text style={styles.quantityButtonText}>+</Text></Pressable>
                    </View>
                  );
                })}
              </View>
            ) : null}
            {podImageUri ? (
              <View style={styles.podPreviewWrap}>
                <Image source={{ uri: podImageUri }} style={styles.podPreview} accessibilityLabel="Proof of delivery preview" />
                {podCaptureMetadata ? (
                  <View style={styles.podPreviewOverlay} pointerEvents="none">
                    <Text style={styles.podPreviewOverlayText}>{formatPodDate(new Date(podCaptureMetadata.capturedAt))}</Text>
                    <Text style={styles.podPreviewOverlayText}>{formatPodTime(new Date(podCaptureMetadata.capturedAt))}</Text>
                    <Text style={styles.podPreviewOverlayText}>{formatDriverFullName(profile, user)}</Text>
                    <Text style={styles.podPreviewOverlayText} numberOfLines={2}>{podCaptureMetadata.address}</Text>
                    <Text style={styles.podPreviewOverlayText}>GPS: {podCaptureMetadata.latitude.toFixed(6)}, {podCaptureMetadata.longitude.toFixed(6)}</Text>
                  </View>
                ) : null}
              </View>
            ) : <Text style={styles.subtle}>A proof of delivery image is required.</Text>}
            <View style={styles.row}>
              <Pressable style={styles.secondaryButton} onPress={() => void choosePodImage("camera")}><Text style={styles.secondaryButtonText}>Take Photo</Text></Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => void choosePodImage("library")}><Text style={styles.secondaryButtonText}>Choose Photo</Text></Pressable>
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalGhostButton} onPress={closeStopAction}><Text style={styles.modalGhostButtonText}>Cancel</Text></Pressable>
              <Pressable style={styles.primaryButtonCompact} onPress={() => void handleCompleteStop()} disabled={stopActionLoading}><Text style={styles.primaryButtonText}>{stopActionLoading ? "Submitting…" : "Confirm Delivered"}</Text></Pressable>
            </View>
          </ModalShell>

          <Modal visible={podCameraOpen} animationType="fade" onRequestClose={closePodCamera}>
            <View style={styles.podCameraScreen}>
              <CameraView ref={podCameraRef} style={styles.podCameraPreview} facing="back" active={podCameraOpen}>
                <SafeAreaView style={styles.podCameraSafeArea}>
                  <View style={styles.podCameraTopBar}>
                    <Pressable style={styles.podCameraCloseButton} onPress={closePodCamera} accessibilityLabel="Close proof camera">
                      <Ionicons name="close" size={25} color="#ffffff" />
                    </Pressable>
                    <Text style={styles.podCameraTitle}>Proof of Delivery</Text>
                    <View style={styles.podCameraTopSpacer} />
                  </View>
                  <View style={styles.podCameraOverlayWrap} pointerEvents="none">
                    <View style={styles.podCameraOverlay}>
                      <Text style={styles.podCameraOverlayText}>{formatPodDate(podCameraNow)}</Text>
                      <Text style={styles.podCameraOverlayText}>{formatPodTime(podCameraNow)}</Text>
                      <Text style={styles.podCameraOverlayText}>{formatDriverFullName(profile, user)}</Text>
                      <Text style={styles.podCameraOverlayText}>{podCameraAddress}</Text>
                      <Text style={styles.podCameraOverlayText}>
                        {podCameraLocation ? `GPS: ${podCameraLocation.latitude.toFixed(6)}, ${podCameraLocation.longitude.toFixed(6)}` : "Waiting for current GPS location..."}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.podCameraControls}>
                    {!!podCameraError && <Text style={styles.podCameraError}>{podCameraError}</Text>}
                    <Pressable
                      style={[styles.podCameraShutter, (!podCameraLocation || podCameraAddressResolving || podCameraCapturing) && styles.podCameraShutterDisabled]}
                      onPress={() => void capturePodCameraPhoto()}
                      disabled={!podCameraLocation || podCameraAddressResolving || podCameraCapturing}
                      accessibilityLabel="Capture proof of delivery photo"
                    >
                      {podCameraCapturing ? <ActivityIndicator color="#0f172a" /> : <View style={styles.podCameraShutterInner} />}
                    </Pressable>
                  </View>
                </SafeAreaView>
              </CameraView>
            </View>
          </Modal>

          <ModalShell
            visible={stopActionMode === "failed"}
            title="Cannot Deliver"
            subtitle={stopActionPoint?.locationName || `Stop ${stopActionPoint?.sequence || ""}`}
            onClose={closeStopAction}
          >
            {!!error && <Text style={styles.error}>{error}</Text>}
            <TextInput style={[styles.input, styles.multilineInput]} value={failureReason} onChangeText={setFailureReason} placeholder="Reason delivery failed" multiline />
            <TextInput style={[styles.input, styles.multilineInput]} value={deliveryNotes} onChangeText={setDeliveryNotes} placeholder="Additional notes (optional)" multiline />
            <Text style={styles.listTitle}>What should happen next?</Text>
            <View style={styles.choiceWrap}>
              {([
                ["tomorrow", "Tomorrow"],
                ["other_date", "Other date"],
                ["cancel", "Cancel delivery"],
              ] as const).map(([value, label]) => (
                <Pressable key={value} style={[styles.choiceChip, rescheduleWindow === value && styles.choiceChipActive]} onPress={() => setRescheduleWindow(value)}>
                  <Text style={[styles.choiceChipText, rescheduleWindow === value && styles.choiceChipTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {rescheduleWindow === "other_date" ? <TextInput style={styles.input} value={rescheduleDate} onChangeText={setRescheduleDate} placeholder="YYYY-MM-DD" /> : null}
            <Text style={styles.modalHelpText}>{rescheduleWindow === "cancel" ? "Cancellation releases reserved inventory." : "Inventory stays reserved and the order returns to route planning."}</Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalGhostButton} onPress={closeStopAction}><Text style={styles.modalGhostButtonText}>Back</Text></Pressable>
              <Pressable style={[styles.primaryButtonCompact, rescheduleWindow === "cancel" && styles.dangerButton]} onPress={() => void handleFailedStop()} disabled={stopActionLoading}><Text style={styles.primaryButtonText}>{stopActionLoading ? "Saving…" : rescheduleWindow === "cancel" ? "Cancel Delivery" : "Save Reschedule"}</Text></Pressable>
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
        </View>
      )}
      <ModalShell
        visible={authModal === "login-otp"}
        title="Verify Driver Login"
        subtitle={`Enter the code sent to ${email.trim().toLowerCase()}.`}
        onClose={() => { setAuthModal(null); setLoginOtp(""); setError(null); }}
      >
        {!!error && <Text style={styles.error}>{error}</Text>}
        <TextInput
          style={styles.input}
          value={loginOtp}
          onChangeText={(value) => { setLoginOtp(value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
          placeholder="6-digit verification code"
          keyboardType="number-pad"
          maxLength={6}
        />
        <Pressable style={styles.loginButton} onPress={() => void handleVerifyLoginOtp()} disabled={loginOtpLoading}>
          <Text style={styles.primaryButtonText}>{loginOtpLoading ? "Verifying..." : "Verify and Log In"}</Text>
        </Pressable>
        <Pressable style={styles.forgotButton} onPress={() => void handleResendLoginOtp()} disabled={loginOtpLoading}>
          <Text style={styles.forgotButtonText}>Resend verification code</Text>
        </Pressable>
      </ModalShell>

      <ModalShell
        visible={authModal === "forgot-password"}
        title="Reset Password"
        subtitle={forgotPasswordStep === "email" ? "Enter your driver account email." : forgotPasswordStep === "otp" ? "Verify the code sent to your email." : "Create a new secure password."}
        onClose={() => { setAuthModal(null); setError(null); }}
      >
        {!!error && <Text style={styles.error}>{error}</Text>}
        {forgotPasswordStep === "email" ? (
          <TextInput style={styles.input} value={forgotEmail} onChangeText={setForgotEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Driver email" />
        ) : null}
        {forgotPasswordStep === "otp" ? (
          <TextInput style={styles.input} value={forgotOtp} onChangeText={(value) => setForgotOtp(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} placeholder="6-digit verification code" />
        ) : null}
        {forgotPasswordStep === "password" ? (
          <>
            <TextInput style={styles.input} value={forgotNewPassword} onChangeText={setForgotNewPassword} secureTextEntry placeholder="New password" />
            <TextInput style={styles.input} value={forgotConfirmPassword} onChangeText={setForgotConfirmPassword} secureTextEntry placeholder="Confirm new password" />
            <PasswordRequirements password={forgotNewPassword} />
          </>
        ) : null}
        <Pressable style={styles.loginButton} onPress={() => void handleForgotPasswordNext()} disabled={forgotPasswordLoading}>
          <Text style={styles.primaryButtonText}>
            {forgotPasswordLoading ? "Please wait..." : forgotPasswordStep === "email" ? "Send Verification Code" : forgotPasswordStep === "otp" ? "Verify Code" : "Reset Password"}
          </Text>
        </Pressable>
        {forgotPasswordStep !== "email" ? (
          <Pressable style={styles.forgotButton} onPress={() => setForgotPasswordStep(forgotPasswordStep === "password" ? "otp" : "email")}>
            <Text style={styles.forgotButtonText}>Back</Text>
          </Pressable>
        ) : null}
      </ModalShell>
    </SafeAreaView>
  );
}

function AppHeader({ title, unreadCount, onOpenNotifications }: { title: string; unreadCount: number; onOpenNotifications: () => void }) {
  return (
    <View style={styles.appHeader}>
      <View style={styles.logoWrap}>
        <View style={styles.flex}>
          <Text style={styles.appHeaderEyebrow}>ANN ANN&apos;S BEVERAGES TRADING</Text>
          <Text style={styles.appHeaderTitle}>{title}</Text>
        </View>
      </View>
      <Pressable accessibilityLabel="Open notifications" style={styles.headerAvatar} onPress={onOpenNotifications}>
        <Ionicons name="notifications-outline" size={18} color="#ffffff" />
        {unreadCount > 0 ? <View style={styles.headerUnreadDot} /> : null}
      </Pressable>
    </View>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: number; icon?: string }) {
  return (
    <View style={styles.metricCard}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={styles.metricLabel}>{label}</Text>
        {icon && (
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={icon as any} size={20} color="#0d61ad" />
          </View>
        )}
      </View>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

// Status pill shared by every history level, mirroring renderStatusPill() in the
// web portal: completed/delivered reads "Delivered", failures read in red.
function StatusPill({ status, label }: { status?: string | null; label?: string }) {
  const raw = String(status || "").toUpperCase();
  const failed = raw === "FAILED" || raw === "CANCELLED" || raw === "SKIPPED" || raw === "REJECTED";
  const arrived = raw === "ARRIVED";
  const pending = raw === "PENDING" || raw === "IN_TRANSIT";
  const text = label
    || (failed ? (raw === "FAILED" ? "Failed" : "Cancelled") : arrived || pending ? raw.replace("_", " ") : "Delivered");
  // Kept as two values rather than a tuple: a mixed View/Text style array widens to
  // a union that neither prop accepts.
  const boxStyle = failed
    ? styles.statusPillFailed
    : arrived ? styles.statusPillArrived : pending ? styles.statusPillPending : styles.statusPillDone;
  const textStyle = failed
    ? styles.statusPillTextFailed
    : arrived ? styles.statusPillTextArrived : pending ? styles.statusPillTextPending : styles.statusPillTextDone;
  return (
    <View style={[styles.statusPill, boxStyle]}>
      <Text style={[styles.statusPillText, textStyle]}>{text}</Text>
    </View>
  );
}

function HistoryDetails({ trip, selectedPointId, onOpenPoint, onBack }: {
  trip: DriverTrip | null;
  selectedPointId: string | null;
  onOpenPoint: (pointId: string | null) => void;
  onBack: () => void;
}) {
  if (!trip) return <Text style={styles.subtle}>This completed trip is no longer available.</Text>;
  const dropPoints = trip.dropPoints || [];
  const selectedPoint = dropPoints.find((point) => point.id === selectedPointId) || null;

  // LEVEL 3 - one purchase order on a completed trip.
  if (selectedPoint) {
    const order = selectedPoint.order;
    const items = order?.items || [];
    const totalCases = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const address = [selectedPoint.address, selectedPoint.city, selectedPoint.province, selectedPoint.zipCode]
      .filter(Boolean)
      .join(", ");
    const status = String(selectedPoint.status || order?.status || "").toUpperCase();
    const failed = status === "FAILED" || status === "CANCELLED" || status === "SKIPPED";

    return (
      <View style={styles.stack}>
        <Pressable style={styles.historyBackRow} onPress={onBack}>
          <Ionicons name="arrow-back" size={16} color="#475569" />
          <Text style={styles.historyBackText}>Back to {trip.tripNumber}</Text>
        </Pressable>

        <View style={styles.historyPanel}>
          <View style={styles.historyCardHead}>
            <View style={styles.flex}>
              <Text style={styles.historyStopLabel}>Stop #{selectedPoint.sequence || 1}</Text>
              <Text style={styles.historyOrderNumber}>
                {order?.orderNumber || "Order"}
              </Text>
            </View>
            <StatusPill status={status} />
          </View>

          <View style={styles.historyKeyValues}>
            <View>
              <Text style={styles.historyKeyLabel}>Customer</Text>
              <Text style={styles.historyKeyValue}>
                {selectedPoint.locationName || selectedPoint.contactName || order?.shippingName || "N/A"}
              </Text>
            </View>
            <View>
              <Text style={styles.historyKeyLabel}>Phone</Text>
              <Text style={styles.historyKeyValue}>{selectedPoint.contactPhone || order?.shippingPhone || "N/A"}</Text>
            </View>
            <View>
              <Text style={styles.historyKeyLabel}>Delivery Address</Text>
              <Text style={styles.historyKeyValue}>{address || "N/A"}</Text>
            </View>
          </View>

          {failed && (selectedPoint.notes || selectedPoint.failureReason) ? (
            <View style={styles.historyFailureBox}>
              <Text style={styles.historyFailureTitle}>Cancellation / Failure Reason</Text>
              <Text style={styles.historyFailureText}>
                {selectedPoint.notes || selectedPoint.failureReason}
              </Text>
            </View>
          ) : null}

          {selectedPoint.deliveryPhoto ? (
            <View style={styles.historyPodBox}>
              <View style={styles.historyCardHead}>
                <Text style={styles.historyPodTitle}>Proof of Delivery</Text>
                {selectedPoint.recipientName ? (
                  <Text style={styles.historyPodRecipient}>
                    Received by: <Text style={styles.historyPodRecipientName}>{selectedPoint.recipientName}</Text>
                  </Text>
                ) : null}
              </View>
              {/* The web links out to the full-size photo; tapping the thumbnail
                  opens the same image full-screen here. */}
              <ImagePreview
                url={selectedPoint.deliveryPhoto}
                style={styles.historyPodImage}
                caption="View Delivery Photo"
                accessibilityLabel="proof of delivery"
              />
            </View>
          ) : null}
        </View>

        <View style={styles.historyPanel}>
          <View style={styles.historyPanelHead}>
            <Text style={styles.historyPanelTitle}>Ordered Products ({items.length})</Text>
            <Text style={styles.historyPanelMeta}>
              {totalCases} Total {totalCases === 1 ? "Case" : "Cases"}
            </Text>
          </View>
          {items.length === 0 ? (
            <Text style={styles.historyNoProducts}>No products recorded on this order.</Text>
          ) : (
            items.map((item, index) => <OrderItemDetails key={item.id || String(index)} item={item} />)
          )}
          {Number(order?.totalAmount || 0) > 0 ? (
            <View style={styles.historyTotalRow}>
              <Text style={styles.historyTotalLabel}>Total Order Value</Text>
              <Text style={styles.historyTotalValue}>{formatPeso(order?.totalAmount)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  // LEVEL 2 - the purchase orders on one completed trip.
  return (
    <View style={styles.stack}>
      <Pressable style={styles.historyBackRow} onPress={onBack}>
        <Ionicons name="arrow-back" size={16} color="#475569" />
        <Text style={styles.historyBackText}>Back to Delivery History</Text>
      </Pressable>

      <View>
        <View style={styles.historyCardHead}>
          <Text style={styles.historyTripNumber}>{trip.tripNumber}</Text>
          <StatusPill status="COMPLETED" label="Completed" />
        </View>
        <Text style={styles.historyCardTime}>
          Completed on {formatDate(trip.actualEndAt || trip.updatedAt)} - {trip.vehicle?.licensePlate || "Vehicle"} ({trip.vehicle?.type || "N/A"})
        </Text>
      </View>

      <Text style={styles.historySectionLabel}>Purchase Orders ({dropPoints.length})</Text>
      {dropPoints.length === 0 ? (
        <Text style={styles.historyNoProducts}>No purchase orders found for this trip.</Text>
      ) : null}
      {dropPoints.map((point) => {
        const orderItems = point.order?.items || [];
        const itemCount = orderItems.length;
        const totalCases = orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const stopAddress = [point.address, point.city].filter(Boolean).join(", ");
        return (
          <Pressable key={point.id} style={styles.historyCard} onPress={() => onOpenPoint(point.id)}>
            <View style={styles.historyCardHead}>
              <View style={styles.flex}>
                <View style={styles.historyStopRow}>
                  <View style={styles.historySequence}>
                    <Text style={styles.historySequenceText}>{point.sequence || 1}</Text>
                  </View>
                  <Text style={styles.historyCustomerName}>
                    {point.locationName || point.contactName || point.order?.shippingName || "Customer"}
                  </Text>
                </View>
                <Text style={styles.historyStopOrder}>
                  {point.order?.orderNumber || "Order"}
                </Text>
              </View>
              <StatusPill status={point.status || point.order?.status} />
            </View>
            <Text style={styles.historyStopAddress} numberOfLines={1}>{stopAddress || "N/A"}</Text>
            <View style={styles.historyCardFooter}>
              <View style={styles.historyThumbRow}>
                {orderItems.slice(0, 3).map((item, index) => (
                  item.product?.imageUrl ? (
                    <Image
                      key={item.id || String(index)}
                      source={{ uri: resolveMediaUrl(item.product.imageUrl) }}
                      style={styles.historyThumb}
                    />
                  ) : (
                    <View key={item.id || String(index)} style={[styles.historyThumb, styles.historyThumbEmpty]}>
                      <Ionicons name="cube-outline" size={12} color="#94a3b8" />
                    </View>
                  )
                ))}
                <Text style={styles.historyItemSummary}>
                  {itemCount > 0
                    ? `${itemCount} item${itemCount === 1 ? "" : "s"} - ${totalCases} case${totalCases === 1 ? "" : "s"}`
                    : "Details"}
                </Text>
              </View>
              <View style={styles.historyViewDetails}>
                <Text style={styles.historyViewDetailsText}>View Details</Text>
                <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function OrderItemDetails({ item }: { item: DriverTripOrderItem }) {
  const isMixed = item.itemType === "MIXED_CASE";
  const productName = isMixed ? "Mixed Case" : String(item.product?.name || item.product?.sku || "Product");
  const sizeLabel = String(item.product?.sizeLabel || "").trim();
  const sku = String(item.product?.sku || "").trim();
  const qty = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const lineTotal = Number(item.totalPrice || unitPrice * qty || 0);
  const image = item.product?.imageUrl;

  return (
    <View style={styles.productRow}>
      <View style={styles.productThumbWrap}>
        {image ? (
          <Image source={{ uri: resolveMediaUrl(image) }} style={styles.productThumb} resizeMode="cover" />
        ) : (
          <Ionicons name="cube-outline" size={20} color="#94a3b8" />
        )}
      </View>

      <View style={styles.productInfo}>
        <Text style={styles.productName}>
          {productName}
          {sizeLabel ? <Text style={styles.productSize}> ({sizeLabel})</Text> : null}
        </Text>
        {sku ? <Text style={styles.productSku}>SKU: {sku}</Text> : null}
        {isMixed ? (
          <View style={styles.mixedBadge}>
            <Text style={styles.mixedBadgeText}>Mixed Case</Text>
          </View>
        ) : null}
        {isMixed ? (item.components || []).map((component) => (
          <Text key={component.id || component.productId || component.productSku} style={styles.productComponent}>
            {productNameWithSize(component.productName || component.productSku || "Product", component.product?.sizes?.[0])}: {Number(component.quantityPerCase || 0)} {component.baseUnitLabel || "bottles"} per case
          </Text>
        )) : null}
      </View>

      <View style={styles.productPricing}>
        <Text style={styles.productQty}>{qty} {qty === 1 ? "case" : "cases"}</Text>
        {unitPrice > 0 ? <Text style={styles.productUnit}>{formatPeso(unitPrice)} ea</Text> : null}
        {lineTotal > 0 ? <Text style={styles.productLineTotal}>{formatPeso(lineTotal)}</Text> : null}
      </View>
    </View>
  );
}

function getReturnableContainers(point: DriverTripDropPoint | null): Array<{ id: string; name: string; expected: number }> {
  const grouped = new Map<string, { id: string; name: string; expected: number }>();
  for (const item of point?.order?.items || []) {
    if (!item.isReturnableItem || !item.containerTypeId) continue;
    const current = grouped.get(item.containerTypeId) || {
      id: item.containerTypeId,
      name: item.containerTypeName || "Returnable Glass Bottle",
      expected: 0,
    };
    current.expected += Math.max(0, Number(item.fullQuantity ?? item.quantity ?? 0));
    grouped.set(item.containerTypeId, current);
  }
  return Array.from(grouped.values());
}

// The stop card on the trip-detail sheet. Laid out to match the web driver portal:
// numbered marker, customer, order number, the amber Total Price strip, the Order
// Details panel with a category line per product, POD photo, and the call/deliver
// actions.
function DropPointCard({ point, tripStatus, onArrive, onComplete, onFailed }: {
  point: DriverTripDropPoint;
  tripStatus: string;
  onArrive: () => void;
  onComplete: () => void;
  onFailed: () => void;
}) {
  const status = normalizeStatus(point.status || "PENDING");
  const canAct = normalizeStatus(tripStatus) === "IN_PROGRESS";
  const order = point.order;
  const orderNumber = String(order?.orderNumber || "").trim();
  // A replacement delivery collects nothing, so it shows a free-of-charge strip
  // instead of an order total.
  const isReplacementOrder = Boolean(order?.scheduledReplacement) || orderNumber.toUpperCase().startsWith("RPL-");
  const address = [point.address, point.city, point.province, point.zipCode].filter(Boolean).join(", ");
  const items = order?.items || [];
  const phone = String(point.contactPhone || order?.shippingPhone || "").trim();
  const done = status === "COMPLETED" || status === "FAILED" || status === "SKIPPED" || status === "CANCELLED";

  return (
    <View style={styles.dropPointCard}>
      <View style={styles.dropPointHead}>
        <View style={[
          styles.dropPointMarker,
          status === "COMPLETED" ? styles.dropPointMarkerDone : status === "FAILED" ? styles.dropPointMarkerFailed : null,
        ]}>
          {status === "COMPLETED"
            ? <Ionicons name="checkmark" size={15} color="#ffffff" />
            : <Text style={[styles.dropPointMarkerText, status === "FAILED" ? styles.dropPointMarkerTextOn : null]}>{point.sequence || "?"}</Text>}
        </View>

        <View style={styles.flex}>
          <View style={styles.dropPointTitleRow}>
            <Text style={styles.dropPointName}>
              {point.locationName || point.contactName || order?.shippingName || "Customer"}
            </Text>
            <StatusPill status={point.status || "PENDING"} />
          </View>
          {address ? <Text style={styles.dropPointAddress}>{address}</Text> : null}
          {orderNumber ? <Text style={styles.dropPointOrderNumber}>{orderNumber}</Text> : null}

          {order ? (
            <View style={isReplacementOrder ? styles.replacementTotalBox : styles.orderTotalBox}>
              <Text style={isReplacementOrder ? styles.replacementTotalText : styles.orderTotalText}>
                {isReplacementOrder
                  ? "Replacement Delivery • Free / No Collection (₱0.00)"
                  : `Total Price: ${formatPeso(order.totalAmount)}`}
              </Text>
            </View>
          ) : null}

          {items.length ? (
            <View style={styles.orderDetailsPanel}>
              <View style={styles.orderDetailsHead}>
                <Text style={styles.orderDetailsTitle}>
                  {isReplacementOrder ? "Replacement Details" : "Order Details"}
                </Text>
                {isReplacementOrder ? (
                  <View style={styles.replacementBadge}>
                    <Text style={styles.replacementBadgeText}>Replacement</Text>
                  </View>
                ) : null}
              </View>
              {items.map((item, index) => {
                const isMixedCase = item.itemType === "MIXED_CASE";
                const measure = String(item.product?.unit || "case").toLowerCase().includes("pack") ? "packs" : "cases";
                const category = String(item.product?.category || "").trim();
                return (
                  <View key={item.id || String(index)} style={styles.orderDetailsItem}>
                    <Text style={styles.orderDetailsItemName}>
                      {isMixedCase
                        ? "Mixed Case"
                        : productNameWithSize(item.product?.name || item.product?.sku || "Product", item.product?.sizeLabel)}
                      {` x${Number(item.quantity || 0)} ${measure}`}
                    </Text>
                    {category ? <Text style={styles.orderDetailsItemCategory}>{category}</Text> : null}
                    {isMixedCase ? (item.components || []).map((component) => (
                      <Text key={component.id || component.productId || component.productSku} style={styles.orderDetailsItemCategory}>
                        {productNameWithSize(component.productName || component.productSku || "Product", component.product?.sizes?.[0])}: {Number(component.quantityPerCase || 0)} {component.baseUnitLabel || "bottles"} per case
                      </Text>
                    )) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {point.deliveryPhoto ? (
            <View style={styles.orderDetailsPanel}>
              <Text style={styles.orderDetailsTitle}>POD Photo</Text>
              <ImagePreview
                url={point.deliveryPhoto}
                style={styles.dropPointPodImage}
                caption="View Delivery Photo"
                accessibilityLabel="proof of delivery"
              />
            </View>
          ) : null}

          {order?.replacements?.length ? (
            <View style={styles.orderDetailsPanel}>
              <Text style={styles.orderDetailsTitle}>Replacement items</Text>
              {order.replacements.map((replacement) => (
                <Text key={replacement.id} style={styles.orderDetailsItemCategory}>
                  {replacement.replacementNumber || "Replacement"}: {replacement.remainingQuantity ?? replacement.replacementQuantity ?? 0} remaining • {replacement.status || "PENDING"}
                </Text>
              ))}
            </View>
          ) : null}

          {point.notes ? <Text style={styles.dropPointNotes}>Notes: {point.notes}</Text> : null}
        </View>
      </View>

      {phone ? (
        <Pressable
          style={styles.callContactRow}
          accessibilityRole="button"
          accessibilityLabel={`Call ${point.contactName || "contact"}`}
          onPress={() => Linking.openURL(`tel:${phone}`)}
        >
          <Ionicons name="call-outline" size={15} color="#0369a1" />
          <Text style={styles.callContactText}>Call Contact</Text>
        </Pressable>
      ) : null}

      {canAct && !done ? (
        <View style={styles.dropPointActions}>
          {status === "PENDING" ? (
            <Pressable
              accessibilityLabel={`Mark stop ${point.sequence || ""} arrived`}
              style={styles.primaryButtonCompact}
              onPress={onArrive}
            >
              <Text style={styles.primaryButtonText}>Arrived</Text>
            </Pressable>
          ) : null}
          {status === "ARRIVED" ? (
            <>
              <Text style={styles.podHelperText}>Camera access is required before marking as delivered.</Text>
              <View style={styles.row}>
                <Pressable
                  accessibilityLabel={`Complete delivery at stop ${point.sequence || ""}`}
                  style={styles.deliveredButton}
                  onPress={onComplete}
                >
                  <Ionicons name="checkmark-circle-outline" size={16} color="#ffffff" />
                  <Text style={styles.primaryButtonText}>Delivered</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Report stop ${point.sequence || ""} failed`}
                  style={styles.failedButton}
                  onPress={onFailed}
                >
                  <Ionicons name="alert-circle-outline" size={16} color="#ffffff" />
                  <Text style={styles.primaryButtonText}>Failed</Text>
                </Pressable>
              </View>
            </>
          ) : null}
          {status === "PENDING" ? (
            <Pressable
              accessibilityLabel={`Report stop ${point.sequence || ""} failed`}
              style={styles.dangerOutlineButton}
              onPress={onFailed}
            >
              <Text style={styles.dangerOutlineText}>Cannot Deliver</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// The web portal ticks each password rule off as you type; the app showed one static
// sentence and only reported a failure on submit.
const OTP_CODE_LENGTH = 6;

// Code entry for the change-password flow, mirroring the customer app's
// screens/profile/password-otp-screen.tsx: six boxes, an expiry countdown and a
// resend cooldown. The driver app previously had one plain text input with no
// countdown and no resend gating at all.
function OtpScreen({
  email,
  code,
  onChangeCode,
  expirySeconds,
  resendSeconds,
  verifying,
  sending,
  error,
  onVerify,
  onResend,
  onBack,
}: {
  email: string;
  code: string;
  onChangeCode: (next: string) => void;
  expirySeconds: number;
  resendSeconds: number;
  verifying: boolean;
  sending: boolean;
  error: string | null;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
}) {
  const inputs = useRef<Array<TextInput | null>>([]);
  const cleaned = code.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH);
  const digits = Array.from({ length: OTP_CODE_LENGTH }, (_, index) => cleaned[index] || "");
  const expired = expirySeconds <= 0;

  const setDigit = (index: number, next: string) => {
    const typed = next.replace(/\D/g, "");
    // A paste fills the row from the first box rather than one character.
    if (typed.length > 1) {
      onChangeCode(typed.slice(0, OTP_CODE_LENGTH));
      inputs.current[Math.min(typed.length, OTP_CODE_LENGTH - 1)]?.focus();
      return;
    }
    const next_ = cleaned.split("");
    next_[index] = typed;
    onChangeCode(next_.join("").slice(0, OTP_CODE_LENGTH));
    if (typed && index < OTP_CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  // Backspace on an empty box steps back, which is what people expect here.
  const handleKeyPress = (index: number, key: string) => {
    if (key !== "Backspace" || digits[index] || index === 0) return;
    const next_ = cleaned.split("");
    next_[index - 1] = "";
    onChangeCode(next_.join(""));
    inputs.current[index - 1]?.focus();
  };

  return (
    <View style={styles.otpScreen}>
      <View style={styles.otpBadge}>
        <Ionicons name="lock-closed-outline" size={20} color="#16a34a" />
      </View>
      <Text style={styles.otpTitle}>Enter Verification Code</Text>
      <Text style={styles.otpSubtitle}>
        We sent a 6-digit verification code to{"\n"}
        <Text style={styles.otpEmail}>{email}</Text>
      </Text>

      <View style={styles.otpBoxRow}>
        {digits.map((digit, index) => (
          <TextInput
            key={index}
            ref={(node) => { inputs.current[index] = node; }}
            style={[styles.otpBox, digit ? styles.otpBoxFilled : null, error ? styles.otpBoxError : null]}
            value={digit}
            onChangeText={(next) => setDigit(index, next)}
            onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
            keyboardType="number-pad"
            maxLength={OTP_CODE_LENGTH}
            selectTextOnFocus
            editable={!expired && !verifying}
            placeholder={String(index + 1)}
            placeholderTextColor="#cbd5e1"
            accessibilityLabel={`Verification code digit ${index + 1}`}
          />
        ))}
      </View>

      {expired ? (
        <Text style={styles.otpExpired}>Verification code has expired</Text>
      ) : (
        <Text style={styles.otpCountdown}>
          Code expires in <Text style={styles.otpCountdownValue}>{formatOtpCountdown(expirySeconds)}</Text>
        </Text>
      )}

      {error ? <Text style={styles.otpError}>{error}</Text> : null}

      <Pressable
        style={[styles.otpVerify, verifying || cleaned.length < OTP_CODE_LENGTH || expired ? styles.otpVerifyDisabled : null]}
        onPress={onVerify}
        disabled={verifying || cleaned.length < OTP_CODE_LENGTH || expired}
        accessibilityRole="button"
      >
        <Text style={styles.otpVerifyText}>{verifying ? "Verifying Code..." : "Verify Code"}</Text>
      </Pressable>

      {sending ? (
        <Text style={styles.otpResendWaiting}>Sending...</Text>
      ) : resendSeconds > 0 ? (
        <Text style={styles.otpResendWaiting}>Resend code in {resendSeconds}s</Text>
      ) : (
        <Pressable onPress={onResend} accessibilityRole="button" accessibilityLabel="Resend verification code">
          <Text style={styles.otpResend}>Resend Code</Text>
        </Pressable>
      )}

      <Pressable onPress={onBack} accessibilityRole="button">
        <Text style={styles.otpBackLink}>Back to Change Password</Text>
      </Pressable>
    </View>
  );
}

// A labelled input, the way every field reads in the driver portal's profile screens.
// The app previously relied on placeholders alone, so a filled-in field lost its label.
function Field({
  label,
  value,
  placeholder,
  onChangeText,
  optional = false,
  editable = true,
  secureTextEntry = false,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  optional?: boolean;
  editable?: boolean;
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {optional ? <Text style={styles.fieldOptional}>  (Optional)</Text> : null}
      </Text>
      <TextInput
        style={[styles.input, !editable ? styles.disabledInput : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        editable={editable}
        secureTextEntry={secureTextEntry}
      />
    </View>
  );
}

function PasswordRequirements({ password }: { password: string }) {
  const value = String(password || "");
  const rules: Array<{ label: string; met: boolean }> = [
    { label: "Min 8 characters", met: value.length >= 8 },
    { label: "Uppercase letter", met: /[A-Z]/.test(value) },
    { label: "Lowercase letter", met: /[a-z]/.test(value) },
    { label: "One number", met: /\d/.test(value) },
    { label: "Special character", met: /[^A-Za-z0-9\s]/.test(value) },
    { label: "No spaces", met: value.length > 0 && !/\s/.test(value) },
  ];

  return (
    <View style={styles.passwordRules}>
      <Text style={styles.passwordRulesTitle}>Password Requirements</Text>
      <View style={styles.passwordRulesGrid}>
        {rules.map((rule) => (
          <View key={rule.label} style={styles.passwordRule}>
            <Ionicons
              name={rule.met ? "checkmark-circle" : "ellipse-outline"}
              size={13}
              color={rule.met ? "#16a34a" : "#cbd5e1"}
            />
            <Text style={[styles.passwordRuleText, rule.met ? styles.passwordRuleTextMet : null]}>{rule.label}</Text>
          </View>
        ))}
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
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  description: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <View style={[styles.menuIconWrap, danger ? styles.menuIconWrapDanger : null]}>
        <Ionicons name={icon} size={20} color={danger ? "#ef4444" : "#0d61ad"} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.menuLabel, danger ? styles.menuLabelDanger : null]}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#cbd5e1" />
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
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: "#cbd5e1", true: "#0f766e" }} thumbColor="#ffffff" />
    </View>
  );
}

function ModalShell({
  visible,
  title,
  subtitle,
  onClose,
  children,
  fullScreen = false,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  fullScreen?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, fullScreen ? styles.fullScreenModalBackdrop : null]}>
        <View style={[styles.modalCard, fullScreen ? styles.fullScreenModalCard : null]}>
          <View style={styles.modalHeader}>
            {fullScreen ? <Pressable onPress={onClose} hitSlop={8}><Ionicons name="arrow-back" size={21} color="#334155" /></Pressable> : null}
            <View style={styles.flex}>
              <Text style={styles.modalTitle}>{title}</Text>
              {!fullScreen ? <Text style={styles.subtle}>{subtitle}</Text> : null}
            </View>
            {!fullScreen ? <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.closeGlyph}>X</Text>
            </Pressable> : null}
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
  items: Array<{ id: string; label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; activeIcon: React.ComponentProps<typeof Ionicons>["name"] }>;
  activeTab: string;
  onSelect: (tab: string) => void;
}) {
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const active = item.id === activeTab;
        return (
          <Pressable key={item.id} style={[styles.bottomNavItem, active ? (item.id === "home" ? styles.bottomNavItemHomeActive : styles.bottomNavItemActive) : null]} onPress={() => onSelect(item.id)}>
            <View style={styles.bottomNavIconWrap}>
              <Ionicons name={active ? item.activeIcon : item.icon} size={16} color={active ? (item.id === "home" ? "#047857" : "#0369a1") : "#0e4f92"} />
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

function compactDriverName(profile: DriverProfile | null): string {
  if (!profile) return "Name details not set";
  const middleInitial = String(profile.middleName || "").replace(/\.+$/, "").charAt(0).toUpperCase();
  return [profile.firstName, middleInitial ? `${middleInitial}.` : "", profile.lastName, profile.suffix].filter(Boolean).join(" ") || "Name details not set";
}

function productNameWithSize(name: string, size?: string | null): string {
  const cleanName = String(name || "Product").trim();
  const cleanSize = String(size || "").trim();
  if (!cleanSize || cleanName.toLowerCase().endsWith(cleanSize.toLowerCase())) return cleanName;
  return `${cleanName} ${cleanSize}`;
}

function getPreferredOperationalTripId(trips: DriverTrip[]): string | null {
  return trips.find((trip) => normalizeStatus(trip.status) === "IN_PROGRESS")?.id
    || trips.find((trip) => normalizeStatus(trip.status) === "PLANNED")?.id
    || trips[0]?.id
    || null;
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function resolveMediaUrl(value: string): string {
  if (/^(https?:|file:|data:)/i.test(value)) return value;
  return `${API_BASE_URL.replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
}

function formatDateOnly(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function getLicenseStatus(profile: DriverProfile | null) {
  if (!profile?.licenseExpiry) return "";
  const parsed = new Date(profile.licenseExpiry);
  if (Number.isNaN(parsed.getTime())) return "";
  const now = new Date();
  if (parsed.getTime() < now.getTime()) return "Expired";
  const daysRemaining = Math.ceil((parsed.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysRemaining <= 30) return "Expiring Soon";
  return "Valid";
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
  container: { flex: 1, backgroundColor: "#dff0ea" },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#dff0ea" },
  authShell: { flexGrow: 1, padding: 12, justifyContent: "center" },
  authCard: {
    // Keep the card inside narrow preview/native safe areas even when web uses content-box sizing.
    width: "92%",
    boxSizing: "border-box",
    maxWidth: 440,
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9e4e5",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    shadowColor: "#0f435e",
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  authLogoImage: { width: 100, height: 100 },
  authEyebrow: { color: "#199154", fontSize: 11, fontFamily: "Poppins_700Bold", letterSpacing: 2.8, textAlign: "center" },
  authTitle: { marginTop: 8, color: "#0a4286", fontSize: 32, lineHeight: 32, fontFamily: "Poppins_900Black", letterSpacing: -1.2 },
  authDriverRow: { marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  authDriverTitle: { color: "#13a455", fontSize: 34, lineHeight: 35, fontFamily: "Poppins_900Black", letterSpacing: -1.2 },
  speedLines: { width: 30, gap: 3, alignItems: "flex-end" },
  speedLinesMirrored: { transform: [{ rotate: "180deg" }] },
  speedLineLong: { width: 30, height: 2, borderRadius: 2, backgroundColor: "#13a455" },
  speedLineShort: { width: 20, height: 2, borderRadius: 2, backgroundColor: "#13a455" },
  authSubtitle: { marginTop: 10, color: "#586484", fontSize: 14, lineHeight: 19, fontFamily: "Poppins_500Medium", textAlign: "center", maxWidth: 288 },
  authForm: { width: "100%", marginTop: 12, gap: 10 },
  inputLabel: { color: "#324766", fontSize: 13, fontFamily: "Poppins_700Bold", marginTop: 2 },
  authInputRow: { height: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#d5dee4", borderRadius: 12, backgroundColor: "#ffffff" },
  authTextInput: { flex: 1, height: 42, paddingVertical: 0, color: "#0f172a", fontSize: 15, fontFamily: "Poppins_400Regular" },
  passwordInputRow: { minHeight: 44, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#d5dee4", borderRadius: 12, backgroundColor: "#ffffff", overflow: "hidden" },
  passwordLeadingIcon: { marginLeft: 12 },
  passwordInput: { minWidth: 0, flex: 1, paddingHorizontal: 10, paddingVertical: 10, color: "#0f172a", fontSize: 15, fontFamily: "Poppins_400Regular" },
  passwordToggle: { width: 42, minHeight: 42, alignItems: "center", justifyContent: "center" },
  passwordToggleText: { color: "#60708b", fontSize: 12, fontFamily: "Poppins_700Bold" },
  loginButton: { minHeight: 50, borderRadius: 999, backgroundColor: "#169f50", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 4, shadowColor: "#16a850", shadowOpacity: 0.24, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  forgotButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  forgotButtonText: { color: "#16984e", fontSize: 14, fontFamily: "Poppins_700Bold" },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: "#94a3b8", alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
  checkboxChecked: { backgroundColor: "#2f9a34", borderColor: "#2f9a34" },
  checkboxGlyph: { color: "#ffffff", fontSize: 13, fontFamily: "Poppins_900Black" },
  rememberText: { color: "#4e5f79", fontSize: 13, fontFamily: "Poppins_500Medium" },
  heroCard: {
    backgroundColor: "#0f172a",
    borderRadius: 28,
    padding: 22,
    gap: 8,
  },
  appHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: "#dff0ea",
    borderBottomWidth: 1,
    borderBottomColor: "#bae6fd",
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
    backgroundColor: "#0e5aa8",
    alignItems: "center",
    justifyContent: "center",
  },
  logoBadgeText: { color: "#ffffff", fontSize: 13, fontFamily: "Poppins_800ExtraBold", letterSpacing: 1 },
  appHeaderEyebrow: { color: "#475569", fontSize: 9, fontFamily: "Poppins_600SemiBold", letterSpacing: 1.25 },
  appHeaderTitle: { color: "#0f3d72", fontSize: 18, fontFamily: "Poppins_900Black", letterSpacing: -0.2 },
  appHeaderSubtitle: { color: "#64748b", fontSize: 11, marginTop: 1 },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#0e5aa8",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  headerGlyph: { color: "#ffffff", fontSize: 15, fontFamily: "Poppins_800ExtraBold" },
  headerUnreadDot: { position: "absolute", top: 6, right: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: "#ef4444", borderWidth: 2, borderColor: "#ffffff" },
  eyebrow: { color: "#94a3b8", fontSize: 12, fontFamily: "Poppins_700Bold", letterSpacing: 1 },
  title: { color: "#ffffff", fontSize: 28, fontFamily: "Poppins_800ExtraBold" },
  subtle: { color: "#64748b", fontSize: 14, fontFamily: "Poppins_400Regular" },
  subtleOnDark: { color: "#cbd5e1", fontSize: 14, lineHeight: 20 },
  subtleCentered: { color: "#64748b", fontSize: 14, textAlign: "center" },
  bodyText: { color: "#334155", fontSize: 14, lineHeight: 20 },
  pageHeading: {
    paddingHorizontal: 18,
    gap: 6,
  },
  profileScreen: { marginTop: -8, paddingTop: 18, paddingBottom: 12, gap: 20, backgroundColor: "#f8f9fa" },
  profilePageTitle: { marginHorizontal: 16, fontSize: 24, fontFamily: "Poppins_800ExtraBold", color: "#0f172a" },
  profilePageSubtitle: { fontSize: 14, color: "#475569", lineHeight: 20 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    marginHorizontal: 16,
    padding: 16,
    gap: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  summaryCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    marginHorizontal: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  profileHero: { marginHorizontal: 16, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 16 },
  profileMenuCard: { marginHorizontal: 16, overflow: "hidden", borderRadius: 24, borderWidth: 1, borderColor: "#f1f5f9", backgroundColor: "#ffffff", shadowColor: "#000000", shadowOpacity: 0.02, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  profileLogoutCard: { marginHorizontal: 16, overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: "#f1f5f9", backgroundColor: "#ffffff" },
  summaryAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#0d61ad",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#ffffff",
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  avatarCameraBadge: { position: "absolute", bottom: -2, right: -4, width: 28, height: 28, borderRadius: 14, backgroundColor: "#0d61ad", borderWidth: 2, borderColor: "#ffffff", alignItems: "center", justifyContent: "center", shadowColor: "#000000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  summaryAvatarImage: { width: "100%", height: "100%" },
  summaryAvatarText: { color: "#ffffff", fontSize: 24, fontFamily: "Poppins_800ExtraBold" },
  avatarEditor: { alignItems: "center", gap: 12, paddingBottom: 4 },
  summaryContent: { flex: 1, gap: 6 },
  summaryName: { fontSize: 20, fontFamily: "Poppins_800ExtraBold", color: "#17365d" },
  summaryMeta: { fontSize: 14, color: "#5f7390" },
  roleBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#e0f2fe",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  roleBadgeText: {fontFamily: "Poppins_600SemiBold",  color: "#0369a1", fontSize: 12 },
  sectionTitle: { fontSize: 27.2, fontFamily: "Poppins_600SemiBold", letterSpacing: -0.2 },
  featureTitle: { fontSize: 20, fontFamily: "Poppins_800ExtraBold", color: "#1e293b" },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: "#f8fafc",
    color: "#0f172a",
  },
  multilineInput: { minHeight: 92, textAlignVertical: "top" },
  disabledInput: {
    backgroundColor: "#eef2f7",
    color: "#64748b",
  },
  primaryButton: {
    backgroundColor: "#0d61ad",
    borderRadius: 12,
    height: 40,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0284c7",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  primaryButtonCompact: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 132,
  },
  dangerButton: { backgroundColor: "#b91c1c" },
  dangerOutlineButton: { minHeight: 44, borderWidth: 1, borderColor: "#ef4444", borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  dangerOutlineText: { color: "#b91c1c", fontFamily: "Poppins_700Bold" },
  primaryButtonText: { color: "#ffffff", fontFamily: "Poppins_700Bold" },
  secondaryButton: {
    backgroundColor: "#dbeafe",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonCompact: {
    backgroundColor: "#dbeafe",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 110,
  },
  secondaryButtonText: { color: "#1d4ed8", fontFamily: "Poppins_700Bold" },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minHeight: 40,
  },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  scrollContent: { paddingTop: 8, paddingBottom: 120, gap: 16 },
  profileScrollContent: { backgroundColor: "#f8f9fa" },
  tripDetailScrollContent: { paddingTop: 0, paddingBottom: 0, backgroundColor: "#f8fafc" },
  ambientGlowSky: { position: "absolute", top: -40, left: -40, width: 224, height: 224, borderRadius: 112, backgroundColor: "rgba(186, 230, 253, 0.45)" },
  ambientGlowEmerald: { position: "absolute", top: 120, right: -60, width: 224, height: 224, borderRadius: 112, backgroundColor: "rgba(167, 243, 208, 0.45)" },
  homePanel: { marginHorizontal: 16, padding: 16, gap: 16, borderRadius: 25.6, borderWidth: 1, borderColor: "rgba(255,255,255,0.70)", backgroundColor: "rgba(205,228,243,0.85)", shadowColor: "#0e7490", shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  homeDashboardHeading: { gap: 3 },
  homeMetricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  homeAssignmentCard: { backgroundColor: "#f8f8f2", borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: "rgba(203,213,225,0.7)", shadowColor: "#0f172a", shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  dashboardHeading: { paddingHorizontal: 16, gap: 3 },
  dashboardEyebrow: { color: "#1f3558", fontSize: 11, fontFamily: "Poppins_700Bold", letterSpacing: 1.75 },
  dashboardTitle: { color: "#0a1435", fontSize: 32, lineHeight: 38, fontFamily: "Poppins_900Black", letterSpacing: -0.6 },
  dashboardSubtitle: { color: "#223c5d", fontSize: 18, lineHeight: 25 },
  metricGrid: {
    paddingHorizontal: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metricCard: {
    width: "47%",
    minHeight: 106,
    backgroundColor: "#f8f8f2",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#d7dee7",
    gap: 8,
  },
  metricValue: { fontSize: 32, lineHeight: 32, fontFamily: "Poppins_900Black", color: "#2f9a34" },
  metricLabel: { color: "#1f4d79", fontSize: 13, fontFamily: "Poppins_600SemiBold" },

  tripDetailScreen: { position: "relative", width: "100%", overflow: "hidden", backgroundColor: "#f8fbfe" },
  tripMapContextRow: { position: "absolute", zIndex: 20, top: 88, left: 14, right: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  tripMapBackButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "rgba(255,255,255,0.97)", shadowColor: "#0f172a", shadowOpacity: 0.12, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  tripMapChip: { height: 34, justifyContent: "center", paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "rgba(255,255,255,0.97)", shadowColor: "#0f172a", shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  tripMapChipText: { color: "#0f172a", fontSize: 12, fontFamily: "Poppins_700Bold" },
  tripCoordinateChip: { minWidth: 0, flex: 1 },
  tripCoordinateText: { color: "#0f172a", fontSize: 11, fontFamily: "Poppins_600SemiBold" },
  tripStartArea: { position: "absolute", zIndex: 22, left: 16, right: 16, bottom: 118, gap: 8 },
  tripLoadConfirm: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: "#cbd5e1", backgroundColor: "rgba(255,255,255,0.96)", flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 9 },
  tripLoadConfirmText: { color: "#0f172a", fontFamily: "Poppins_700Bold", fontSize: 14 },
  tripStartButton: { minHeight: 48, borderRadius: 12, backgroundColor: "#1d4ed8", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, shadowColor: "#1d4ed8", shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  tripStartButtonDisabled: { opacity: 0.55 },
  tripSheetPeek: { position: "absolute", zIndex: 24, left: 0, right: 0, bottom: 0, minHeight: 108, paddingHorizontal: 18, paddingTop: 9, paddingBottom: 13, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, borderColor: "rgba(255,255,255,0.9)", backgroundColor: "rgba(255,255,255,0.97)", shadowColor: "#0f172a", shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: -8 }, elevation: 10 },
  // The pill is only 5px tall; the grip gives the gesture something to land on.
  tripSheetGrip: { paddingTop: 6, paddingBottom: 10, marginHorizontal: -18, alignItems: "center" },
  tripSheetHandle: { width: 54, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: 8, backgroundColor: "#cbd5e1" },
  tripSheetEyebrow: { color: "#64748b", fontSize: 10, fontFamily: "Poppins_700Bold", letterSpacing: 1.7 },
  tripSheetSummaryRow: { marginTop: 3, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  tripSheetTripNumber: { color: "#0f172a", fontSize: 19, fontFamily: "Poppins_900Black", letterSpacing: -0.3 },
  tripSheetSchedule: { color: "#64748b", fontSize: 11, marginTop: 2 },
  tripSheetSummaryRight: { alignItems: "flex-end", gap: 4 },
  tripSheetSpeed: { color: "#0f172a", fontSize: 12, fontFamily: "Poppins_900Black" },
  tripSheetProgress: { color: "#334155", fontSize: 11, fontFamily: "Poppins_700Bold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden", backgroundColor: "#f1f5f9" },
  tripBottomSheet: { position: "absolute", zIndex: 25, left: 0, right: 0, bottom: 0, height: "55%", paddingTop: 9, paddingHorizontal: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, borderColor: "rgba(255,255,255,0.9)", backgroundColor: "rgba(255,255,255,0.98)", shadowColor: "#0f172a", shadowOpacity: 0.2, shadowRadius: 22, shadowOffset: { width: 0, height: -10 }, elevation: 12 },
  tripSheetExpandedHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingBottom: 10 },
  tripSheetScroll: { flex: 1 },
  tripSheetScrollContent: { gap: 10, paddingBottom: 24 },
  tripsScreen: { paddingHorizontal: 16, gap: 12 },
  tripsEyebrow: { color: "#64748b", fontSize: 11, fontFamily: "Poppins_700Bold", letterSpacing: 1.75 },
  tripsTitle: { marginTop: -8, color: "#0f172a", fontSize: 20, lineHeight: 26, fontFamily: "Poppins_900Black" },
  searchField: { height: 40, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "#e0f2fe", borderRadius: 12, backgroundColor: "rgba(255,255,255,0.94)", shadowColor: "#0284c7", shadowOpacity: 0.08, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  searchInput: { flex: 1, height: 40, paddingVertical: 0, color: "#0f172a", fontSize: 14, fontFamily: "Poppins_400Regular" },
  routeCard: { padding: 16, gap: 8, borderWidth: 1, borderColor: "#e0f2fe", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.96)", shadowColor: "#0284c7", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  routeCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  routeNumber: { flex: 1, color: "#0f172a", fontSize: 16, fontFamily: "Poppins_700Bold" },
  viewDetailsButton: { height: 36, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#bae6fd", borderRadius: 8, backgroundColor: "#ffffff" },
  viewDetailsText: { color: "#0369a1", fontSize: 12, fontFamily: "Poppins_500Medium" },
  tripStatusBadge: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: "#bae6fd", borderRadius: 999, backgroundColor: "#e0f2fe" },
  tripStatusActive: { borderColor: "#a7f3d0", backgroundColor: "#d1fae5" },
  tripStatusText: { color: "#075985", fontSize: 11, fontFamily: "Poppins_700Bold" },
  tripStatusTextActive: { color: "#065f46" },
  routeMeta: { color: "#475569", fontSize: 13, lineHeight: 19 },
  listItem: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  listItemSelected: {
    borderColor: "#1d4ed8",
    backgroundColor: "#eff6ff",
  },
  listTitle: { fontSize: 15, fontFamily: "Poppins_700Bold", color: "#0f172a" },
  badgeText: { color: "#1d4ed8", fontFamily: "Poppins_800ExtraBold" },
  stack: { gap: 10 },
  dropPointCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  orderItems: { gap: 6, marginTop: 6 },
  mixedComponentRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  componentImage: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#e2e8f0" },
  orderItem: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
    gap: 2,
  },
  orderItemHistory: { borderWidth: 1, borderColor: "#dbe4ee", borderRadius: 14, padding: 12, gap: 4, backgroundColor: "#f8fafc" },
  // --- OTP step, mirroring the customer app's password OTP screen ---
  otpScreen: { alignItems: "center", gap: 14, paddingVertical: 8 },
  otpBadge: { width: 52, height: 52, borderRadius: 16, backgroundColor: "#dcfce7", alignItems: "center", justifyContent: "center" },
  otpTitle: { color: "#0f172a", fontSize: 19, fontFamily: "Poppins_700Bold" },
  otpSubtitle: { color: "#64748b", fontSize: 13, lineHeight: 19, textAlign: "center", fontFamily: "Poppins_400Regular" },
  otpEmail: { color: "#0f172a", fontFamily: "Poppins_700Bold" },
  otpBoxRow: { flexDirection: "row", gap: 8, justifyContent: "center" },
  otpBox: { width: 46, height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#ffffff", textAlign: "center", color: "#0f172a", fontSize: 20, fontFamily: "Poppins_700Bold" },
  otpBoxFilled: { borderColor: "#16a34a" },
  otpBoxError: { borderColor: "#f87171" },
  otpCountdown: { color: "#64748b", fontSize: 12, fontFamily: "Poppins_500Medium" },
  otpCountdownValue: { color: "#15803d", fontFamily: "Poppins_700Bold" },
  otpExpired: { color: "#b91c1c", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  otpError: { color: "#b91c1c", fontSize: 12, textAlign: "center", fontFamily: "Poppins_500Medium" },
  otpVerify: { alignSelf: "stretch", minHeight: 50, borderRadius: 14, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center" },
  otpVerifyDisabled: { backgroundColor: "#8fbfa0" },
  otpVerifyText: { color: "#ffffff", fontSize: 15, fontFamily: "Poppins_700Bold" },
  otpResendWaiting: { color: "#94a3b8", fontSize: 12, fontFamily: "Poppins_500Medium" },
  otpResend: { color: "#0369a1", fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  otpBackLink: { color: "#64748b", fontSize: 13, fontFamily: "Poppins_500Medium" },
  // --- Notifications feed ---
  notificationsHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  notificationsCount: { color: "#64748b", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  notificationsHeaderActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  notificationsMarkRead: { color: "#0369a1", fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  notificationsClearAll: { color: "#dc2626", fontSize: 13, fontFamily: "Poppins_700Bold" },
  notificationRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  notificationIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#e0f2fe", alignItems: "center", justifyContent: "center" },
  notificationTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  notificationTitle: { flex: 1, color: "#0f172a", fontSize: 14, fontFamily: "Poppins_700Bold" },
  notificationDate: { color: "#94a3b8", fontSize: 11, fontFamily: "Poppins_500Medium" },
  notificationBody: { marginTop: 2, color: "#64748b", fontSize: 12, lineHeight: 17, fontFamily: "Poppins_400Regular" },
  // --- Profile screens, matching the driver portal ---
  profileHeroCard: { alignItems: "center", gap: 10, paddingVertical: 20, borderRadius: 18, backgroundColor: "#ffffff" },
  avatarPickWrap: { position: "relative" },
  profileHeroName: { color: "#0f172a", fontSize: 16, fontFamily: "Poppins_700Bold" },
  formCard: { borderRadius: 18, backgroundColor: "#ffffff", padding: 16, gap: 14 },
  field: { gap: 6 },
  fieldOptional: { color: "#64748b", fontSize: 12, fontFamily: "Poppins_400Regular" },
  primaryWideButton: { minHeight: 52, borderRadius: 14, backgroundColor: "#1d4ed8", alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  primaryWideButtonDisabled: { backgroundColor: "#93b4ec" },
  primaryWideButtonText: { color: "#ffffff", fontSize: 15, fontFamily: "Poppins_700Bold" },
  verificationPanel: { borderRadius: 14, backgroundColor: "#eff6ff", padding: 14, gap: 10 },
  verificationTitle: { color: "#1d4ed8", fontSize: 11, letterSpacing: 1, fontFamily: "Poppins_700Bold", textTransform: "uppercase" },
  verificationWaiting: { color: "#64748b", fontSize: 12, textAlign: "center", fontFamily: "Poppins_500Medium" },
  verificationBody: { color: "#334155", fontSize: 13, lineHeight: 18, fontFamily: "Poppins_400Regular" },
  // --- Profile ---
  sectionHeading: { color: "#0f172a", fontSize: 14, fontFamily: "Poppins_700Bold" },
  phonePill: { marginTop: 6, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, backgroundColor: "#e0f2fe", paddingHorizontal: 10, paddingVertical: 4 },
  phonePillText: { color: "#0369a1", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  fieldLabel: { color: "#334155", fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  passwordRules: { borderRadius: 16, borderWidth: 1, borderColor: "#f1f5f9", backgroundColor: "#f8fafc", padding: 12, gap: 6 },
  passwordRulesTitle: { color: "#94a3b8", fontSize: 10, letterSpacing: 0.8, fontFamily: "Poppins_700Bold", textTransform: "uppercase" },
  passwordRulesGrid: { flexDirection: "row", flexWrap: "wrap" },
  passwordRule: { width: "50%", flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 2 },
  passwordRuleText: { color: "#94a3b8", fontSize: 11, fontFamily: "Poppins_500Medium" },
  passwordRuleTextMet: { color: "#15803d" },
  // --- Trip detail stop card, matching the web driver portal ---
  dropPointHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  dropPointMarker: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#e2e8f0", alignItems: "center", justifyContent: "center" },
  dropPointMarkerDone: { backgroundColor: "#22c55e" },
  dropPointMarkerFailed: { backgroundColor: "#ef4444" },
  dropPointMarkerText: { color: "#475569", fontSize: 13, fontFamily: "Poppins_700Bold" },
  dropPointMarkerTextOn: { color: "#ffffff" },
  dropPointTitleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  dropPointName: { flex: 1, color: "#0f172a", fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  dropPointAddress: { marginTop: 2, color: "#64748b", fontSize: 12, fontFamily: "Poppins_400Regular" },
  dropPointOrderNumber: { marginTop: 4, color: "#0369a1", fontSize: 12, fontFamily: "Poppins_500Medium" },
  orderTotalBox: { marginTop: 6, borderRadius: 8, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", paddingHorizontal: 8, paddingVertical: 6 },
  orderTotalText: { color: "#92400e", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  replacementTotalBox: { marginTop: 6, borderRadius: 8, borderWidth: 1, borderColor: "#a7f3d0", backgroundColor: "#ecfdf5", paddingHorizontal: 8, paddingVertical: 6 },
  replacementTotalText: { color: "#065f46", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  orderDetailsPanel: { marginTop: 8, borderRadius: 10, backgroundColor: "#f8fafc", paddingHorizontal: 10, paddingVertical: 10, gap: 6 },
  orderDetailsHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  orderDetailsTitle: { color: "#475569", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  replacementBadge: { borderRadius: 999, borderWidth: 1, borderColor: "#fcd34d", backgroundColor: "#fef3c7", paddingHorizontal: 8, paddingVertical: 1 },
  replacementBadgeText: { color: "#92400e", fontSize: 10, letterSpacing: 0.5, fontFamily: "Poppins_600SemiBold", textTransform: "uppercase" },
  orderDetailsItem: { gap: 1 },
  orderDetailsItemName: { color: "#334155", fontSize: 12, lineHeight: 17, fontFamily: "Poppins_500Medium" },
  orderDetailsItemCategory: { color: "#94a3b8", fontSize: 11, lineHeight: 15, fontFamily: "Poppins_400Regular" },
  dropPointPodImage: { width: "100%", height: 170, borderRadius: 10, backgroundColor: "#e2e8f0" },
  dropPointNotes: { marginTop: 8, color: "#64748b", fontSize: 12, fontFamily: "Poppins_400Regular" },
  callContactRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  callContactText: { color: "#0369a1", fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  dropPointActions: { marginTop: 12, gap: 8 },
  podHelperText: { color: "#64748b", fontSize: 11, fontFamily: "Poppins_400Regular" },
  deliveredButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12, backgroundColor: "#16a34a" },
  failedButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12, backgroundColor: "#dc2626" },
  statusPillArrived: { backgroundColor: "#e0f2fe", borderColor: "#bae6fd" },
  statusPillTextArrived: { color: "#0369a1" },
  statusPillPending: { backgroundColor: "#f1f5f9", borderColor: "#e2e8f0" },
  statusPillTextPending: { color: "#475569" },
  // --- Delivery History, matching the web driver portal's three levels ---
  historyShowing: { color: "#64748b", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  historyEmpty: { alignItems: "center", gap: 6, paddingVertical: 42, borderRadius: 18, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#ffffff" },
  historyEmptyTitle: { color: "#475569", fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  historyEmptyHint: { color: "#94a3b8", fontSize: 12, fontFamily: "Poppins_400Regular" },
  historyCardHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  historyCardTitle: { color: "#0f172a", fontSize: 16, fontFamily: "Poppins_700Bold" },
  historyCardMeta: { marginTop: 2, color: "#64748b", fontSize: 12, fontFamily: "Poppins_500Medium" },
  historyCardTime: { marginTop: 4, color: "#94a3b8", fontSize: 11, fontFamily: "Poppins_400Regular" },
  historyCardFooter: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  historyInspect: { color: "#64748b", fontSize: 12, fontFamily: "Poppins_500Medium" },
  historyViewDetails: { flexDirection: "row", alignItems: "center", gap: 4 },
  historyViewDetailsText: { color: "#0f172a", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  historyPager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 8 },
  historyPagerButton: { flex: 1, height: 38, borderRadius: 12, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
  historyPagerButtonDisabled: { opacity: 0.45 },
  historyPagerText: { color: "#334155", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  historyPagerLabel: { color: "#64748b", fontSize: 12, fontFamily: "Poppins_500Medium", paddingHorizontal: 8 },
  historyBackRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  historyBackText: { color: "#475569", fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  historyTripNumber: { color: "#0f172a", fontSize: 20, fontFamily: "Poppins_700Bold" },
  historySectionLabel: { color: "#64748b", fontSize: 11, letterSpacing: 1, fontFamily: "Poppins_700Bold", textTransform: "uppercase" },
  historyPanel: { borderRadius: 18, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#ffffff", padding: 16, gap: 14 },
  historyPanelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  historyPanelTitle: { color: "#0f172a", fontSize: 15, fontFamily: "Poppins_700Bold" },
  historyPanelMeta: { color: "#64748b", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  historyStopLabel: { color: "#64748b", fontSize: 11, letterSpacing: 0.8, fontFamily: "Poppins_600SemiBold", textTransform: "uppercase" },
  historyOrderNumber: { marginTop: 2, color: "#0f172a", fontSize: 19, fontFamily: "Poppins_700Bold" },
  historyKeyValues: { gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  historyKeyLabel: { color: "#64748b", fontSize: 12, fontFamily: "Poppins_500Medium" },
  historyKeyValue: { marginTop: 2, color: "#0f172a", fontSize: 13, fontFamily: "Poppins_600SemiBold" },
  historyFailureBox: { borderRadius: 14, borderWidth: 1, borderColor: "#fecdd3", backgroundColor: "#fff1f2", padding: 12 },
  historyFailureTitle: { color: "#9f1239", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  historyFailureText: { marginTop: 4, color: "#4c0519", fontSize: 12, fontFamily: "Poppins_500Medium" },
  historyPodBox: { borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#f8fafc", padding: 12, gap: 8 },
  historyPodTitle: { color: "#1e293b", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  historyPodRecipient: { color: "#64748b", fontSize: 12, fontFamily: "Poppins_400Regular" },
  historyPodRecipientName: { color: "#1e293b", fontFamily: "Poppins_600SemiBold" },
  historyNoProducts: { paddingVertical: 22, textAlign: "center", color: "#64748b", fontSize: 12, fontFamily: "Poppins_400Regular" },
  historyTotalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  historyTotalLabel: { color: "#475569", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  historyTotalValue: { color: "#0f172a", fontSize: 15, fontFamily: "Poppins_700Bold" },
  historyStopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  historySequence: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  historySequenceText: { color: "#334155", fontSize: 11, fontFamily: "Poppins_700Bold" },
  historyCustomerName: { color: "#0f172a", fontSize: 14, fontFamily: "Poppins_700Bold" },
  historyStopOrder: { marginTop: 4, marginLeft: 28, color: "#64748b", fontSize: 12, fontFamily: "Poppins_400Regular" },
  historyStopAddress: { marginTop: 8, marginLeft: 28, color: "#64748b", fontSize: 12, fontFamily: "Poppins_400Regular" },
  historyThumbRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  historyThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  historyThumbEmpty: { alignItems: "center", justifyContent: "center" },
  historyItemSummary: { marginLeft: 2, color: "#475569", fontSize: 12, fontFamily: "Poppins_500Medium" },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1 },
  statusPillDone: { backgroundColor: "#ecfdf5", borderColor: "#a7f3d0" },
  statusPillFailed: { backgroundColor: "#fff1f2", borderColor: "#fecdd3" },
  statusPillText: { fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  statusPillTextDone: { color: "#047857" },
  statusPillTextFailed: { color: "#be123c" },
  productRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  productThumbWrap: { width: 52, height: 52, borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#f8fafc", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  productThumb: { width: "100%", height: "100%" },
  productInfo: { flex: 1, gap: 2 },
  productName: { color: "#0f172a", fontSize: 13, lineHeight: 18, fontFamily: "Poppins_600SemiBold" },
  productSize: { color: "#64748b", fontSize: 11, fontFamily: "Poppins_400Regular" },
  productSku: { color: "#94a3b8", fontSize: 11, fontFamily: "Poppins_400Regular" },
  productComponent: { color: "#64748b", fontSize: 11, fontFamily: "Poppins_400Regular" },
  mixedBadge: { alignSelf: "flex-start", borderRadius: 6, borderWidth: 1, borderColor: "#e9d5ff", backgroundColor: "#faf5ff", paddingHorizontal: 6, paddingVertical: 2 },
  mixedBadgeText: { color: "#7e22ce", fontSize: 10, fontFamily: "Poppins_600SemiBold" },
  productPricing: { alignItems: "flex-end" },
  productQty: { color: "#0f172a", fontSize: 13, fontFamily: "Poppins_700Bold" },
  productUnit: { marginTop: 2, color: "#64748b", fontSize: 11, fontFamily: "Poppins_400Regular" },
  productLineTotal: { marginTop: 2, color: "#1e293b", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  historyPodImage: { width: "100%", height: 210, borderRadius: 16, backgroundColor: "#e2e8f0" },
  historyTotal: { color: "#059669", fontSize: 20, fontFamily: "Poppins_900Black", textAlign: "right" },
  linkText: { color: "#0d61ad", fontSize: 12, fontFamily: "Poppins_600SemiBold", marginTop: 6 },
  historyScreen: { paddingHorizontal: 16, gap: 10 },
  historyTitle: { color: "#0f172a", fontSize: 20, lineHeight: 26, fontFamily: "Poppins_700Bold" },
  historySubtitle: { marginTop: -8, color: "#64748b", fontSize: 12, fontFamily: "Poppins_400Regular" },
  historyCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.80)",
    borderRadius: 16,
    padding: 16,
    gap: 5,
    shadowColor: "#000000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 6,
  },
  infoLabel: { color: "#475569", fontSize: 14, flex: 1 },
  infoValue: { color: "#0f172a", fontSize: 14, fontFamily: "Poppins_700Bold", flex: 1, textAlign: "right" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuIconWrap: {
    width: 22,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  menuIconWrapDanger: {
    backgroundColor: "transparent",
  },
  menuLabel: { color: "#1e293b", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
  menuLabelDanger: { color: "#dc2626" },
  menuDescription: { color: "#64748b", fontSize: 13, marginTop: 2 },
  menuGlyph: { color: "#0f172a", fontSize: 11, fontFamily: "Poppins_800ExtraBold" },
  menuGlyphDanger: { color: "#b91c1c" },
  chevronText: { color: "#94a3b8", fontSize: 18, fontFamily: "Poppins_700Bold" },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(239,247,251,0.95)",
    borderTopWidth: 1,
    borderTopColor: "rgba(186,230,253,0.70)",
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  bottomNavItem: {
    flex: 1,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 12,
  },
  bottomNavItemActive: { backgroundColor: "rgba(224,242,254,0.92)" },
  bottomNavItemHomeActive: { backgroundColor: "rgba(209,250,229,0.92)" },
  bottomNavIconWrap: {
    width: 24,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomNavIconWrapActive: {
    backgroundColor: "transparent",
  },
  bottomNavIconWrapHomeActive: { backgroundColor: "transparent" },
  bottomNavGlyph: { color: "#0e4f92", fontSize: 18, fontFamily: "Poppins_900Black" },
  bottomNavGlyphActive: { color: "#047857" },
  bottomNavLabel: { color: "#0e4f92", fontSize: 11, fontFamily: "Poppins_500Medium" },
  bottomNavLabelActive: { color: "#047857" },
  error: { color: "#b91c1c", fontFamily: "Poppins_600SemiBold" },
  errorBanner: {
    color: "#991b1b",
    backgroundColor: "#fee2e2",
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 12,
    fontFamily: "Poppins_600SemiBold",
  },
  offlineBanner: { color: "#7c2d12", backgroundColor: "#ffedd5", marginHorizontal: 16, borderRadius: 14, padding: 12, fontFamily: "Poppins_700Bold" },
  queueBanner: { marginHorizontal: 16, padding: 12, borderRadius: 14, backgroundColor: "#fef3c7", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  queueText: { color: "#78350f", fontFamily: "Poppins_700Bold", flex: 1 },
  queueError: { color: "#991b1b", fontSize: 12, marginTop: 3 },
  queueAction: { color: "#1d4ed8", fontFamily: "Poppins_800ExtraBold" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  fullScreenModalBackdrop: { backgroundColor: "#f8f9fa", justifyContent: "flex-start" },
  modalCard: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "88%",
    paddingTop: 10,
  },
  fullScreenModalCard: { flex: 1, width: "100%", maxHeight: "100%", paddingTop: 24, borderTopLeftRadius: 0, borderTopRightRadius: 0, backgroundColor: "#f8f9fa" },
  confirmCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    backgroundColor: "#ffffff",
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
    borderBottomColor: "#e2e8f0",
    gap: 12,
  },
  modalTitle: { color: "#0f172a", fontSize: 20, fontFamily: "Poppins_700Bold" },
  closeGlyph: { color: "#475569", fontSize: 16, fontFamily: "Poppins_800ExtraBold" },
  modalBody: { padding: 18, gap: 14 },
  modalHelpText: { color: "#64748b", fontSize: 13, lineHeight: 18 },
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
    borderColor: "#f59e0b",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 108,
  },
  modalGhostButtonText: { color: "#0f172a", fontFamily: "Poppins_700Bold" },
  modalOutlineButton: {
    borderWidth: 1,
    borderColor: "#f59e0b",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButtonText: { color: "#0f172a", fontFamily: "Poppins_700Bold" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#f8fafc",
    borderRadius: 18,
    padding: 14,
  },
  notificationHeader: { borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 14, gap: 10 },
  notificationCard: { padding: 12, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 14, gap: 5 },
  notificationUnread: { backgroundColor: "#eff6ff", borderColor: "#93c5fd" },
  podPreviewWrap: { position: "relative", width: "100%", height: 220, borderRadius: 18, overflow: "hidden", backgroundColor: "#e2e8f0" },
  podPreview: { width: "100%", height: "100%", backgroundColor: "#e2e8f0" },
  podPreviewOverlay: { position: "absolute", left: 8, right: 18, bottom: 8, alignSelf: "flex-start", borderRadius: 8, backgroundColor: "rgba(0,0,0,0.48)", paddingHorizontal: 8, paddingVertical: 6 },
  podPreviewOverlayText: { color: "#ffffff", fontSize: 9, lineHeight: 12, fontFamily: "Poppins_600SemiBold", textShadowColor: "rgba(0,0,0,0.95)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  // Added: responsive full-screen POD camera with a lower-left information safe area.
  podCameraScreen: { flex: 1, backgroundColor: "#000000" },
  podCameraPreview: { flex: 1 },
  podCameraSafeArea: { flex: 1, justifyContent: "space-between" },
  podCameraTopBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8 },
  podCameraCloseButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  podCameraTitle: { color: "#ffffff", fontSize: 18, fontFamily: "Poppins_800ExtraBold", textShadowColor: "rgba(0,0,0,0.9)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  podCameraTopSpacer: { width: 44 },
  podCameraOverlayWrap: { position: "absolute", left: "3%", right: "7%", bottom: 128, alignItems: "flex-start" },
  podCameraOverlay: { maxWidth: "100%", borderRadius: 12, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 12, paddingVertical: 10 },
  podCameraOverlayText: { color: "#ffffff", fontSize: 14, lineHeight: 19, fontFamily: "Poppins_600SemiBold", textShadowColor: "rgba(0,0,0,0.95)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  podCameraControls: { minHeight: 112, alignItems: "center", justifyContent: "center", paddingBottom: 14, gap: 8, backgroundColor: "rgba(0,0,0,0.22)" },
  podCameraError: { color: "#fecaca", backgroundColor: "rgba(127,29,29,0.82)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, fontFamily: "Poppins_700Bold", maxWidth: "90%" },
  podCameraShutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: "#ffffff", backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  podCameraShutterDisabled: { opacity: 0.5 },
  podCameraShutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#ffffff" },
  returnableRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  quantityButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: "#f59e0b", alignItems: "center", justifyContent: "center" },
  quantityButtonText: { color: "#0f172a", fontSize: 20, fontFamily: "Poppins_800ExtraBold" },
  quantityValue: { minWidth: 30, textAlign: "center", color: "#0f172a", fontFamily: "Poppins_800ExtraBold" },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choiceChip: { minHeight: 44, borderWidth: 1, borderColor: "#f59e0b", borderRadius: 999, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  choiceChipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  choiceChipText: { color: "#334155", fontFamily: "Poppins_700Bold" },
  choiceChipTextActive: { color: "#ffffff" },
  documentEmptyState: {
    borderWidth: 1,
    borderColor: "#f59e0b",
    borderStyle: "dashed",
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f8fafc",
  },
  documentGlyph: { color: "#64748b", fontSize: 16, fontFamily: "Poppins_800ExtraBold" },
  documentEmptyTitle: { color: "#0f172a", fontFamily: "Poppins_700Bold" },
});
