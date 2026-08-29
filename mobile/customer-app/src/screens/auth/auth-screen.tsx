// Extracted from App.tsx during the Phase 0 split.
// Customer login and registration.
import React from "react";
import { Check, Eye, EyeOff, Leaf, Lock, Mail } from "lucide-react-native";
import { ActivityIndicator, Image, ImageBackground, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ModalShell } from "../../components/ui/modal-shell";
import { LinearGradient } from "expo-linear-gradient";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";
import { useCustomerPortal } from "../../portal/portal-context";

export function AuthScreen() {
  const {
    loading,
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
    verifyingEmailOtp,
    error,
    setError,
    rememberMe,
    setRememberMe,
    orders,
    securityForm,
    setSecurityForm,
    sendingOtp,
    verifyingOtp,
    resettingPassword,
    otpVerified,
    setOtpVerified,
    handleLogin,
    handleRequestRegistrationOtp,
    handleVerifyRegistrationOtp,
    handleRegister,
    resetSecurityState,
    handleRequestOtp,
    handleVerifyOtp,
    handleChangePassword,
    width,
  } = useCustomerPortal();

  return (
    <>
      <ImageBackground
        source={require("../../../../../public/customer-login-bg.png")}
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
            <Image source={require("../../../../../public/aab-trading-shop.png")} style={styles.authLogo} resizeMode="contain" />
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
                <Text style={styles.secondaryButtonText}>{emailVerificationToken ? "Verified" : sendingEmailOtp ? "Sending..." : "Send Verification OTP"}</Text>
              </Pressable>
              {!emailVerificationToken && emailOtp.length === 6 ? (
                <Pressable style={styles.secondaryButtonCompact} onPress={handleVerifyRegistrationOtp} disabled={verifyingEmailOtp}>
                  <Text style={styles.secondaryButtonText}>{verifyingEmailOtp ? "Verifying Code..." : "Verify Code"}</Text>
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
              {loading ? <ActivityIndicator size="small" color={theme.colors.white} /> : null}
              <Text style={styles.authPrimaryButtonText}>
                {authMode === "login" ? "Log In" : "Create Account"}
              </Text>
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
          onClose={() => {
            setForgotPasswordVisible(false);
            resetSecurityState();
          }}
        >
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
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
              <Text style={styles.secondaryButtonText}>{sendingOtp ? "Sending..." : otpVerified ? "Resend Verification OTP" : "Send Verification OTP"}</Text>
            </Pressable>
          </View>
          <Pressable style={styles.modalOutlineButton} onPress={handleVerifyOtp} disabled={verifyingOtp || securityForm.otp.length !== 6}>
            <Text style={styles.outlineButtonText}>{verifyingOtp ? "Verifying Code..." : "Verify Code"}</Text>
          </Pressable>
          <TextInput style={styles.input} value={securityForm.newPassword} onChangeText={(value) => setSecurityForm((current) => ({ ...current, newPassword: value }))} secureTextEntry placeholder="New password" />
          <TextInput style={styles.input} value={securityForm.confirmPassword} onChangeText={(value) => setSecurityForm((current) => ({ ...current, confirmPassword: value }))} secureTextEntry placeholder="Confirm password" />
          {!!error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.primaryButton, !otpVerified || resettingPassword ? styles.disabledButton : null]} onPress={handleChangePassword} disabled={!otpVerified || resettingPassword}>
            <Text style={styles.primaryButtonText}>{resettingPassword ? "Updating..." : "Reset Password"}</Text>
          </Pressable>
        </ModalShell>
      </ImageBackground>
    </>
  );
}
