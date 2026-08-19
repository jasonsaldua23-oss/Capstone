import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
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
  updateDriverProfile,
  verifyPasswordResetOtp,
  type DriverProfileUpdateInput,
} from "./src/services/auth";
import { ApiError } from "./src/services/api";
import { getTrackedTripId, startBackgroundTripTracking, stopBackgroundTripTracking } from "./src/services/background-location";
import { clearOfflineQueue, queueOfflineOperation, readOfflineQueue, syncOfflineQueue, type OfflineQueueItem } from "./src/services/offline-queue";
import { buildTripSearchText, getStartBlockedOrders, isUsableLocationSample, normalizeStatus } from "./src/lib/driver-logic";
import DriverNavigationMap from "./src/components/DriverNavigationMap";
import type { AuthUser, DriverNotification, DriverProfile, DriverTrip, DriverTripDropPoint, DriverTripLocation } from "./src/types";

type DriverTab = "home" | "trips" | "history" | "profile";
type DriverProfileModal = "edit" | "security" | "notifications" | "license" | null;
type StopActionMode = "complete" | "failed" | null;

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
  name: "",
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
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [activeTab, setActiveTab] = useState<DriverTab>("home");
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [startingTripId, setStartingTripId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<DriverProfileUpdateInput>(initialProfileForm);
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
  const [rescheduleWindow, setRescheduleWindow] = useState<"today" | "tomorrow" | "other_date" | "cancel">("today");
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
    setProfileForm({
      name: nextProfile.name || "",
      phone: nextProfile.phone || "",
      emergencyContact: nextProfile.emergencyContact || "",
      licenseNumber: nextProfile.licenseNumber || "",
      licenseType: nextProfile.licenseType || "",
      licenseExpiry: nextProfile.licenseExpiry ? String(nextProfile.licenseExpiry).slice(0, 10) : "",
    });
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
      setSecurityPrefs(raw ? { ...defaultSecurityPrefs, ...JSON.parse(raw) } : defaultSecurityPrefs);
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
      const loggedIn = await login(email.trim(), password, rememberMe);
      setUser(loggedIn);
      await refreshData(false);
      await loadNotificationPreferences();
      await loadSecurityPreferences();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setLoading(false);
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
      const nextProfile = await updateDriverProfile(profileForm);
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

  async function loadNotifications() {
    setNotificationLoading(true);
    try {
      const data = await fetchNotifications();
      setNotifications(data.notifications || []);
      setUnreadNotifications(Number(data.unreadCount || 0));
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
    setRescheduleWindow("today");
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
    if (!recipientName.trim()) {
      setError("Recipient name is required.");
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
        recipientName: recipientName.trim(),
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

  async function handleFailedStop() {
    if (!stopActionPoint || !failureReason.trim()) {
      setError("Enter the failed-delivery reason.");
      return;
    }
    if (rescheduleWindow === "other_date" && !/^\d{4}-\d{2}-\d{2}$/.test(rescheduleDate.trim())) {
      setError("Enter the reschedule date as YYYY-MM-DD.");
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
        <View style={styles.authShell}>
          <View style={styles.heroCard}>
            <Text style={styles.eyebrow}>Driver Mobile Portal</Text>
            <Text style={styles.title}>Manage trips on the road</Text>
            <Text style={styles.subtleOnDark}>
              Log in with a driver account to view assigned trips, start routes, and send live location.
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
              <Switch value={rememberMe} onValueChange={setRememberMe} trackColor={{ false: "#cbd5e1", true: "#86efac" }} thumbColor="#ffffff" />
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
            title="AAB TRADING DRIVER"
            subtitle={activeTab === "profile" ? "Driver account profile" : `Assigned trips: ${trips.length}`}
          />

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshData(false)} />}
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
              <>
                <View style={styles.metricGrid}>
                  <MetricCard label="In Progress" value={dashboardMetrics.inProgress} accent="#0f766e" />
                  <MetricCard label="Planned" value={dashboardMetrics.planned} accent="#9a3412" />
                  <MetricCard label="Completed" value={dashboardMetrics.completed} accent="#1d4ed8" />
                  <MetricCard label="Stops Left" value={dashboardMetrics.remainingStops} accent="#6d28d9" />
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Active trip</Text>
                  {selectedTrip ? (
                    <>
                      <Text style={styles.featureTitle}>{selectedTrip.tripNumber}</Text>
                      <Text style={styles.subtle}>Status: {selectedTrip.status}</Text>
                      <Text style={styles.subtle}>Schedule: {formatDate(selectedTrip.tripSchedule || selectedTrip.plannedStartAt)}</Text>
                      <Text style={styles.subtle}>
                        Stops: {selectedTrip.completedDropPoints || 0} / {selectedTrip.totalDropPoints || selectedTrip.dropPoints?.length || 0}
                      </Text>
                      {selectedTrip.vehicle?.licensePlate ? (
                        <Text style={styles.subtle}>
                          Vehicle: {selectedTrip.vehicle.licensePlate} {selectedTrip.vehicle.type ? `(${selectedTrip.vehicle.type})` : ""}
                        </Text>
                      ) : null}
                      {currentLocation || selectedTrip.latestLocation ? (
                        <Text style={styles.subtle}>
                          Last GPS: {(currentLocation || selectedTrip.latestLocation)!.latitude.toFixed(5)}, {(currentLocation || selectedTrip.latestLocation)!.longitude.toFixed(5)}
                        </Text>
                      ) : (
                        <Text style={styles.subtle}>No GPS location sent yet.</Text>
                      )}
                      <Text style={styles.subtle}>Tracking: {trackingMode.replace("-", " ")}</Text>
                      <View style={styles.row}>
                        {selectedTrip.status === "PLANNED" ? (
                          <Pressable
                            style={styles.primaryButton}
                            onPress={() => handleStartTrip(selectedTrip.id)}
                            disabled={startingTripId === selectedTrip.id}
                          >
                            <Text style={styles.primaryButtonText}>
                              {startingTripId === selectedTrip.id ? "Starting..." : "Start Trip"}
                            </Text>
                          </Pressable>
                        ) : null}
                        <Pressable style={styles.secondaryButton} onPress={handleShareLocation} disabled={sharingLocation}>
                          <Text style={styles.secondaryButtonText}>
                            {sharingLocation ? "Sending..." : "Share Location"}
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <Text style={styles.subtle}>No assigned trips yet.</Text>
                  )}
                </View>
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Assigned orders</Text>
                  {(selectedTrip?.dropPoints || []).filter((point) => point.order).length === 0 ? <Text style={styles.subtle}>No assigned orders for this trip.</Text> : null}
                  {(selectedTrip?.dropPoints || []).filter((point) => point.order).map((point) => (
                    <Pressable key={point.id} style={styles.listItem} onPress={() => { setActiveTab("trips"); setSelectedTripId(selectedTrip!.id); }}>
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>{point.order?.orderNumber || "Order"}</Text>
                        <Text style={styles.subtle}>{point.contactName || point.order?.shippingName || point.locationName || "Customer"}</Text>
                      </View>
                      <Text style={styles.badgeText}>{point.order?.warehouseStage || point.status || "PENDING"}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {activeTab === "trips" ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Assigned trips</Text>
                  <TextInput style={styles.input} value={tripSearch} onChangeText={setTripSearch} placeholder="Search trip, customer, order, address, or vehicle" />
                  {activeTrips.length === 0 ? <Text style={styles.subtle}>No active assigned trips match your search.</Text> : null}
                  {activeTrips.map((trip) => (
                    <Pressable
                      key={trip.id}
                      style={[styles.listItem, selectedTrip?.id === trip.id ? styles.listItemSelected : null]}
                      onPress={() => setSelectedTripId(trip.id)}
                    >
                      <View style={styles.flex}>
                        <Text style={styles.listTitle}>{trip.tripNumber}</Text>
                        <Text style={styles.subtle}>{trip.status}</Text>
                      </View>
                      <Text style={styles.badgeText}>
                        {trip.completedDropPoints || 0}/{trip.totalDropPoints || trip.dropPoints?.length || 0}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {selectedTrip ? (
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Trip details</Text>
                    <Text style={styles.featureTitle}>{selectedTrip.tripNumber}</Text>
                    <Text style={styles.subtle}>Status: {selectedTrip.status}</Text>
                    <Text style={styles.subtle}>Schedule: {formatDate(selectedTrip.tripSchedule || selectedTrip.plannedStartAt)}</Text>
                    <Text style={styles.subtle}>
                      Vehicle: {selectedTrip.vehicle?.licensePlate || "Not assigned"} {selectedTrip.vehicle?.type ? `(${selectedTrip.vehicle.type})` : ""}
                    </Text>
                    {selectedTrip.warehouse ? (
                      <Text style={styles.subtle}>Warehouse: {[selectedTrip.warehouse.name, selectedTrip.warehouse.address, selectedTrip.warehouse.city].filter(Boolean).join(", ")}</Text>
                    ) : null}
                    {selectedTrip.notes ? <Text style={styles.bodyText}>Notes: {selectedTrip.notes}</Text> : null}
                    {normalizeStatus(selectedTrip.status) === "IN_PROGRESS" ? (
                      <DriverNavigationMap trip={selectedTrip} currentLocation={currentLocation || selectedTrip.latestLocation || null} />
                    ) : null}
                    {selectedTrip.dropPoints?.length ? (
                      <View style={styles.stack}>
                        {selectedTrip.dropPoints.map((point) => (
                          <DropPointCard
                            key={point.id}
                            point={point}
                            tripStatus={selectedTrip.status}
                            onArrive={() => confirmArrived(point)}
                            onComplete={() => openStopAction(point, "complete")}
                            onFailed={() => openStopAction(point, "failed")}
                          />
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.subtle}>No stops are assigned to this trip.</Text>
                    )}
                  </View>
                ) : null}
              </>
            ) : null}

            {activeTab === "history" ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Trip history</Text>
                <TextInput style={styles.input} value={historySearch} onChangeText={(value) => { setHistorySearch(value); setHistoryLimit(10); }} placeholder="Search completed trips" />
                {completedTrips.length === 0 ? <Text style={styles.subtle}>No completed trips yet.</Text> : null}
                {completedTrips.slice(0, historyLimit).map((trip) => (
                  <Pressable key={trip.id} style={styles.historyCard} onPress={() => { setSelectedTripId(trip.id); setActiveTab("trips"); }}>
                    <Text style={styles.listTitle}>{trip.tripNumber}</Text>
                    <Text style={styles.subtle}>Completed stops: {trip.completedDropPoints || 0}</Text>
                    <Text style={styles.subtle}>Vehicle: {trip.vehicle?.licensePlate || "Not assigned"}</Text>
                    <Text style={styles.subtle}>Customers: {(trip.dropPoints || []).map((point) => point.contactName || point.order?.shippingName).filter(Boolean).join(", ") || "Not recorded"}</Text>
                    <Text style={styles.subtle}>Started: {formatDate(trip.actualStartAt)}</Text>
                    <Text style={styles.subtle}>Finished: {formatDate(trip.actualEndAt)}</Text>
                  </Pressable>
                ))}
                {historyLimit < completedTrips.length ? (
                  <Pressable style={styles.secondaryButton} onPress={() => setHistoryLimit((value) => value + 10)}><Text style={styles.secondaryButtonText}>Load More</Text></Pressable>
                ) : null}
              </View>
            ) : null}

            {activeTab === "profile" ? (
              <>
                <View style={styles.pageHeading}>
                  <Text style={styles.profilePageTitle}>My Profile</Text>
                  <Text style={styles.profilePageSubtitle}>Manage your driver account details, security, and license records.</Text>
                </View>

                <View style={styles.summaryCard}>
                  <View style={styles.summaryAvatar}>
                    <Text style={styles.summaryAvatarText}>{driverInitials}</Text>
                  </View>
                  <View style={styles.summaryContent}>
                    <Text style={styles.summaryName}>{profile?.name || user.name || ""}</Text>
                    <Text style={styles.summaryMeta}>{profile?.email || user.email || ""}</Text>
                    <View style={styles.roleBadge}>
                      <Text style={styles.roleBadgeText}>Driver</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Driver Information</Text>
                  <InfoRow label="Phone" value={profile?.phone || ""} />
                  <InfoRow label="Driver License" value={profile?.licenseNumber || ""} />
                  <InfoRow label="License Type" value={profile?.licenseType || ""} />
                  <InfoRow label="License Expiry" value={formatDateOnly(profile?.licenseExpiry)} />
                  <InfoRow label="License Status" value={licenseStatus} />
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
                    description="Manage trip, delivery, and system alerts."
                    onPress={() => openProfileModal("notifications")}
                  />
                  <MenuRow
                    icon="DL"
                    label="Driver License"
                    description="View and manage your license details."
                    onPress={() => openProfileModal("license")}
                  />
                  <MenuRow
                    icon="LO"
                    label="Log Out"
                    description="Sign out of the driver mobile app."
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
              { id: "trips", label: "Trips", icon: "TR" },
              { id: "history", label: "History", icon: "HI" },
              { id: "profile", label: "Profile", icon: "PR" },
            ]}
            activeTab={activeTab}
            onSelect={(tab) => {
              if (tab === "home") setSelectedTripId(getPreferredOperationalTripId(trips));
              setActiveTab(tab as DriverTab);
            }}
          />

          <ModalShell
            visible={activeProfileModal === "edit"}
            title="Edit Profile"
            subtitle="Update your basic driver information."
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
              onValueChange={(value) => void persistSecurityPreferences({ ...securityPrefs, twoFactorAuthentication: value })}
            />
            <ToggleRow
              label="Login Alerts"
              description="Show security alerts for new driver logins."
              value={securityPrefs.loginAlerts}
              onValueChange={(value) => void persistSecurityPreferences({ ...securityPrefs, loginAlerts: value })}
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
            <TextInput style={styles.input} value={recipientName} onChangeText={setRecipientName} placeholder="Recipient name" />
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
                ["today", "Later today"],
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
            <Text style={styles.modalHelpText}>{rescheduleWindow === "cancel" ? "Cancellation releases reserved inventory." : rescheduleWindow === "today" ? "The stop returns to pending at the end of today's route." : "Inventory stays reserved and the order returns to route planning."}</Text>
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
    </SafeAreaView>
  );
}

function AppHeader({ title, subtitle }: { title: string; subtitle: string }) {
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
      <View style={styles.headerAvatar}>
        <Text style={styles.headerGlyph}>U</Text>
      </View>
    </View>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <View style={[styles.metricCard, { borderColor: accent }]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
                    ? `Mixed Case (${Number(item.caseCapacity || 0)} bottles/cans)`
                    : item.product?.name || item.product?.sku || "Product"}
                  {` · ${Number(item.quantity || 0)} ${orderMeasure}`}
                </Text>
                {isMixedCase
                  ? (item.components || []).map((component) => (
                      <Text key={component.id || component.productId || component.productSku} style={styles.subtle}>
                        {component.productName || component.productSku || "Product"}: {Number(component.quantityPerCase || 0)} {component.baseUnitLabel || "bottle(s)/can(s)"} per case
                        {component.totalBaseUnits !== null && component.totalBaseUnits !== undefined
                          ? ` (${Number(component.totalBaseUnits)} total)`
                          : ""}
                      </Text>
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
  container: { flex: 1, backgroundColor: "#edf2f7" },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#edf2f7" },
  authShell: { flex: 1, padding: 20, justifyContent: "center", gap: 16 },
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
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  logoBadgeText: { color: "#ffffff", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  appHeaderTitle: { color: "#0f172a", fontSize: 16, fontWeight: "800", letterSpacing: 0.4 },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  headerGlyph: { color: "#0f172a", fontSize: 14, fontWeight: "800" },
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
  profilePageTitle: { fontSize: 28, fontWeight: "800", color: "#0f172a" },
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
  summaryAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center",
  },
  summaryAvatarText: { color: "#1d4ed8", fontSize: 26, fontWeight: "800" },
  summaryContent: { flex: 1, gap: 6 },
  summaryName: { fontSize: 21, fontWeight: "800", color: "#0f172a" },
  summaryMeta: { fontSize: 14, color: "#475569" },
  roleBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#dcfce7",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  roleBadgeText: { color: "#166534", fontWeight: "700", fontSize: 12 },
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
    gap: 12,
  },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  scrollContent: { paddingTop: 8, paddingBottom: 120, gap: 16 },
  metricGrid: {
    paddingHorizontal: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metricCard: {
    width: "47%",
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    gap: 6,
  },
  metricValue: { fontSize: 28, fontWeight: "800", color: "#0f172a" },
  metricLabel: { color: "#475569", fontWeight: "600" },
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
  orderItem: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
    gap: 2,
  },
  historyCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 18,
    padding: 14,
    gap: 4,
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
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 18,
    padding: 14,
  },
  menuIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
  },
  menuIconWrapDanger: {
    backgroundColor: "#fee2e2",
  },
  menuLabel: { color: "#0f172a", fontSize: 15, fontWeight: "700" },
  menuLabelDanger: { color: "#b91c1c" },
  menuDescription: { color: "#64748b", fontSize: 13, marginTop: 2 },
  menuGlyph: { color: "#0f172a", fontSize: 11, fontWeight: "800" },
  menuGlyphDanger: { color: "#b91c1c" },
  chevronText: { color: "#94a3b8", fontSize: 18, fontWeight: "700" },
  bottomNav: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    shadowColor: "#0f172a",
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
    backgroundColor: "#0f172a",
  },
  bottomNavGlyph: { color: "#475569", fontSize: 11, fontWeight: "800" },
  bottomNavGlyphActive: { color: "#ffffff" },
  bottomNavLabel: { color: "#64748b", fontSize: 12, fontWeight: "700" },
  bottomNavLabelActive: { color: "#0f172a" },
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
  modalCard: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "88%",
    paddingTop: 10,
  },
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
