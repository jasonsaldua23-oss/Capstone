// Mirrors src/components/portals/customer/sections/orders/rating-dialog.tsx:
// star rating, a feedback-option set that changes with the rating, and a success
// line before the dialog closes itself.
import { CheckCircle2, Star, X } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";

import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

// Replacement reviews rate how the claim was handled, not the original delivery, so
// they get their own checkbox options per star — the same set the web uses.
const REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING: Record<number, string[]> = {
  1: ["Issue was not resolved", "Replacement arrived damaged", "Very slow handling", "Poor communication"],
  2: ["Resolution was incomplete", "Redelivery was delayed", "Updates were unclear", "Replacement quality issue"],
  3: ["Issue was resolved", "Handling time was acceptable", "Updates could improve", "Replacement was acceptable"],
  4: ["Fast replacement handling", "Good replacement condition", "Clear status updates", "Smooth redelivery"],
  5: ["Excellent replacement service", "Perfect replacement condition", "Very fast resolution", "Excellent communication"],
};

const FEEDBACK_OPTIONS_BY_RATING: Record<number, string[]> = {
  1: ["Missing items", "Damaged unit", "Wrong order", "Poor driver attitude"],
  2: ["Packaging issue", "Incomplete order", "Hard to contact driver", "Item condition problem"],
  3: ["Minor packaging issue", "Communication could improve", "Acceptable service", "Minor inconvenience"],
  4: ["Friendly driver", "Good unit", "Accurate order", "Smooth transaction"],
  5: ["Professional driver", "Perfect packaging", "Complete order", "Great overall experience"],
};

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
  } = useCustomerPortal();

  // A replacement order under review switches both the copy and the option set.
  const isReplacementReview = Boolean((ratingDialogOrder as any)?.isReplacementReview);

  const [showSuccess, setShowSuccess] = useState(false);
  const [selectedFeedbackOptions, setSelectedFeedbackOptions] = useState<string[]>([]);

  const visibleFeedbackOptions = useMemo(
    () => {
      const options = isReplacementReview ? REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING : FEEDBACK_OPTIONS_BY_RATING;
      return options[Math.max(1, Math.min(5, Math.round(deliveryRatingValue || 0)))] || [];
    },
    [deliveryRatingValue, isReplacementReview]
  );

  const close = () => {
    setRatingDialogOrder(null);
    setSelectedFeedbackOptions([]);
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
              return (
                <Pressable
                  key={option}
                  style={[styles.ratingOption, selected ? styles.ratingOptionActive : null]}
                  onPress={() =>
                    setSelectedFeedbackOptions((current) =>
                      selected ? current.filter((item) => item !== option) : [...current, option]
                    )
                  }
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
          {selectedFeedbackOptions.length === 0 ? (
            <Text style={styles.ratingHint}>Select at least one feedback option to submit your review.</Text>
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
