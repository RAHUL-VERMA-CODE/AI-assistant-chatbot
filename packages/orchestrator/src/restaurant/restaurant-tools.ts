/**
 * Restaurant AI Tools (18 Validated Schema Tools)
 * Every tool validates its inputs and returns structured JSON with UI card payloads
 * so the frontend can render rich interactive components (Dish Cards, Cart Card, Order Tracker, Booking Card).
 */

import { restaurantDb, RESTAURANT_INFO } from '../../../../database/restaurant-db.ts';
import type { MenuItem, Order, Booking } from '../../../../database/restaurant-db.ts';

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  message: string;
  data?: any;
  uiComponent?: {
    type:
      | 'dish_carousel'
      | 'dish_card'
      | 'cart_summary'
      | 'order_confirmation'
      | 'order_tracker'
      | 'booking_confirmation'
      | 'coupon_card'
      | 'restaurant_info'
      | 'handoff_card'
      | 'feedback_form';
    payload: any;
  };
  quickReplies?: string[];
}

export class RestaurantTools {
  // 1. search_menu
  public static searchMenu(params: {
    query?: string;
    category?: string;
    vegOnly?: boolean;
    maxPrice?: number;
    spiceLevel?: number;
  }): ToolExecutionResult {
    const dishes = restaurantDb.searchMenu({
      query: params.query,
      category: params.category,
      isVeg: params.vegOnly,
      maxPricePaise: params.maxPrice ? params.maxPrice * 100 : undefined,
      spiceLevel: params.spiceLevel,
    });

    if (dishes.length === 0) {
      return {
        toolName: 'search_menu',
        success: true,
        message: "I couldn't find any dishes matching those exact filters. Would you like to explore our popular curries or biryanis?",
        data: { dishes: [] },
        quickReplies: ['Popular Dishes', 'Butter Chicken', 'Paneer Butter Masala', 'Dum Biryani'],
      };
    }

    const preview = dishes.slice(0, 6);
    return {
      toolName: 'search_menu',
      success: true,
      message: `Here are ${preview.length} delicious options matching your search:`,
      data: { count: dishes.length, dishes: preview },
      uiComponent: {
        type: 'dish_carousel',
        payload: { dishes: preview },
      },
      quickReplies: preview.slice(0, 3).map((d) => `Add ${d.name}`),
    };
  }

  // 2. get_dish_details
  public static getDishDetails(params: { dishId?: string; dishName?: string }): ToolExecutionResult {
    let dish: MenuItem | undefined;
    if (params.dishId) {
      dish = restaurantDb.getDish(params.dishId);
    } else if (params.dishName) {
      dish = restaurantDb.findDishByName(params.dishName);
    }

    if (!dish) {
      return {
        toolName: 'get_dish_details',
        success: false,
        message: `I couldn't find details for "${params.dishName || params.dishId}". Check our menu for available specials!`,
        quickReplies: ['View Menu', 'Today’s Specials'],
      };
    }

    const priceFormatted = `₹${(dish.pricePaise / 100).toFixed(2)}`;
    const spiceText = dish.spiceLevel === 1 ? 'Mild 🌶️' : dish.spiceLevel === 2 ? 'Medium 🌶️🌶️' : 'Spicy 🌶️🌶️🌶️';
    const vegText = dish.isVeg ? 'Vegetarian (Green Dot)' : 'Non-Vegetarian (Red Dot)';
    const allergensText = dish.allergens.length > 0 ? dish.allergens.join(', ') : 'None';

    return {
      toolName: 'get_dish_details',
      success: true,
      message: `**${dish.name}** (${priceFormatted}): ${dish.description} Portion: ${dish.portion}. Allergens: ${allergensText}. Spice: ${spiceText}.`,
      data: { dish },
      uiComponent: {
        type: 'dish_card',
        payload: { dish },
      },
      quickReplies: [`Add ${dish.name}`, 'View Cart', 'More Starters', 'More Curries'],
    };
  }

  // 3. recommend_dishes
  public static recommendDishes(params: {
    budget?: number;
    mood?: string;
    groupSize?: number;
    dietaryNeeds?: string;
  }): ToolExecutionResult {
    let dishes = restaurantDb.getMenu();

    if (params.dietaryNeeds?.toLowerCase().includes('veg')) {
      dishes = dishes.filter((d) => d.isVeg);
    }

    if (params.budget) {
      const perDishMaxPaise = ((params.budget * 100) / (params.groupSize || 1)) * 0.75;
      dishes = dishes.filter((d) => d.pricePaise <= perDishMaxPaise || d.pricePaise <= 35000);
    }

    const recommended = dishes.slice(0, 4);
    return {
      toolName: 'recommend_dishes',
      success: true,
      message: `Based on your preferences (${params.dietaryNeeds || 'all'}, ${params.groupSize || 1} person, budget ₹${params.budget || 500}), here is our curated feast:`,
      data: { recommended },
      uiComponent: {
        type: 'dish_carousel',
        payload: { dishes: recommended },
      },
      quickReplies: recommended.slice(0, 3).map((d) => `Add ${d.name}`),
    };
  }

  // 4. add_to_cart
  public static addToCart(params: {
    sessionId: string;
    dishId?: string;
    dishName?: string;
    quantity?: number;
    notes?: string;
  }): ToolExecutionResult {
    let dish: MenuItem | undefined;
    if (params.dishId) {
      dish = restaurantDb.getDish(params.dishId);
    } else if (params.dishName) {
      dish = restaurantDb.findDishByName(params.dishName);
    }

    if (!dish) {
      return {
        toolName: 'add_to_cart',
        success: false,
        message: `Sorry, I couldn't find "${params.dishName || 'that dish'}" on our menu. Would you like to view our available menu items?`,
        quickReplies: ['View Menu', 'Biryani', 'Butter Chicken', 'Paneer Tikka'],
      };
    }

    try {
      const qty = params.quantity && params.quantity > 0 ? params.quantity : 1;
      const { cart } = restaurantDb.addToCart(params.sessionId, dish.id, qty, params.notes);

      return {
        toolName: 'add_to_cart',
        success: true,
        message: `Added ${qty}x **${dish.name}** to your cart! Total is ₹${(cart.totalPaise / 100).toFixed(2)}.`,
        data: { cart, itemAdded: dish },
        uiComponent: {
          type: 'cart_summary',
          payload: { cart },
        },
        quickReplies: ['View Cart', 'Checkout / Order Now', 'Add Butter Naan', 'Add Gulab Jamun'],
      };
    } catch (err: any) {
      return {
        toolName: 'add_to_cart',
        success: false,
        message: `Could not add to cart: ${err.message}`,
        quickReplies: ['View Menu', 'Check Stock'],
      };
    }
  }

  // 5. update_cart
  public static updateCart(params: {
    sessionId: string;
    dishId: string;
    quantity: number;
    notes?: string;
  }): ToolExecutionResult {
    const cart = restaurantDb.updateCartItem(params.sessionId, params.dishId, params.quantity, params.notes);
    return {
      toolName: 'update_cart',
      success: true,
      message: `Updated your cart. Total items: ${cart.items.reduce((s, it) => s + it.quantity, 0)}. Total: ₹${(cart.totalPaise / 100).toFixed(2)}.`,
      data: { cart },
      uiComponent: {
        type: 'cart_summary',
        payload: { cart },
      },
      quickReplies: ['Checkout / Order Now', 'View Menu', 'Apply Coupon'],
    };
  }

  // 6. remove_from_cart
  public static removeFromCart(params: { sessionId: string; dishId: string }): ToolExecutionResult {
    const cart = restaurantDb.removeFromCart(params.sessionId, params.dishId);
    return {
      toolName: 'remove_from_cart',
      success: true,
      message: `Item removed from cart. Updated total: ₹${(cart.totalPaise / 100).toFixed(2)}.`,
      data: { cart },
      uiComponent: {
        type: 'cart_summary',
        payload: { cart },
      },
      quickReplies: ['View Cart', 'View Menu', 'Order Now'],
    };
  }

  // 7. view_cart
  public static viewCart(params: { sessionId: string }): ToolExecutionResult {
    const cart = restaurantDb.getCart(params.sessionId);
    if (cart.items.length === 0) {
      return {
        toolName: 'view_cart',
        success: true,
        message: 'Your cart is currently empty! Would you like to check our bestsellers or specials?',
        data: { cart },
        quickReplies: ['View Menu', 'Chef Specials', 'Hyderabadi Biryani', 'Butter Chicken'],
      };
    }

    return {
      toolName: 'view_cart',
      success: true,
      message: `Your cart has ${cart.items.length} item(s) totaling ₹${(cart.totalPaise / 100).toFixed(2)} (including 5% GST and packaging):`,
      data: { cart },
      uiComponent: {
        type: 'cart_summary',
        payload: { cart },
      },
      quickReplies: ['Place Order', 'Apply Coupon WELCOME50', 'Add Bread', 'Add Drinks'],
    };
  }

  // 8. apply_coupon
  public static applyCoupon(params: { sessionId: string; code: string }): ToolExecutionResult {
    const result = restaurantDb.applyCoupon(params.sessionId, params.code);
    return {
      toolName: 'apply_coupon',
      success: result.success,
      message: result.message,
      data: { cart: result.cart },
      uiComponent: {
        type: 'cart_summary',
        payload: { cart: result.cart },
      },
      quickReplies: ['Place Order', 'View Cart', 'Add more items'],
    };
  }

  // 9. place_order
  public static placeOrder(params: {
    sessionId: string;
    customerName: string;
    phone: string;
    orderType: 'delivery' | 'takeaway' | 'dine-in';
    deliveryAddress?: string;
    tableNumber?: number;
    paymentMethod: 'COD' | 'UPI' | 'CARD';
  }): ToolExecutionResult {
    try {
      const order = restaurantDb.placeOrder(params);
      return {
        toolName: 'place_order',
        success: true,
        message: `🎉 Order placed successfully! Your Order ID is **#${order.id}**. Our kitchen has started preparing your feast. Estimated arrival: ${order.etaMinutes} mins.`,
        data: { order },
        uiComponent: {
          type: 'order_confirmation',
          payload: { order },
        },
        quickReplies: [`Track #${order.id}`, 'Call Restaurant', 'Order More'],
      };
    } catch (err: any) {
      return {
        toolName: 'place_order',
        success: false,
        message: `Unable to place order: ${err.message}`,
        quickReplies: ['View Cart', 'View Menu', 'Ask Staff for Help'],
      };
    }
  }

  // 10. get_order_status
  public static getOrderStatus(params: { orderId?: string; phone?: string }): ToolExecutionResult {
    let order: Order | undefined;
    if (params.orderId) {
      order = restaurantDb.getOrder(params.orderId);
    } else if (params.phone) {
      const orders = restaurantDb.getOrdersByPhone(params.phone);
      if (orders.length > 0) order = orders[0];
    }

    if (!order) {
      return {
        toolName: 'get_order_status',
        success: false,
        message: `No active order found for ${params.orderId || params.phone}. Please verify your order number or phone.`,
        quickReplies: ['Check Latest Orders', 'Speak with Staff', 'Order Food'],
      };
    }

    return {
      toolName: 'get_order_status',
      success: true,
      message: `Order **#${order.id}** is currently: **${order.status.toUpperCase()}**. Estimated delivery in ${order.etaMinutes} mins.`,
      data: { order },
      uiComponent: {
        type: 'order_tracker',
        payload: { order },
      },
      quickReplies: [`Track #${order.id}`, 'Cancel Order', 'Contact Restaurant'],
    };
  }

  // 11. cancel_order
  public static cancelOrder(params: { orderId: string; reason?: string }): ToolExecutionResult {
    try {
      const order = restaurantDb.cancelOrder(params.orderId, params.reason || 'Customer requested via chat');
      return {
        toolName: 'cancel_order',
        success: true,
        message: `Order #${order.id} has been cancelled. Any online payment will be refunded to your source account within 2 hours.`,
        data: { order },
        uiComponent: {
          type: 'order_tracker',
          payload: { order },
        },
        quickReplies: ['View Menu', 'Book a Table', 'Give Feedback'],
      };
    } catch (err: any) {
      return {
        toolName: 'cancel_order',
        success: false,
        message: `Cancellation error: ${err.message}`,
        quickReplies: ['Speak with Staff', 'Track Order'],
      };
    }
  }

  // 12. check_table_availability
  public static checkTableAvailability(params: {
    date: string;
    time: string;
    guests: number;
  }): ToolExecutionResult {
    const result = restaurantDb.checkTableAvailability(params.date, params.time, params.guests);
    return {
      toolName: 'check_table_availability',
      success: result.available,
      message: result.message,
      data: result,
      quickReplies: result.available
        ? [`Book for ${params.guests} guests on ${params.date}`, 'Change Time', 'View Menu']
        : ['Check another time', 'Call Staff'],
    };
  }

  // 13. book_table
  public static bookTable(params: {
    customerName: string;
    phone: string;
    date: string;
    time: string;
    guests: number;
    specialRequests?: string;
  }): ToolExecutionResult {
    try {
      const booking = restaurantDb.bookTable(params);
      return {
        toolName: 'book_table',
        success: true,
        message: `🥂 Table reserved successfully! Booking ID: **#${booking.id}** for ${booking.guests} guests on ${booking.date} at ${booking.time} (Table #${booking.tableNumber}, ${booking.section}).`,
        data: { booking },
        uiComponent: {
          type: 'booking_confirmation',
          payload: { booking },
        },
        quickReplies: ['View Menu in Advance', `Cancel #${booking.id}`, 'Directions to Restaurant'],
      };
    } catch (err: any) {
      return {
        toolName: 'book_table',
        success: false,
        message: `Booking failed: ${err.message}`,
        quickReplies: ['Try another time', 'Call Restaurant', 'Order Online Instead'],
      };
    }
  }

  // 14. modify_booking
  public static modifyBooking(params: {
    bookingId: string;
    date?: string;
    time?: string;
    guests?: number;
  }): ToolExecutionResult {
    const b = restaurantDb.getBooking(params.bookingId);
    if (!b) {
      return {
        toolName: 'modify_booking',
        success: false,
        message: `Booking #${params.bookingId} not found.`,
        quickReplies: ['Book New Table', 'Talk to Front Desk'],
      };
    }

    if (params.date) b.date = params.date;
    if (params.time) b.time = params.time;
    if (params.guests) b.guests = params.guests;
    restaurantDb.saveToDisk();

    return {
      toolName: 'modify_booking',
      success: true,
      message: `Booking #${b.id} updated to ${b.date} at ${b.time} for ${b.guests} guests.`,
      data: { booking: b },
      uiComponent: {
        type: 'booking_confirmation',
        payload: { booking: b },
      },
      quickReplies: ['View Menu', 'Directions to Restaurant'],
    };
  }

  // 15. cancel_booking
  public static cancelBooking(params: { bookingId: string }): ToolExecutionResult {
    try {
      const b = restaurantDb.cancelBooking(params.bookingId);
      return {
        toolName: 'cancel_booking',
        success: true,
        message: `Reservation #${b.id} has been cancelled. We hope to see you another time!`,
        data: { booking: b },
        quickReplies: ['Book another time', 'Order Food Online'],
      };
    } catch (err: any) {
      return {
        toolName: 'cancel_booking',
        success: false,
        message: `Error cancelling booking: ${err.message}`,
      };
    }
  }

  // 16. get_restaurant_info
  public static getRestaurantInfo(): ToolExecutionResult {
    return {
      toolName: 'get_restaurant_info',
      success: true,
      message: `Welcome to **${RESTAURANT_INFO.name}**! Timings: ${RESTAURANT_INFO.timings}. Address: ${RESTAURANT_INFO.address}. Phone: ${RESTAURANT_INFO.phone}. Free valet parking available. Delivery radius: ${RESTAURANT_INFO.deliveryRadius}.`,
      data: { info: RESTAURANT_INFO },
      uiComponent: {
        type: 'restaurant_info',
        payload: { info: RESTAURANT_INFO },
      },
      quickReplies: ['View Menu', 'Book a Table', 'Order Food Online', 'Offers'],
    };
  }

  // 17. create_handoff_ticket
  public static createHandoffTicket(params: {
    sessionId: string;
    customerName?: string;
    phone?: string;
    reason: string;
    priority?: 'NORMAL' | 'HIGH' | 'URGENT';
    summary?: string;
  }): ToolExecutionResult {
    const ticket = restaurantDb.createHandoffTicket({
      sessionId: params.sessionId,
      customerName: params.customerName,
      phone: params.phone,
      reason: params.reason,
      priority: params.priority || 'HIGH',
      summary: params.summary || 'Customer requested human assistance',
    });

    return {
      toolName: 'create_handoff_ticket',
      success: true,
      message: `I have notified our restaurant manager and floor staff (Ticket **#${ticket.id}**). A staff member will connect with you right away, or you can call us directly at ${RESTAURANT_INFO.phone}.`,
      data: { ticket },
      uiComponent: {
        type: 'handoff_card',
        payload: { ticket, contactPhone: RESTAURANT_INFO.phone },
      },
      quickReplies: ['Call Restaurant Now', 'Back to Chatbot', 'View Menu'],
    };
  }

  // 18. submit_feedback
  public static submitFeedback(params: {
    orderId: string;
    rating: number;
    comment: string;
  }): ToolExecutionResult {
    const fb = restaurantDb.submitFeedback(params.orderId, params.rating, params.comment);
    return {
      toolName: 'submit_feedback',
      success: true,
      message: `Thank you for your ${params.rating}⭐ feedback! Your comments help us keep the charcoal burning bright.`,
      data: { feedback: fb },
      quickReplies: ['Order Again', 'Book a Table', 'View Offers'],
    };
  }
}
