// Mirrors the Empties & Deposits subview in
// src/components/portals/customer/sections/profile/profile-view.tsx: two tabs over
// the customer's container balances, with the record-empties control on the first.
import { Package, Plus, Recycle } from "lucide-react-native";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ModalShell } from "./modal-shell";
import { formatPeso } from "../../lib/customer-logic";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

function formatReservedEmptyUnits(items: any[]): string {
  const totals = (Array.isArray(items) ? items : []).reduce((result, item) => {
    const quantity = Math.max(0, Number(item?.emptyReturnedQuantity || 0));
    const isCase = String(item?.productUnit || item?.product?.unit || item?.unit || "").trim().toLowerCase() === "case";
    const containersPerCase = Math.max(1, Number(item?.containersPerCase || item?.quantityPerCase || item?.product?.quantityPerCase || 1));
    if (isCase) result.cases += Math.floor(quantity / containersPerCase);
    else result.bottles += quantity;
    return result;
  }, { cases: 0, bottles: 0 });
  return [
    totals.cases > 0 ? `${totals.cases} case${totals.cases === 1 ? "" : "s"}` : "",
    totals.bottles > 0 ? `${totals.bottles} bottle${totals.bottles === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" + ") || "0 bottles";
}

export function EmptiesDeposits({
  recordOpen,
  onRecordOpenChange,
}: {
  /** The web opens the recording form from a Record Empties button in the page header. */
  recordOpen: boolean;
  onRecordOpenChange: (open: boolean) => void;
}) {
  const {
    profile,
    orders,
    eligibleEmptyItems,
    emptyQuantitiesByProductId,
    setEmptyQuantitiesByProductId,
    recordingEmptyProductId,
    handleRecordEmpties,
  } = useCustomerPortal();

  const [emptiesTab, setEmptiesTab] = useState<"available" | "reserved">("available");

  const bottleBalances: any[] = (Array.isArray(profile?.bottleBalances) ? profile!.bottleBalances : []).flatMap((balance: any): any[] => {
    const productBalances = Array.isArray(balance.productBalances) ? balance.productBalances : [];
    return productBalances.length > 0
      ? productBalances.map((productBalance: any) => ({ ...balance, containerBottlesAvailable: balance.bottlesAvailable, ...productBalance, productOptions: [productBalance] }))
      : [balance];
  });
  // Active orders that are holding empties, as the web's reservedOrders does.
  const reservedOrders = orders.filter((order) => {
    const status = String(order.status || "").toUpperCase();
    if (["DELIVERED", "CANCELLED", "CANCELED", "REJECTED"].includes(status)) return false;
    return (order.items || []).some((item: any) => Number(item?.emptyReturnedQuantity || 0) > 0);
  });

  return (
    <>
      <View style={styles.emptiesTabRow}>
        <Pressable
          style={[styles.emptiesTab, emptiesTab === "available" ? styles.emptiesTabActive : null]}
          onPress={() => setEmptiesTab("available")}
          accessibilityRole="tab"
          accessibilityState={{ selected: emptiesTab === "available" }}
        >
          <Recycle size={14} color={theme.colors.emerald} />
          <Text style={[styles.emptiesTabText, emptiesTab === "available" ? styles.emptiesTabTextAvailable : null]}>
            Available Empties
          </Text>
        </Pressable>
        <Pressable
          style={[styles.emptiesTab, emptiesTab === "reserved" ? styles.emptiesTabActive : null]}
          onPress={() => setEmptiesTab("reserved")}
          accessibilityRole="tab"
          accessibilityState={{ selected: emptiesTab === "reserved" }}
        >
          <Package size={14} color="#2563eb" />
          <Text style={[styles.emptiesTabText, emptiesTab === "reserved" ? styles.emptiesTabTextReserved : null]}>
            Used or Reserved Deposits
          </Text>
          {reservedOrders.length > 0 ? (
            <View style={styles.emptiesTabCount}>
              <Text style={styles.emptiesTabCountText}>{reservedOrders.length}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {emptiesTab === "available" ? (
        <>
          {/* The web heads this list with a titled card row and an icon, and keeps the
              recording form behind the header's Record Empties button. */}
          <View style={styles.emptiesCardHeader}>
            <View style={styles.emptiesCardHeaderText}>
              <Text style={styles.emptiesSectionTitleTight}>Available Empty Containers</Text>
              <Text style={styles.emptiesCardSubtitle}>
                Available empty containers applied automatically at checkout.
              </Text>
            </View>
            <View style={styles.emptiesCardBadge}>
              <Recycle size={16} color={theme.colors.emerald} />
            </View>
          </View>
          {bottleBalances.length === 0 ? (
            <View style={styles.emptiesEmptyState}>
              <Text style={styles.emptiesEmptyTitle}>No Empty Bottles Recorded</Text>
              <Text style={styles.emptiesEmptyHint}>
                Declare empties from past orders using each product's packaging type.
              </Text>
            </View>
          ) : (
            bottleBalances.map((balance, index) => {
              const bottlesAvailable = Number.isFinite(Number((balance as any).bottlesAvailable))
                ? Math.max(0, Math.floor(Number((balance as any).bottlesAvailable)))
                : Math.max(0, Math.floor(Number(balance.bottlesOutstanding || 0)));
              const productOptions = Array.isArray(balance.productOptions) ? balance.productOptions : [];
              const productUnits = productOptions.map((product: any) => String(product?.unit || "").trim().toLowerCase());
              const isCaseFormat = productUnits.length > 0
                ? productUnits.every((unit: string) => unit === "case")
                : String((balance as any).unit || "").trim().toLowerCase() === "case";
              const selectedPackaging = productOptions[0];
              const containersPerUnit = isCaseFormat
                ? Math.max(1, Number(selectedPackaging?.containersPerCase || balance.containersPerCase || 1))
                : 1;
              const depositAmount = isCaseFormat
                ? (Number(selectedPackaging?.depositAmount || balance.depositAmount || 0) * containersPerUnit)
                  + Number(selectedPackaging?.caseDepositAmount || balance.caseDepositAmount || 0)
                : Number(selectedPackaging?.depositAmount || balance.depositAmount || 0);
              const count = Math.floor(bottlesAvailable / containersPerUnit);
              const depositAvailable = Math.min(
                Math.max(0, Number(balance.depositBalanceTotal ?? balance.depositBalance ?? 0)),
                count * depositAmount
              );
              return (
                <View key={`${balance.containerTypeId || "balance"}-${index}`} style={styles.emptiesBalanceCard}>
                  <View style={styles.emptiesBalanceRow}>
                    <View style={styles.emptiesBalanceMain}>
                      <Text style={styles.emptiesBalanceName} numberOfLines={1}>
                        {balance.containerTypeName || "Returnable container"}
                      </Text>
                      <Text style={styles.emptiesBalanceMeta}>
                        Deposit value:{" "}
                        <Text style={styles.emptiesBalanceStrong}>
                          {formatPeso(depositAmount)}/{isCaseFormat ? "case" : "bottle"}
                        </Text>
                      </Text>
                    </View>
                    <View style={styles.emptiesBalanceSide}>
                      <Text style={[styles.emptiesBalanceCount, count === 0 ? styles.emptiesBalanceCountMuted : null]}>
                        {count}
                      </Text>
                      <Text style={styles.emptiesBalanceUnit}>
                        {isCaseFormat
                          ? `empty case${count !== 1 ? "s" : ""}`
                          : `empty bottle${count !== 1 ? "s" : ""}`}{" "}
                        available
                      </Text>
                      <Text
                        style={[
                          styles.emptiesBalanceCredit,
                          depositAvailable <= 0 ? styles.emptiesBalanceCreditMuted : null,
                        ]}
                      >
                        {formatPeso(depositAvailable)} credit
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}

          <ModalShell
            visible={recordOpen}
            title="Record Empty Containers"
            onClose={() => onRecordOpenChange(false)}
          >
            {eligibleEmptyItems.length === 0 ? (
              <View style={styles.emptiesEmptyState}>
                <Text style={styles.emptiesEmptyTitle}>No Eligible Returnable History</Text>
              </View>
            ) : (
              eligibleEmptyItems.map((item) => {
                const quantity = Math.max(1, emptyQuantitiesByProductId[item.productId] || 1);
                const isCase = String(item.unit || "").toLowerCase() === "case";
                const maximumQuantity = isCase ? item.availableCasesToReturn : item.availableBottlesToReturn;
                // The eligible-items API returns the combined refundable case value.
                const depositPerUnit = isCase ? item.caseDeposit : item.unitDeposit;
                const unitLabel = isCase ? "case" : "bottle";
                return (
                  <View key={item.productId} style={styles.emptiesBalanceCard}>
                    <Text style={styles.emptiesSectionTitleTight}>Select Purchased Beverage</Text>
                    <Text style={styles.emptiesBalanceName}>{item.productName}</Text>
                    <Text style={styles.emptiesBalanceMeta}>
                      Max available: <Text style={styles.emptiesBalanceStrong}>{maximumQuantity} {unitLabel}{maximumQuantity === 1 ? "" : "s"}</Text>
                    </Text>
                    <Text style={styles.emptiesBalanceMeta}>Number of {isCase ? "Cases" : "Bottles"} to Return</Text>
                    <View style={styles.emptiesRecordRow}>
                      <View style={[styles.qtyControls, styles.emptiesQtyControls]}>
                        <Pressable
                          style={styles.qtyButton}
                          onPress={() =>
                            setEmptyQuantitiesByProductId((current) => ({
                              ...current,
                              [item.productId]: Math.max(1, quantity - 1),
                            }))
                          }
                          accessibilityRole="button"
                          accessibilityLabel="Decrease quantity"
                        >
                          <Text style={styles.qtyButtonText}>−</Text>
                        </Pressable>
                        <Text style={styles.qtyValue}>{quantity}</Text>
                        <Pressable
                          style={styles.qtyButton}
                          onPress={() =>
                            setEmptyQuantitiesByProductId((current) => ({
                              ...current,
                              [item.productId]: Math.min(maximumQuantity, quantity + 1),
                            }))
                          }
                          accessibilityRole="button"
                          accessibilityLabel="Increase quantity"
                        >
                          <Text style={styles.qtyButtonText}>+</Text>
                        </Pressable>
                      </View>
                      <Pressable
                        style={styles.primaryButtonCompact}
                        onPress={() => handleRecordEmpties(item)}
                        disabled={recordingEmptyProductId === item.productId}
                        accessibilityRole="button"
                      >
                        <Plus size={14} color={theme.colors.white} />
                        <Text style={styles.primaryButtonText}>
                          {recordingEmptyProductId === item.productId ? "Recording..." : "Record Empties"}
                        </Text>
                      </Pressable>
                    </View>
                    <Text style={styles.emptiesBalanceMeta}>
                      Deposit Credit to Apply:{" "}
                      <Text style={styles.emptiesBalanceStrong}>{formatPeso(quantity * depositPerUnit)}</Text>
                    </Text>
                  </View>
                );
              })
            )}
          </ModalShell>
        </>
      ) : (
        <>
          <Text style={styles.emptiesSectionTitle}>Used or Reserved Deposits</Text>
          {reservedOrders.length === 0 ? (
            <View style={styles.emptiesEmptyState}>
              <Text style={styles.emptiesEmptyTitle}>No Used or Reserved Deposits</Text>
              <Text style={styles.emptiesEmptyHint}>
                You do not have any active orders currently reserving empty containers. All recorded empties are
                available for checkout.
              </Text>
            </View>
          ) : (
            reservedOrders.map((order) => {
              const lockedTotal = (order.items || []).reduce(
                (sum: number, item: any) => sum + Number(item?.depositRefundTotal || item?.depositRefunded || 0),
                0
              );
              return (
                <View key={order.id} style={styles.emptiesBalanceCard}>
                  <Text style={styles.emptiesBalanceName}>{order.orderNumber}</Text>
                  <Text style={styles.emptiesBalanceMeta}>
                    Reserved in active orders:{" "}
                    <Text style={styles.emptiesBalanceStrong}>
                      {formatReservedEmptyUnits(order.items || [])}
                    </Text>
                  </Text>
                  <View style={styles.emptiesLockedRow}>
                    <Text style={styles.emptiesBalanceMeta}>Total Locked Deposit Credit</Text>
                    <Text style={styles.emptiesBalanceStrong}>
                      {formatPeso(Number(order.depositRefunded || lockedTotal || 0))}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
          <Text style={styles.emptiesEmptyHint}>
            Deposits locked in pending and active orders. Released if cancelled.
          </Text>
        </>
      )}
    </>
  );
}
