import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { fetchAuthMe, fetchCustomerOrders, fetchCustomerTracking, getStoredUser, login, logout } from "./src/services/auth";
import type { CustomerOrder, CustomerTrackingItem, CustomerUser } from "./src/types";

export default function App() {
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("customer@example.com");
  const [password, setPassword] = useState("customer123");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [tracking, setTracking] = useState<CustomerTrackingItem[]>([]);

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
      const [currentUser, customerOrders, customerTracking] = await Promise.all([fetchAuthMe(), fetchCustomerOrders(), fetchCustomerTracking()]);
      setUser(currentUser);
      setOrders(customerOrders);
      setTracking(customerTracking);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load customer data.");
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
    setOrders([]);
    setTracking([]);
    setLoading(false);
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.subtle}>Starting customer app...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      {!user ? (
        <View style={styles.card}>
          <Text style={styles.title}>Customer App Login</Text>
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
          <Text style={styles.subtle}>Orders: {orders.length}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => refreshData(true)} disabled={loading}>
              <Text>{loading ? "Refreshing..." : "Refresh"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleLogout} disabled={loading}>
              <Text>Logout</Text>
            </TouchableOpacity>
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Text style={styles.sectionTitle}>My Orders</Text>
          <FlatList
            data={orders}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={<Text style={styles.subtle}>No orders yet.</Text>}
            renderItem={({ item }) => (
              <View style={styles.itemRow}>
                <Text style={styles.itemTitle}>{item.orderNumber}</Text>
                <Text>{item.status}</Text>
                <Text style={styles.subtle}>Total: {item.totalAmount}</Text>
              </View>
            )}
          />
          <Text style={styles.sectionTitle}>Tracking</Text>
          <FlatList
            data={tracking}
            keyExtractor={(item) => item.orderId}
            ListEmptyComponent={<Text style={styles.subtle}>No tracking updates.</Text>}
            renderItem={({ item }) => (
              <View style={styles.itemRow}>
                <Text style={styles.itemTitle}>{item.orderNumber}</Text>
                <Text>Status: {item.orderStatus || item.status || "UNKNOWN"}</Text>
                <Text style={styles.subtle}>
                  {item.trip ? `Trip ${item.trip.tripNumber} (${item.trip.status})` : "No trip assigned yet"}
                </Text>
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
  itemRow: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 12, marginBottom: 8 },
  itemTitle: { fontWeight: "700" },
});
