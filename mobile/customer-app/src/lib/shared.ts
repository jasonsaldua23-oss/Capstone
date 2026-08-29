// Single entry point for logic shared with the web customer portal.
// Relative paths keep this resolvable by Metro, tsc, and `node --test` alike;
// metro.config.js adds the shared folder to watchFolders.
export {
  normalizeDeliveryStatus,
  isRescheduledOrder,
  getOrderStageIndex,
  formatOrderStatus,
  isOrderDelivered,
  isOrderCancellable,
  isOrderTrackable,
  orderStages,
} from "../../../../shared/customer-logic/src/order-status.ts";

export {
  getOrderedContainerLabel,
  formatOrderedQuantityWithContainer,
} from "../../../../shared/customer-logic/src/order-item-display.ts";

export {
  extractCustomerPayload,
  formatPeso,
  formatPdfMoney,
  parseReplacementMeta,
  getReplacementRank,
  getReplacementStatusLabel,
  getReplacementStatusTone,
} from "../../../../shared/customer-logic/src/customer-common.ts";
export type { ReplacementTone } from "../../../../shared/customer-logic/src/customer-common.ts";

export {
  getMixedCaseComponentDepositProfile,
  getMixedCaseDepositAmounts,
} from "../../../../shared/customer-logic/src/mixed-case-deposit.ts";
