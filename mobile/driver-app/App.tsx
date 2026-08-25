import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
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
} from "./src/services/auth";
import { ApiError } from "./src/services/api";
import { API_BASE_URL } from "./src/config/env";
import { getTrackedTripId, startBackgroundTripTracking, stopBackgroundTripTracking } from "./src/services/background-location";
import { clearOfflineQueue, queueOfflineOperation, readOfflineQueue, syncOfflineQueue, type OfflineQueueItem } from "./src/services/offline-queue";
import { buildTripSearchText, getStartBlockedOrders, isUsableLocationSample, normalizeStatus } from "./src/lib/driver-logic";
import DriverNavigationMap from "./src/components/DriverNavigationMap";
import type { AuthUser, DriverNotification, DriverProfile, DriverTrip, DriverTripDropPoint, DriverTripLocation, DriverTripOrderItem } from "./src/types";

type DriverTab = "home" | "trips" | "history" | "profile";
type DriverProfileModal = "edit" | "security" | "notifications" | "license" | null;
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

export default function App() {
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
  const [historyLimit, setHistoryLimit] = useState(10);
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
          body: startLocation,
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
    setFailureReason("");
    setRescheduleWindow("tomorrow");
    setRescheduleDate("");
  }

  function closeStopAction() {
    setStopActionMode(null);
    setStopActionPoint(null);
  }

  async function choosePodImage(source: "camera" | "library") {
    const permission = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission Required", `Allow ${source === "camera" ? "camera" : "photo library"} access to attach proof of delivery.`);
      return;
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.75 });
    if (!result.canceled && result.assets[0]?.uri) setPodImageUri(result.assets[0].uri);
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
      const imageUrl = await uploadPodImage(podImageUri);
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

  function openProfileModal(modal: Exclude<DriverProfileModal, null>) {
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

  const completedTrips = useMemo(
    () => trips
      .filter((trip) => normalizeStatus(trip.status) === "COMPLETED")
      .filter((trip) => buildTripSearchText(trip).includes(historySearch.trim().toLowerCase())),
    [historySearch, trips],
  );

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
              <View style={styles.homePanel}>
                <View style={styles.homeDashboardHeading}>
                  <Text style={styles.dashboardEyebrow}>DRIVER DASHBOARD</Text>
                  <Text style={styles.dashboardTitle}>Driver Dashboard</Text>
                  <Text style={styles.dashboardSubtitle}>Here is your delivery overview for today.</Text>
                </View>
                <View style={styles.homeMetricGrid}>
                  <MetricCard label="Total Trips" value={dashboardMetrics.inProgress + dashboardMetrics.planned + dashboardMetrics.completed} />
                  <MetricCard label="Planned" value={dashboardMetrics.planned} />
                  <MetricCard label="Completed" value={dashboardMetrics.completed} />
                  <MetricCard label="Pending Stops" value={dashboardMetrics.remainingStops} />
                </View>

                <View style={styles.homeAssignmentCard}>
                  <Text style={styles.sectionTitle}>Active trip</Text>
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
                      <View style={[styles.tripStatusBadge, normalizeStatus(trip.status) === "IN_PROGRESS" ? styles.tripStatusActive : null]}><Text style={styles.tripStatusText}>{String(trip.status || "").replace(/_/g, " ")}</Text></View>
                      <Text style={styles.routeMeta}>Vehicle: {trip.vehicle?.licensePlate || "Not assigned"} | Driver: {profile?.name || user.name || "Assigned Driver"}</Text>
                      <Text style={styles.routeMeta}>Route: Warehouse → {trip.dropPoints?.at(-1)?.locationName || "Destination"}</Text>
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
                      <Pressable
                        style={styles.tripStartButton}
                        onPress={() => void handleStartTrip(selectedTrip.id)}
                        disabled={startingTripId === selectedTrip.id}
                      >
                        {startingTripId === selectedTrip.id ? <ActivityIndicator color="#ffffff" /> : <Ionicons name="play" size={19} color="#ffffff" />}
                        <Text style={styles.primaryButtonText}>Start Trip</Text>
                      </Pressable>
                    ) : null}

                    {!isTripSheetOpen ? (
                      <Pressable style={styles.tripSheetPeek} onPress={() => setIsTripSheetOpen(true)} accessibilityLabel="Open trip drop points">
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
                      </Pressable>
                    ) : (
                      <View style={styles.tripBottomSheet}>
                        <Pressable onPress={() => setIsTripSheetOpen(false)} accessibilityLabel="Collapse trip drop points">
                          <View style={styles.tripSheetHandle} />
                        </Pressable>
                        <View style={styles.tripSheetExpandedHeader}>
                          <View style={styles.flex}>
                            <Text style={styles.tripSheetEyebrow}>DROP POINTS</Text>
                            <Text style={styles.tripSheetTripNumber}>{selectedTrip.tripNumber}</Text>
                          </View>
                          <View style={styles.tripStatusBadge}><Text style={styles.tripStatusText}>{String(selectedTrip.status || "").replace(/_/g, " ")}</Text></View>
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
                      </View>
                    )}
                  </View>
                ) : null}
              </>
            ) : null}

            {activeTab === "history" ? (
              <View style={styles.historyScreen}>
                <Text style={styles.historyTitle}>{historyTripId ? "Trip Details" : "Delivery History"}</Text>
                {!historyTripId ? <Text style={styles.historySubtitle}>Completed delivery trips and fulfilled orders</Text> : null}
                {historyTripId ? (
                  <Pressable style={styles.tripBackButton} onPress={() => { if (historyPointId) setHistoryPointId(null); else setHistoryTripId(null); }}>
                    <Text style={styles.tripBackText}>‹</Text>
                  </Pressable>
                ) : null}
                {!historyTripId ? <View style={styles.searchField}><Ionicons name="search" size={18} color="#94a3b8" /><TextInput style={styles.searchInput} value={historySearch} onChangeText={(value) => { setHistorySearch(value); setHistoryLimit(10); }} placeholder="Search completed trips" placeholderTextColor="#94a3b8" /></View> : null}
                {!historyTripId && completedTrips.length === 0 ? <Text style={styles.subtle}>No completed trips yet.</Text> : null}
                {!historyTripId ? completedTrips.slice(0, historyLimit).map((trip) => (
                  <Pressable key={trip.id} style={styles.historyCard} onPress={() => setHistoryTripId(trip.id)}>
                    <Text style={styles.listTitle}>{trip.tripNumber}</Text>
                    <Text style={styles.subtle}>Completed stops: {trip.completedDropPoints || 0}</Text>
                    <Text style={styles.subtle}>Vehicle: {trip.vehicle?.licensePlate || "Not assigned"}</Text>
                    <Text style={styles.subtle}>Customers: {(trip.dropPoints || []).map((point) => point.contactName || point.order?.shippingName).filter(Boolean).join(", ") || "Not recorded"}</Text>
                    <Text style={styles.subtle}>Started: {formatDate(trip.actualStartAt)}</Text>
                    <Text style={styles.subtle}>Finished: {formatDate(trip.actualEndAt)}</Text>
                  </Pressable>
                )) : null}
                {historyTripId ? (
                  <HistoryDetails
                    trip={trips.find((trip) => trip.id === historyTripId) || null}
                    selectedPointId={historyPointId}
                    onOpenPoint={setHistoryPointId}
                  />
                ) : null}
                {!historyTripId && historyLimit < completedTrips.length ? (
                  <Pressable style={styles.secondaryButton} onPress={() => setHistoryLimit((value) => value + 10)}><Text style={styles.secondaryButtonText}>Load More</Text></Pressable>
                ) : null}
              </View>
            ) : null}

            {activeTab === "profile" ? (
              <View style={styles.profileScreen}>
                <Text style={styles.profilePageTitle}>Profile</Text>
                <View style={styles.profileHero}>
                  <View style={styles.summaryAvatar}>
                    {profile?.avatar ? (
                      <Image source={{ uri: resolveMediaUrl(profile.avatar) }} style={styles.summaryAvatarImage} accessibilityLabel="Driver profile photo" />
                    ) : (
                      <Text style={styles.summaryAvatarText}>{driverInitials}</Text>
                    )}
                  </View>
                  <View style={styles.summaryContent}>
                    <Text style={styles.summaryName}>{profile?.name || user.name || ""}</Text>
                    <Text style={styles.summaryMeta}>{compactDriverName(profile)}</Text>
                    <Text style={styles.summaryMeta}>{profile?.email || user.email || ""}</Text>
                    <View style={styles.roleBadge}>
                      <Text style={styles.roleBadgeText}>Driver</Text>
                    </View>
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
                    label="Account & Security"
                    description="Change your password and secure your account."
                    onPress={() => openProfileModal("security")}
                  />
                  <MenuRow
                    icon="notifications-outline"
                    label="Notification Settings"
                    description="Manage trip, delivery, and system alerts."
                    onPress={() => openProfileModal("notifications")}
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
            <View style={styles.avatarEditor}>
              <View style={styles.summaryAvatar}>
                {profileAvatarUri || profile?.avatar ? (
                  <Image source={{ uri: profileAvatarUri || resolveMediaUrl(profile?.avatar || "") }} style={styles.summaryAvatarImage} accessibilityLabel="Selected driver profile photo" />
                ) : (
                  <Text style={styles.summaryAvatarText}>{driverInitials}</Text>
                )}
              </View>
              <Pressable style={styles.modalOutlineButton} onPress={() => void chooseProfileAvatar()}>
                <Text style={styles.outlineButtonText}>Choose Profile Photo</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              value={profileForm.firstName}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, firstName: value }))}
              placeholder="First name"
            />
            <TextInput
              style={styles.input}
              value={profileForm.middleName}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, middleName: value }))}
              placeholder="Middle name (optional)"
            />
            <TextInput
              style={styles.input}
              value={profileForm.lastName}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, lastName: value }))}
              placeholder="Last name"
            />
            <TextInput
              style={styles.input}
              value={profileForm.suffix}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, suffix: value }))}
              placeholder="Suffix (optional)"
            />
            <TextInput
              style={styles.input}
              value={profileForm.phone}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, phone: value }))}
              placeholder="Phone"
            />
            <TextInput
              style={styles.input}
              value={profileForm.emergencyContact}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, emergencyContact: value }))}
              placeholder="Emergency contact"
            />
            <TextInput style={[styles.input, styles.disabledInput]} value={profile?.email || user?.email || ""} editable={false} placeholder="Email" />
            <Text style={styles.modalHelpText}>Driver license details are managed in the separate Driver License section.</Text>
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
            fullScreen
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
            <ToggleRow
              label="Two-Factor Authentication"
              description="Remember whether additional verification is enabled for this device."
              value={securityPrefs.twoFactorAuthentication}
              onValueChange={(value) => void handleSecurityPreferenceChange("twoFactorAuthentication", value)}
            />
            <ToggleRow
              label="Login Alerts"
              description="Show security alerts for new driver logins."
              value={securityPrefs.loginAlerts}
              onValueChange={(value) => void handleSecurityPreferenceChange("loginAlerts", value)}
            />
            <ToggleRow
              label="Remember This Device"
              description="Keep this trusted-device preference on this phone."
              value={securityPrefs.rememberDevice}
              onValueChange={(value) => void persistSecurityPreferences({ ...securityPrefs, rememberDevice: value })}
            />
          </ModalShell>

          <ModalShell
            visible={activeProfileModal === "notifications"}
            fullScreen
            title="Notifications"
            subtitle="Choose which driver alerts you want to receive."
            onClose={closeProfileModal}
          >
            <ToggleRow
              label="Trip Notifications"
              description="Receive updates when a new trip is assigned or rescheduled."
              value={notificationPrefs.tripNotifications}
              onValueChange={(value) =>
                void persistNotificationPreferences({
                  ...notificationPrefs,
                  tripNotifications: value,
                })
              }
            />
            <ToggleRow
              label="Delivery Updates"
              description="Stay informed about route progress and delivery status changes."
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
              description="Receive important driver system announcements."
              value={notificationPrefs.systemAlerts}
              onValueChange={(value) =>
                void persistNotificationPreferences({
                  ...notificationPrefs,
                  systemAlerts: value,
                })
              }
            />
            <View style={styles.notificationHeader}>
              <Text style={styles.sectionTitle}>Notification Feed ({unreadNotifications} unread)</Text>
              <View style={styles.row}>
                <Pressable style={styles.modalOutlineButton} onPress={() => void handleMarkAllNotificationsRead()}><Text style={styles.outlineButtonText}>Mark All Read</Text></Pressable>
                <Pressable style={styles.dangerOutlineButton} onPress={() => Alert.alert("Clear Notifications", "Delete all of your notifications?", [{ text: "Cancel", style: "cancel" }, { text: "Clear", style: "destructive", onPress: () => void handleClearNotifications() }])}><Text style={styles.dangerOutlineText}>Clear All</Text></Pressable>
              </View>
            </View>
            {notificationLoading ? <ActivityIndicator color="#0f172a" /> : null}
            {!notificationLoading && notifications.length === 0 ? <Text style={styles.subtle}>No notifications.</Text> : null}
            {notifications.map((notification) => (
              <View key={notification.id} style={[styles.notificationCard, !notification.isRead && styles.notificationUnread]}>
                <Text style={styles.listTitle}>{notification.title || "Notification"}</Text>
                <Text style={styles.bodyText}>{notification.message || ""}</Text>
                <Text style={styles.subtle}>{formatDate(notification.createdAt)}</Text>
              </View>
            ))}
          </ModalShell>

          <ModalShell
            visible={activeProfileModal === "license"}
            fullScreen
            title="Driver License"
            subtitle="Review and manage your license details."
            onClose={closeProfileModal}
          >
            <TextInput
              style={styles.input}
              value={profileForm.licenseNumber}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, licenseNumber: value }))}
              placeholder="Driver license number"
            />
            <TextInput
              style={styles.input}
              value={profileForm.licenseType}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, licenseType: value }))}
              placeholder="License type"
            />
            <TextInput
              style={styles.input}
              value={profileForm.licenseExpiry}
              onChangeText={(value) => setProfileForm((current) => ({ ...current, licenseExpiry: value }))}
              placeholder="License expiry YYYY-MM-DD"
            />
            <InfoRow label="License Status" value={licenseStatus} />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalGhostButton} onPress={closeProfileModal}>
                <Text style={styles.modalGhostButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryButtonCompact} onPress={handleSaveProfile} disabled={savingProfile}>
                <Text style={styles.primaryButtonText}>{savingProfile ? "Saving..." : "Save License"}</Text>
              </Pressable>
            </View>
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
            {podImageUri ? <Image source={{ uri: podImageUri }} style={styles.podPreview} accessibilityLabel="Proof of delivery preview" /> : <Text style={styles.subtle}>A proof of delivery image is required.</Text>}
            <View style={styles.row}>
              <Pressable style={styles.secondaryButton} onPress={() => void choosePodImage("camera")}><Text style={styles.secondaryButtonText}>Take Photo</Text></Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => void choosePodImage("library")}><Text style={styles.secondaryButtonText}>Choose Photo</Text></Pressable>
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalGhostButton} onPress={closeStopAction}><Text style={styles.modalGhostButtonText}>Cancel</Text></Pressable>
              <Pressable style={styles.primaryButtonCompact} onPress={() => void handleCompleteStop()} disabled={stopActionLoading}><Text style={styles.primaryButtonText}>{stopActionLoading ? "Submitting…" : "Confirm Delivered"}</Text></Pressable>
            </View>
          </ModalShell>

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
            <Text style={styles.modalHelpText}>Use at least 8 characters with uppercase, lowercase, number, and special character.</Text>
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
        <Ionicons name="notifications-outline" size={19} color="#ffffff" />
        {unreadCount > 0 ? <View style={styles.headerUnreadDot} /> : null}
      </Pressable>
    </View>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function HistoryDetails({ trip, selectedPointId, onOpenPoint }: {
  trip: DriverTrip | null;
  selectedPointId: string | null;
  onOpenPoint: (pointId: string | null) => void;
}) {
  if (!trip) return <Text style={styles.subtle}>This completed trip is no longer available.</Text>;
  const selectedPoint = (trip.dropPoints || []).find((point) => point.id === selectedPointId) || null;

  if (selectedPoint) {
    return (
      <View style={styles.stack}>
        <Text style={styles.featureTitle}>{selectedPoint.order?.orderNumber || `Stop ${selectedPoint.sequence || ""}`}</Text>
        <Text style={styles.bodyText}>{selectedPoint.contactName || selectedPoint.order?.shippingName || selectedPoint.locationName || "Customer"}</Text>
        <Text style={styles.subtle}>{[selectedPoint.address, selectedPoint.city, selectedPoint.province].filter(Boolean).join(", ")}</Text>
        {selectedPoint.deliveryPhoto ? <Image source={{ uri: resolveMediaUrl(selectedPoint.deliveryPhoto) }} style={styles.historyPodImage} resizeMode="cover" /> : null}
        {(selectedPoint.order?.items || []).map((item) => <OrderItemDetails key={item.id} item={item} />)}
        {selectedPoint.order?.totalAmount != null ? <Text style={styles.historyTotal}>Total: ₱{Number(selectedPoint.order.totalAmount).toFixed(2)}</Text> : null}
        {selectedPoint.failureReason ? <Text style={styles.error}>Failure: {selectedPoint.failureReason}{selectedPoint.failureNotes ? ` — ${selectedPoint.failureNotes}` : ""}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Text style={styles.featureTitle}>{trip.tripNumber}</Text>
      <Text style={styles.subtle}>Vehicle: {trip.vehicle?.licensePlate || "Not assigned"}</Text>
      <Text style={styles.subtle}>Finished: {formatDate(trip.actualEndAt)}</Text>
      {(trip.dropPoints || []).map((point) => (
        <Pressable key={point.id} style={styles.historyCard} onPress={() => onOpenPoint(point.id)}>
          <Text style={styles.listTitle}>{point.order?.orderNumber || `Stop ${point.sequence || ""}`}</Text>
          <Text style={styles.subtle}>{point.contactName || point.order?.shippingName || point.locationName || "Customer"}</Text>
          <Text style={styles.subtle}>{point.status || "COMPLETED"}</Text>
          <Text style={styles.linkText}>View Details</Text>
        </Pressable>
      ))}
    </View>
  );
}

function OrderItemDetails({ item }: { item: DriverTripOrderItem }) {
  const isMixed = item.itemType === "MIXED_CASE";
  return (
    <View style={styles.orderItemHistory}>
      <Text style={styles.listTitle}>{isMixed ? "Mixed Case" : productNameWithSize(item.product?.name || item.product?.sku || "Product", item.product?.sizeLabel)}</Text>
      <Text style={styles.subtle}>Quantity: {Number(item.quantity || 0)} case{Number(item.quantity || 0) === 1 ? "" : "s"}</Text>
      {isMixed ? (item.components || []).map((component) => (
        <View key={component.id || component.productId || component.productSku} style={styles.mixedComponentRow}>
          {component.product?.imageUrl ? <Image source={{ uri: resolveMediaUrl(component.product.imageUrl) }} style={styles.componentImage} /> : null}
          <Text style={[styles.subtle, styles.flex]}>
            {productNameWithSize(component.productName || component.productSku || "Product", component.product?.sizes?.[0])}: {Number(component.quantityPerCase || 0)} {component.baseUnitLabel || "bottles"} per case
          </Text>
        </View>
      )) : null}
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

function DropPointCard({ point, tripStatus, onArrive, onComplete, onFailed }: {
  point: DriverTripDropPoint;
  tripStatus: string;
  onArrive: () => void;
  onComplete: () => void;
  onFailed: () => void;
}) {
  const status = normalizeStatus(point.status || "PENDING");
  const canAct = normalizeStatus(tripStatus) === "IN_PROGRESS";
  return (
    <View style={styles.dropPointCard}>
      <Text style={styles.listTitle}>
        Stop {point.sequence || "?"} {point.locationName ? `- ${point.locationName}` : ""}
      </Text>
      <Text style={styles.subtle}>Status: {point.status || "PENDING"}</Text>
      {[point.address, point.city, point.province, point.zipCode].filter(Boolean).length ? (
        <Text style={styles.bodyText}>{[point.address, point.city, point.province, point.zipCode].filter(Boolean).join(", ")}</Text>
      ) : null}
      {point.contactName || point.contactPhone ? <Text style={styles.subtle}>Customer: {[point.contactName, point.contactPhone].filter(Boolean).join(" · ")}</Text> : null}
      {point.order?.orderNumber ? (
        <Text style={styles.subtle}>
          Order: {point.order.orderNumber} {point.order.status ? `(${point.order.status})` : ""}
        </Text>
      ) : null}
      {point.order?.warehouseStage ? <Text style={styles.subtle}>Warehouse stage: {point.order.warehouseStage}</Text> : null}
      {point.order?.totalAmount != null ? <Text style={styles.subtle}>Order total: ₱{Number(point.order.totalAmount).toFixed(2)}</Text> : null}
      {point.order?.items?.length ? (
        <View style={styles.orderItems}>
          {point.order.items.map((item) => {
            const isMixedCase = item.itemType === "MIXED_CASE";
            const orderMeasure = String(item.product?.unit || "case").toLowerCase().includes("pack") ? "pack(s)" : "case(s)";
            return (
              <View key={item.id} style={styles.orderItem}>
                <Text style={styles.listTitle}>
                  {isMixedCase
                    ? "Mixed Case"
                    : productNameWithSize(item.product?.name || item.product?.sku || "Product", item.product?.sizeLabel)}
                  {` · ${Number(item.quantity || 0)} ${orderMeasure}`}
                </Text>
                {isMixedCase
                  ? (item.components || []).map((component) => (
                      <View key={component.id || component.productId || component.productSku} style={styles.mixedComponentRow}>
                        {component.product?.imageUrl ? <Image source={{ uri: resolveMediaUrl(component.product.imageUrl) }} style={styles.componentImage} /> : null}
                        <Text style={[styles.subtle, styles.flex]}>
                          {productNameWithSize(component.productName || component.productSku || "Product", component.product?.sizes?.[0])}: {Number(component.quantityPerCase || 0)} {component.baseUnitLabel || "bottles"} per case
                          {component.totalBaseUnits !== null && component.totalBaseUnits !== undefined
                            ? ` (${Number(component.totalBaseUnits)} total)`
                            : ""}
                        </Text>
                      </View>
                    ))
                  : null}
              </View>
            );
          })}
        </View>
      ) : null}
      {point.order?.replacements?.length ? (
        <View style={styles.orderItems}>
          <Text style={styles.listTitle}>Replacement items</Text>
          {point.order.replacements.map((replacement) => (
            <Text key={replacement.id} style={styles.subtle}>
              {replacement.replacementNumber || "Replacement"}: {replacement.remainingQuantity ?? replacement.replacementQuantity ?? 0} remaining · {replacement.status || "PENDING"}
            </Text>
          ))}
        </View>
      ) : null}
      {point.notes ? <Text style={styles.subtle}>Notes: {point.notes}</Text> : null}
      {canAct && status === "PENDING" ? (
        <View style={styles.row}>
          <Pressable accessibilityLabel={`Mark stop ${point.sequence || ""} arrived`} style={styles.primaryButtonCompact} onPress={onArrive}><Text style={styles.primaryButtonText}>Arrived</Text></Pressable>
          <Pressable accessibilityLabel={`Report stop ${point.sequence || ""} failed`} style={styles.dangerOutlineButton} onPress={onFailed}><Text style={styles.dangerOutlineText}>Cannot Deliver</Text></Pressable>
        </View>
      ) : null}
      {canAct && status === "ARRIVED" ? (
        <View style={styles.row}>
          <Pressable accessibilityLabel={`Complete delivery at stop ${point.sequence || ""}`} style={styles.primaryButtonCompact} onPress={onComplete}><Text style={styles.primaryButtonText}>Delivered</Text></Pressable>
          <Pressable accessibilityLabel={`Report stop ${point.sequence || ""} failed`} style={styles.dangerOutlineButton} onPress={onFailed}><Text style={styles.dangerOutlineText}>Cannot Deliver</Text></Pressable>
        </View>
      ) : null}
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
        <Ionicons name={icon} size={21} color={danger ? "#ef4444" : "#0d61ad"} />
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
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: "#cbd5e1", true: "#86efac" }} thumbColor="#ffffff" />
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
              <Ionicons name={active ? item.activeIcon : item.icon} size={18} color={active ? (item.id === "home" ? "#047857" : "#0369a1") : "#0e4f92"} />
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
  authEyebrow: { color: "#199154", fontSize: 11, fontWeight: "700", letterSpacing: 2.8, textAlign: "center" },
  authTitle: { marginTop: 8, color: "#0a4286", fontSize: 32, lineHeight: 32, fontWeight: "900", letterSpacing: -1.2 },
  authDriverRow: { marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  authDriverTitle: { color: "#13a455", fontSize: 34, lineHeight: 35, fontWeight: "900", letterSpacing: -1.2 },
  speedLines: { width: 30, gap: 3, alignItems: "flex-end" },
  speedLinesMirrored: { transform: [{ rotate: "180deg" }] },
  speedLineLong: { width: 30, height: 2, borderRadius: 2, backgroundColor: "#13a455" },
  speedLineShort: { width: 20, height: 2, borderRadius: 2, backgroundColor: "#13a455" },
  authSubtitle: { marginTop: 10, color: "#586484", fontSize: 14, lineHeight: 19, fontWeight: "500", textAlign: "center", maxWidth: 288 },
  authForm: { width: "100%", marginTop: 12, gap: 10 },
  inputLabel: { color: "#324766", fontSize: 13, fontWeight: "700", marginTop: 2 },
  authInputRow: { height: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#d5dee4", borderRadius: 12, backgroundColor: "#ffffff" },
  authTextInput: { flex: 1, height: 42, paddingVertical: 0, color: "#0f172a", fontSize: 15 },
  passwordInputRow: { minHeight: 44, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#d5dee4", borderRadius: 12, backgroundColor: "#ffffff", overflow: "hidden" },
  passwordLeadingIcon: { marginLeft: 12 },
  passwordInput: { minWidth: 0, flex: 1, paddingHorizontal: 10, paddingVertical: 10, color: "#0f172a", fontSize: 15 },
  passwordToggle: { width: 42, minHeight: 42, alignItems: "center", justifyContent: "center" },
  passwordToggleText: { color: "#60708b", fontSize: 12, fontWeight: "700" },
  loginButton: { minHeight: 50, borderRadius: 999, backgroundColor: "#169f50", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 4, shadowColor: "#16a850", shadowOpacity: 0.24, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  forgotButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  forgotButtonText: { color: "#16984e", fontSize: 14, fontWeight: "700" },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: "#94a3b8", alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
  checkboxChecked: { backgroundColor: "#2f9a34", borderColor: "#2f9a34" },
  checkboxGlyph: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  rememberText: { color: "#4e5f79", fontSize: 13, fontWeight: "500" },
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
    backgroundColor: "#edf5fb",
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
  logoBadgeText: { color: "#ffffff", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  appHeaderEyebrow: { color: "#475569", fontSize: 9, fontWeight: "600", letterSpacing: 1.25 },
  appHeaderTitle: { color: "#0f3d72", fontSize: 18, fontWeight: "900", letterSpacing: -0.2 },
  appHeaderSubtitle: { color: "#64748b", fontSize: 11, marginTop: 1 },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#0e5aa8",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  headerGlyph: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  headerUnreadDot: { position: "absolute", top: 6, right: 6, width: 9, height: 9, borderRadius: 5, backgroundColor: "#ef4444", borderWidth: 2, borderColor: "#ffffff" },
  eyebrow: { color: "#94a3b8", fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#ffffff", fontSize: 28, fontWeight: "800" },
  subtle: { color: "#64748b", fontSize: 14 },
  subtleOnDark: { color: "#cbd5e1", fontSize: 14, lineHeight: 20 },
  subtleCentered: { color: "#64748b", fontSize: 14, textAlign: "center" },
  bodyText: { color: "#334155", fontSize: 14, lineHeight: 20 },
  pageHeading: {
    paddingHorizontal: 18,
    gap: 6,
  },
  profileScreen: { marginTop: -8, paddingTop: 18, paddingBottom: 12, gap: 20, backgroundColor: "#f8f9fa" },
  profilePageTitle: { marginHorizontal: 16, fontSize: 24, fontWeight: "800", color: "#0f172a" },
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
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#0d61ad",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  summaryAvatarImage: { width: "100%", height: "100%" },
  summaryAvatarText: { color: "#ffffff", fontSize: 26, fontWeight: "800" },
  avatarEditor: { alignItems: "center", gap: 12, paddingBottom: 4 },
  summaryContent: { flex: 1, gap: 6 },
  summaryName: { fontSize: 20, fontWeight: "800", color: "#17365d" },
  summaryMeta: { fontSize: 14, color: "#5f7390" },
  roleBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#e0f2fe",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  roleBadgeText: { color: "#0369a1", fontWeight: "700", fontSize: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  featureTitle: { fontSize: 20, fontWeight: "800", color: "#1e293b" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 16,
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
    backgroundColor: "#0f172a",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
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
  dangerOutlineButton: { minHeight: 44, borderWidth: 1, borderColor: "#ef4444", borderRadius: 14, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  dangerOutlineText: { color: "#b91c1c", fontWeight: "700" },
  primaryButtonText: { color: "#ffffff", fontWeight: "700" },
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
  secondaryButtonText: { color: "#1d4ed8", fontWeight: "700" },
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
  homePanel: { marginHorizontal: 16, padding: 16, gap: 16, borderRadius: 26, borderWidth: 1, borderColor: "rgba(255,255,255,0.75)", backgroundColor: "rgba(205,228,243,0.88)", shadowColor: "#0e7490", shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  homeDashboardHeading: { gap: 3 },
  homeMetricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  homeAssignmentCard: { backgroundColor: "#f8f8f2", borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: "rgba(203,213,225,0.7)", shadowColor: "#0f172a", shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  dashboardHeading: { paddingHorizontal: 16, gap: 3 },
  dashboardEyebrow: { color: "#1f3558", fontSize: 11, fontWeight: "700", letterSpacing: 1.75 },
  dashboardTitle: { color: "#0a1435", fontSize: 32, lineHeight: 38, fontWeight: "900", letterSpacing: -0.6 },
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
  metricValue: { fontSize: 32, lineHeight: 35, fontWeight: "900", color: "#2f9a34" },
  metricLabel: { color: "#1f4d79", fontSize: 13, fontWeight: "600" },
  tripBackButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
  tripBackText: { color: "#0f2747", fontSize: 34, lineHeight: 36, marginTop: -4 },
  tripDetailScreen: { position: "relative", width: "100%", overflow: "hidden", backgroundColor: "#f8fbfe" },
  tripMapContextRow: { position: "absolute", zIndex: 20, top: 88, left: 14, right: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  tripMapBackButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "rgba(255,255,255,0.97)", shadowColor: "#0f172a", shadowOpacity: 0.12, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  tripMapChip: { height: 34, justifyContent: "center", paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "rgba(255,255,255,0.97)", shadowColor: "#0f172a", shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  tripMapChipText: { color: "#0f172a", fontSize: 12, fontWeight: "700" },
  tripCoordinateChip: { minWidth: 0, flex: 1 },
  tripCoordinateText: { color: "#0f172a", fontSize: 11, fontWeight: "600" },
  tripStartButton: { position: "absolute", zIndex: 22, left: 16, right: 16, bottom: 118, minHeight: 48, borderRadius: 12, backgroundColor: "#1d4ed8", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, shadowColor: "#1d4ed8", shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  tripSheetPeek: { position: "absolute", zIndex: 24, left: 0, right: 0, bottom: 0, minHeight: 108, paddingHorizontal: 18, paddingTop: 9, paddingBottom: 13, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, borderColor: "rgba(255,255,255,0.9)", backgroundColor: "rgba(255,255,255,0.97)", shadowColor: "#0f172a", shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: -8 }, elevation: 10 },
  tripSheetHandle: { width: 54, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: 8, backgroundColor: "#cbd5e1" },
  tripSheetEyebrow: { color: "#64748b", fontSize: 10, fontWeight: "700", letterSpacing: 1.7 },
  tripSheetSummaryRow: { marginTop: 3, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  tripSheetTripNumber: { color: "#0f172a", fontSize: 19, fontWeight: "900", letterSpacing: -0.3 },
  tripSheetSchedule: { color: "#64748b", fontSize: 11, marginTop: 2 },
  tripSheetSummaryRight: { alignItems: "flex-end", gap: 4 },
  tripSheetSpeed: { color: "#0f172a", fontSize: 12, fontWeight: "900" },
  tripSheetProgress: { color: "#334155", fontSize: 11, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden", backgroundColor: "#f1f5f9" },
  tripBottomSheet: { position: "absolute", zIndex: 25, left: 0, right: 0, bottom: 0, height: "55%", paddingTop: 9, paddingHorizontal: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, borderColor: "rgba(255,255,255,0.9)", backgroundColor: "rgba(255,255,255,0.98)", shadowColor: "#0f172a", shadowOpacity: 0.2, shadowRadius: 22, shadowOffset: { width: 0, height: -10 }, elevation: 12 },
  tripSheetExpandedHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingBottom: 10 },
  tripSheetScroll: { flex: 1 },
  tripSheetScrollContent: { gap: 10, paddingBottom: 24 },
  tripsScreen: { paddingHorizontal: 16, gap: 12 },
  tripsEyebrow: { color: "#64748b", fontSize: 11, fontWeight: "700", letterSpacing: 1.75 },
  tripsTitle: { marginTop: -8, color: "#0f172a", fontSize: 20, lineHeight: 26, fontWeight: "900" },
  searchField: { height: 40, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "#e0f2fe", borderRadius: 12, backgroundColor: "rgba(255,255,255,0.94)", shadowColor: "#0284c7", shadowOpacity: 0.08, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  searchInput: { flex: 1, height: 40, paddingVertical: 0, color: "#0f172a", fontSize: 14 },
  routeCard: { padding: 16, gap: 8, borderWidth: 1, borderColor: "#e0f2fe", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.96)", shadowColor: "#0284c7", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  routeCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  routeNumber: { flex: 1, color: "#0f172a", fontSize: 16, fontWeight: "800" },
  viewDetailsButton: { height: 32, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#bae6fd", borderRadius: 8, backgroundColor: "#ffffff" },
  viewDetailsText: { color: "#0369a1", fontSize: 12, fontWeight: "700" },
  tripStatusBadge: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: "#bae6fd", borderRadius: 999, backgroundColor: "#e0f2fe" },
  tripStatusActive: { borderColor: "#a7f3d0", backgroundColor: "#d1fae5" },
  tripStatusText: { color: "#075985", fontSize: 11, fontWeight: "700" },
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
  listTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  badgeText: { color: "#1d4ed8", fontWeight: "800" },
  stack: { gap: 10 },
  dropPointCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  orderItems: { gap: 6, marginTop: 6 },
  mixedComponentRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  componentImage: { width: 38, height: 38, borderRadius: 8, backgroundColor: "#e2e8f0" },
  orderItem: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
    gap: 2,
  },
  orderItemHistory: { borderWidth: 1, borderColor: "#dbe4ee", borderRadius: 14, padding: 12, gap: 4, backgroundColor: "#f8fafc" },
  historyPodImage: { width: "100%", height: 210, borderRadius: 16, backgroundColor: "#e2e8f0" },
  historyTotal: { color: "#059669", fontSize: 20, fontWeight: "900", textAlign: "right" },
  linkText: { color: "#0d61ad", fontSize: 13, fontWeight: "800", marginTop: 6 },
  historyScreen: { paddingHorizontal: 16, gap: 10 },
  historyTitle: { color: "#0f172a", fontSize: 20, lineHeight: 26, fontWeight: "800" },
  historySubtitle: { marginTop: -8, color: "#64748b", fontSize: 12 },
  historyCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.8)",
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
  infoValue: { color: "#0f172a", fontSize: 14, fontWeight: "700", flex: 1, textAlign: "right" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    paddingHorizontal: 16,
    paddingVertical: 15,
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
  menuLabel: { color: "#1e293b", fontSize: 15, fontWeight: "700" },
  menuLabelDanger: { color: "#dc2626" },
  menuDescription: { color: "#64748b", fontSize: 13, marginTop: 2 },
  menuGlyph: { color: "#0f172a", fontSize: 11, fontWeight: "800" },
  menuGlyphDanger: { color: "#b91c1c" },
  chevronText: { color: "#94a3b8", fontSize: 18, fontWeight: "700" },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#eff7fb",
    borderTopWidth: 1,
    borderTopColor: "#bae6fd",
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
    backgroundColor: "#dbeafe",
  },
  bottomNavIconWrapHomeActive: { backgroundColor: "#d1fae5" },
  bottomNavGlyph: { color: "#0e4f92", fontSize: 18, fontWeight: "900" },
  bottomNavGlyphActive: { color: "#047857" },
  bottomNavLabel: { color: "#0e4f92", fontSize: 11, fontWeight: "700" },
  bottomNavLabelActive: { color: "#047857" },
  error: { color: "#b91c1c", fontWeight: "600" },
  errorBanner: {
    color: "#991b1b",
    backgroundColor: "#fee2e2",
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 12,
    fontWeight: "600",
  },
  offlineBanner: { color: "#7c2d12", backgroundColor: "#ffedd5", marginHorizontal: 16, borderRadius: 14, padding: 12, fontWeight: "700" },
  queueBanner: { marginHorizontal: 16, padding: 12, borderRadius: 14, backgroundColor: "#fef3c7", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  queueText: { color: "#78350f", fontWeight: "700", flex: 1 },
  queueError: { color: "#991b1b", fontSize: 12, marginTop: 3 },
  queueAction: { color: "#1d4ed8", fontWeight: "800" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  fullScreenModalBackdrop: { backgroundColor: "#f8f9fa", justifyContent: "flex-start" },
  modalCard: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
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
  modalTitle: { color: "#0f172a", fontSize: 20, fontWeight: "800" },
  closeGlyph: { color: "#475569", fontSize: 16, fontWeight: "800" },
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
    borderColor: "#cbd5e1",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 108,
  },
  modalGhostButtonText: { color: "#0f172a", fontWeight: "700" },
  modalOutlineButton: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButtonText: { color: "#0f172a", fontWeight: "700" },
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
  podPreview: { width: "100%", height: 220, borderRadius: 18, backgroundColor: "#e2e8f0" },
  returnableRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  quantityButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center" },
  quantityButtonText: { color: "#0f172a", fontSize: 20, fontWeight: "800" },
  quantityValue: { minWidth: 30, textAlign: "center", color: "#0f172a", fontWeight: "800" },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choiceChip: { minHeight: 44, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 999, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  choiceChipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  choiceChipText: { color: "#334155", fontWeight: "700" },
  choiceChipTextActive: { color: "#ffffff" },
  documentEmptyState: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderStyle: "dashed",
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f8fafc",
  },
  documentGlyph: { color: "#64748b", fontSize: 16, fontWeight: "800" },
  documentEmptyTitle: { color: "#0f172a", fontWeight: "700" },
});
