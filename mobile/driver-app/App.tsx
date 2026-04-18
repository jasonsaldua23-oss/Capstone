import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { fetchDriverProfile, fetchDriverTrips, getStoredUser, login, logout } from "./src/services/auth";
import type { AuthUser, DriverTrip } from "./src/types";

export default function App() {
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("driver@logistics.com");
  const [password, setPassword] = useState("driver123");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [trips, setTrips] = useState<DriverTrip[]>([]);

  useEffect(() => {
    (async () => {
      const stored = await getStoredUser();
      if (stored) {
        setUser(stored);
        await refreshData(false);
      }
      setBooting(false);
    })();
  }, []);

  async function refreshData(showLoader = true) {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const [profile, tripList] = await Promise.all([fetchDriverProfile(), fetchDriverTrips()]);
      setUser(profile);
      setTrips(tripList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load driver data.");
    } finally {
      if (showLoader) setLoading(false);
    }
  }

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const loggedIn = await login(email.trim(), password);
      setUser(loggedIn);
      await refreshData(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    await logout();
    setUser(null);
    setTrips([]);
    setLoading(false);
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.subtle}>Starting driver app...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      {!user ? (
        <View style={styles.card}>
          <Text style={styles.title}>Driver App Login</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="Email" />
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? "Logging in..." : "Log In"}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.title}>Welcome, {user.name}</Text>
          <Text style={styles.subtle}>Role: {user.role}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => refreshData(true)} disabled={loading}>
              <Text>{loading ? "Refreshing..." : "Refresh"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleLogout} disabled={loading}>
              <Text>Logout</Text>
            </TouchableOpacity>
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Text style={styles.sectionTitle}>Assigned Trips</Text>
          <FlatList
            data={trips}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={<Text style={styles.subtle}>No trips assigned.</Text>}
            renderItem={({ item }) => (
              <View style={styles.tripRow}>
                <Text style={styles.tripCode}>{item.tripNumber}</Text>
                <Text>{item.status}</Text>
              </View>
            )}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f7fb", padding: 16 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  card: { flex: 1, backgroundColor: "white", borderRadius: 12, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "700" },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginTop: 8 },
  subtle: { color: "#6b7280" },
  error: { color: "#b91c1c" },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 12, backgroundColor: "white" },
  primaryButton: { backgroundColor: "#111827", borderRadius: 8, padding: 12, alignItems: "center" },
  primaryButtonText: { color: "white", fontWeight: "600" },
  secondaryButton: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  row: { flexDirection: "row", gap: 8, marginTop: 4 },
  tripRow: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 12, marginBottom: 8 },
  tripCode: { fontWeight: "700" },
});
