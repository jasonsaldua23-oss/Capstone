// Mirrors src/components/portals/customer/sections/profile/edit-address-page.tsx.
import { ArrowLeft, Loader2, MapPin, Trash2 } from "lucide-react-native";
import React from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { AddressMapPicker } from "../../components/ui/address-map-picker";
import { isValidPhilippinePhone } from "../../lib/customer-logic";
import { composeShippingAddress } from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

function Field({
  label,
  value,
  placeholder,
  onChangeText,
  keyboardType,
  editable = true,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText?: (next: string) => void;
  keyboardType?: "default" | "phone-pad" | "number-pad";
  editable?: boolean;
}) {
  return (
    <View style={styles.addressField}>
      <Text style={styles.addressFieldLabel}>{label}</Text>
      <TextInput
        style={[styles.addressInput, editable ? null : styles.disabledInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textFaint}
        keyboardType={keyboardType || "default"}
        editable={editable}
      />
    </View>
  );
}

export function EditAddressScreen() {
  const {
    popRoute,
    addressForm,
    setAddressField,
    clearAddressForm,
    handlePinnedLocation,
    handleOutsideServiceArea,
    useCurrentLocation,
    resolvingPinnedAddress,
    savingProfile,
    handleSaveAddress,
  } = useCustomerPortal();

  const composed = composeShippingAddress({
    houseNumber: addressForm.houseNumber,
    streetName: addressForm.streetName,
    subdivision: addressForm.subdivision,
    barangay: addressForm.barangay,
    city: addressForm.city,
    province: addressForm.province,
    zipCode: addressForm.zipCode,
  });

  const phoneValid = !addressForm.phone.trim() || isValidPhilippinePhone(addressForm.phone);

  return (
    <View style={styles.addressSection}>
      <View style={styles.addressHeader}>
        <Pressable
          style={styles.addressBackButton}
          onPress={popRoute}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={16} color={theme.colors.slate600} />
          <Text style={styles.addressBackText}>Back</Text>
        </Pressable>
        <Text style={styles.addressTitle}>Edit Address</Text>
        <Pressable
          style={styles.addressClearButton}
          onPress={clearAddressForm}
          accessibilityRole="button"
          accessibilityLabel="Clear address fields"
        >
          <Trash2 size={14} color="#e11d48" />
        </Pressable>
      </View>

      <View style={styles.addressBody}>
        <Text style={styles.addressSectionTitle}>Contact Information</Text>
        <Field
          label="Full Name"
          value={addressForm.name}
          placeholder="Full name"
          onChangeText={(next) => setAddressField("name", next)}
        />
        <Field
          label="Phone Number"
          value={addressForm.phone}
          placeholder="09XX XXX XXXX or 639XX XXX XXXX"
          keyboardType="phone-pad"
          onChangeText={(next) => setAddressField("phone", next)}
        />
        {!phoneValid ? (
          <Text style={styles.addressFieldError}>
            Please enter a valid Philippine mobile number (e.g., 09171234567 or 639171234567).
          </Text>
        ) : null}

        <Text style={styles.addressSectionTitle}>Address Details</Text>
        <Field
          label="House number (optional)"
          value={addressForm.houseNumber}
          placeholder="House number"
          onChangeText={(next) => setAddressField("houseNumber", next)}
        />
        <Field
          label="Street name"
          value={addressForm.streetName}
          placeholder="Street name"
          onChangeText={(next) => setAddressField("streetName", next)}
        />
        <Field
          label="Subdivision (optional)"
          value={addressForm.subdivision}
          placeholder="Subdivision"
          onChangeText={(next) => setAddressField("subdivision", next)}
        />
        <Field
          label="Barangay"
          value={addressForm.barangay}
          placeholder="Barangay"
          onChangeText={(next) => setAddressField("barangay", next)}
        />
        <Field
          label="City / Municipality"
          value={addressForm.city}
          placeholder="City / Municipality"
          onChangeText={(next) => setAddressField("city", next)}
        />
        <Field
          label="Province"
          value={addressForm.province}
          placeholder="Province"
          onChangeText={(next) => setAddressField("province", next)}
        />
        <Field
          label="Postal code"
          value={addressForm.zipCode}
          placeholder="Postal code"
          keyboardType="number-pad"
          onChangeText={(next) => setAddressField("zipCode", next)}
        />
        <Field label="Country" value={addressForm.country} placeholder="Country" editable={false} />

        <View style={styles.addressPreviewBox}>
          <Text style={styles.addressPreviewLabel}>Full Address Preview:</Text>
          <Text style={styles.addressPreviewValue}>{composed || "—"}</Text>
        </View>

        <AddressMapPicker
          latitude={addressForm.latitude}
          longitude={addressForm.longitude}
          onPick={(lat, lng) => void handlePinnedLocation(lat, lng)}
          onOutsideServiceArea={handleOutsideServiceArea}
        />

        <Pressable
          style={styles.addressLocationButton}
          onPress={() => void useCurrentLocation()}
          accessibilityRole="button"
        >
          <MapPin size={14} color={theme.colors.emeraldDark} />
          <Text style={styles.addressLocationText}>Use Current Location</Text>
        </Pressable>

        <Text style={styles.addressPinnedText}>
          {addressForm.latitude !== null && addressForm.longitude !== null
            ? `Pinned Location: ${addressForm.latitude.toFixed(6)}, ${addressForm.longitude.toFixed(6)}`
            : "No location pinned yet"}
        </Text>

        {resolvingPinnedAddress ? (
          <View style={styles.addressResolvingRow}>
            <ActivityIndicator size="small" color={theme.colors.emerald} />
            <Text style={styles.addressFieldLabel}>Auto-filling address from pinned location...</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.primaryButton, savingProfile || !phoneValid ? styles.disabledButton : null]}
          disabled={savingProfile || !phoneValid}
          onPress={() => void handleSaveAddress()}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{savingProfile ? "Saving..." : "Save Address"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
