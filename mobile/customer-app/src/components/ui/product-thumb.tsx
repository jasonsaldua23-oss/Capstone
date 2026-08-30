// A product thumbnail that degrades gracefully.
//
// resolveImageUrl() falls back to the company logo when a product has no image,
// which meant every image-less product pulled a 537KB PNG to fill a 40x40 box —
// and rendered as a broken-image icon whenever that host was unreachable. Products
// seeded with /images/products/... paths are worse: those files only exist in the
// Next.js public/ folder and 404 against the Django host, so the image never loads
// at all.
//
// Render a real image only when there is a real path, and fall back to a cheap
// local placeholder both when the path is missing and when the load fails.
import React, { useState } from "react";
import { Image, Text, View } from "react-native";
import { Package } from "lucide-react-native";
import { resolveImageUrl } from "../../lib/format";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

type ProductThumbProps = {
  uri?: string | null;
  name?: string | null;
  size?: number;
};

export function ProductThumb({ uri, name, size = 40 }: ProductThumbProps) {
  const [failed, setFailed] = useState(false);
  const path = String(uri || "").trim();
  const box = { width: size, height: size };

  if (!path || failed) {
    const initial = String(name || "").trim().charAt(0).toUpperCase();
    return (
      <View style={[styles.productThumbFallback, box]}>
        {initial ? (
          <Text style={styles.productThumbInitial}>{initial}</Text>
        ) : (
          <Package size={Math.round(size * 0.45)} color={theme.colors.textFaint} />
        )}
      </View>
    );
  }

  return (
    <Image
      source={{ uri: resolveImageUrl(path) }}
      style={[styles.productThumbImage, box]}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}
