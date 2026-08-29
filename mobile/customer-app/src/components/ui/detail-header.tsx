// Back affordance for pushed detail routes. The web portal puts a ghost
// ArrowLeft button beside the view title (see the customer track and
// order-detail views); this is the native equivalent.
import { ArrowLeft } from "lucide-react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export function DetailHeader({ title, subtitle }: { title: string; subtitle?: string | null }) {
  const { popRoute } = useCustomerPortal();

  return (
    <View style={styles.detailHeader}>
      <Pressable
        style={styles.detailHeaderBack}
        onPress={popRoute}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
      >
        <ArrowLeft size={16} color={theme.colors.text} />
      </Pressable>
      <View style={styles.flex}>
        <Text style={styles.detailHeaderTitle}>{title}</Text>
        {subtitle ? <Text style={styles.detailHeaderSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}
