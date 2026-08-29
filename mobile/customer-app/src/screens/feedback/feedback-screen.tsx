// Extracted from App.tsx during the Phase 0 split.
// Rewritten for web parity in the per-screen phases.
import React from "react";
import { Pressable, Text, View } from "react-native";
import { formatDate } from "../../lib/format";
import { styles } from "../../styles/app-styles";
import { useCustomerPortal } from "../../portal/portal-context";

export function FeedbackScreen() {
  const {
    feedbackItems,
    feedbackRatingValue,
    setFeedbackRatingValue,
    selectedFeedbackOptions,
    setSelectedFeedbackOptions,
    submittingFeedback,
    handleSubmitFeedback,
    feedbackOrder,
    currentFeedback,
    visibleFeedbackOptions,
  } = useCustomerPortal();

  return (
    <>
      <>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Order feedback</Text>
          {feedbackOrder ? (
            <>
              <Text style={styles.featureTitle}>{feedbackOrder.orderNumber}</Text>
              <Text style={styles.subtle}>Status: {feedbackOrder.status}</Text>
              {currentFeedback ? (
                <View style={styles.feedbackHistoryCard}>
                  <Text style={styles.listTitle}>Submitted review</Text>
                  <Text style={styles.subtle}>Rating: {currentFeedback.rating}/5</Text>
                  <Text style={styles.bodyText}>{currentFeedback.message || "No feedback message."}</Text>
                  <Text style={styles.subtle}>Submitted: {formatDate(currentFeedback.createdAt)}</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.subtle}>Rate delivery, then select at least one required feedback reason.</Text>
                  <View style={styles.ratingRow}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <Pressable
                        key={value}
                        style={[styles.ratingButton, feedbackRatingValue >= value ? styles.ratingButtonActive : null]}
                        onPress={() => {
                          setFeedbackRatingValue(value);
                          setSelectedFeedbackOptions([]);
                        }}
                      >
                        <Text style={[styles.ratingButtonText, feedbackRatingValue >= value ? styles.ratingButtonTextActive : null]}>
                          {value}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.feedbackOptionsCard}>
                    {visibleFeedbackOptions.map((option) => {
                      const selected = selectedFeedbackOptions.includes(option);
                      return (
                        <Pressable
                          key={option}
                          style={[styles.feedbackOptionRow, selected ? styles.feedbackOptionRowActive : null]}
                          onPress={() =>
                            setSelectedFeedbackOptions((current) =>
                              selected ? current.filter((item) => item !== option) : [...current, option]
                            )
                          }
                        >
                          <Text style={[styles.feedbackOptionText, selected ? styles.feedbackOptionTextActive : null]}>{option}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable
                    style={[styles.primaryButton, selectedFeedbackOptions.length === 0 ? { opacity: 0.5 } : null]}
                    onPress={handleSubmitFeedback}
                    disabled={submittingFeedback || selectedFeedbackOptions.length === 0}
                  >
                    <Text style={styles.primaryButtonText}>{submittingFeedback ? "Submitting..." : "Submit Review"}</Text>
                  </Pressable>
                </>
              )}
            </>
          ) : (
            <Text style={styles.subtle}>Select a delivered order from Orders to open feedback.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Feedback history</Text>
          {feedbackItems.length === 0 ? <Text style={styles.subtle}>No feedback submitted yet.</Text> : null}
          {feedbackItems.map((item) => (
            <View key={item.id} style={styles.feedbackHistoryCard}>
              <Text style={styles.listTitle}>{item.subject || "Order Review"}</Text>
              <Text style={styles.subtle}>Rating: {item.rating}/5</Text>
              <Text style={styles.bodyText}>{item.message || "No feedback message."}</Text>
              <Text style={styles.subtle}>Submitted: {formatDate(item.createdAt)}</Text>
            </View>
          ))}
        </View>
      </>
    </>
  );
}
