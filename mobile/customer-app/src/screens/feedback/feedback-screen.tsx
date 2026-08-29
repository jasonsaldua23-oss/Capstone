// Mirrors src/components/portals/customer/sections/feedback/feedback-view.tsx.
// Submitting a review happens in the rating dialog, as on the web; this screen
// only lists what has already been sent.
import React from "react";
import { Text, View } from "react-native";

import { CardsSkeleton } from "../../components/ui/skeleton";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";

const TYPE_TONE: Record<string, { background: string; text: string }> = {
  COMPLAINT: { background: "#fee2e2", text: "#b91c1c" },
  SUGGESTION: { background: "#fef3c7", text: "#b45309" },
  COMPLIMENT: { background: "#dcfce7", text: "#15803d" },
};

export function FeedbackScreen() {
  const { feedbackItems, loading } = useCustomerPortal();

  return (
    <View style={styles.feedbackSection}>
      <View style={styles.feedbackIntroCard}>
        <Text style={styles.feedbackIntroTitle}>Your Feedback</Text>
        <Text style={styles.feedbackIntroText}>Use delivered orders to submit feedback.</Text>
      </View>

      {loading && feedbackItems.length === 0 ? (
        <CardsSkeleton cards={3} />
      ) : feedbackItems.length === 0 ? (
        <View style={styles.feedbackEmptyCard}>
          <Text style={styles.feedbackEmptyText}>No feedback submitted yet.</Text>
        </View>
      ) : (
        <View style={styles.feedbackList}>
          {feedbackItems.map((feedback) => {
            const type = String((feedback as any).type || "COMPLIMENT").toUpperCase();
            const tone = TYPE_TONE[type] || TYPE_TONE.COMPLIMENT;
            const rating = Math.max(0, Math.min(5, Number(feedback.rating || 0)));
            return (
              <View key={feedback.id} style={styles.feedbackCard}>
                <View style={styles.feedbackCardHead}>
                  <Text style={styles.feedbackCardTitle}>{feedback.subject}</Text>
                  <View style={[styles.feedbackTypeBadge, { backgroundColor: tone.background }]}>
                    <Text style={[styles.feedbackTypeText, { color: tone.text }]}>{type}</Text>
                  </View>
                </View>
                <Text style={styles.feedbackCardMessage}>{feedback.message}</Text>
                <View style={styles.feedbackCardFooter}>
                  <Text style={styles.feedbackCardMeta}>
                    {"★".repeat(rating)}
                    {"☆".repeat(5 - rating)} {rating}/5
                  </Text>
                  <Text style={styles.feedbackCardMeta}>
                    {feedback.createdAt ? new Date(feedback.createdAt).toLocaleDateString() : ""}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
