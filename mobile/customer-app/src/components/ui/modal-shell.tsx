// Extracted verbatim from App.tsx.
import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { styles } from "../../styles/app-styles";

export function ModalShell({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.flex}>
              <Text style={styles.modalTitle}>{title}</Text>
              <Text style={styles.subtle}>{subtitle}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.closeGlyph}>X</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}
