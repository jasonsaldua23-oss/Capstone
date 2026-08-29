// Extracted verbatim from App.tsx: pure presentation formatters shared by screens.
import { API_BASE_URL } from "../config/env";
import { formatPeso } from "./customer-logic";
import type { CustomerProfileUpdateInput } from "../services/auth";
import type { CustomerOrder } from "../types";

export function formatStatusLabel(value?: string | null) {
  return String(value || "Pending")
    .trim()
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function resolveImageUrl(value?: string | null) {
  const path = String(value || "").trim();
  // Added: relative media paths returned by Django must resolve against the configured mobile API host.
  if (!path) return `${API_BASE_URL}/email-assets/ann-anns-logo.png`;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
export function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

export function formatDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function escapeReceiptHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildReceiptHtml(order: CustomerOrder) {
  const itemRows = (order.items || []).map((item) => `
    <tr>
      <td>${escapeReceiptHtml(item.product?.name || (item.itemType === "MIXED_CASE" ? "Mixed Case" : "Product"))}</td>
      <td style="text-align:center">${Number(item.quantity || 0)}</td>
      <td style="text-align:right">${escapeReceiptHtml(formatPeso(Number(item.totalPrice || 0)))}</td>
    </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;color:#0f172a;padding:28px}h1{color:#123e73;margin:0}small{color:#64748b}
    .meta{margin:22px 0;line-height:1.65}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left}
    .total{font-size:20px;font-weight:800;text-align:right;margin-top:20px;color:#047857}
  </style></head><body><h1>AAB TRADING SHOP</h1><small>Ann Ann's Beverages Trading · Official Delivery Receipt</small>
    <div class="meta"><strong>Receipt:</strong> RCT-${escapeReceiptHtml(order.orderNumber)}<br><strong>Customer:</strong> ${escapeReceiptHtml(order.shippingName)}<br><strong>Address:</strong> ${escapeReceiptHtml(order.shippingAddress)}<br><strong>Date:</strong> ${escapeReceiptHtml(formatDate(order.createdAt))}</div>
    <table><thead><tr><th>Product</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div class="total">Total: ${escapeReceiptHtml(formatPeso(Number(order.totalAmount || 0)))}</div></body></html>`;
}

export function formatAddress(form: CustomerProfileUpdateInput) {
  return [form.address, form.city, form.province, form.zipCode].filter((value) => value && value.trim()).join(", ");
}
