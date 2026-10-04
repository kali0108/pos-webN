/**
 * Applies the standing discount rules (Admin → Discounts) to a product
 * list, same precedence as the Billing screen: a rule for the specific
 * product beats a rule for its whole category.
 */
export function buildEffectivePrices(items, rules) {
  const itemRule = new Map();
  const categoryRule = new Map();
  (rules || []).forEach((r) => {
    if (r.scope === 'item') itemRule.set(r.item_id, r);
    else categoryRule.set(r.category_id, r);
  });
  return (items || []).map((i) => {
    const rule = itemRule.get(i.id) || categoryRule.get(i.category_id);
    let price = Number(i.unit_price);
    if (rule) {
      price = rule.discount_type === 'percent'
        ? price * (1 - Number(rule.discount_value) / 100)
        : price - Number(rule.discount_value);
    }
    return { ...i, effective_price: Number(Math.max(price, 0).toFixed(2)), discount_label: rule ? rule.label : null };
  });
}
