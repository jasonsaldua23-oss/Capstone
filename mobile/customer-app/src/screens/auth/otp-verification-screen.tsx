// Email verification, as its own page rather than a modal.
//
// The web portal shows this as a dialog (shared/otp-verification-modal.tsx), but on
// the phone a dialog stacked over the sign-up form left the code boxes fighting the
// keyboard for room, so here it replaces the auth card entirely and returns to the
// form on Back. The chrome still follows the web modal: lock badge, the destination
// address called out, six rounded-square code boxes numbered 1-6, an expiry
// countdown, and a resend held behind its own cooldown.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { ChevronLeft, Lock } from "lucide-react-native";
import { OTP_EXPIRY_SECONDS, OTP_RESEND_COOLDOWN_SECONDS, formatOtpCountdown } from "../../lib/shared";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

const CODE_LENGTH = 6;

type OtpVerificationScreenProps = {
  email: string;
  value: string;
  onChange: (value: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
  verifying?: boolean;
  resending?: boolean;
  error?: string | null;
  /** Bumped by the caller each time a code is sent, to restart both countdowns. */
  sentAt?: number;
};

export function OtpVerificationScreen({
  email,
  value,
  onChange,
  onVerify,
  onResend,
  onBack,
  verifying = false,
  resending = false,
  error,
  sentAt = 0,
}: OtpVerificationScreenProps) {
  const [expiresIn, setExpiresIn] = useState(OTP_EXPIRY_SECONDS);
  const [resendIn, setResendIn] = useState(OTP_RESEND_COOLDOWN_SECONDS);
  const inputs = useRef<Array<TextInput | null>>([]);

  // Mounting means a code was just sent; resending restarts both clocks.
  useEffect(() => {
    setExpiresIn(OTP_EXPIRY_SECONDS);
    setResendIn(OTP_RESEND_COOLDOWN_SECONDS);
  }, [sentAt]);

  useEffect(() => {
    const timer = setInterval(() => {
      setExpiresIn((current) => (current > 0 ? current - 1 : 0));
      setResendIn((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const focus = setTimeout(() => inputs.current[0]?.focus(), 120);
    return () => clearTimeout(focus);
  }, []);

  const digits = useMemo(() => {
    const cleaned = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    return Array.from({ length: CODE_LENGTH }, (_, index) => cleaned[index] || "");
  }, [value]);

  const filled = digits.filter(Boolean).length;
  const expired = expiresIn <= 0;
  const canVerify = filled === CODE_LENGTH && !verifying && !expired;

  // One box takes one digit; a paste of the whole code fills the rest.
  const setDigit = (index: number, next: string) => {
    const typed = next.replace(/\D/g, "");
    const cleaned = value.replace(/\D/g, "").slice(0, CODE_LENGTH).split("");
    if (typed.length > 1) {
      onChange(typed.slice(0, CODE_LENGTH));
      inputs.current[Math.min(typed.length, CODE_LENGTH - 1)]?.focus();
      return;
    }
    if (typed.length === 0) {
      cleaned[index] = "";
      onChange(cleaned.join("").slice(0, CODE_LENGTH));
      return;
    }
    cleaned[index] = typed;
    onChange(cleaned.join("").slice(0, CODE_LENGTH));
    if (index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  // Backspace on an empty box steps back, which is what people expect here.
  const handleKeyPress = (index: number, key: string) => {
    if (key !== "Backspace" || digits[index] || index === 0) return;
    const cleaned = value.replace(/\D/g, "").split("");
    cleaned[index - 1] = "";
    onChange(cleaned.join(""));
    inputs.current[index - 1]?.focus();
  };

  return (
    <SafeAreaView style={styles.otpScreenPage}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.otpScreenScroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.otpScreenContent}>
          <Pressable style={styles.otpScreenBack} onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back">
            <ChevronLeft size={18} color="#64748b" />
            <Text style={styles.otpScreenBackText}>Back</Text>
          </Pressable>

          <View style={styles.otpScreenBadge}>
            <Lock size={20} color={theme.colors.emerald} />
          </View>
          <Text style={styles.otpScreenTitle}>Enter Verification Code</Text>
          <Text style={styles.otpScreenSubtitle}>
            We sent a 6-digit verification code to{"\n"}
            <Text style={styles.otpScreenEmail}>{email}</Text>
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
                editable={!expired && !verifying}
                placeholder={String(index + 1)}
                placeholderTextColor="#cbd5e1"
                accessibilityLabel={`Verification code digit ${index + 1}`}
              />
            ))}
          </View>

          <Text style={expired ? styles.otpScreenExpired : styles.otpScreenCountdown}>
            {expired ? "Verification code has expired" : `Code expires in ${formatOtpCountdown(expiresIn)}`}
          </Text>

          {error ? <Text style={styles.otpScreenError}>{error}</Text> : null}

          <Pressable
            style={[styles.otpScreenVerify, !canVerify && styles.otpScreenVerifyDisabled]}
            onPress={onVerify}
            disabled={!canVerify}
            accessibilityRole="button"
          >
            <Text style={styles.otpScreenVerifyText}>{verifying ? "Verifying..." : "Verify Code"}</Text>
          </Pressable>

          <Pressable
            onPress={onResend}
            disabled={resendIn > 0 || resending}
            accessibilityRole="button"
            accessibilityLabel="Resend verification code"
          >
            <Text style={resendIn > 0 || resending ? styles.otpScreenResendWaiting : styles.otpScreenResend}>
              {resending ? "Sending..." : resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
            </Text>
          </Pressable>

          <Pressable onPress={onBack} accessibilityRole="button">
            <Text style={styles.otpScreenCancel}>Back to sign up</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
