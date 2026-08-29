// The four primary destinations, with the labels the web portal uses in each form:
// the sidebar spells "Purchase Request" out, the bottom bar abbreviates it.
// Detail views keep their parent destination highlighted, exactly as the web nav does.
import type { CustomerTab, PortalRoute } from "../../portal/portal-context";

export type NavItemId = "home" | "requests" | "orders" | "profile";

export const NAV_ITEMS: Array<{ id: NavItemId; label: string; shortLabel: string }> = [
  { id: "home", label: "Home", shortLabel: "Home" },
  { id: "requests", label: "Purchase Request", shortLabel: "Purchase Req." },
  { id: "orders", label: "Purchase Order", shortLabel: "Purchase Order" },
  { id: "profile", label: "Profile", shortLabel: "Profile" },
];

export function getActiveNavId(activeTab: CustomerTab, route: PortalRoute | null): NavItemId | null {
  if (route) {
    if (route.name === "purchase-request-detail") return "requests";
    if (route.name === "order-detail") return "orders";
    if (route.name === "replacement-detail") return "orders";
    if (route.name === "edit-address") return "profile";
  }
  if (activeTab === "home") return "home";
  if (activeTab === "requests") return "requests";
  if (activeTab === "orders") return "orders";
  if (activeTab === "profile") return "profile";
  return null;
}
