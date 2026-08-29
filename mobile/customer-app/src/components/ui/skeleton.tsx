// Native equivalent of the web portal's <Skeleton> and PortalProductGridSkeleton
// (src/components/portals/shared/loading-skeletons.tsx). Tailwind's animate-pulse
// is reproduced with a looping opacity animation.
import React, { useEffect, useRef } from "react";
import { Animated, View, type ViewStyle } from "react-native";

import { styles } from "../../styles/app-styles";

export function Skeleton({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return <Animated.View style={[styles.skeleton, style, { opacity: pulse }]} />;
}

export function ProductGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <View style={styles.productGrid}>
      {Array.from({ length: cards }).map((_, index) => (
        <View key={`product-skeleton-${index}`} style={styles.productSkeletonCard}>
          <Skeleton style={styles.productSkeletonImage} />
          <View style={styles.productSkeletonBody}>
            <Skeleton style={styles.productSkeletonLineLg} />
            <Skeleton style={styles.productSkeletonLineSm} />
            <Skeleton style={styles.productSkeletonLineMd} />
            <Skeleton style={styles.productSkeletonButton} />
          </View>
        </View>
      ))}
    </View>
  );
}
