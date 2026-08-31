// Native equivalent of the web portal's <Skeleton> and PortalProductGridSkeleton
// (src/components/portals/shared/loading-skeletons.tsx). Tailwind's animate-pulse
// is reproduced with a looping opacity animation.
import React, { useEffect, useRef } from "react";
import { Animated, View, type ViewStyle } from "react-native";

import { USE_NATIVE_DRIVER } from "../../lib/motion";

import { styles } from "../../styles/app-styles";

export function Skeleton({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 500, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: USE_NATIVE_DRIVER }),
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

// Mirrors PortalCardsSkeleton: the loading state for the order and request lists.
export function CardsSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <View style={styles.cardsSkeletonWrap}>
      {Array.from({ length: cards }).map((_, index) => (
        <View key={`card-skeleton-${index}`} style={styles.cardsSkeletonCard}>
          <Skeleton style={styles.cardsSkeletonLineLg} />
          <Skeleton style={styles.cardsSkeletonLineMd} />
          <Skeleton style={styles.cardsSkeletonLineSm} />
        </View>
      ))}
    </View>
  );
}

// Mirrors PortalTimelineSkeleton: the Delivery Journey loading state.
export function TimelineSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <View style={styles.timelineSkeletonWrap}>
      {Array.from({ length: rows }).map((_, index) => (
        <View key={`timeline-skeleton-${index}`} style={styles.timelineSkeletonRow}>
          <Skeleton style={styles.timelineSkeletonDot} />
          <View style={styles.flex}>
            <Skeleton style={styles.timelineSkeletonLineLg} />
            <Skeleton style={styles.timelineSkeletonLineSm} />
          </View>
          <Skeleton style={styles.timelineSkeletonTime} />
        </View>
      ))}
    </View>
  );
}
