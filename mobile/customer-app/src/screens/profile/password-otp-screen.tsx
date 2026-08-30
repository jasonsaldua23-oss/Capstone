// Code entry for the change-password flow, as a full screen.
//
// It renders in place of the whole portal shell — no app header, no bottom nav —
// the same as the registration verification page (screens/auth/otp-verification-screen.tsx),
// and shares that page's styles so the two read as one flow.
//
// Reaching it never sends a code by itself: the Change Password form sends one and
// navigates here, or, while a code is still valid, offers "Enter OTP" which comes
// straight here and leaves the running countdown alone.
import React, { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, Lock } from "lucide-react-native";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";

import { formatOtpCountdown } from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

const CODE_LENGTH = 6;

export function PasswordOtpScreen() {
  const {
    user,
    profile,
    error,
    securityForm,
    setSecurityForm,
    otpVerified,
    setOtpVerified,
    otpExpiry,
    otpResendCooldown,
    handleRequestOtp,
    sendingOtp,
    handleVerifyOtp,
    verifyingOtp,
    openProfileModal,
  } = useCustomerPortal();

  const inputs = useRef<Array<TextInput | null>>([]);

  const digits = useMemo(() => {
    const cleaned = securityForm.otp.replace(/\D/g, "").slice(0, CODE_LENGTH);
    return Array.from({ length: CODE_LENGTH }, (_, index) => cleaned[index] || "");
  }, [securityForm.otp]);

  const setDigit = (index: number, next: string) => {
    const typed = next.replace(/\D/g, "");
    const cleaned = securityForm.otp.replace(/\D/g, "").slice(0, CODE_LENGTH).split("");
    if (typed.length > 1) {
      setSecurityForm((current) => ({ ...current, otp: typed.slice(0, CODE_LENGTH) }));
      setOtpVerified(false);
      inputs.current[Math.min(typed.length, CODE_LENGTH - 1)]?.focus();
      return;
    }
    cleaned[index] = typed;
    setSecurityForm((current) => ({ ...current, otp: cleaned.join("").slice(0, CODE_LENGTH) }));
    setOtpVerified(false);
    if (typed && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  // Backspace on an empty box steps back, which is what people expect here.
  const handleKeyPress = (index: number, key: string) => {
    if (key !== "Backspace" || digits[index] || index === 0) return;
    const cleaned = securityForm.otp.replace(/\D/g, "").split("");
    cleaned[index - 1] = "";
    setSecurityForm((current) => ({ ...current, otp: cleaned.join("") }));
    setOtpVerified(false);
    inputs.current[index - 1]?.focus();
  };

  const expired = otpExpiry <= 0;
  const goBack = () => openProfileModal("change-password");

  // Verified means there is nothing left to type here, so hand the form back.
  useEffect(() => {
    if (otpVerified) openProfileModal("change-password");
  }, [otpVerified]);

  return (
    <SafeAreaView style={styles.otpScreenPage}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.otpScreenScroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.otpScreenContent}>
          <Pressable style={styles.otpScreenBack} onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back">
            <ChevronLeft size={18} color="#64748b" />
            <Text style={styles.otpScreenBackText}>Back</Text>
          </Pressable>

          <View style={styles.otpScreenBadge}>
            <Lock size={20} color={theme.colors.emerald} />
          </View>
          <Text style={styles.otpScreenTitle}>Enter Verification Code</Text>
          <Text style={styles.otpScreenSubtitle}>
            We sent a 6-digit verification code to{"\n"}
            <Text style={styles.otpScreenEmail}>{profile?.email || user?.email || "your email"}</Text>
          </Text>

          <View style={styles.otpScreenBoxes}>
            {digits.map((digit, index) => (
              <TextInput
                key={index}
                ref={(node) => {
                  inputs.current[index] = node;
                }}
                style={[
                  styles.otpScreenBox,
                  digit ? styles.otpScreenBoxFilled : null,
                  error ? styles.otpScreenBoxError : null,
                ]}
                value={digit}
                onChangeText={(next) => setDigit(index, next)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                selectTextOnFocus
                editable={!expired && !verifyingOtp}
                placeholder={String(index + 1)}
                placeholderTextColor="#cbd5e1"
                accessibilityLabel={`Verification code digit ${index + 1}`}
              />
            ))}
          </View>

          {expired ? (
            <Text style={styles.otpScreenExpired}>Verification code has expired</Text>
          ) : (
            <Text style={styles.otpScreenCountdown}>Code expires in {formatOtpCountdown(otpExpiry)}</Text>
          )}

          {error ? <Text style={styles.otpScreenError}>{error}</Text> : null}

          <Pressable
            style={[
              styles.otpScreenVerify,
              verifyingOtp || securityForm.otp.length < CODE_LENGTH || expired ? styles.otpScreenVerifyDisabled : null,
            ]}
            onPress={handleVerifyOtp}
            disabled={verifyingOtp || securityForm.otp.length < CODE_LENGTH || expired}
            accessibilityRole="button"
          >
            <Text style={styles.otpScreenVerifyText}>{verifyingOtp ? "Verifying Code..." : "Verify Code"}</Text>
          </Pressable>

          {sendingOtp ? (
            <Text style={styles.otpScreenResendWaiting}>Sending...</Text>
          ) : otpResendCooldown > 0 ? (
            <Text style={styles.otpScreenResendWaiting}>Resend code in {otpResendCooldown}s</Text>
          ) : (
            <Pressable
              onPress={() => void handleRequestOtp()}
              accessibilityRole="button"
              accessibilityLabel="Resend verification code"
            >
              <Text style={styles.otpScreenResend}>Resend Code</Text>
            </Pressable>
          )}

          <Pressable onPress={goBack} accessibilityRole="button">
            <Text style={styles.otpScreenCancel}>Back to Change Password</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
