import { describe, it } from 'node:test';
import assert from 'node:assert';
import { restaurantDb } from '../../../../database/restaurant-db.ts';
import { RestaurantTools } from './restaurant-tools.ts';
import { restaurantOrchestrator } from './restaurant-orchestrator.ts';

describe('Restaurant Database & Tools Integration', () => {
  const sessionId = 'test_session_rest_01';

  it('calculates integer paise prices and 5% GST accurately', () => {
    restaurantDb.clearCart(sessionId);
    // Add Butter Chicken (₹399 = 39900 paise)
    const res1 = restaurantDb.addToCart(sessionId, 'main_01', 1);
    assert.strictEqual(res1.cart.subtotalPaise, 39900);
    // Subtotal < 40000 paise so ₹40 delivery fee applies
    assert.strictEqual(res1.cart.deliveryFeePaise, 4000);
    // Packaging fee: 2500 paise
    assert.strictEqual(res1.cart.packagingFeePaise, 2500);
    // 5% GST on 39900 = 1995 paise
    assert.strictEqual(res1.cart.gstPaise, 1995);
    // Total = 39900 + 1995 + 4000 + 2500 = 48395 paise
    assert.strictEqual(res1.cart.totalPaise, 48395);
  });

  it('applies coupon WELCOME50 and recalculates bill breakdown', () => {
    const couponRes = restaurantDb.applyCoupon(sessionId, 'WELCOME50');
    assert.strictEqual(couponRes.success, true);
    // 50% discount capped at max 10000 paise (₹100)
    assert.strictEqual(couponRes.cart.discountPaise, 10000);
    // Discounted subtotal = 39900 - 10000 = 29900
    // 5% GST on 29900 = 1495 paise
    assert.strictEqual(couponRes.cart.gstPaise, 1495);
    // Total = 29900 + 1495 + 4000 + 2500 = 37895 paise
    assert.strictEqual(couponRes.cart.totalPaise, 37895);
  });

  it('places order, clears cart, and tracks order status', () => {
    const order = restaurantDb.placeOrder({
      sessionId,
      customerName: 'Aarav Sharma',
      phone: '9876543210',
      orderType: 'delivery',
      deliveryAddress: 'Flat 101, Indiranagar, Bengaluru',
      paymentMethod: 'UPI',
    });

    assert.ok(order.id.startsWith('ORD-'));
    assert.strictEqual(order.status, 'Placed');
    assert.strictEqual(order.items.length, 1);
    assert.strictEqual(order.items[0].dishId, 'main_01');

    // Cart is now empty
    const cartAfter = restaurantDb.getCart(sessionId);
    assert.strictEqual(cartAfter.items.length, 0);

    // Track order via tool
    const trackRes = RestaurantTools.getOrderStatus({ orderId: order.id });
    assert.strictEqual(trackRes.success, true);
    assert.strictEqual(trackRes.data.order.id, order.id);
    assert.strictEqual(trackRes.uiComponent?.type, 'order_tracker');
  });

  it('checks table availability and books reservation', () => {
    const today = new Date().toISOString().split('T')[0];
    const avail = restaurantDb.checkTableAvailability(today, '20:00', 4);
    assert.strictEqual(avail.available, true);
    assert.ok(avail.table && avail.table.capacity >= 4);

    const booking = restaurantDb.bookTable({
      customerName: 'Priya Verma',
      phone: '9876501234',
      date: today,
      time: '20:00',
      guests: 4,
      specialRequests: 'Window seat if possible',
    });

    assert.ok(booking.id.startsWith('TBL-'));
    assert.strictEqual(booking.status, 'Confirmed');
    assert.strictEqual(booking.guests, 4);
  });

  it('handles Hinglish and English conversational turns through orchestrator', async () => {
    const sId = 'hinglish_user_session_01';

    // 1. Menu browse in Hinglish
    const turn1 = await restaurantOrchestrator.handleTurn(sId, 'Bhook lagi hai kya khana milega?');
    assert.ok(turn1.text.includes('The Spice Lounge') || turn1.text.includes('खिला') || turn1.text.includes('mood'));
    assert.ok(turn1.quickReplies && turn1.quickReplies.length > 0);

    // 2. Add dish in Hinglish
    const turn2 = await restaurantOrchestrator.handleTurn(sId, 'Ek Paneer Butter Masala add kar do');
    assert.strictEqual(turn2.toolExecuted, 'add_to_cart');
    assert.strictEqual(turn2.uiComponent?.type, 'cart_summary');

    // 3. View cart
    const turn3 = await restaurantOrchestrator.handleTurn(sId, 'Cart me kya hai?');
    assert.strictEqual(turn3.toolExecuted, 'view_cart');
    assert.strictEqual(turn3.uiComponent?.type, 'cart_summary');

    // 4. Place order
    const turn4 = await restaurantOrchestrator.handleTurn(sId, 'Order place kardo please');
    assert.strictEqual(turn4.toolExecuted, 'place_order');
    assert.strictEqual(turn4.uiComponent?.type, 'order_confirmation');
    assert.ok(turn4.data?.order?.id);

    // 5. Track order
    const turn5 = await restaurantOrchestrator.handleTurn(sId, 'Mera order kahan hai?');
    assert.strictEqual(turn5.toolExecuted, 'get_order_status');
    assert.strictEqual(turn5.uiComponent?.type, 'order_tracker');
  });
});
