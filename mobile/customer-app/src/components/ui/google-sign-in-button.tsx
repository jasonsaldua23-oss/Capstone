// Google sign-in for the customer app.
//
// The backend already verifies Google ID tokens (auth_customer_google) and the
// service call already existed (loginWithGoogle) — only the UI was missing, so the
// screen said "Google sign-in is not configured yet" while the credentials sat in
// the repo-root .env all along.
//
// expo-auth-session's useIdTokenAuthRequest is used rather than Google Identity
// Services because GIS is browser-only; this path works on web and native alike.
// It yields an id_token, which is exactly what the endpoint expects.
//
// The chrome deliberately mirrors the button the web portal gets from GIS
// (CustomerLoginPage.renderGoogleButton): type "standard", theme "outline",
// size "large", text "continue_with", shape "pill", logo_alignment "left",
// width capped at 340 and centred — i.e. a 40px-tall white pill with a 1px
// #dadce0 border, the four-colour G pinned to the left edge, and the label
// centred across the whole button in #3c4043.
import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import * as Google from "expo-auth-session/providers/google";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

// Required so the popup hands the result back to the app on web.
WebBrowser.maybeCompleteAuthSession();

// app.config.js resolves this from the app-local .env or the repo-root .env, so the
// button works without a second copy of the credential kept in sync by hand.
const CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
  String((Constants.expoConfig?.extra as { googleClientId?: string } | undefined)?.googleClientId || "");

// Google rejects any redirect_uri that is not registered on the OAuth client
// ("Error 400: redirect_uri_mismatch"), and the value depends on where the app is
// being served from: on web expo-auth-session derives it from the page origin
// (Linking.createURL("") with the trailing slash stripped, e.g. "http://localhost:8081"),
// on native from the app scheme. It is resolved once here and logged in development so
// the exact string to paste into Google Cloud Console -> Credentials -> the Web client
// -> "Authorized redirect URIs" is never a guess. Serving the app from a LAN IP or a
// deployed host changes it, and each origin has to be registered separately.
const REDIRECT_URI = makeRedirectUri();

if (__DEV__ && REDIRECT_URI) {
  console.info(`[google-sign-in] redirect_uri = ${REDIRECT_URI} (must be registered on the OAuth client)`);
}

// The official mark, at the 18px GIS uses for size "large".
function GoogleGlyph() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

type GoogleSignInButtonProps = {
  onCredential: (idToken: string) => void | Promise<void>;
  onError?: (message: string) => void;
  disabled?: boolean;
};

export function GoogleSignInButton({ onCredential, onError, disabled = false }: GoogleSignInButtonProps) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    // The button is also shown on the register screen; either way we only need identity.
    scopes: ["openid", "email", "profile"],
  });

  useEffect(() => {
    if (!response) return;

    if (response.type === "success") {
      const idToken = response.params?.id_token;
      if (idToken) void onCredential(idToken);
      return;
    }

    // Cancelling the popup is not a failure, but a rejection from Google used to be
    // swallowed here, which made the button look dead.
    if (response.type === "error") {
      const code = String(response.params?.error || response.error?.params?.error || "");
      onError?.(
        code === "redirect_uri_mismatch"
          ? `Google rejected this app's redirect URL. Add ${REDIRECT_URI} to the OAuth client's authorized redirect URIs.`
          : response.error?.description || "Google sign-in failed. Please try again.",
      );
    }
  }, [response]);

  // Without a client ID the prompt would open a Google error page, so say so instead.
  if (!CLIENT_ID) {
    return <Text style={styles.googleUnavailable}>Google sign-in is not configured yet.</Text>;
  }

  const busy = disabled || !request;

  return (
    <View style={styles.googleButtonRow}>
      <Pressable
        style={[styles.googleButton, busy && styles.googleButtonDisabled]}
        onPress={() => void promptAsync()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
      >
        {/* Absolutely placed, so the label stays centred on the button itself —
            what GIS does when logo_alignment is "left". */}
        <View style={styles.googleMark}>
          {busy && !request ? (
            <ActivityIndicator size="small" color={theme.colors.textSubtle} />
          ) : (
            <GoogleGlyph />
          )}
        </View>
        <Text style={styles.googleButtonText}>Continue with Google</Text>
      </Pressable>
    </View>
  );
}
