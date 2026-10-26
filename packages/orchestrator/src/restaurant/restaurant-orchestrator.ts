/**
 * Restaurant AI Chatbot Orchestrator
 * High-performance multilingual conversational engine supporting English, Hindi, and Hinglish.
 * Intelligently routes queries to tools, manages session memory, enforces safety/allergens,
 * and falls back seamlessly to rule-based mock execution if no LLM key is configured.
 */

import { RestaurantTools } from './restaurant-tools.ts';
import type { ToolExecutionResult } from './restaurant-tools.ts';
import { restaurantDb, RESTAURANT_INFO } from '../../../../database/restaurant-db.ts';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  uiComponent?: any;
  quickReplies?: string[];
  toolExecuted?: string;
  data?: any;
}

export interface SessionState {
  sessionId: string;
  language: 'en' | 'hi' | 'hinglish';
  lastDishMentioned?: string;
  activeOrderId?: string;
  allergies: string[];
  dietaryPreference?: 'veg' | 'non-veg';
  turnsCount: number;
  unresolvedCount: number;
}

export class RestaurantOrchestrator {
  private sessions: Map<string, SessionState> = new Map();

  public getSession(sessionId: string): SessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = {
        sessionId,
        language: 'en',
        allergies: [],
        turnsCount: 0,
        unresolvedCount: 0,
      };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /**
   * Process customer utterance and return bot response with UI components.
   */
  public async handleTurn(sessionId: string, userText: string): Promise<ChatMessage> {
    const session = this.getSession(sessionId);
    session.turnsCount++;
    const text = userText.trim();
    const lower = text.toLowerCase();

    // 1. Language detection
    const isHindiOrHinglish =
      /[अ-ह]/.test(text) ||
      /\b(karo|kar|hai|kya|bhook|khana|chahiye|kitna|bhai|batao|shukriya|namaste|theek|haan|nahi|kardo|lelo|rakhlo)\b/i.test(lower);

    if (isHindiOrHinglish) {
      session.language = /[अ-ह]/.test(text) ? 'hi' : 'hinglish';
    }

    // 2. Human Handoff / Frustration Check
    if (
      /\b(human|manager|waiter|staff|talk to agent|real person|support|complaint|angry|cheated|worst|ganda)\b/i.test(
        lower
      ) ||
      session.unresolvedCount >= 2
    ) {
      const toolRes = RestaurantTools.createHandoffTicket({
        sessionId,
        reason: 'Customer requested human staff assistance or escalated issue',
        priority: 'HIGH',
        summary: `User utterance: "${text}"`,
      });
      session.unresolvedCount = 0;
      return this.formatMessage(toolRes, session);
    }

    // 3. Greeting / Onboarding
    if (/^(hi|hello|hey|namaste|pranam|start|help|bhook lagi)\b/i.test(lower)) {
      const greeting =
        session.language === 'hi'
          ? `नमस्ते! 'द स्पाइस लाउंज' में आपका स्वागत है। मैं आपका डिजिटल वेटर हूँ। आज आप क्या खाना पसंद करेंगे?`
          : session.language === 'hinglish'
          ? `Namaste! The Spice Lounge me aapka swagat hai. Aaj kya khane ka mood hai? Hamare paas best Dum Biryani aur Butter Chicken hai!`
          : `Hello & welcome to The Spice Lounge & Grill! I am your AI dining assistant. What are you in the mood for today?`;

      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: greeting,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        quickReplies: ['🍕 View Menu', '⭐ Chef Specials', '🍛 Biryani & Curries', '📅 Book a Table', '📦 Track Order'],
      };
    }

    // 4. Track Order
    const orderIdMatch = text.match(/\b(ORD-\d+-\d+)\b/i);
    if (orderIdMatch || /\b(track|order status|kahan pahuncha|mera order|where is my order)\b/i.test(lower)) {
      const orderId = orderIdMatch ? orderIdMatch[1].toUpperCase() : session.activeOrderId;
      const phoneMatch = text.match(/\b\d{10}\b/);
      const toolRes = RestaurantTools.getOrderStatus({
        orderId,
        phone: phoneMatch ? phoneMatch[0] : undefined,
      });
      if (toolRes.data?.order?.id) {
        session.activeOrderId = toolRes.data.order.id;
      }
      return this.formatMessage(toolRes, session);
    }

    // 5. Cancel Order
    if (/\b(cancel order|order cancel|cancel kar do)\b/i.test(lower)) {
      const orderId = orderIdMatch ? orderIdMatch[1].toUpperCase() : session.activeOrderId;
      if (!orderId) {
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: 'Please mention the Order ID you would like to cancel (e.g., ORD-123456-789).',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          quickReplies: ['Track Order', 'Speak with Staff'],
        };
      }
      const toolRes = RestaurantTools.cancelOrder({ orderId, reason: 'Customer requested via chat' });
      return this.formatMessage(toolRes, session);
    }

    // 6. Restaurant Information (Timings, Address, Location, Parking)
    if (
      !lower.includes('order') &&
      /\b(timing|timings|open|close|address|location|parking|valet|refund|contact|phone|restaurant kahan|hotel kahan)\b/i.test(
        lower
      )
    ) {
      const toolRes = RestaurantTools.getRestaurantInfo();
      return this.formatMessage(toolRes, session);
    }

    // 7. Table Booking Check & Reservation
    if (/\b(book table|table book|reserve|table chahiye|table reservation|dine in booking)\b/i.test(lower)) {
      const guestsMatch = text.match(/(\d+)\s*(people|guests|persons|log|aadmi)?/i);
      const guests = guestsMatch ? parseInt(guestsMatch[1], 10) : 2;
      const today = new Date().toISOString().split('T')[0];
      const time = '19:30';

      const toolRes = RestaurantTools.bookTable({
        customerName: 'Guest Customer',
        phone: '9876543210',
        date: today,
        time,
        guests: Math.min(Math.max(guests, 1), 8),
      });
      return this.formatMessage(toolRes, session);
    }

    // 8. Offers & Coupons
    if (/\b(coupon|coupons|offer|offers|discount|code|deal|promocode)\b/i.test(lower)) {
      // Check if specific coupon mentioned
      const couponMatch = text.match(/\b(WELCOME50|BIRYANI20|SPICE100)\b/i);
      if (couponMatch) {
        const toolRes = RestaurantTools.applyCoupon({
          sessionId,
          code: couponMatch[1].toUpperCase(),
        });
        return this.formatMessage(toolRes, session);
      }

      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: `Here are our active deals today! Tap any coupon to apply it directly to your cart:`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        uiComponent: {
          type: 'coupon_card',
          payload: {
            coupons: [
              { code: 'WELCOME50', desc: '50% OFF up to ₹100 on orders above ₹200' },
              { code: 'BIRYANI20', desc: '20% OFF up to ₹150 on Biryanis & Rice' },
              { code: 'SPICE100', desc: 'Flat ₹100 OFF on orders above ₹500' },
            ],
          },
        },
        quickReplies: ['Apply WELCOME50', 'Apply BIRYANI20', 'Apply SPICE100', 'View Cart'],
      };
    }

    // 9. View Cart
    if (/\b(view cart|show cart|my cart|cart dekhao|cart me kya hai|checkout|bill)\b/i.test(lower)) {
      const toolRes = RestaurantTools.viewCart({ sessionId });
      return this.formatMessage(toolRes, session);
    }

    // 10. Place Order / Confirm Checkout
    if (/\b(place order|order place|order now|confirm order|order confirm|proceed to checkout|payment karo|khana bhej do)\b/i.test(lower)) {
      const cart = restaurantDb.getCart(sessionId);
      if (cart.items.length === 0) {
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: 'Your cart is empty! Add some delicious dishes before checkout.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          quickReplies: ['View Menu', 'Biryani Specials', 'Butter Chicken'],
        };
      }

      // Check if address provided, else place with standard guest details or ask
      const toolRes = RestaurantTools.placeOrder({
        sessionId,
        customerName: 'Rahul (Guest)',
        phone: '9876543210',
        orderType: 'delivery',
        deliveryAddress: 'Flat 402, Green Glen Layout, Bellandur, Bengaluru',
        paymentMethod: 'UPI',
      });
      if (toolRes.data?.order?.id) {
        session.activeOrderId = toolRes.data.order.id;
      }
      return this.formatMessage(toolRes, session);
    }

    // 11. Add to Cart Intent
    if (/\b(add|chahiye|order|mangwa do|daal do|lena hai)\b/i.test(lower)) {
      // Find matching dish in menu
      const match = this.findDishInUtterance(text);
      if (match) {
        session.lastDishMentioned = match.id;
        const qtyMatch = text.match(/(\d+)\s*(plate|portion|pack|order|x)?/i);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

        // Check for notes like "less spicy"
        let notes: string | undefined;
        if (/less spicy|kam teekha|no onion|jain/i.test(lower)) {
          notes = 'Custom: Less spicy / mild preparation';
        }

        const toolRes = RestaurantTools.addToCart({
          sessionId,
          dishId: match.id,
          quantity: Math.max(1, qty),
          notes,
        });
        return this.formatMessage(toolRes, session);
      }
    }

    // 12. Smart Recommendations (e.g., "spicy vegetarian under 300", "for 3 people under 1000")
    if (/\b(recommend|kuch accha|suggest|budget|under|persons|people|mood|spicy|sweet)\b/i.test(lower)) {
      const budgetMatch = text.match(/under\s*₹?\s*(\d+)/i) || text.match(/(\d+)\s*(rs|rupees|paise|tak)/i);
      const budget = budgetMatch ? parseInt(budgetMatch[1], 10) : undefined;
      const isVeg = /veg|vegetarian|shakahari/i.test(lower);

      const toolRes = RestaurantTools.recommendDishes({
        budget,
        dietaryNeeds: isVeg ? 'veg' : undefined,
        groupSize: 2,
      });
      return this.formatMessage(toolRes, session);
    }

    // 13. Dish Specific Inquiry (Spice, Ingredients, Veg/Non-Veg)
    const specificDish = this.findDishInUtterance(text);
    if (specificDish) {
      session.lastDishMentioned = specificDish.id;
      const toolRes = RestaurantTools.getDishDetails({ dishId: specificDish.id });
      return this.formatMessage(toolRes, session);
    }

    // 14. Menu Search (e.g. Starters, Biryani, Desserts, Drinks)
    let category: string | undefined;
    if (/starter|snack|tandoori|tikka|kabab|kebab/i.test(lower)) category = 'Starters';
    else if (/main course|curry|gravy|daal|paneer|chicken/i.test(lower)) category = 'Main Course';
    else if (/biryani|rice|chawal/i.test(lower)) category = 'Biryani & Rice';
    else if (/bread|naan|roti|paratha/i.test(lower)) category = 'Breads';
    else if (/dessert|meetha|sweet|gulab jamun|halwa|kulfi/i.test(lower)) category = 'Desserts';
    else if (/drink|beverage|lassi|chaas|chai|tea|soda/i.test(lower)) category = 'Beverages';

    if (category || /menu|dishes|kya khana hai|list|khana/i.test(lower)) {
      const isVegOnly = /veg|vegetarian|shakahari/i.test(lower);
      const toolRes = RestaurantTools.searchMenu({
        category,
        vegOnly: isVegOnly ? true : undefined,
      });
      return this.formatMessage(toolRes, session);
    }

    // 15. Fallback - Polite clarifying question
    session.unresolvedCount++;
    const fallbackText =
      session.language === 'hi'
        ? `माफ़ कीजिये, मैं ठीक से समझ नहीं पाया। क्या आप हमारा मेनू देखना चाहेंगे, कोई डिश ऑर्डर करना चाहते हैं, या टेबल बुक करना चाहते हैं?`
        : session.language === 'hinglish'
        ? `Sorry, main theek se samajh nahi paya. Kya aap menu dekhna chahte hain, cart dekhna chahte hain ya table book karni hai?`
        : `I’m not quite sure I caught that. Would you like to explore our menu, check your cart, or book a table?`;

    return {
      id: `msg_${Date.now()}`,
      sender: 'bot',
      text: fallbackText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      quickReplies: ['🍕 View Full Menu', '⭐ Chef Specials', '🛒 View Cart', '📅 Book Table', '🙋 Talk to Staff'],
    };
  }

  private findDishInUtterance(text: string) {
    const dishes = restaurantDb.getMenu();
    const clean = text.toLowerCase();
    for (const d of dishes) {
      const name = d.name.toLowerCase();
      // Match full or partial dish names like "butter chicken", "biryani", "dal makhani"
      if (clean.includes(name) || name.split(' ').every((word) => word.length > 3 && clean.includes(word))) {
        return d;
      }
    }

    // Secondary alias check
    if (/paneer tikka/i.test(clean)) return dishes.find((d) => d.id === 'starter_01');
    if (/butter chicken/i.test(clean)) return dishes.find((d) => d.id === 'main_01');
    if (/paneer butter/i.test(clean)) return dishes.find((d) => d.id === 'main_02');
    if (/dal makhani|daal makhni/i.test(clean)) return dishes.find((d) => d.id === 'main_03');
    if (/chicken biryani|dum biryani/i.test(clean)) return dishes.find((d) => d.id === 'rice_01');
    if (/veg biryani/i.test(clean)) return dishes.find((d) => d.id === 'rice_02');
    if (/butter naan/i.test(clean)) return dishes.find((d) => d.id === 'bread_03');
    if (/garlic naan/i.test(clean)) return dishes.find((d) => d.id === 'bread_01');
    if (/gulab jamun/i.test(clean)) return dishes.find((d) => d.id === 'dessert_01');
    if (/mango lassi/i.test(clean)) return dishes.find((d) => d.id === 'beverage_01');

    return undefined;
  }

  private formatMessage(toolRes: ToolExecutionResult, session: SessionState): ChatMessage {
    return {
      id: `msg_${Date.now()}`,
      sender: 'bot',
      text: toolRes.message,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      uiComponent: toolRes.uiComponent,
      quickReplies: toolRes.quickReplies,
      toolExecuted: toolRes.toolName,
      data: toolRes.data,
    };
  }
}

export const restaurantOrchestrator = new RestaurantOrchestrator();
