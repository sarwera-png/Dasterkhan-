// Deterministic pricing. PURE functions: the same input always gives the same output, nothing is read from disk here
// and nothing is changed. The AI model never calculates a price, a total or a discount: only this code does.
// All amounts are whole PKR (integers). Demo tax is 0 (data/restaurant.json taxRate).
const { fail } = require('./fail');

// Food subtotal in PKR from the cart lines and the menu prices. Delivery fees are never part of it.
function foodSubtotal(items, menu) {
  let subtotal = 0;
  for (const line of items) {
    const item = menu.items.find((i) => i.id === line.id);
    if (!item || !Number.isInteger(item.price) || item.price < 0 || !Number.isInteger(line.quantity) || line.quantity < 1) {
      return { error: fail('cart_invalid', 'Sorry, one of the items in your cart is no longer on our menu. Please review your cart.', null, 'Ask the customer to review the cart.') };
    }
    subtotal += item.price * line.quantity;
  }
  return { subtotal };
}

// Returns null if the order qualifies for the promotion, otherwise an error object.
function checkEligibility(promo, subtotal, orderType) {
  const rules = promo.eligibility || {};
  const restrictsOrderType = Array.isArray(rules.orderTypes) && rules.orderTypes.length > 0
    && !(rules.orderTypes.includes('pickup') && rules.orderTypes.includes('delivery'));
  if (restrictsOrderType) {
    if (!orderType) {
      return fail('order_type_needed', 'Is this order for pickup or delivery?', null,
        'The code has NOT been applied. Ask the customer; do not assume or choose for them. After they answer in their own words, call setOrderType, then applyPromotion again.');
    }
    if (!rules.orderTypes.includes(orderType)) {
      return fail('order_type_not_eligible', `Sorry, this code is only for ${rules.orderTypes.join(' or ')} orders.`, null, 'The code has not been applied.');
    }
  }
  if (typeof rules.minFoodSubtotal === 'number' && subtotal < rules.minFoodSubtotal) {
    return fail('below_minimum', `Sorry, this code needs at least ${rules.minFoodSubtotal} PKR of food. Your food total is ${subtotal} PKR.`,
      { foodSubtotal: subtotal, minFoodSubtotal: rules.minFoodSubtotal, shortBy: rules.minFoodSubtotal - subtotal }, 'The code has not been applied.');
  }
  return null;
}

// Discount in whole PKR, on the food subtotal only, never more than the subtotal.
function computeDiscount(promo, subtotal) {
  const d = promo.discount;
  let amount = d.type === 'percent' ? Math.floor((subtotal * d.value) / 100) : d.value;
  if (typeof d.maxAmount === 'number') amount = Math.min(amount, d.maxAmount);
  return Math.max(0, Math.min(amount, subtotal));
}

// The one pricing function.
//   input: { items: [{ id, quantity }], orderType: 'pickup' | 'delivery' | null, promoCode: string | null }
//   data:  { menu, promotions: [...], restaurant }
// At most ONE promotion, re-checked on every call (minimum subtotal, cap, pickup-only, active flag).
// A promotion that no longer qualifies is dropped and reported in promoRemoved. The delivery fee is never discounted.
// total is null until the order type is known (the delivery fee depends on it).
function computeTotals(input, data) {
  const { items, orderType, promoCode } = input;
  const { menu, promotions, restaurant } = data;
  const sub = foodSubtotal(items, menu);
  if (sub.error) return { ok: false, error: sub.error };

  let discount = null;
  let promoRemoved = null;
  if (promoCode) {
    const promo = promotions.find((p) => p.id === promoCode);
    const problem = !promo || promo.active !== true || !promo.discount
      ? fail('inactive_code', "Sorry, that promo code isn't valid.", null, 'The code is no longer valid.')
      : checkEligibility(promo, sub.subtotal, orderType);
    if (problem) {
      promoRemoved = {
        code: promoCode,
        reason: problem.error,
        customerMessage: `Your ${promoCode} discount was removed because your order no longer qualifies for it.`,
        detail: problem.customerMessage,
        internalNote: 'Tell the customer the discount was removed.'
      };
    } else {
      discount = { code: promo.id, name: promo.name, amount: computeDiscount(promo, sub.subtotal) };
    }
  }

  const discountAmount = discount ? discount.amount : 0;
  const foodAfterDiscount = sub.subtotal - discountAmount;
  const deliveryFee = orderType === 'delivery' ? restaurant.delivery.fee : orderType === 'pickup' ? restaurant.pickup.fee : null;
  const tax = Math.round(foodAfterDiscount * (restaurant.taxRate || 0));
  const total = deliveryFee === null ? null : foodAfterDiscount + deliveryFee + tax;
  return { ok: true, foodSubtotal: sub.subtotal, discount, promoRemoved, discountAmount, foodAfterDiscount, deliveryFee, tax, total, orderType: orderType || null };
}

// Plain lines for the customer, built by code from a computeTotals result.
function totalsLines(t) {
  const lines = [`Food subtotal: ${t.foodSubtotal} PKR`];
  if (t.discount) lines.push(`Discount (${t.discount.code}): -${t.discount.amount} PKR`);
  if (t.orderType === 'delivery') lines.push(`Delivery fee: ${t.deliveryFee} PKR`);
  else if (t.orderType === 'pickup') lines.push('Pickup: free');
  lines.push(t.total === null ? 'Total: shown once you choose pickup or delivery' : `Total: ${t.total} PKR`);
  return lines;
}

module.exports = { computeTotals, totalsLines, foodSubtotal, checkEligibility, computeDiscount };
