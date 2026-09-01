// Restores EventEmitter.removeSubscription, which expo-location still calls on web.
//
// expo-location@18.1.6 (Expo SDK 53) resolves a web-specific emitter:
//
//   // expo-location/build/LocationEventEmitter.web.js
//   import { EventEmitter } from 'expo-modules-core';
//   export const LocationEventEmitter = new EventEmitter();
//
// but its shared LocationSubscribers.js still calls the legacy API:
//
//   LocationEventEmitter.removeSubscription(this.eventSubscription);
//
// expo-modules-core@2.5.0 dropped removeSubscription in favour of
// subscription.remove(), so the moment the last location watcher is unregistered
// the call throws "removeSubscription is not a function". That escapes into React,
// unmounts <App> through the error boundary, and leaves a blank white screen —
// which is exactly how the driver app failed after login on web.
//
// This is upstream's bug, not ours; the shim simply puts the removed method back,
// delegating to the replacement API. It is web-only so native behaviour is
// untouched, and it can be deleted once expo-location ships a build whose web
// emitter matches the API it calls.
//
// Import this before expo-location, i.e. at the very top of App.tsx.
import { Platform } from "react-native";
import { EventEmitter } from "expo-modules-core";

if (Platform.OS === "web") {
  const prototype = (EventEmitter as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (prototype && typeof prototype.removeSubscription !== "function") {
    prototype.removeSubscription = function removeSubscription(subscription: { remove?: () => void } | null) {
      subscription?.remove?.();
    };
  }
}

export {};
