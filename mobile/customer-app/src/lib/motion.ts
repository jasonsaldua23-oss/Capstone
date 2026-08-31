import { Platform } from "react-native";

// react-native-web has no RCTAnimation native module, so every Animated call that
// asks for the native driver logs "Animated: `useNativeDriver` is not supported
// because the native animated module is missing" and silently falls back to the JS
// driver. The fallback is what actually runs the login and tab transitions in the
// web preview, and driving them from JS through the warning path makes them stutter.
//
// Ask for the native driver only where one exists. iOS and Android keep the
// off-thread animation; web gets a clean JS-driven animation with no warning.
export const USE_NATIVE_DRIVER = Platform.OS !== "web";
