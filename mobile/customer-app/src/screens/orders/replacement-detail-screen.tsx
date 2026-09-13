// Mirrors the replacement-details dialog in
// src/components/portals/customer/sections/orders/orders-view.tsx.
import { Boxes, CalendarDays, CircleAlert, Clock3, Hash, NotebookPen, Package2 } from "lucide-react-native";
import React from "react";
import { Image, Text, View } from "react-native";

import { Badge } from "../../components/ui/badge";
import { ImagePreview } from "../../components/ui/image-preview";
import { DetailHeader } from "../../components/ui/detail-header";
import { resolveImageUrl } from "../../lib/format";
import {
  parseReplacementMeta,
  getLinkedOrderForReplacementRecord,
  getReplacementDisplayQty,
  getReplacementDisplayStatus,
  getReplacementEvidenceUrls,
  getReplacementPod,
  getReplacementStatusTone,
  sanitizeReplacementText,
} from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

function DetailRow({
  Icon,
  label,
  value,
  emerald,
  withDot,
}: {
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  value: string;
  emerald?: boolean;
  withDot?: boolean;
}) {
  return (
    <View style={styles.replacementDetailRow}>
      <View style={emerald ? styles.replacementDetailIconEmerald : styles.replacementDetailIcon}>
        <Icon size={20} color={emerald ? theme.colors.emerald : theme.colors.slate500} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.replacementDetailLabel}>{label}</Text>
        <View style={styles.replacementDetailValueRow}>
          {withDot ? <View style={styles.replacementDetailDot} /> : null}
          <Text style={styles.replacementDetailValue}>{value}</Text>
        </View>
      </View>
    </View>
  );
}

export function ReplacementDetailScreen({ replacementId }: { replacementId: string }) {
  const { replacements, orders } = useCustomerPortal();

  const record = replacements.find((row) => String(row.id) === String(replacementId)) || null;
  if (!record) return null;

  const linkedOrder = getLinkedOrderForReplacementRecord(record, orders);
  const statusLabel = getReplacementDisplayStatus(record, linkedOrder);
  const evidenceUrls = getReplacementEvidenceUrls(record);
  const qtyLabel = getReplacementDisplayQty(record);
  const pod = getReplacementPod(record, linkedOrder);
  const reportedAt = record.createdAt ? new Date(record.createdAt).toLocaleString() : "N/A";
  // The API keeps the customer's note and the status history on the replacement's meta.
  const meta = parseReplacementMeta((record as any).notes);
  const claimNote = String(meta?.customerNotes || "").trim();
  const claimTimeline = (Array.isArray(meta?.statusTimeline) ? meta.statusTimeline : [])
    .map((entry: any) => ({
      label: sanitizeReplacementText(String(entry?.label || entry?.status || "")),
      at: entry?.at || entry?.timestamp ? new Date(entry.at || entry.timestamp).toLocaleString() : "",
    }))
    .filter((entry: { label: string }) => Boolean(entry.label))
    .reverse();

  return (
    <View style={styles.detailSection}>
      <DetailHeader title="Back to Purchase Orders" />

      <View style={styles.detailBody}>
        <View style={styles.detailTitleRow}>
          <View style={styles.replacementDetailHeaderIcon}>
            <Package2 size={26} color={theme.colors.emerald} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.detailOrderNumber}>{record.replacementNumber || "Replacement"}</Text>
            <View style={styles.detailBadgeRow}>
              <Badge label={statusLabel} tone={getReplacementStatusTone(statusLabel)} />
            </View>
            <View style={styles.listCardMetaRow}>
              <CalendarDays size={16} color={theme.colors.slate500} />
              <Text style={styles.listCardMeta}>{reportedAt}</Text>
            </View>
          </View>
        </View>

        <View style={styles.replacementDetailCard}>
          <Text style={styles.replacementDetailHeading}>Replacement Details</Text>
          <DetailRow Icon={Hash} label="Claim ID" value={record.replacementNumber || "N/A"} />
          <DetailRow Icon={Hash} label="Order Number" value={record.orderNumber || "N/A"} />
          <DetailRow
            Icon={Boxes}
            label="Product"
            value={record.originalProductName || record.replacementProductName || "N/A"}
          />
          <DetailRow Icon={CircleAlert} label="Reason" value={sanitizeReplacementText(record.reason)} />
          <DetailRow Icon={Package2} label="Status" value={statusLabel} emerald withDot />
          <DetailRow Icon={Package2} label="Quantity" value={qtyLabel} />
          <DetailRow Icon={Clock3} label="Reported" value={reportedAt} />
          {claimNote ? <DetailRow Icon={NotebookPen} label="Notes" value={claimNote} /> : null}
        </View>

        {/* ── Claim Progress tracker (mirrors the order Delivery Journey stepper) ── */}
        {(() => {
          const rawStatus = String((record as any).status || "").toUpperCase();
          // Map the replacement status to a 0-based stage index (matches the 4 steps below).
          const stageIndex =
            rawStatus === "COMPLETED" || rawStatus === "RESOLVED_ON_DELIVERY"
              ? 3
              : rawStatus === "APPROVED" || rawStatus === "IN_PROGRESS"
                ? 2
                : rawStatus === "UNDER_REVIEW"
                  ? 1
                  : rawStatus === "PENDING" || rawStatus === "REPORTED"
                    ? 0
                    : -1; // Cancelled / Rejected: do not highlight any forward step

          // Build a lookup: status → earliest timestamp from the raw statusTimeline.
          const rawTimeline: any[] = Array.isArray(meta?.statusTimeline) ? meta.statusTimeline : [];
          const timestampByStatus: Record<string, string> = {};
          for (const entry of rawTimeline) {
            const entryStatus = String(entry?.status || "").toUpperCase();
            if (entryStatus && !timestampByStatus[entryStatus]) {
              const ts = entry?.at || entry?.timestamp;
              if (ts) timestampByStatus[entryStatus] = new Date(ts).toLocaleString();
            }
          }

          const trackerSteps = [
            {
              key: "submitted",
              label: "Claim Submitted",
              description: "Your replacement request was received.",
              matchStatuses: ["PENDING", "REPORTED"],
              active: stageIndex >= 0,
            },
            {
              key: "review",
              label: "Under Review",
              description: "Our team is reviewing your claim.",
              matchStatuses: ["UNDER_REVIEW"],
              active: stageIndex >= 1,
            },
            {
              key: "approved",
              label: "Approved / Scheduled",
              description: "Claim approved. Replacement delivery is being arranged.",
              matchStatuses: ["APPROVED", "IN_PROGRESS"],
              active: stageIndex >= 2,
            },
            {
              key: "completed",
              label: "Completed",
              description: "Your replacement has been delivered.",
              matchStatuses: ["COMPLETED", "RESOLVED_ON_DELIVERY"],
              active: stageIndex >= 3,
            },
          ];

          // Resolve per-step timestamp: first matching status found in the timeline.
          const getStepTimestamp = (step: typeof trackerSteps[0]): string => {
            for (const s of step.matchStatuses) {
              if (timestampByStatus[s]) return timestampByStatus[s];
            }
            return "";
          };

          return (
            <View style={styles.trackCard}>
              <View style={styles.trackCardHeader}>
                <Text style={styles.trackCardTitle}>Claim Progress</Text>
              </View>
              <View style={styles.trackTimeline}>
                {trackerSteps.map((step, idx) => {
                  const timestamp = getStepTimestamp(step);
                  return (
                    <View key={step.key} style={styles.trackTimelineRow}>
                      <View style={styles.trackTimelineRail}>
                        <View
                          style={[
                            styles.trackTimelineDot,
                            step.active ? styles.trackTimelineDotActive : null,
                          ]}
                        />
                        {idx < trackerSteps.length - 1 ? (
                          <View
                            style={[
                              styles.trackTimelineLine,
                              step.active ? styles.trackTimelineLineActive : null,
                            ]}
                          />
                        ) : null}
                      </View>
                      <View style={styles.flex}>
                        <Text
                          style={
                            step.active
                              ? styles.trackTimelineLabelActive
                              : styles.trackTimelineLabel
                          }
                        >
                          {step.label}
                        </Text>
                        <Text style={styles.trackTimelineDescription}>
                          {step.description}
                        </Text>
                      </View>
                      <Text style={styles.trackTimelineTime}>
                        {timestamp || "--"}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })()}

        {claimTimeline.length > 0 ? (
          <View style={styles.replacementDetailCard}>
            <Text style={styles.replacementDetailHeading}>Claim Timeline</Text>
            {claimTimeline.map((entry, index) => (
              <View key={`${entry.label}-${index}`} style={styles.claimTimelineRow}>
                <View style={styles.claimTimelineMarker}>
                  <View style={index === 0 ? styles.claimTimelineDotActive : styles.claimTimelineDot} />
                  {index < claimTimeline.length - 1 ? <View style={styles.claimTimelineLine} /> : null}
                </View>
                <View style={styles.flex}>
                  <Text style={styles.claimTimelineLabel}>{entry.label}</Text>
                  {entry.at ? <Text style={styles.claimTimelineMeta}>{entry.at}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {evidenceUrls.length > 0 ? (
          <View style={styles.replacementDetailCard}>
            <Text style={styles.replacementDetailHeading}>Evidence ({evidenceUrls.length})</Text>
            <View style={styles.evidenceRow}>
              {evidenceUrls.map((url) => (
                <ImagePreview
                  key={url}
                  url={url}
                  style={styles.replacementEvidenceImage}
                  caption=""
                  accessibilityLabel="damage photo"
                />
              ))}
            </View>
          </View>
        ) : null}

        {pod.show ? (
          <View style={styles.replacementDetailCard}>
            <Text style={styles.replacementDetailHeading}>Proof of Delivery (POD)</Text>
            {pod.replacementOrderNumber ? (
              <Text style={styles.detailInfoText}>
                <Text style={styles.listCardMetaStrong}>Replacement Order:</Text> {pod.replacementOrderNumber}
              </Text>
            ) : null}
            {pod.recipientName ? (
              <Text style={styles.detailInfoText}>
                <Text style={styles.listCardMetaStrong}>Received By:</Text> {pod.recipientName}
              </Text>
            ) : null}
            {pod.submittedAt ? (
              <Text style={styles.detailInfoText}>
                <Text style={styles.listCardMetaStrong}>Submitted At:</Text>{" "}
                {new Date(pod.submittedAt).toLocaleString()}
              </Text>
            ) : null}
            {pod.deliveryPhoto ? (
              <ImagePreview
                url={pod.deliveryPhoto}
                style={styles.replacementPodImage}
                accessibilityLabel="proof of delivery"
              />
            ) : (
              <Text style={styles.detailInfoText}>No POD uploaded yet.</Text>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}
