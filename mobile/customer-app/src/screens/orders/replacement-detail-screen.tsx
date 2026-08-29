// Mirrors the replacement-details dialog in
// src/components/portals/customer/sections/orders/orders-view.tsx.
import { Boxes, CalendarDays, CircleAlert, Clock3, Hash, Package2 } from "lucide-react-native";
import React from "react";
import { Image, Text, View } from "react-native";

import { Badge } from "../../components/ui/badge";
import { DetailHeader } from "../../components/ui/detail-header";
import { resolveImageUrl } from "../../lib/format";
import {
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
          <DetailRow Icon={Hash} label="Order #" value={record.orderNumber || "N/A"} />
          <DetailRow
            Icon={Boxes}
            label="Product"
            value={record.originalProductName || record.replacementProductName || "N/A"}
          />
          <DetailRow Icon={CircleAlert} label="Reason" value={sanitizeReplacementText(record.reason)} />
          <DetailRow Icon={Package2} label="Status" value={statusLabel} emerald withDot />
          <DetailRow Icon={Package2} label="Quantity" value={qtyLabel} />
          <DetailRow Icon={Clock3} label="Reported" value={reportedAt} />
        </View>

        {evidenceUrls.length > 0 ? (
          <View style={styles.replacementDetailCard}>
            <Text style={styles.replacementDetailHeading}>Evidence ({evidenceUrls.length})</Text>
            <View style={styles.evidenceRow}>
              {evidenceUrls.map((url) => (
                <Image
                  key={url}
                  source={{ uri: resolveImageUrl(url) }}
                  style={styles.replacementEvidenceImage}
                  resizeMode="cover"
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
              <Image
                source={{ uri: resolveImageUrl(pod.deliveryPhoto) }}
                style={styles.replacementPodImage}
                resizeMode="contain"
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
