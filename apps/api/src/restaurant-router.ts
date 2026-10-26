/**
 * Restaurant REST & Realtime API Router
 * Endpoints for AI Chatbot, Cart, Orders, Menu Management, Bookings, Admin Kanban, and SSE.
 */

import http from 'node:http';
import { restaurantDb, RESTAURANT_INFO } from '../../../database/restaurant-db.ts';
import type { OrderStatus } from '../../../database/restaurant-db.ts';
import { restaurantOrchestrator } from '../../../packages/orchestrator/src/restaurant/restaurant-orchestrator.ts';
import { sseBroadcaster } from './sse-broadcaster.ts';

export async function handleRestaurantApi(
  method: string,
  pathname: string,
  parsedUrl: URL,
  body: any,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  // 1. SSE Realtime Stream
  if (method === 'GET' && pathname === '/api/events') {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    sseBroadcaster.addClient(clientId, res);
    return true;
  }

  // Helper response sender
  const sendJson = (status: number, data: any) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Helper error sender
  const sendError = (status: number, message: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  };

  // 2. POST /api/chat (AI Chatbot Turn)
  if (method === 'POST' && pathname === '/api/chat') {
    const { sessionId, message } = body || {};
    if (!message) {
      sendError(400, 'Parameter "message" is required');
      return true;
    }
    const sid = sessionId || 'session_guest_default';
    const reply = await restaurantOrchestrator.handleTurn(sid, message);
    sendJson(200, reply);
    return true;
  }

  // 3. GET /api/menu
  if (method === 'GET' && pathname === '/api/menu') {
    const category = parsedUrl.searchParams.get('category') || undefined;
    const isVegParam = parsedUrl.searchParams.get('isVeg');
    const isVeg = isVegParam !== null ? isVegParam === 'true' : undefined;
    const dishes = restaurantDb.searchMenu({ category, isVeg });
    sendJson(200, { count: dishes.length, dishes });
    return true;
  }

  // 4. PATCH /api/menu/:id/stock (Admin toggle in-stock / out-of-stock)
  if (method === 'PATCH' && pathname.startsWith('/api/menu/') && pathname.endsWith('/stock')) {
    const dishId = pathname.replace('/api/menu/', '').replace('/stock', '');
    const inStock = Boolean(body?.inStock);
    const updated = restaurantDb.updateDishStock(dishId, inStock);
    if (!updated) {
      sendError(404, `Dish with ID '${dishId}' not found`);
      return true;
    }
    // Broadcast stock update
    sseBroadcaster.broadcast({ type: 'menu_stock_updated', payload: { dish: updated } });
    sendJson(200, { success: true, dish: updated });
    return true;
  }

  // 5. GET /api/cart
  if (method === 'GET' && pathname === '/api/cart') {
    const sid = parsedUrl.searchParams.get('sessionId') || 'session_guest_default';
    const cart = restaurantDb.getCart(sid);
    sendJson(200, cart);
    return true;
  }

  // 6. POST /api/cart/add
  if (method === 'POST' && pathname === '/api/cart/add') {
    const { sessionId, dishId, quantity, notes } = body || {};
    if (!dishId) {
      sendError(400, 'Parameter "dishId" is required');
      return true;
    }
    const sid = sessionId || 'session_guest_default';
    try {
      const result = restaurantDb.addToCart(sid, dishId, quantity || 1, notes);
      sendJson(200, result);
    } catch (err: any) {
      sendError(400, err.message);
    }
    return true;
  }

  // 7. PATCH /api/cart/update
  if (method === 'PATCH' && pathname === '/api/cart/update') {
    const { sessionId, dishId, quantity, notes } = body || {};
    if (!dishId || typeof quantity !== 'number') {
      sendError(400, 'Parameters "dishId" and "quantity" are required');
      return true;
    }
    const sid = sessionId || 'session_guest_default';
    const updatedCart = restaurantDb.updateCartItem(sid, dishId, quantity, notes);
    sendJson(200, updatedCart);
    return true;
  }

  // 8. DELETE /api/cart/remove
  if (method === 'DELETE' && pathname === '/api/cart/remove') {
    const { sessionId, dishId } = body || {};
    if (!dishId) {
      sendError(400, 'Parameter "dishId" is required');
      return true;
    }
    const sid = sessionId || 'session_guest_default';
    const updatedCart = restaurantDb.removeFromCart(sid, dishId);
    sendJson(200, updatedCart);
    return true;
  }

  // 9. POST /api/cart/coupon
  if (method === 'POST' && pathname === '/api/cart/coupon') {
    const { sessionId, code } = body || {};
    if (!code) {
      sendError(400, 'Parameter "code" is required');
      return true;
    }
    const sid = sessionId || 'session_guest_default';
    const result = restaurantDb.applyCoupon(sid, code);
    sendJson(result.success ? 200 : 400, result);
    return true;
  }

  // 10. POST /api/orders (Place Order)
  if (method === 'POST' && pathname === '/api/orders') {
    const { sessionId, customerName, phone, orderType, deliveryAddress, tableNumber, paymentMethod } = body || {};
    if (!customerName || !phone || !orderType) {
      sendError(400, 'customerName, phone, and orderType are required');
      return true;
    }
    const sid = sessionId || 'session_guest_default';
    try {
      const order = restaurantDb.placeOrder({
        sessionId: sid,
        customerName,
        phone,
        orderType,
        deliveryAddress,
        tableNumber,
        paymentMethod: paymentMethod || 'UPI',
      });
      // Broadcast new order to staff Kanban!
      sseBroadcaster.broadcast({ type: 'new_order', payload: { order } });
      sendJson(201, { success: true, order });
    } catch (err: any) {
      sendError(400, err.message);
    }
    return true;
  }

  // 11. GET /api/orders (List all orders for admin)
  if (method === 'GET' && pathname === '/api/orders') {
    const orders = restaurantDb.getAllOrders();
    sendJson(200, { count: orders.length, orders });
    return true;
  }

  // 12. GET /api/orders/:id (Get order details)
  if (method === 'GET' && pathname.startsWith('/api/orders/')) {
    const orderId = pathname.replace('/api/orders/', '');
    const order = restaurantDb.getOrder(orderId);
    if (!order) {
      sendError(404, `Order #${orderId} not found`);
      return true;
    }
    sendJson(200, order);
    return true;
  }

  // 13. PATCH /api/orders/:id/status (Admin updates order status -> LIVE REALTIME BROADCAST!)
  if (method === 'PATCH' && pathname.startsWith('/api/orders/') && pathname.endsWith('/status')) {
    const orderId = pathname.replace('/api/orders/', '').replace('/status', '');
    const { status, note } = body || {};
    if (!status) {
      sendError(400, 'Parameter "status" is required');
      return true;
    }
    try {
      const updatedOrder = restaurantDb.updateOrderStatus(orderId, status as OrderStatus, note);
      // REALTIME BROADCAST TO CUSTOMER & ADMIN CLIENTS!
      sseBroadcaster.broadcast({
        type: 'order_status_updated',
        payload: { order: updatedOrder },
      });
      sendJson(200, { success: true, order: updatedOrder });
    } catch (err: any) {
      sendError(400, err.message);
    }
    return true;
  }

  // 14. POST /api/bookings (Book Table)
  if (method === 'POST' && pathname === '/api/bookings') {
    const { customerName, phone, date, time, guests, specialRequests } = body || {};
    if (!customerName || !phone || !date || !time || !guests) {
      sendError(400, 'customerName, phone, date, time, and guests are required');
      return true;
    }
    try {
      const booking = restaurantDb.bookTable({
        customerName,
        phone,
        date,
        time,
        guests: parseInt(guests, 10),
        specialRequests,
      });
      sseBroadcaster.broadcast({ type: 'new_booking', payload: { booking } });
      sendJson(201, { success: true, booking });
    } catch (err: any) {
      sendError(400, err.message);
    }
    return true;
  }

  // 15. GET /api/bookings (List bookings for admin)
  if (method === 'GET' && pathname === '/api/bookings') {
    const bookings = restaurantDb.getAllBookings();
    sendJson(200, { count: bookings.length, bookings });
    return true;
  }

  // 16. PATCH /api/bookings/:id/cancel
  if (method === 'PATCH' && pathname.startsWith('/api/bookings/') && pathname.endsWith('/cancel')) {
    const bookingId = pathname.replace('/api/bookings/', '').replace('/cancel', '');
    try {
      const b = restaurantDb.cancelBooking(bookingId);
      sseBroadcaster.broadcast({ type: 'booking_cancelled', payload: { booking: b } });
      sendJson(200, { success: true, booking: b });
    } catch (err: any) {
      sendError(400, err.message);
    }
    return true;
  }

  // 17. GET /api/restaurant (Restaurant Info)
  if (method === 'GET' && pathname === '/api/restaurant') {
    sendJson(200, RESTAURANT_INFO);
    return true;
  }

  // 18. GET /api/admin/analytics
  if (method === 'GET' && pathname === '/api/admin/analytics') {
    const stats = restaurantDb.getAnalytics();
    sendJson(200, stats);
    return true;
  }

  // 19. GET /api/admin/handoffs
  if (method === 'GET' && pathname === '/api/admin/handoffs') {
    const tickets = restaurantDb.getAllHandoffTickets();
    sendJson(200, { count: tickets.length, tickets });
    return true;
  }

  // 20. PATCH /api/admin/handoffs/:id/resolve
  if (method === 'PATCH' && pathname.startsWith('/api/admin/handoffs/') && pathname.endsWith('/resolve')) {
    const ticketId = pathname.replace('/api/admin/handoffs/', '').replace('/resolve', '');
    const t = restaurantDb.resolveHandoffTicket(ticketId);
    if (!t) {
      sendError(404, `Ticket #${ticketId} not found`);
      return true;
    }
    sendJson(200, { success: true, ticket: t });
    return true;
  }

  return false; // Not handled by restaurant router
}
