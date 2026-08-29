// Mirrors src/components/portals/shared/welcome-popup.tsx as the customer portal
// configures it: emerald panel, slate title, close button in the corner.
import { X } from "lucide-react-native";
import React from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export function WelcomePopup({
  open,
  message,
  subtitle,
  onClose,
}: {
  open: boolean;
  message: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.welcomeOverlay}>
        <View style={styles.welcomePanel}>
          <View style={styles.welcomePanelRow}>
            <View style={styles.flex}>
              <Text style={styles.welcomeTitle}>{message}</Text>
              <Text style={styles.welcomeSubtitle}>{subtitle}</Text>
            </View>
            <Pressable
              style={styles.welcomeCloseButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close welcome popup"
              hitSlop={8}
            >
              <X size={16} color={theme.colors.emeraldDark} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
