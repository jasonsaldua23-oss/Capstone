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

export {
  getMixedCaseComponentNameWithSize,
  getMixedCaseBottleQuantity,
} from "../../../../shared/customer-logic/src/mixed-case-components.ts";

export {
  isReturnableGlassItem,
  getAutomaticEmptyCredit,
  getLineDepositAmounts,
  type EmptyCredit,
} from "../../../../shared/customer-logic/src/empty-credit.ts";

export {
  getOrderItemDisplayName,
  getRequestItemDisplayName,
  normalizePRStatus,
  getPRStatusText,
  formatCardDateTime,
  getCheckoutQuantityLabel,
  type PRStatus,
} from "../../../../shared/customer-logic/src/item-display.ts";

export {
  formatDiscountPercent,
  formatDiscountLabel,
  getEffectiveDiscountPercent,
} from "../../../../shared/customer-logic/src/discount.ts";

export {
  getReplacementNumberFromRecord,
  getReplacementDisplayStatus,
  getReplacementLineQtyLabel,
  getReplacementDisplayQty,
  getReplacementItemsForRecord,
  getReplacementTotalAmount,
  getLinkedOrderForReplacementRecord,
  buildReplacementTabOrders,
  getReplacementEvidenceUrls,
  getReplacementPod,
  sanitizeReplacementText,
  type ReplacementDisplayItem,
  type ReplacementPod,
} from "../../../../shared/customer-logic/src/replacement-display.ts";

export {
  DAMAGE_REASON_OPTIONS,
  MAX_EVIDENCE_PHOTOS,
  newReplacementLine,
  getSelectableReplacementItems,
  getSelectableItemsForLine,
  getSelectedReplacementItem,
  getMaxReplacementQtyForLine,
  getReplacementOptionLabel,
  buildReplacementRequest,
  type ReplacementLine,
  type ReplacementInputMode,
  type SelectableReplacementItem,
} from "../../../../shared/customer-logic/src/replacement-request.ts";

export {
  SERVICE_AREA_BOUNDS,
  SERVICE_AREA_MESSAGE,
  isWithinServiceArea,
  isWithinServiceAreaBounds,
  computeBounds,
  extractServiceAreaGeometries,
  composeShippingAddress,
  type PolygonGeometry,
} from "../../../../shared/customer-logic/src/service-area.ts";
