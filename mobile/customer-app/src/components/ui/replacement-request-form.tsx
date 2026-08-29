// Mirrors the Request Replacement dialog in
// src/components/portals/customer/sections/orders/order-detail-page.tsx:
// one block per product, By Unit / By Bottle toggle, product and reason pickers,
// a quantity capped by what was ordered, and up to two evidence photos.
import { Upload } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
  DAMAGE_REASON_OPTIONS,
  MAX_EVIDENCE_PHOTOS,
  buildReplacementRequest,
  getMaxReplacementQtyForLine,
  getReplacementOptionLabel,
  getSelectableItemsForLine,
  getSelectableReplacementItems,
  getSelectedReplacementItem,
  newReplacementLine,
  type ReplacementLine,
  type SelectableReplacementItem,
} from "../../lib/shared";
import { resolveImageUrl } from "../../lib/format";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

function OptionSheet({
  visible,
  title,
  options,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.categorySheetOverlay} onPress={onClose}>
        <Pressable style={styles.categorySheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.categorySheetTitle}>{title}</Text>
          <ScrollView>
            {options.map((option) => (
              <Pressable
                key={option.value}
                style={styles.categorySheetOption}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                accessibilityRole="button"
              >
                <Text style={styles.categorySheetOptionText}>{option.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ReplacementRequestForm({
  order,
  evidence,
  uploadingEvidence,
  onPickEvidence,
  onRemoveEvidence,
  submitting,
  blockedMessage,
  onSubmit,
}: {
  order: any;
  evidence: string[];
  uploadingEvidence: boolean;
  onPickEvidence: () => void;
  onRemoveEvidence: (url: string) => void;
  submitting: boolean;
  blockedMessage: string | null;
  onSubmit: (built: ReturnType<typeof buildReplacementRequest>) => void;
}) {
  const [lines, setLines] = useState<ReplacementLine[]>([newReplacementLine("line-1")]);
  const [error, setError] = useState("");
  const [openPicker, setOpenPicker] = useState<{ kind: "product" | "reason"; key: string } | null>(null);

  const selectableItems: SelectableReplacementItem[] = useMemo(
    () => getSelectableReplacementItems(order),
    [order]
  );

  const updateLine = (key: string, patch: Partial<ReplacementLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const activeLine = openPicker ? lines.find((l) => l.key === openPicker.key) : undefined;

  return (
    <>
      <Text style={styles.replacementHint}>Select one or more products and set reason per product.</Text>
      {blockedMessage ? <Text style={styles.replacementBlocked}>{blockedMessage}</Text> : null}
      {error ? <Text style={styles.replacementError}>{error}</Text> : null}

      {lines.map((line, index) => {
        const selected = getSelectedReplacementItem(selectableItems, line.productId);
        const isComponent = Boolean(selected?.component);
        const maxQty = Math.max(getMaxReplacementQtyForLine(selectableItems, line), 1);
        return (
          <View key={line.key} style={styles.replacementLineCard}>
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.replacementLineTitle}>Product #{index + 1}</Text>
              <Pressable
                disabled={lines.length <= 1}
                onPress={() => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== line.key) : prev))}
                accessibilityRole="button"
              >
                <Text style={[styles.replacementRemove, lines.length <= 1 ? styles.disabledButton : null]}>Remove</Text>
              </Pressable>
            </View>

            <View style={styles.replacementModeToggle}>
              <Pressable
                style={[styles.replacementModeButton, line.inputMode === "case" ? styles.replacementModeButtonActive : null]}
                disabled={isComponent}
                onPress={() => updateLine(line.key, { inputMode: "case" })}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.replacementModeText,
                    line.inputMode === "case" ? styles.replacementModeTextActive : null,
                    isComponent ? styles.disabledButton : null,
                  ]}
                >
                  By Unit
                </Text>
              </Pressable>
              <Pressable
                style={[styles.replacementModeButton, line.inputMode === "bottle" ? styles.replacementModeButtonActive : null]}
                onPress={() => updateLine(line.key, { inputMode: "bottle" })}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.replacementModeText,
                    line.inputMode === "bottle" ? styles.replacementModeTextActive : null,
                  ]}
                >
                  By Bottle
                </Text>
              </Pressable>
            </View>

            <Text style={styles.replacementFieldLabel}>Product</Text>
            <Pressable
              style={styles.replacementSelect}
              onPress={() => setOpenPicker({ kind: "product", key: line.key })}
              accessibilityRole="button"
              accessibilityLabel={`Replacement product ${index + 1}`}
            >
              <Text style={styles.replacementSelectText} numberOfLines={1}>
                {selected ? getReplacementOptionLabel(selected) : "Select product"}
              </Text>
            </Pressable>

            <Text style={styles.replacementFieldLabel}>Quantity</Text>
            <TextInput
              style={styles.replacementInput}
              value={line.quantity}
              keyboardType="number-pad"
              onChangeText={(next) => {
                if (!next) {
                  updateLine(line.key, { quantity: "" });
                  return;
                }
                const parsed = Number(next.replace(/\D/g, ""));
                if (!Number.isFinite(parsed)) return;
                updateLine(line.key, { quantity: String(Math.min(Math.max(Math.floor(parsed), 1), maxQty)) });
              }}
            />

            <Text style={styles.replacementFieldLabel}>Reason</Text>
            <Pressable
              style={styles.replacementSelect}
              onPress={() => setOpenPicker({ kind: "reason", key: line.key })}
              accessibilityRole="button"
              accessibilityLabel={`Replacement reason ${index + 1}`}
            >
              <Text style={styles.replacementSelectText}>{line.reason}</Text>
            </Pressable>

            {line.reason === "Other" ? (
              <TextInput
                style={[styles.replacementInput, styles.replacementTextarea]}
                value={line.description}
                onChangeText={(value) => updateLine(line.key, { description: value })}
                placeholder="Describe the issue for this product"
                placeholderTextColor={theme.colors.textFaint}
                multiline
              />
            ) : null}
          </View>
        );
      })}

      <Pressable
        style={styles.replacementAddButton}
        onPress={() => setLines((prev) => [...prev, newReplacementLine(`line-${Date.now()}-${prev.length + 1}`)])}
        accessibilityRole="button"
      >
        <Text style={styles.replacementAddButtonText}>Add Product</Text>
      </Pressable>

      <Pressable
        style={styles.replacementUploadButton}
        onPress={onPickEvidence}
        disabled={uploadingEvidence || evidence.length >= MAX_EVIDENCE_PHOTOS}
        accessibilityRole="button"
      >
        <Upload size={14} color={theme.colors.textBody} />
        <Text style={styles.replacementUploadText}>
          {uploadingEvidence ? "Uploading..." : "Upload Evidence (Photo)"}
        </Text>
      </Pressable>
      <Text style={styles.replacementEvidenceCount}>
        {evidence.length} / {MAX_EVIDENCE_PHOTOS} photo(s) selected
      </Text>
      {evidence.length > 0 ? (
        <View style={styles.evidenceRow}>
          {evidence.map((url) => (
            <Pressable key={url} onPress={() => onRemoveEvidence(url)} accessibilityRole="button">
              <Image source={{ uri: resolveImageUrl(url) }} style={styles.evidenceImage} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable
        style={[styles.primaryButton, submitting || blockedMessage ? styles.disabledButton : null]}
        disabled={submitting || Boolean(blockedMessage)}
        onPress={() => {
          try {
            setError("");
            onSubmit(buildReplacementRequest(selectableItems, lines));
            setLines([newReplacementLine("line-1")]);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to submit replacement request");
          }
        }}
        accessibilityRole="button"
      >
        <Text style={styles.primaryButtonText}>Submit</Text>
      </Pressable>

      <OptionSheet
        visible={openPicker?.kind === "product"}
        title="Select product"
        options={
          activeLine
            ? getSelectableItemsForLine(selectableItems, lines, activeLine.key).map((entry) => ({
                value: entry.selectionId,
                label: getReplacementOptionLabel(entry),
              }))
            : []
        }
        onSelect={(value) => {
          if (!activeLine) return;
          const picked = getSelectedReplacementItem(selectableItems, value);
          updateLine(activeLine.key, {
            productId: value,
            inputMode: picked?.component ? "bottle" : activeLine.inputMode,
            quantity: "1",
          });
        }}
        onClose={() => setOpenPicker(null)}
      />
      <OptionSheet
        visible={openPicker?.kind === "reason"}
        title="Reason"
        options={DAMAGE_REASON_OPTIONS.map((reason) => ({ value: reason, label: reason }))}
        onSelect={(value) => activeLine && updateLine(activeLine.key, { reason: value })}
        onClose={() => setOpenPicker(null)}
      />
    </>
  );
}
