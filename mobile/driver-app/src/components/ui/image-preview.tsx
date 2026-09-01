// Tap a proof-of-delivery thumbnail to inspect it full-size.
//
// The web driver portal links the POD out to the full-size image ("View Delivery
// Photo"); a phone has nowhere to open that link to, so the app shows the same photo
// full-screen instead. This mirrors the customer app's ImagePreview, and the web
// equivalent in src/components/shared/pod-image-preview.tsx.
import React, { useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { API_BASE_URL } from "../../config/env";

function resolveUrl(value: string): string {
  const path = String(value || "").trim();
  if (!path) return "";
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function ImagePreview({
  url,
  style,
  caption = "View Delivery Photo",
  accessibilityLabel = "Photo",
}: {
  url: string;
  style?: any;
  caption?: string;
  accessibilityLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const uri = resolveUrl(url);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Open full-size ${accessibilityLabel}`}
      >
        <Image source={{ uri }} style={style} resizeMode="cover" />
        {caption ? <Text style={previewStyles.caption}>{caption}</Text> : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={previewStyles.backdrop}>
          <Pressable
            style={previewStyles.close}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
          >
            <Ionicons name="close" size={20} color="#ffffff" />
          </Pressable>
          {/* Tapping the backdrop closes, the way the web dialog does. */}
          <Pressable style={previewStyles.fill} onPress={() => setOpen(false)}>
            <Image source={{ uri }} style={previewStyles.image} resizeMode="contain" />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const previewStyles = StyleSheet.create({
  caption: { marginTop: 6, color: "#0369a1", fontSize: 12, fontFamily: "Poppins_600SemiBold" },
  backdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.94)" },
  fill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 12 },
  image: { width: "100%", height: "100%" },
  close: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 2,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
});
