// Tap a damage or POD thumbnail to inspect it full-size.
//
// The web equivalent is shared/pod-image-preview.tsx, where clicking a thumbnail opens
// an enlarged view; this is the same affordance for the app. The enlarged view is a
// plain overlay rather than one of the portal's dialogs so the photo gets the whole
// screen, which is the point of opening it.
import React, { useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";

import { resolveImageUrl } from "../../lib/format";
import { styles } from "../../styles/app-styles";

export function ImagePreview({
  url,
  style,
  caption = "Tap to view full-size photo",
  accessibilityLabel = "Photo",
}: {
  url: string;
  style?: any;
  caption?: string;
  accessibilityLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const uri = resolveImageUrl(url);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Open full-size ${accessibilityLabel}`}
      >
        <Image source={{ uri }} style={style} resizeMode="cover" />
        {caption ? <Text style={styles.imagePreviewCaption}>{caption}</Text> : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.imagePreviewBackdrop}>
          <Pressable
            style={styles.imagePreviewClose}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
          >
            <X size={20} color="#ffffff" />
          </Pressable>
          {/* Tapping the backdrop closes, the way the web dialog does. */}
          <Pressable style={styles.imagePreviewFill} onPress={() => setOpen(false)}>
            <Image source={{ uri }} style={styles.imagePreviewImage} resizeMode="contain" />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
