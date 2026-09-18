// Mirrors src/components/portals/customer/sections/orders/rating-dialog.tsx:
// star rating, a feedback-option set that changes with the rating, and a success
// line before the dialog closes itself.
import { CheckCircle2, Star, X } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from "react-native";

import {
  MOBILE_DELIVERY_FEEDBACK_OPTIONS_BY_RATING as FEEDBACK_OPTIONS_BY_RATING,
  MOBILE_REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING as REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING,
  OTHER_REASON_MAX_LENGTH,
  OTHER_FEEDBACK_REASON,
  OTHER_REASON_LABEL,
  OTHER_REASON_PLACEHOLDER,
  getFeedbackOptionsForRating,
  isOtherFeedbackReason,
} from "../../lib/customer-logic";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

const RATING_LABELS: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Very Good",
  5: "Excellent!",
};

export function RatingDialog() {
  const {
    ratingDialogOrder,
    setRatingDialogOrder,
    deliveryRatingValue,
    setDeliveryRatingValue,
    submittingFeedback,
    submitRating,
    otherReasonText,
    setOtherReasonText,
  } = useCustomerPortal();

  // A replacement order under review switches both the copy and the option set.
  const isReplacementReview = Boolean((ratingDialogOrder as any)?.isReplacementReview);

  const [showSuccess, setShowSuccess] = useState(false);
  const [selectedFeedbackOptions, setSelectedFeedbackOptions] = useState<string[]>([]);

  const visibleFeedbackOptions = useMemo(
    () => getFeedbackOptionsForRating(
      isReplacementReview ? REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING : FEEDBACK_OPTIONS_BY_RATING,
      deliveryRatingValue
    ),
    [deliveryRatingValue, isReplacementReview]
  );

  const hasOtherSelected = selectedFeedbackOptions.some(isOtherFeedbackReason);
  // Describing the problem and ticking preset phrases are alternatives: a review that
  // says both cannot be attributed to either, so one disables the other.
  const canSubmitFeedback = hasOtherSelected
    ? otherReasonText.trim().length > 0
    : selectedFeedbackOptions.length > 0;

  const close = () => {
    setRatingDialogOrder(null);
    setSelectedFeedbackOptions([]);
    setOtherReasonText("");
    setShowSuccess(false);
  };

  const handleSubmit = async () => {
    const submitted = await submitRating(selectedFeedbackOptions);
    if (!submitted) return;
    setShowSuccess(true);
    setTimeout(close, 1500);
  };

  return (
    <Modal
      visible={Boolean(ratingDialogOrder)}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View style={styles.ratingOverlay}>
        <View style={styles.ratingPanel}>
          <Pressable
            style={styles.ratingClose}
            onPress={close}
            disabled={submittingFeedback}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <X size={18} color={theme.colors.textFaint} />
          </Pressable>

          <View style={styles.ratingHeaderRow}>
            <View style={styles.ratingHeaderIcon}>
              <Star size={18} color={theme.colors.emerald} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.ratingTitle}>
                Review {isReplacementReview ? "Replacement" : "Order"} {ratingDialogOrder?.orderNumber}
              </Text>
              <Text style={styles.ratingSubtitle}>
                Rate {isReplacementReview ? "replacement handling" : "delivery"}, then select feedback.
              </Text>
            </View>
          </View>

          <Text style={styles.ratingSectionLabel}>Delivery Rating</Text>
          <View style={styles.ratingStarsRow}>
            {[1, 2, 3, 4, 5].map((value) => {
              const filled = deliveryRatingValue >= value;
              return (
                <Pressable
                  key={value}
                  onPress={() => {
                    setDeliveryRatingValue(value);
                    setSelectedFeedbackOptions([]);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${value} star`}
                  hitSlop={4}
                >
                  <Star
                    size={30}
                    color={filled ? "#f59e0b" : theme.colors.slate300}
                    fill={filled ? "#f59e0b" : "transparent"}
                  />
                </Pressable>
              );
            })}
          </View>
          {deliveryRatingValue > 0 ? (
            <Text style={styles.ratingLabel}>{RATING_LABELS[deliveryRatingValue] || ""}</Text>
          ) : null}

          <Text style={styles.ratingSectionLabel}>Select Feedback</Text>
          <View style={styles.ratingOptionsWrap}>
            {visibleFeedbackOptions.map((option) => {
              const selected = selectedFeedbackOptions.includes(option);
              const isOther = isOtherFeedbackReason(option);
              const blocked = isOther
                ? selectedFeedbackOptions.length > 0 && !selected
                : hasOtherSelected;
              return (
                <Pressable
                  key={option}
                  style={[
                    styles.ratingOption,
                    selected ? styles.ratingOptionActive : null,
                    blocked ? styles.ratingOptionDisabled : null,
                  ]}
                  onPress={() => {
                    setSelectedFeedbackOptions((current) => {
                      if (selected) return current.filter((item) => item !== option);
                      // Other stands alone; picking it clears the preset phrases.
                      if (isOther) return [OTHER_FEEDBACK_REASON];
                      return [...current.filter((item) => !isOtherFeedbackReason(item)), option];
                    });
                    if (isOther && selected) setOtherReasonText("");
                  }}
                  disabled={blocked}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.ratingOptionText, selected ? styles.ratingOptionTextActive : null]}>
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {hasOtherSelected ? (
            <>
              <Text style={styles.otherReasonLabel}>{OTHER_REASON_LABEL}</Text>
              <TextInput
                style={styles.otherReasonInput}
                value={otherReasonText}
                onChangeText={setOtherReasonText}
                placeholder={OTHER_REASON_PLACEHOLDER}
                placeholderTextColor={theme.colors.slate300}
                maxLength={OTHER_REASON_MAX_LENGTH}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                editable={!submittingFeedback}
                autoFocus
              />
              <Text style={styles.otherReasonCounter}>
                {otherReasonText.length}/{OTHER_REASON_MAX_LENGTH}
              </Text>
            </>
          ) : null}

          {!canSubmitFeedback ? (
            <Text style={styles.ratingHint}>
              {hasOtherSelected
                ? "Describe what happened to submit your review."
                : "Select at least one feedback option to submit your review."}
            </Text>
          ) : null}

          {showSuccess ? (
            <View style={styles.ratingSuccess}>
              <CheckCircle2 size={16} color={theme.colors.emeraldDark} />
              <Text style={styles.ratingSuccessText}>Your feedback helps us improve our service</Text>
            </View>
          ) : null}

          <View style={styles.ratingActions}>
            <Pressable
              style={styles.ratingCancelButton}
              onPress={close}
              disabled={submittingFeedback}
              accessibilityRole="button"
            >
              <Text style={styles.ratingCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.ratingSubmitButton,
                submittingFeedback || deliveryRatingValue === 0 || selectedFeedbackOptions.length === 0
                  ? styles.disabledButton
                  : null,
              ]}
              disabled={submittingFeedback || deliveryRatingValue === 0 || selectedFeedbackOptions.length === 0}
              onPress={() => void handleSubmit()}
              accessibilityRole="button"
            >
              {submittingFeedback ? <ActivityIndicator size="small" color={theme.colors.white} /> : null}
              <Text style={styles.ratingSubmitText}>
                {submittingFeedback ? "Submitting..." : "Submit Review"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
