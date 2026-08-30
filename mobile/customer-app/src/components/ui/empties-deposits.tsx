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
    emptyCasesByProductId,
    setEmptyCasesByProductId,
    recordingEmptyProductId,
    handleRecordEmptyCases,
  } = useCustomerPortal();

  const [emptiesTab, setEmptiesTab] = useState<"available" | "reserved">("available");

  const bottleBalances = Array.isArray(profile?.bottleBalances) ? profile!.bottleBalances : [];
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
            Used / Reserved Deposits
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
                Have empty cases at home from past purchases? Use Record Empties to declare them in cases and waive
                container deposits on your next order.
              </Text>
            </View>
          ) : (
            bottleBalances.map((balance, index) => {
              const containersPerCase = Math.max(1, Number((balance as any).containersPerCase || 1));
              const bottlesAvailable = Number.isFinite(Number((balance as any).bottlesAvailable))
                ? Math.max(0, Math.floor(Number((balance as any).bottlesAvailable)))
                : Math.max(0, Math.floor(Number(balance.bottlesOutstanding || 0)));
              const casesAvailable = Number.isFinite(Number((balance as any).casesAvailable))
                ? Math.max(0, Math.floor(Number((balance as any).casesAvailable)))
                : Math.floor(bottlesAvailable / containersPerCase);
              const looseAvailable = Number.isFinite(Number((balance as any).looseBottlesAvailable))
                ? Math.max(0, Math.floor(Number((balance as any).looseBottlesAvailable)))
                : bottlesAvailable % containersPerCase;
              const casesReserved = Number((balance as any).casesReserved || 0);
              const isCaseFormat = casesAvailable > 0 || (casesReserved > 0 && looseAvailable === 0);
              const depositAmount = isCaseFormat
                ? Number((balance as any).caseDepositAmount || 0)
                : Number((balance as any).depositAmount || 0);
              const depositAvailable = Number.isFinite(Number((balance as any).depositAvailable))
                ? Number((balance as any).depositAvailable)
                : Number((balance as any).depositBalance || 0);
              const count = isCaseFormat ? casesAvailable : looseAvailable;
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
                          ? `empty case${casesAvailable !== 1 ? "s" : ""}`
                          : `loose bottle${looseAvailable !== 1 ? "s" : ""}`}{" "}
                        available
                      </Text>
                      {isCaseFormat && looseAvailable > 0 ? (
                        <Text style={styles.emptiesBalanceUnit}>
                          + {looseAvailable} loose bottle{looseAvailable !== 1 ? "s" : ""}
                        </Text>
                      ) : null}
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
            title="Record Empty Bottle Cases"
            onClose={() => onRecordOpenChange(false)}
          >
            {eligibleEmptyItems.length === 0 ? (
              <View style={styles.emptiesEmptyState}>
                <Text style={styles.emptiesEmptyTitle}>No Eligible Returnable History</Text>
              </View>
            ) : (
              eligibleEmptyItems.map((item) => {
                const cases = Math.max(1, emptyCasesByProductId[item.productId] || 1);
                return (
                  <View key={item.productId} style={styles.emptiesBalanceCard}>
                    <Text style={styles.emptiesSectionTitleTight}>Select Purchased Beverage</Text>
                    <Text style={styles.emptiesBalanceName}>{item.productName}</Text>
                    <Text style={styles.emptiesBalanceMeta}>
                      Max available: <Text style={styles.emptiesBalanceStrong}>{item.availableCasesToReturn}</Text>
                    </Text>
                    <Text style={styles.emptiesBalanceMeta}>Number of Cases to Return</Text>
                    <View style={styles.emptiesRecordRow}>
                      <View style={[styles.qtyControls, styles.emptiesQtyControls]}>
                        <Pressable
                          style={styles.qtyButton}
                          onPress={() =>
                            setEmptyCasesByProductId((current) => ({
                              ...current,
                              [item.productId]: Math.max(1, cases - 1),
                            }))
                          }
                          accessibilityRole="button"
                          accessibilityLabel="Decrease quantity"
                        >
                          <Text style={styles.qtyButtonText}>−</Text>
                        </Pressable>
                        <Text style={styles.qtyValue}>{cases}</Text>
                        <Pressable
                          style={styles.qtyButton}
                          onPress={() =>
                            setEmptyCasesByProductId((current) => ({
                              ...current,
                              [item.productId]: Math.min(item.availableCasesToReturn, cases + 1),
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
                        onPress={() => handleRecordEmptyCases(item)}
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
                      <Text style={styles.emptiesBalanceStrong}>{formatPeso(cases * item.caseDeposit)}</Text>
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
                      {(order.items || []).reduce(
                        (sum: number, item: any) => sum + Number(item?.emptyReturnedQuantity || 0),
                        0
                      )}
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
