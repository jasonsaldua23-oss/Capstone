// Mirrors MixedCaseComponents in src/components/portals/shared/mixed-case-components.tsx.
// The two label helpers come from shared/customer-logic, so wording matches the web exactly.
import { Package } from "lucide-react-native";
import React from "react";
import { Image, Text, View } from "react-native";

import { getMixedCaseBottleQuantity, getMixedCaseComponentNameWithSize } from "../../lib/shared";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export function MixedCaseComponents({
  item,
  showImages = true,
  compact = false,
}: {
  item: any;
  showImages?: boolean;
  compact?: boolean;
}) {
  const components = Array.isArray(item?.components) ? item.components : [];
  if (components.length === 0) {
    return <Text style={styles.mixedCaseEmptyText}>No mixed-case products available.</Text>;
  }

  return (
    <View style={compact ? styles.mixedCaseListCompact : styles.mixedCaseList}>
      {components.map((component: any, index: number) => {
        const imageUrl = String(component?.product?.imageUrl || component?.imageUrl || "").trim();
        return (
          <View key={component?.id || component?.productId || index} style={styles.mixedCaseRow}>
            {showImages ? (
              <View style={[styles.mixedCaseThumb, compact ? styles.mixedCaseThumbCompact : null]}>
                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.mixedCaseThumbImage} resizeMode="cover" />
                ) : (
                  <Package size={16} color={theme.colors.textFaint} />
                )}
              </View>
            ) : null}
            <View style={styles.flex}>
              <Text style={compact ? styles.mixedCaseNameCompact : styles.mixedCaseName}>
                {getMixedCaseComponentNameWithSize(component)}
              </Text>
              <Text style={compact ? styles.mixedCaseQtyCompact : styles.mixedCaseQty}>
                {getMixedCaseBottleQuantity(component)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
