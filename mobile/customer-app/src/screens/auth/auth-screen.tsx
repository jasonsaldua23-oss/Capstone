// Extracted from App.tsx during the Phase 0 split.
// Customer login and registration.
import React, { useEffect, useState } from "react";
import { Check, Eye, EyeOff, Leaf, Lock, Mail } from "lucide-react-native";
import { ActivityIndicator, Image, ImageBackground, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ModalShell } from "../../components/ui/modal-shell";
import { OtpVerificationScreen } from "./otp-verification-screen";
import { GoogleSignInButton } from "../../components/ui/google-sign-in-button";
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
    otpExpiry,
    sendingOtp,
    verifyingOtp,
    resettingPassword,
    otpVerified,
    setOtpVerified,
    handleLogin,
    handleGoogleCredential,
    handleRequestRegistrationOtp,
    handleVerifyRegistrationOtp,
    handleRegister,
    resetSecurityState,
    handleRequestOtp,
    handleVerifyOtp,
    handleChangePassword,
    width,
  } = useCustomerPortal();

  const [otpPageVisible, setOtpPageVisible] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState(0);

  // Sending navigates to the verification page; the code is entered there, not on the
  // form and no longer in a modal over it. A rejected address keeps the user on the
  // form, where the reason is next to the field it belongs to.
  async function handleSendRegistrationOtp() {
    const sent = await handleRequestRegistrationOtp();
    if (!sent) return;
    setEmailOtp("");
    setOtpSentAt(Date.now());
    setOtpPageVisible(true);
  }

  async function handleVerifyFromOtpPage() {
    await handleVerifyRegistrationOtp();
  }

  // A verified address means the page is done; fall back to the form.
  useEffect(() => {
    if (emailVerificationToken) setOtpPageVisible(false);
  }, [emailVerificationToken]);


  // A page, not a modal: it takes over the screen and Back returns to the form.
  if (otpPageVisible) {
    return (
      <OtpVerificationScreen
        email={email.trim().toLowerCase()}
        value={emailOtp}
        onChange={setEmailOtp}
        onVerify={handleVerifyFromOtpPage}
        onResend={handleSendRegistrationOtp}
        onBack={() => setOtpPageVisible(false)}
        verifying={verifyingEmailOtp}
        resending={sendingEmailOtp}
        error={error}
        sentAt={otpSentAt}
      />
    );
  }

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
            <Text style={styles.authLabel}>
              Email{authMode === "register" ? <Text style={styles.authRequiredMark}> *</Text> : null}
            </Text>
            {/* Send OTP sits on its own row: beside the field it left barely 180px for
                the address, which cut real ones off mid-domain. */}
            <View style={styles.authIconInputWrap}>
              <Mail size={16} color="#697a96" strokeWidth={2} />
              <TextInput style={[styles.authIconInput, styles.authEmailInput]} value={email} onChangeText={(value) => { setEmail(value); setEmailVerificationToken(""); }} autoCapitalize="none" keyboardType="email-address" placeholder="Enter email address" placeholderTextColor="#8a99b3" />
            </View>
            {authMode === "register" ? (
              <Pressable
                style={[styles.authSendOtpButton, Boolean(emailVerificationToken) && styles.authSendOtpButtonDone]}
                onPress={emailVerificationToken ? undefined : handleSendRegistrationOtp}
                disabled={sendingEmailOtp || Boolean(emailVerificationToken)}
                accessibilityRole="button"
              >
                <Text style={styles.authSendOtpText}>
                  {emailVerificationToken ? "Verified" : sendingEmailOtp ? "Sending..." : "Send OTP"}
                </Text>
              </Pressable>
            ) : null}
          </View>
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
            <View style={[styles.authPrimaryButton, loading ? styles.disabledButton : null]}>
              {loading ? <ActivityIndicator size="small" color={theme.colors.white} /> : null}
              <Text style={styles.authPrimaryButtonText}>
                {authMode === "login" ? "Log In" : "Create Account"}
              </Text>
            </View>
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
              <GoogleSignInButton onCredential={handleGoogleCredential} onError={setError} disabled={loading} />
              <View style={styles.authSwitchRow}>
                <Text style={styles.authSwitchText}>Don&apos;t have an account? </Text>
                <Pressable onPress={() => { setAuthMode("register"); setError(null); }}>
                  <Text style={styles.authSwitchLink}>Register</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
            <View style={styles.continueDivider}>
              <View style={styles.dividerLine} />
              <View style={styles.continueLabel}>
                <Leaf size={13} color="#4aa13d" />
                <Text style={styles.continueLabelText}>OR CONTINUE WITH</Text>
              </View>
              <View style={styles.dividerLine} />
            </View>
            <GoogleSignInButton onCredential={handleGoogleCredential} onError={setError} disabled={loading} />
            <View style={styles.authSwitchRow}>
              <Text style={styles.authSwitchText}>Already have an account? </Text>
              <Pressable onPress={() => { setAuthMode("login"); setError(null); }}>
                <Text style={styles.authSwitchLink}>Log In</Text>
              </Pressable>
            </View>
            </>
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
              placeholder="Enter Verification Code"
            />
            <Pressable style={styles.secondaryButtonCompact} onPress={handleRequestOtp} disabled={sendingOtp}>
              {/* Resend once a code is outstanding — the label keyed off otpVerified, so it
                  read "Send" for a code already sent and "Resend" only after verifying. */}
              <Text style={styles.secondaryButtonText}>{sendingOtp ? "Sending..." : otpExpiry > 0 ? "Resend Verification OTP" : "Send Verification OTP"}</Text>
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
