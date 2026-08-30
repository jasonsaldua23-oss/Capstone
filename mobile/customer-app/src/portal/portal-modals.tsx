// Extracted from App.tsx during the Phase 0 split.
// Every dialog rendered above the authenticated shell.
import React from "react";
import { Search } from "lucide-react-native";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { CUSTOMER_ORDER_REASONS, REPLACEMENT_REASONS, formatPeso } from "../lib/customer-logic";
import { formatDate } from "../lib/format";
import { InfoRow } from "../components/ui/info-row";
import { DateField } from "../components/ui/date-field";
import { ModalShell } from "../components/ui/modal-shell";
import { RatingDialog } from "../components/ui/rating-dialog";
import { ReceiptDialog } from "../components/ui/receipt-dialog";
import { ReplacementRequestForm } from "../components/ui/replacement-request-form";
import { StatusSelect } from "../components/ui/status-select";
import { ConfirmationModal } from "../components/ui/confirmation-modal";
import { MixedCaseBuilder } from "../components/MixedCaseBuilder";
import { OTHER_ORDER_REASON } from "../lib/customer-logic";
import { styles } from "../styles/app-styles";
import { theme } from "../theme";
import { useCustomerPortal } from "./portal-context";

export function PortalModals() {
  const {
    products,
    mixedCaseBuilderVisible,
    editingMixedCase,
    confirmLogoutVisible,
    setConfirmLogoutVisible,
    pendingCancellationOrder,
    setPendingCancellationOrder,
    selectedCancellationReasons,
    setSelectedCancellationReasons,
    otherCancellationReason,
    setOtherCancellationReason,
    replacements,
    replacementOrder,
    setReplacementOrder,
    replacementEvidence,
    setReplacementEvidence,
    uploadingEvidence,
    submittingReplacement,
    handleLogout,
    closeMixedCaseBuilder,
    saveMixedCase,
    confirmPendingCancellation,
    handlePickReplacementEvidence,
    handleSubmitReplacement,
    orderConfirmationVisible,
    setOrderConfirmationVisible,
    lastPlacedOrderNumber,
    filterDialogVisible,
    setFilterDialogVisible,
    orderFilterStatus,
    setOrderFilterStatus,
    orderFilterDateFrom,
    setOrderFilterDateFrom,
    orderFilterDateTo,
    setOrderFilterDateTo,
    pendingCancelReplacement,
    setPendingCancelReplacement,
    cancellingReplacement,
    confirmCancelReplacement,
  } = useCustomerPortal();

  return (
    <>
      <RatingDialog />
      <ReceiptDialog />

      <ConfirmationModal
        visible={Boolean(pendingCancelReplacement)}
        title="Cancel Replacement Request?"
        message={`Cancel ${pendingCancelReplacement?.replacementNumber || "this replacement request"}? This cannot be undone.`}
        confirmLabel={cancellingReplacement ? "Cancelling..." : "Cancel Replacement"}
        danger
        onCancel={() => setPendingCancelReplacement(null)}
        onConfirm={() => void confirmCancelReplacement()}
      />

      <ModalShell
        visible={filterDialogVisible}
        title="Filter Orders"
        subtitle="Refine the list by status and date range."
        onClose={() => setFilterDialogVisible(false)}
      >
        <Text style={styles.checkoutFieldLabel}>Status</Text>
        <StatusSelect value={orderFilterStatus} onChange={setOrderFilterStatus} />
        <Text style={styles.checkoutFieldLabel}>Date from</Text>
        <DateField value={orderFilterDateFrom} onChange={setOrderFilterDateFrom} accessibilityLabel="Date from" />
        <Text style={styles.checkoutFieldLabel}>Date to</Text>
        <DateField value={orderFilterDateTo} onChange={setOrderFilterDateTo} accessibilityLabel="Date to" />
        <View style={styles.modalActions}>
          <Pressable
            style={styles.modalGhostButton}
            onPress={() => {
              setOrderFilterStatus("ALL");
              setOrderFilterDateFrom("");
              setOrderFilterDateTo("");
            }}
          >
            <Text style={styles.modalGhostButtonText}>Clear</Text>
          </Pressable>
          <Pressable style={styles.primaryButtonCompact} onPress={() => setFilterDialogVisible(false)}>
            <Text style={styles.primaryButtonText}>Apply</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={orderConfirmationVisible}
        title="Purchase Request Submitted"
        subtitle={
          lastPlacedOrderNumber
            ? `Your purchase request ${lastPlacedOrderNumber} has been submitted and is currently pending review by warehouse staff.`
            : "Your purchase request has been submitted and is currently pending review by warehouse staff."
        }
        onClose={() => setOrderConfirmationVisible(false)}
      >
        <View style={styles.modalActions}>
          <Pressable style={styles.primaryButtonCompact} onPress={() => setOrderConfirmationVisible(false)}>
            <Text style={styles.primaryButtonText}>OK</Text>
          </Pressable>
        </View>
      </ModalShell>






      
      
      <ModalShell
        visible={Boolean(replacementOrder)}
        title="Request Replacement"
        subtitle={`Report affected items from ${replacementOrder?.orderNumber || "this delivered order"}.`}
        onClose={() => {
          setReplacementOrder(null);
          setReplacementEvidence([]);
        }}
      >
        {replacementOrder ? (
          <ReplacementRequestForm
            order={replacementOrder}
            evidence={replacementEvidence}
            uploadingEvidence={uploadingEvidence}
            onPickEvidence={handlePickReplacementEvidence}
            onRemoveEvidence={(url) => setReplacementEvidence((current) => current.filter((item) => item !== url))}
            submitting={submittingReplacement}
            blockedMessage={
              replacements.some(
                (record) =>
                  record.orderId === replacementOrder.id || record.orderNumber === replacementOrder.orderNumber
              )
                ? "A replacement request is already in progress or completed for this order."
                : null
            }
            onSubmit={(built) => void handleSubmitReplacement(built)}
          />
        ) : null}
      </ModalShell>

      <ModalShell
        visible={Boolean(pendingCancellationOrder)}
        title="Cancel Order"
        subtitle={`Tell us why you are cancelling ${pendingCancellationOrder?.purchaseRequestNumber || pendingCancellationOrder?.orderNumber || "this order"}.`}
        onClose={() => {
          setPendingCancellationOrder(null);
          setSelectedCancellationReasons([]);
          setOtherCancellationReason("");
        }}
      >
        {CUSTOMER_ORDER_REASONS.map((reason) => {
          const selected = selectedCancellationReasons.includes(reason);
          return (
            <Pressable
              key={reason}
              style={[styles.reasonOption, selected ? styles.reasonOptionSelected : null]}
              onPress={() => setSelectedCancellationReasons((current) => selected ? current.filter((item) => item !== reason) : [...current, reason])}
            >
              <View style={[styles.checkbox, selected ? styles.checkboxChecked : null]}><Text style={styles.checkboxText}>{selected ? "✓" : ""}</Text></View>
              <Text style={styles.bodyText}>{reason}</Text>
            </Pressable>
          );
        })}
        {selectedCancellationReasons.includes(OTHER_ORDER_REASON) ? (
          <TextInput style={[styles.input, styles.multilineInput]} value={otherCancellationReason} onChangeText={setOtherCancellationReason} multiline placeholder="Type your reason" />
        ) : null}
        <Text style={styles.modalHelpText}>This action cannot be undone.</Text>
        <View style={styles.modalActions}>
          <Pressable style={styles.modalGhostButton} onPress={() => setPendingCancellationOrder(null)}><Text style={styles.modalGhostButtonText}>Keep Order</Text></Pressable>
          <Pressable style={[styles.primaryButtonCompact, styles.dangerButton]} onPress={confirmPendingCancellation}><Text style={styles.primaryButtonText}>Cancel Order</Text></Pressable>
        </View>
      </ModalShell>

      <ConfirmationModal
        visible={confirmLogoutVisible}
        title="Log Out Account?"
        message="Are you sure you want to log out of your account?"
        confirmLabel="Log Out"
        danger
        onCancel={() => setConfirmLogoutVisible(false)}
        onConfirm={() => {
          setConfirmLogoutVisible(false);
          void handleLogout();
        }}
      />
      <MixedCaseBuilder
        visible={mixedCaseBuilderVisible}
        products={products}
        editingItem={editingMixedCase}
        onClose={closeMixedCaseBuilder}
        onSave={saveMixedCase}
      />
    </>
  );
}
