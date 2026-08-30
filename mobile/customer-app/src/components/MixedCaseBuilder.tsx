import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { quoteMixedCase } from "../services/auth";
import { formatPeso } from "../lib/customer-logic";
import { ProductThumb } from "./ui/product-thumb";
import type { MobileMixedCaseCartItem, Product } from "../types";

type Props = {
  visible: boolean;
  products: Product[];
  editingItem?: MobileMixedCaseCartItem | null;
  onClose: () => void;
  onSave: (item: MobileMixedCaseCartItem) => void;
};

function getSharedCapacities(products: Product[]): number[] {
  if (products.length === 0) return [];
  const configured = products.map(
    (product) => new Set((product.packagingProfile?.allowedMixedCaseCapacities || []).filter((value) => Number.isInteger(value) && value > 0))
  );
  return Array.from(configured[0] || [])
    .filter((value) => configured.every((capacities) => capacities.has(value)))
    .sort((left, right) => left - right);
}

// Same precedence the catalog card uses for a product's size.
function sizeLabelOf(product: any): string {
  const sizes = Array.isArray(product?.sizes)
    ? product.sizes.map((size: any) => String(size).trim()).filter(Boolean)
    : [];
  if (sizes.length > 0) return sizes.join(", ");
  return String(product?.sizeLabel || product?.size || "").trim();
}

export function MixedCaseBuilder({ visible, products, editingItem, onClose, onSave }: Props) {
  const groups = useMemo(() => {
    const grouped = new Map<string, Product[]>();
    products.forEach((product) => {
      const profile = product.packagingProfile;
      if (!profile?.isActive || !profile.compatibilityKey || Number(product.availableBaseUnits || 0) <= 0) return;
      grouped.set(profile.compatibilityKey, [...(grouped.get(profile.compatibilityKey) || []), product]);
    });
    return Array.from(grouped.entries()).filter(([, rows]) => rows.length >= 2);
  }, [products]);
  const [groupKey, setGroupKey] = useState("");
  const [capacity, setCapacity] = useState(0);
  const [caseCount, setCaseCount] = useState("1");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedGroup = groups.find(([key]) => key === groupKey) || groups[0];
  const selectedProducts = selectedGroup?.[1] || [];
  const capacities = useMemo(() => getSharedCapacities(selectedProducts), [selectedGroup]);

  useEffect(() => {
    if (!visible) return;
    if (editingItem) {
      const firstProduct = products.find((product) => product.id === editingItem.components[0]?.productId);
      const editingGroupKey = firstProduct?.packagingProfile?.compatibilityKey || groups[0]?.[0] || "";
      const editingProducts = groups.find(([key]) => key === editingGroupKey)?.[1] || [];
      const editingCapacities = getSharedCapacities(editingProducts);
      const canReuseComposition = editingCapacities.includes(editingItem.caseCapacity);
      setGroupKey(editingGroupKey);
      setCapacity(canReuseComposition ? editingItem.caseCapacity : editingCapacities[0] || 0);
      setCaseCount(String(Math.max(1, Math.floor(Number(editingItem.quantity || 1)))));
      setQuantities(
        canReuseComposition
          ? Object.fromEntries(editingItem.components.map((component) => [component.productId, component.quantityPerCase]))
          : {}
      );
      setError("");
      return;
    }
    const initialGroup = groups[0];
    setGroupKey(initialGroup?.[0] || "");
    setCapacity(getSharedCapacities(initialGroup?.[1] || [])[0] || 0);
    setCaseCount("1");
    setQuantities({});
    setError("");
  }, [visible, editingItem, groups, products]);

  const parsedCaseCount = Number(caseCount.trim());
  const validCaseCount = caseCount.trim() !== "" && Number.isInteger(parsedCaseCount) && parsedCaseCount > 0;
  const cases = validCaseCount ? parsedCaseCount : 0;
  const selected = selectedProducts.map((product) => ({ product, quantity: Math.max(0, quantities[product.id] || 0) })).filter((row) => row.quantity > 0);
  const added = selected.reduce((sum, row) => sum + row.quantity, 0);
  const remaining = Math.max(0, capacity - added);
  const insufficientStock = validCaseCount && selected.some(
    (row) => row.quantity * cases > Number(row.product.availableBaseUnits || 0)
  );
  const complete = validCaseCount && !insufficientStock && capacity > 0 && added === capacity && selected.length >= 2;
  const estimate = selected.reduce((sum, row) => sum + Number(row.product.baseUnitPrice || 0) * row.quantity, 0) * cases;

  const updateQuantity = (product: Product, next: number) => {
    if (!validCaseCount) return;
    setError("");
    setQuantities((current) => {
      const unitsFromOtherProducts = Object.entries(current).reduce(
        (sum, [productId, quantity]) => sum + (productId === product.id ? 0 : Math.max(0, Number(quantity) || 0)),
        0
      );
      const maxByCapacity = Math.max(0, capacity - unitsFromOtherProducts);
      const maxByStock = Math.floor(Number(product.availableBaseUnits || 0) / cases);
      const normalized = Math.max(0, Math.min(maxByCapacity, maxByStock, Math.floor(Number(next) || 0)));
      const updated = { ...current };
      if (normalized === 0) delete updated[product.id];
      else updated[product.id] = normalized;
      return updated;
    });
  };

  const save = async () => {
    if (!validCaseCount) return setError("Number of cases must be a positive whole number.");
    if (insufficientStock) return setError("Reduce the component quantities or number of cases to match available stock.");
    if (!complete) return setError("Fill the case exactly with at least two compatible products.");
    setSaving(true);
    setError("");
    try {
      const quote = await quoteMixedCase({
        caseCapacity: capacity,
        quantity: cases,
        components: selected.map((row) => ({ productId: row.product.id, quantity: row.quantity })),
      });
      onSave({
        id: editingItem?.id || `mixed:${Date.now()}-${Math.random().toString(36).slice(2)}`,
        itemType: "MIXED_CASE",
        caseCapacity: Number(quote.caseCapacity),
        quantity: Number(quote.caseCount || cases),
        unitPrice: Number(quote.unitPrice || 0),
        components: quote.components || [],
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to validate Mixed Case.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.title}>{editingItem ? "Edit Mixed Case" : "Build a Mixed Case"}</Text>
        {groups.length === 0 ? <Text style={styles.error}>At least two compatible in-stock products are required.</Text> : null}
        {groups.length > 1 ? (
          <View style={styles.wrap}>
            {groups.map(([key, rows]) => (
              <Pressable
                key={key}
                style={[styles.chip, key === selectedGroup?.[0] && styles.chipActive]}
                onPress={() => {
                  setGroupKey(key);
                  setCapacity(getSharedCapacities(rows)[0] || 0);
                  setQuantities({});
                  setError("");
                }}
              >
                <Text>{rows[0]?.packagingProfile?.name || key}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text style={styles.label}>Case capacity</Text>
        <View style={styles.wrap}>
          {capacities.map((value) => (
            <Pressable
              key={value}
              style={[styles.chip, capacity === value && styles.chipActive]}
              onPress={() => {
                setCapacity(value);
                setQuantities({});
                setError("");
              }}
            >
              <Text>{value} units</Text>
            </Pressable>
          ))}
        </View>
        {selectedProducts.length > 0 && capacities.length === 0 ? (
          <Text style={styles.error}>These products do not share a configured Mixed Case capacity.</Text>
        ) : null}
        <Text style={styles.label}>Number of cases</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={caseCount}
          onChangeText={(value) => {
            setCaseCount(value);
            setError("");
          }}
        />
        {!validCaseCount ? <Text style={styles.error}>Number of cases must be a positive whole number.</Text> : null}
        <View style={styles.summary}><Text>Capacity {capacity}</Text><Text>Added {added}</Text><Text>Remaining {remaining}</Text></View>
        {selectedProducts.map((product) => {
          const quantity = quantities[product.id] || 0;
          const max = validCaseCount ? Math.floor(Number(product.availableBaseUnits || 0) / cases) : 0;
          const atLimit = !validCaseCount || quantity >= max || added >= capacity;
          const componentSubtotal = Number(product.baseUnitPrice || 0) * quantity * cases;
          return (
            <View key={product.id} style={styles.product}>
              <ProductThumb uri={product.imageUrl} name={product.name} />
              <View style={styles.flex}>
                <Text style={styles.productName}>
                  {product.name}
                  {sizeLabelOf(product) ? ` ${sizeLabelOf(product)}` : ""}
                </Text>
                <Text style={styles.muted}>
                  {formatPeso(Number(product.baseUnitPrice || 0))}/{product.packagingProfile?.baseUnitLabel || "unit"}
                </Text>
                <Text style={styles.muted}>
                  {quantity} {quantity === 1 ? "Bottle" : "Bottles"} per case
                </Text>
                {quantity > 0 && validCaseCount ? (
                  <Text style={styles.componentSubtotal}>
                    Subtotal/case: {formatPeso(Number(product.baseUnitPrice || 0) * quantity)}
                  </Text>
                ) : null}
              </View>
              <View style={styles.counter}>
                <Pressable
                  style={[styles.counterButton, (!validCaseCount || quantity <= 0) && styles.disabled]}
                  disabled={!validCaseCount || quantity <= 0}
                  onPress={() => updateQuantity(product, quantity - 1)}
                >
                  <Text>-</Text>
                </Pressable>
                <Text style={styles.counterValue}>{quantity}</Text>
                <Pressable
                  style={[styles.counterButton, atLimit && styles.disabled]}
                  disabled={atLimit}
                  onPress={() => updateQuantity(product, quantity + 1)}
                >
                  <Text>+</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
        {insufficientStock ? <Text style={styles.error}>Selected quantities exceed current stock for the requested case count.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.total}>Estimated Mixed Case total: {formatPeso(estimate)}</Text>
        <View style={styles.actions}><Pressable style={styles.secondary} onPress={onClose}><Text>Cancel</Text></Pressable><Pressable style={[styles.primary, (!complete || saving) && styles.disabled]} disabled={!complete || saving} onPress={save}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{editingItem ? "Save Changes" : "Add Mixed Case"}</Text>}</Pressable></View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, gap: 12, backgroundColor: "#f8fafc", minHeight: "100%" }, title: { fontSize: 24, fontWeight: "800", color: "#0f172a" },
  label: { fontSize: 13, fontWeight: "700", color: "#334155" }, wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, chip: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#fff" }, chipActive: { borderColor: "#0284c7", backgroundColor: "#e0f2fe" },
  input: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, backgroundColor: "#fff", padding: 10 }, summary: { flexDirection: "row", justifyContent: "space-between", borderRadius: 10, backgroundColor: "#dcfce7", padding: 12 },
  product: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 12, backgroundColor: "#fff" }, flex: { flex: 1 }, productName: { fontWeight: "700", color: "#0f172a" }, muted: { fontSize: 12, color: "#64748b", marginTop: 3 }, componentSubtotal: { fontSize: 12, color: "#047857", fontWeight: "700", marginTop: 3 }, counter: { flexDirection: "row", alignItems: "center", gap: 8 }, counterButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#bae6fd", borderRadius: 17, backgroundColor: "#f0f9ff" }, counterValue: { minWidth: 24, textAlign: "center", fontWeight: "700" },
  error: { color: "#b91c1c", backgroundColor: "#fee2e2", padding: 10, borderRadius: 8 }, total: { fontSize: 18, fontWeight: "800", color: "#047857" }, actions: { flexDirection: "row", gap: 10 }, secondary: { flex: 1, alignItems: "center", padding: 13, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10 }, primary: { flex: 1, alignItems: "center", padding: 13, backgroundColor: "#059669", borderRadius: 10 }, primaryText: { color: "#fff", fontWeight: "700" }, disabled: { opacity: 0.45 },
});
