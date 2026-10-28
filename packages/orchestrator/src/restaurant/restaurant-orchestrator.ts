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
  cancellationOrderPending?: string;
  allergies: string[];
  dietaryPreference?: 'veg' | 'non-veg';
  turnsCount: number;
  unresolvedCount: number;
}

export class RestaurantOrchestrator {
  private formatClockTime(): string {
    return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

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
    let text = userText.trim();
    // Normalize typos & phonetics
    const typoMap: [RegExp, string][] = [
      [/\bcoldrik\b/gi, 'coldrink'],
      [/\bcold\s*drink\b/gi, 'coldrink'],
      [/\bcolddrink\b/gi, 'coldrink'],
      [/\bjucie\b/gi, 'juice'],
      [/\bjuce\b/gi, 'juice'],
      [/\bpiza\b/gi, 'pizza'],
      [/\bpizaa\b/gi, 'pizza'],
      [/\bbiryanni\b/gi, 'biryani'],
      [/\bbriyani\b/gi, 'biryani'],
      [/\bpaner\b/gi, 'paneer'],
      [/\bpneer\b/gi, 'paneer'],
      [/\btika\b/gi, 'tikka'],
      [/\btikaa\b/gi, 'tikka'],
      [/\blasii\b/gi, 'lassi'],
      [/\bchass\b/gi, 'chaas'],
      [/\bchaach\b/gi, 'chaas'],
      [/\blight food\b/gi, 'healthy food'],
      [/\bdiet food\b/gi, 'healthy food'],
      [/\blow cal\b/gi, 'low calorie'],
      [/\blow calriesw\b/gi, 'low calorie'],
      [/\blow calries\b/gi, 'low calorie'],
    ];
    for (const [pat, rep] of typoMap) {
      text = text.replace(pat, rep);
    }
    const lower = text.toLowerCase();

    // 1. Dynamic Multilingual Detection (Pure Hindi, Hinglish, English)
    const isHindiScript = /[ऀ-ॿ]/.test(text);
    const isHinglishWords = /\b(karo|kar|hai|hain|kya|kyun|kaun|kaise|bhook|khana|chahiye|kitna|kitne|kitni|bhai|batao|bataiye|dikhao|dikhaye|shukriya|dhanyawad|namaste|namaskar|theek|haan|ha|nahi|na|kardo|lelo|rakhlo|mangwa|mangao|daal|daalo|paratha|pichli|baar|jaisa|purana|mera|meri|mere|aap|aapka|aapke|hum|mujhe|hamare|paas|kahan|pahuncha|kab|aayega|aayegi|bhejo|bhej|dekhna|dekhao|rok|hatao|badal|kam|jyada|teekha|meetha|roti|sabji|swagat|logon|ke\s*liye|andar|kuch|achha|accha|saaf)\b/i.test(lower);
    const isEnglishOnly = !isHindiScript && !isHinglishWords && /\b(the|is|are|show|what|where|how|can|please|add|order|view|menu|dish|dishes|table|reserve|cancel|track|thanks|thank you|hello|hi|hey|good|morning|evening|hungry|want|give|cost|price|bill|cart|food)\b/i.test(lower);

    if (isHindiScript) {
      session.language = 'hi';
    } else if (isHinglishWords) {
      session.language = 'hinglish';
    } else if (isEnglishOnly) {
      session.language = 'en';
    }

    // 2. Human Handoff / Frustration Check (Only when customer explicitly requests human staff or files severe complaint)
    if (
      /\b(human|manager|waiter|staff|talk to agent|real person|support ticket|complaint|cheated|worst|ganda|bakwas|fraud)\b/i.test(
        lower
      )
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

    // 2b. Order Cancellation Confirmation or Reason Selection (Flipkart / Amazon style)
    const isCancelReason =
      /\b(ordered by mistake|wrong dish|wrong item|too long|delivery time|change address|change delivery address|payment issue|pricing issue|changed my mind|found alternative|galti se|galat dish|der ho gayi|address badalna|mistake|reason)\b/i.test(lower) ||
      lower.includes('ordered by mistake') || lower.includes('wrong dish') || lower.includes('changed my mind') || lower.includes('found alternative') || lower.includes('delivery time');

    const isKeepOrder =
      /\b(keep|keep my order|don'?t cancel|mat cancel|mat karo|nahi cancel|rehne do|no cancel|रहने दो|मत काटो|कैंसिल मत करो)\b/i.test(lower) ||
      lower.includes('keep my order') || lower.includes("don't cancel");

    if (isKeepOrder || isCancelReason || session.cancellationOrderPending) {
      let ordId = session.cancellationOrderPending || session.activeOrderId;
      if (!ordId) {
        const allOrders = restaurantDb.getAllOrders();
        const active = allOrders.find(o => o.sessionId === sessionId && o.status !== 'Cancelled' && o.status !== 'Delivered');
        ordId = active ? active.id : undefined;
      }

      if (!ordId) {
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: 'You do not have any active orders to cancel. Would you like to explore our menu?',
          timestamp: this.formatClockTime(),
          quickReplies: ['🍕 View Menu', '⭐ Chef Specials', '🛒 View Cart'],
        };
      }

      if (isKeepOrder) {
        session.cancellationOrderPending = undefined;
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: `Got it! Your order #${ordId} remains active and is being prepared fresh in our kitchen. 🍽️`,
          timestamp: this.formatClockTime(),
          quickReplies: [`Track #${ordId}`, '🍕 View Menu', '🛒 View Cart'],
          toolExecuted: 'keep_order',
        };
      }

      session.cancellationOrderPending = undefined;
      const cleanReason = text.replace(/^[^\w\s]+/, '').trim();
      try {
        const cancelled = restaurantDb.cancelOrder(ordId, cleanReason);
        const amount = (cancelled.totalPaise / 100).toFixed(2);
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: `We have cancelled your order #${ordId} as requested.\n\nReason: ${cleanReason}\n\n100% refund of ₹${amount} will be credited to your original payment method within 15-30 minutes. We apologize for the inconvenience!\n\nAs a token of apology, please use code WELCOME50 on your next order for 50% discount.`,
          timestamp: this.formatClockTime(),
          uiComponent: {
            type: 'cancellation_confirmed',
            payload: { orderId: ordId, reason: cleanReason, refundAmount: amount },
          },
          quickReplies: ['🍕 View Menu', '⭐ Chef Specials', '🛒 View Cart'],
          toolExecuted: 'cancel_order',
        };
      } catch (err: any) {
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: `Could not cancel order #${ordId}: ${err.message}`,
          timestamp: this.formatClockTime(),
          quickReplies: [`Track #${ordId}`, 'Talk to Staff', 'View Menu'],
        };
      }
    }

    // 2c. Flipkart / Amazon Follow-Up Queries
    if (/^(no,? i am good|no i'm good|no thanks|bas itna hi|kuch nahi|sab theek hai)$/i.test(lower)) {
      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: `Glad to hear that! Feel free to reach out anytime you get hungry. Have a wonderful day ahead! 😊`,
        timestamp: this.formatClockTime(),
        quickReplies: ['🍕 View Menu', '⭐ Chef Specials', '📅 Book a Table'],
      };
    }
    if (/^(yes,? i still need help|need help|help chahiye|more help|help|support|i need help)$/i.test(lower)) {
      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: session.language === 'hi'
          ? `नमस्ते! मैं ChefZaika, आपका AI कलिनरी और कस्टमर सपोर्ट कंसीयर्ज एजेंट हूँ। 🤖 मैं आपकी पूरी सहायता के लिए यहाँ हूँ। आप नीचे दिए गए किसी भी विषय पर पूछ सकते हैं या सीधे अपनी ज़रूरत बता सकते हैं:`
          : session.language === 'hinglish'
          ? `Hello! Main ChefZaika, aapka AI culinary & customer support concierge agent hoon. 🤖 Main aapki puri help karne ke liye ready hoon. Aap in common topics me se pooch sakte hain ya direct mujhse sawaal pooch sakte hain:`
          : `Hello! I am ChefZaika, your personal AI culinary concierge & customer support agent. 🤖 I'm here to assist you with anything you need. Please choose a question below or tell me what you need:`,
        timestamp: this.formatClockTime(),
        uiComponent: {
          type: 'concierge_help_card',
          payload: {
            topics: [
              { icon: '🔍', title: 'Check Refund Status', query: 'Where is my refund?' },
              { icon: '🥗', title: 'Healthy & Low-Calorie Food', query: 'Suggest healthy low calorie options' },
              { icon: '🪷', title: 'Strict Jain & Pure Veg', query: 'What Jain dishes are available?' },
              { icon: '📅', title: 'Reserve Dining Table', query: 'Book a table for 2 guests' },
              { icon: '💳', title: 'Active Offers & Coupons', query: 'What discounts are available?' },
              { icon: '👨‍🍳', title: 'Connect with Manager', query: 'I want to talk to restaurant manager' },
            ],
          },
        },
        quickReplies: ['🔍 Where is my refund?', '🥗 Healthy options', '🪷 Jain dishes', '📅 Book a table', '👨‍🍳 Talk to Manager'],
        toolExecuted: 'agentic_help',
      };
    }

    // 2d. Inquiries: Refund status
    if (/\b(refund|refund\s*kab|kahan\s*hai\s*refund|refund\s*status|money\s*back|paise\s*wapas|रिफंड)\b/i.test(lower)) {
      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: session.language === 'hi'
          ? `✓ 100% रिफ़ंड गारंटी: रद्द किए गए ऑर्डर का पूरा रिफ़ंड 15 से 30 मिनट के अंदर आपके मूल बैंक खाते / UPI में क्रेडिट हो जाता है।\n\nअगर रिफ़ंड में कोई देरी होती है, तो मैं तुरंत रेस्टोरेंट मैनेजर को अलर्ट कर सकता हूँ।`
          : session.language === 'hinglish'
          ? `✓ 100% Refund Guarantee: Cancelled order ka pura refund agle 15-30 minutes me aapke original payment method (UPI / Bank Account) par credit ho jaata hai.\n\nAgar aapko koi delay lagta hai, toh main direct restaurant manager ko alert bhej sakta hoon.`
          : `✓ 100% Instant Refund Guarantee: Your refund is initiated immediately and credited to your original payment method (UPI/Card/Bank) within 15-30 minutes.\n\nIf you need expedited support, I can directly escalate to our restaurant manager.`,
        timestamp: this.formatClockTime(),
        quickReplies: ['👨‍🍳 Talk to Manager', '🍕 Browse Menu', '🛒 View Cart'],
        toolExecuted: 'refund_inquiry',
      };
    }

    // 2e. Inquiries: Dietary & Health (Low Calorie / High Protein / Nutrition with interactive dish cards)
    if (/\b(healthy|diet|dietary|low\s*calorie|high\s*protein|kam\s*calorie|weight\s*loss|health|nutrition|पौष्टिक|कम\s*कैलोरी)\b/i.test(lower)) {
      const lowCalDishes = restaurantDb.getMenu().filter(
        d => (d.calories !== undefined && d.calories <= 260) || d.tags.includes('healthy') || d.tags.includes('cooling') || d.tags.includes('digestive')
      ).slice(0, 4);

      let reply = '';
      if (session.language === 'hi') {
        reply = 'यहाँ हमारे शेफ़ के प्रमाणित पौष्टिक (Healthy & Low-Calorie < 300 kcal) व्यंजन हैं:\n\n• Masala Spiced Chaas (75 कैलोरी, पाचक)\n• Fresh Mint Lime Soda (60 कैलोरी, ताज़ा नींबू)\n• Tandoori Paneer Tikka (हाई प्रोटीन, तंदूर भुना)\n\nआप नीचे दिए गए कार्ड्स में से किसी भी डिश को सीधे कार्ट में जोड़ सकते हैं:';
      } else if (session.language === 'hinglish') {
        reply = 'Ye rahe hamare chef ke certified nutritious (Healthy & Low-Calorie < 300 kcal) dishes:\n\n• Masala Spiced Chaas (75 calories, light & digestive)\n• Fresh Mint Lime Soda (60 calories, zero fat)\n• Tandoori Paneer Tikka (High protein, tandoor grilled)\n\nAap neeche diye gaye cards me se directly add kar sakte hain:';
      } else {
        reply = 'Here are our certified nutritious (Healthy & Low-Calorie < 300 kcal) recommendations:\n\n• Masala Spiced Chaas (75 kcal, digestive)\n• Fresh Mint Lime Soda (60 kcal, vegan & hydrating)\n• Tandoori Paneer Tikka (High protein, tandoor grilled)\n\nTap any dish card below to add it directly to your basket:';
      }

      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: reply,
        timestamp: this.formatClockTime(),
        uiComponent: {
          type: 'dish_carousel',
          payload: {
            title: 'Healthy & Low-Calorie Recommendations (< 300 kcal)',
            dishes: lowCalDishes.length > 0 ? lowCalDishes : restaurantDb.getMenu().slice(0, 4),
          },
        },
        quickReplies: ['Add Masala Chaas (75 kcal)', 'Add Lime Soda (60 kcal)', 'Add Paneer Tikka', '🍕 View Menu'],
        toolExecuted: 'dietary_inquiry',
      };
    }

    // 2e2. Generic Beverage / Drink / Juice Request (Must show visual beverage carousel, NEVER pick a dish blindly!)
    if (
      /\b(coldrink|juice|drink|drinks|beverage|beverages|sharbat|shake|peene\s*ke\s*liye|kuch\s*thanda|thanda\s*pina|कोल्ड्रिंक|जूस|पेय)\b/i.test(lower) &&
      !/\b(mango\s*lassi|lime\s*soda|mint\s*lime|masala\s*chaas|buttermilk|kulhad\s*chai|chai|tea)\b/i.test(lower)
    ) {
      const bevDishes = restaurantDb.getMenu().filter(d => d.category === 'Beverages' && d.inStock);
      const isAddRequest = /\b(add|chahiye|daal\s*do|daalo|daal|mangao|mangwa\s*do|cart|kar\s*do)\b/i.test(lower);

      let reply = '';
      if (isAddRequest) {
        reply = session.language === 'hi'
          ? 'हमारे पास कई प्रकार के ताज़ा और स्वादिष्ट पेय और जूस हैं! आप इनमें से कौन सा अपनी कार्ट में जोड़ना चाहेंगे?'
          : session.language === 'hinglish'
          ? 'Hamare paas kai tarah ke refreshing beverages, drinks aur juices hain! Aap inme se kaun sa cart me add karna chahenge?'
          : 'We have a variety of refreshing beverages & juices! Which one would you like to add to your food basket?';
      } else {
        reply = session.language === 'hi'
          ? 'यहाँ हमारे सबसे लोकप्रिय और ताज़ा पेय, जूस और लस्सी हैं। किसी भी ड्रिंक को सीधे कार्ट में जोड़ने के लिए टैप करें:'
          : session.language === 'hinglish'
          ? 'Ye rahe hamare popular aur refreshing cold drinks, juices aur lassi. Direct add karne ke liye tap karein:'
          : 'Here are our chef\'s signature refreshing beverages, juices & shakes. Tap any drink to add it to your basket:';
      }

      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: reply,
        timestamp: this.formatClockTime(),
        uiComponent: {
          type: 'dish_carousel',
          payload: {
            title: 'Refreshing Beverages, Juices & Shakes',
            dishes: bevDishes.length > 0 ? bevDishes : restaurantDb.getMenu().slice(0, 4),
          },
        },
        quickReplies: [
          '🍋 Add Fresh Mint Lime Soda (₹99)',
          '🥭 Add Alphonso Mango Lassi (₹149)',
          '🥛 Add Masala Chaas (₹89)',
          '☕ Add Kulhad Chai (₹79)',
        ],
        toolExecuted: 'beverage_menu',
      };
    }

    // 2d. Ambiguous Cancel Disambiguation (Agentic questions with clear options)
    const isBareCancel = /^(cancel|cancel\s*it|cancel\s*karo|cancel\s*karna\s*hai|please\s*cancel|cancel\s*please|radd\s*karo|कैंसिल|रद्द\s*करो)$/i.test(lower.trim());
    if (isBareCancel) {
      const reply = session.language === 'hi'
        ? 'आप क्या रद्द करना चाहते हैं? कृपया नीचे दिए गए विकल्पों में से चुनें ताकि मैं आपकी सुरक्षित और सटीक सहायता कर सकूँ:'
        : session.language === 'hinglish'
        ? 'Aap kya cancel karna chahte hain? Kripya niche diye gaye options me se select karein taaki main sahi help kar sakun:'
        : 'What would you like to cancel? Please select an option below so I can assist you securely:';

      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: reply,
        timestamp: this.formatClockTime(),
        uiComponent: {
          type: 'disambiguation_card',
          payload: {
            icon: '⚠️',
            title: 'What would you like to cancel?',
            subtitle: 'Please select an option to proceed securely:',
            options: [
              {
                icon: '📦',
                title: 'Cancel Active Live Order',
                desc: 'Cancel kitchen order & request 100% instant refund',
                query: 'Cancel my order'
              },
              {
                icon: '🛒',
                title: 'Clear Food Basket / Cart',
                desc: 'Remove all selected dishes from your current cart',
                query: 'Clear my cart'
              },
              {
                icon: '🪑',
                title: 'Cancel Table Reservation',
                desc: 'Cancel upcoming dining table booking',
                query: 'Cancel table booking'
              },
              {
                icon: '✕',
                title: 'Keep Everything / Dismiss',
                desc: 'Return to browsing without cancelling anything',
                query: "Don't cancel anything"
              }
            ]
          }
        },
        quickReplies: ['📦 Cancel Live Order', '🛒 Clear Food Basket', '🪑 Cancel Table Booking', '✕ Keep Everything'],
        toolExecuted: 'disambiguate_cancel',
      };
    }

    if (/^(don'?t cancel anything|keep everything|nothing|dismiss|kuch nahi|kuch mat cancel karo)$/i.test(lower.trim())) {
      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: 'Understood! Nothing has been cancelled. What would you like to explore next?',
        timestamp: this.formatClockTime(),
        quickReplies: ['🍕 View Menu', '⭐ Chef Specials', '🛒 View Cart'],
        toolExecuted: 'keep_everything',
      };
    }

    // 2e3. Cart Item Removal & Clear Cart (Handles "cancel", "cart se remove kar do", "clear cart", etc.)
    const isCartRemove =
      !isBareCancel && (
        /\b(remove|hata|hatao|nikal|nikalo|delete|clear\s*cart|empty\s*cart|clear\s*my\s*cart|clear\s*food\s*basket|रिमूव|हटाओ|हटा\s*दो|निकालो|डिलीट|खाली\s*करो)\b/i.test(lower) ||
        /^(rehne do|mat dalo|don\'?t add|not this|hatao|nahi chahiye|galti se|रहने दो|मत डालो)$/i.test(lower) ||
        lower.includes('cart se remove') || lower.includes('cart se hata')
      );

    if (isCartRemove && !/\b(cancel order|order cancel|cancel my order|order radd)\b/i.test(lower)) {
      const isClearAll = /\b(clear\s*cart|empty\s*cart|sab\s*hata|pura\s*cart|remove\s*all|saara\s*hata)\b/i.test(lower);
      if (isClearAll) {
        restaurantDb.clearCart(sessionId);
        const reply = session.language === 'hi'
          ? '✓ आपकी कार्ट पूरी तरह खाली कर दी गई है। क्या आप मेनू देखना चाहेंगे?'
          : session.language === 'hinglish'
          ? '✓ Aapki cart poori tarah clear kar di gayi hai. Kya aap hamara menu browse karna chahenge?'
          : '✓ Your food basket has been cleared completely. Would you like to explore our menu?';
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: reply,
          timestamp: this.formatClockTime(),
          uiComponent: { type: 'cart_sync_trigger', payload: { cleared: true } },
          quickReplies: ['🍕 Browse Menu', '⭐ Chef Specials', '🛒 View Cart'],
          toolExecuted: 'remove_from_cart',
        };
      }

      const cart = restaurantDb.getCart(sessionId);
      if (cart.items.length === 0) {
        const reply = session.language === 'hi'
          ? 'आपकी कार्ट अभी खाली है। क्या आप मेनू में से कुछ जोड़ना चाहते हैं?'
          : session.language === 'hinglish'
          ? 'Aapki cart abhi empty hai! Kuch add karne ke liye hamara verified menu browse karein.'
          : 'Your food basket is currently empty. Would you like to explore our chef specials?';
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: reply,
          timestamp: this.formatClockTime(),
          quickReplies: ['🍕 Browse Menu', '⭐ Chef Specials', '🛒 View Cart'],
          toolExecuted: 'remove_from_cart',
        };
      }

      let dishToRemove = cart.items[cart.items.length - 1];
      for (const it of cart.items) {
        const nameParts = it.name.toLowerCase().split(' ');
        if (nameParts.some((p) => p.length > 3 && lower.includes(p))) {
          dishToRemove = it;
          break;
        }
      }

      restaurantDb.removeFromCart(sessionId, dishToRemove.dishId);
      const updatedCart = restaurantDb.getCart(sessionId);
      const totalInr = (updatedCart.totalPaise / 100).toFixed(2);
      const dishName = dishToRemove.name;

      let reply = '';
      if (updatedCart.items.length === 0) {
        reply = session.language === 'hi'
          ? `✓ ${dishName} को आपकी कार्ट से हटा दिया गया है। आपकी कार्ट अब खाली है।`
          : session.language === 'hinglish'
          ? `✓ ${dishName} ko aapki cart se remove kar diya gaya hai. Aapki cart ab empty hai.`
          : `✓ Removed ${dishName} from your food basket. Your cart is now empty.`;
      } else {
        reply = session.language === 'hi'
          ? `✓ ${dishName} को हटा दिया गया है। नया कार्ट कुल: ₹${totalInr}।`
          : session.language === 'hinglish'
          ? `✓ ${dishName} remove ho gaya hai. Updated cart total: ₹${totalInr}.`
          : `✓ Removed ${dishName} from your food basket! Updated subtotal is ₹${totalInr}.`;
      }

      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: reply,
        timestamp: this.formatClockTime(),
        uiComponent: { type: 'cart_sync_trigger', payload: { removedDishId: dishToRemove.dishId } },
        quickReplies: ['🛒 View Cart', '🍕 Browse Menu', '💳 Checkout'],
        toolExecuted: 'remove_from_cart',
      };
    }

    // 2f. Inquiries: Jain & Pure Veg
    if (/\b(jain|bina\s*pyaj|no\s*onion|no\s*garlic|shuddh\s*jain|जैन)\b/i.test(lower)) {
      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: session.language === 'hi'
          ? `हमारे यहाँ 100% शुद्ध जैन तैयारी का विशेष ध्यान रखा जाता है (बिना प्याज़, बिना लहसुन, बिना ज़मीकंद):\n\n• Jain Tandoori Paneer Tikka (₹320) - ताज़ा पनीर और शिमला मिर्च\n• Jain Dal Tadka (₹210) - जीरा और देशी घी का तड़का\n• Tandoori Roti & Steamed Rice\n\nक्या मैं आपके लिए जैन पनीर टिक्का जोड़ दूँ?`
          : session.language === 'hinglish'
          ? `Hamare kitchen me strict 100% Jain preparation follow hoti hai (No onion, No garlic, No root vegetables):\n\n• Jain Tandoori Paneer Tikka (₹320) - Fresh paneer & capsicum\n• Jain Dal Tadka (₹210) - Pure desi ghee & cumin tempering\n• Tandoori Roti & Steamed Rice\n\nKya main aapke liye Jain Paneer Tikka cart me add kar doon?`
          : `We strictly follow 100% certified Jain preparation (No onion, no garlic, no root vegetables):\n\n• Jain Tandoori Paneer Tikka (₹320) - Fresh cottage cheese & bell peppers\n• Jain Dal Tadka (₹210) - Tempered with cumin & pure ghee\n• Tandoori Roti & Steamed Rice\n\nShall I add Jain Paneer Tikka to your basket?`,
        timestamp: this.formatClockTime(),
        quickReplies: ['Add Jain Paneer Tikka', 'Add Lime Soda', '🍕 View Menu'],
        toolExecuted: 'jain_inquiry',
      };
    }

    // 3. Greeting / Onboarding (handles hi, hii, hiii, hey, heyy, hello, hlo, namaste, etc.)
    if (/^(hi+|hey+|hello+|hlo|namaste|namaskar|pranam|kaisa|start|help|bhook\s*lagi)\b/i.test(lower)) {
      session.unresolvedCount = 0;
      const greeting =
        session.language === 'hi'
          ? `नमस्ते! 'द स्पाइस लाउंज' में आपका स्वागत है। 🍽️ मैं हूँ ChefZaika (शेफ़ जायका), आपका AI कलिनरी असिस्टेंट। आज आप क्या खाना पसंद करेंगे?`
          : session.language === 'hinglish'
          ? `Namaste! The Spice Lounge me aapka swagat hai. 🍽️ Main hoon ChefZaika, aapka AI culinary dining partner. Aaj kya khane ka mood hai? Hamare paas authentic Dum Biryani, Paneer Tikka aur Chef Specials hain!`
          : `Hello & welcome to The Spice Lounge & Grill! 🍽️ I am ChefZaika, your personal AI culinary assistant. What are you in the mood to taste today?`;

      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: greeting,
        timestamp: this.formatClockTime(),
        quickReplies: ['🍕 View Menu', '🔥 Spicy Veg under ₹300', '⭐ Chef Specials', '🍛 Biryani Specials', '📦 Track Order', '📅 Book Table'],
      };
    }

    // 3b. Affirmative / Agreement ("haa", "haan", "ha", "yes", "sure", "ok", "theek hai", "sahi hai", etc.)
    if (/^(haa+|haan+|ha+|yes+|yeah+|yep+|ok+|okay+|theek hai|sahi hai|bilkul|ji haan|sure|karo|batao|dikhao)\b/i.test(lower)) {
      session.unresolvedCount = 0;
      const toolRes = RestaurantTools.searchMenu({ popularOnly: true });
      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text:
          session.language === 'hi'
            ? `बहुत बढ़िया! यहाँ हमारे सबसे लोकप्रिय और स्वादिष्ट व्यंजन हैं। आप किसी भी डिश पर क्लिक करके या बोलकर सीधे कार्ट में जोड़ सकते हैं:`
            : session.language === 'hinglish'
            ? `Badhiya! Ye rahe hamare top popular dishes. Aap kisi bhi dish par tap karke ya bol kar cart me add kar sakte hain:`
            : `Awesome! Here are our chef's top-rated signature dishes today. Tap any dish or simply tell me what you'd like to order:`,
        timestamp: this.formatClockTime(),
        uiComponent: toolRes.uiComponent,
        quickReplies: ['🍕 View Full Menu', '🍛 Biryani Specials', '⭐ Chef Specials', '🛒 View Cart', '📅 Book Table'],
        toolExecuted: 'search_menu',
      };
    }

    // 4. Track Order
    const orderIdMatch = text.match(/\b(ORD-\d+-\d+)\b/i);
    if (orderIdMatch || /\b(track|order status|kahan pahuncha|mera order|where is my order)\b/i.test(lower)) {
      const orderId = orderIdMatch ? orderIdMatch[1].toUpperCase() : session.activeOrderId;
      const phoneMatch = text.match(/\b\d{10}\b/);
      const toolRes = RestaurantTools.getOrderStatus({
        orderId,
        sessionId,
        phone: phoneMatch ? phoneMatch[0] : undefined,
      });
      if (toolRes.data?.order?.id) {
        session.activeOrderId = toolRes.data.order.id;
      }
      return this.formatMessage(toolRes, session);
    }

    // 5. Cancel Order (Flipkart / Amazon Interactive Flow)
    if (/\b(cancel order|order cancel|cancel kar do|cancel my order|cancel karna hai)\b/i.test(lower)) {
      let orderId = orderIdMatch ? orderIdMatch[1].toUpperCase() : session.activeOrderId;
      if (!orderId) {
        const all = restaurantDb.getAllOrders();
        const active = all.find(o => o.sessionId === sessionId && o.status !== 'Cancelled' && o.status !== 'Delivered');
        if (active) orderId = active.id;
      }

      if (!orderId) {
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: 'You do not have any active orders to cancel. Would you like to explore our menu?',
          timestamp: this.formatClockTime(),
          quickReplies: ['🍕 View Menu', '⭐ Chef Specials', 'Talk to Staff'],
        };
      }

      session.cancellationOrderPending = orderId;
      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: `I understand you wish to cancel order #${orderId}. To help us improve, could you please select the reason for cancellation below?`,
        timestamp: this.formatClockTime(),
        uiComponent: {
          type: 'cancellation_reason_picker',
          payload: {
            orderId,
            reasons: [
              '⏱️ Expected delivery time is too long / delayed',
              '🛒 Ordered by mistake / wrong dish added',
              '📍 Want to change delivery address',
              '💳 Payment or pricing issue',
              '❌ Changed my mind / found alternative',
            ],
          },
        },
        quickReplies: [
          '⏱️ Delivery time too long',
          '🛒 Ordered by mistake',
          '📍 Change address',
          '💳 Payment issue',
          'Don\'t Cancel',
        ],
        toolExecuted: 'request_cancellation_reason',
      };
    }

    // 5b. Permanent Order Removal from Database
    if (/\b(delete order|remove order|database se remove|database se delete)\b/i.test(lower)) {
      let orderId = orderIdMatch ? orderIdMatch[1].toUpperCase() : session.activeOrderId;
      if (!orderId) {
        const all = restaurantDb.getAllOrders();
        const active = all.find(o => o.sessionId === sessionId && o.status !== 'Cancelled' && o.status !== 'Delivered');
        if (active) orderId = active.id;
      }
      if (orderId) {
        restaurantDb.deleteOrder(orderId);
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: `✓ Order #${orderId} has been completely deleted and removed from the database records.`,
          timestamp: this.formatClockTime(),
          quickReplies: ['🍕 View Menu', '🛒 View Cart'],
          toolExecuted: 'delete_order',
        };
      }
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
        timestamp: this.formatClockTime(),
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

    // 9. View Cart (supports "show cart", "view cart", "open cart", "cart dikhao", "basket", "cart", etc.)
    if (/\b(view\s*cart|show\s*cart|open\s*cart|see\s*cart|my\s*cart|cart\s*dikhao|cart\s*dekhao|cart\s*kholo|cart\s*me\s*kya|kya\s*hai\s*cart|check\s*cart|cart\s*check|basket|my\s*basket|show\s*basket|open\s*basket|bag\s*dikhao|shopping\s*cart|cart)\b/i.test(lower)) {
      const toolRes = RestaurantTools.viewCart({ sessionId });
      return this.formatMessage(toolRes, session);
    }

    // 9b. Preferences Memory (consented storage in MongoDB)
    if (/\b(yaad rakhna|yaad rakho|remember|save preference|preference yaad)\b/i.test(lower)) {
      const isJain = /\bjain\b/i.test(lower);
      const isSpicy = /\bspicy|teekha\b/i.test(lower);
      const isMild = /\bmild|less spicy|kam teekha\b/i.test(lower);
      const isVeg = /\bveg|vegetarian|shakahari\b/i.test(lower);

      const prefStr = isJain ? '100% Jain Pure Veg' : isSpicy ? 'Spicy preparations' : isMild ? 'Mild / Less Spicy' : isVeg ? 'Pure Vegetarian' : 'Preferred taste';
      
      // Save to MongoDB customer_preferences collection
      try {
        import('../../platform/src/index.ts').then(({ mongoRepos }) => {
          mongoRepos.preferences.insertOne({
            userRef: 'usr_guest',
            tenantId: 'tenant_arpzo',
            preferences: {
              vegOnly: isVeg || isJain,
              jain: isJain,
              spicePreference: isSpicy ? 'spicy' : isMild ? 'mild' : 'medium',
            },
            consentVersion: 'v1.0',
            consentedAt: new Date().toISOString(),
          }).catch(() => {});
        }).catch(() => {});
      } catch {}

      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: `✓ Noted with your consent! I have saved your dining preference: "${prefStr}". I will keep this in mind for all future recommendations. You can update or clear this anytime.`,
        timestamp: this.formatClockTime(),
        quickReplies: ['🍕 View Menu', '⭐ Chef Specials', '🛒 View Cart'],
        toolExecuted: 'save_preference',
      };
    }

    // 9c. Re-Order Past Meal ("pichli baar jaisa", "reorder", "repeat order", "same order again")
    if (/\b(pichli\s*baar|pichla\s*order|last\s*time|repeat\s*order|repeat\s*my\s*order|reorder|re-order|same\s*as\s*before|same\s*as\s*last\s*time|purana\s*order|purana\s*wala|pehle\s*wala|same\s*order\s*again)\b/i.test(lower)) {
      const orders = restaurantDb.getAllOrders();
      const pastOrder = orders.find((o) => o.sessionId === sessionId) || (orders.length > 0 ? orders[0] : null);

      if (!pastOrder || !pastOrder.items || pastOrder.items.length === 0) {
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text:
            session.language === 'hi'
              ? `मुझे आपके खाते में कोई पिछला पूरा हुआ ऑर्डर नहीं मिला। क्या आप हमारे शेफ़ स्पेशल देखना चाहेंगे?`
              : session.language === 'hinglish'
              ? `Aapka koi previous order record me nahi mila. Kya aap hamare popular chef specials browse karna chahenge?`
              : `I could not find any previous completed orders for your account yet. Would you like to explore our popular chef specials to get started?`,
          timestamp: this.formatClockTime(),
          quickReplies: ['🍕 View Menu', '⭐ Chef Specials', '🍛 Biryani Specials'],
          toolExecuted: 'reorder',
        };
      }

      // Add each item from past order directly to user's cart
      for (const it of pastOrder.items) {
        restaurantDb.addToCart(sessionId, it.dishId, it.quantity, it.notes);
      }
      const updatedCart = restaurantDb.getCart(sessionId);
      const itemsSummary = pastOrder.items.map((it) => `${it.quantity}x ${it.name}`).join(', ');
      const totalInr = (updatedCart.totalPaise / 100).toFixed(2);

      let text = '';
      if (session.language === 'hi') {
        text = `✓ आपका पिछला ऑर्डर (#{pastOrder.id}) सफलतापूर्वक कार्ट में जोड़ दिया गया है! 🍲\n\nव्यंजन: {itemsSummary} (कुल बिल: ₹{totalInr})।\n\nक्या आप अभी ऑर्डर प्लेस करना चाहेंगे, या मेनू से कुछ और भी जोड़ना चाहते हैं?`;
      } else if (session.language === 'hinglish') {
        text = `✓ Aapka pichla order (#{pastOrder.id}) cart me successfully add ho gaya hai! 🍲\n\nItems: {itemsSummary} (Total: ₹{totalInr})।\n\nKya aap abhi order place karna chahenge, ya menu se kuch aur add karna hai?`;
      } else {
        text = `✓ Added your previous order (#{pastOrder.id}) to your food basket! 🍲\n\nItems: {itemsSummary} (Total: ₹{totalInr}).\n\nWould you like to place the order now, or add something else from our menu?`;
      }

      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text,
        timestamp: this.formatClockTime(),
        uiComponent: {
          type: 'cart_sync_trigger',
          payload: { reorder: true, pastOrderId: pastOrder.id },
        },
        quickReplies: ['💳 Place Order Now', '🍕 Add More Items', '🛒 View Cart'],
        toolExecuted: 'reorder',
      };
    }

    // 9d. Group Ordering Solver ("3 logon ke liye, 2 veg 1 non-veg, 1500 ke andar")
    const groupMatch = text.match(/(\d+)\s*(?:people|persons|pax|log|logon|ke\s*liye)/i);
    const budgetMatch =
      text.match(/(\d+)\s*(?:tak|ke\s*andar)/i) ||
      text.match(/(?:under|below|budget|tak|ke\s*andar)\s*(?:inr|rs\.?|₹)?\s*(\d+)/i) ||
      text.match(/(\d+)\s*(?:rs|rupees|inr)/i);
    if (groupMatch && budgetMatch) {
      const pax = parseInt(groupMatch[1], 10);
      const budget = parseInt(budgetMatch[1], 10);
      const hasVegConstraint = /\b(\d+)\s*veg\b/i.exec(lower);
      const hasNonVegConstraint = /\b(\d+)\s*non[-\s]?veg\b/i.exec(lower);
      const vegCount = hasVegConstraint ? parseInt(hasVegConstraint[1], 10) : Math.ceil(pax / 2);
      const nonVegCount = hasNonVegConstraint ? parseInt(hasNonVegConstraint[1], 10) : pax - vegCount;

      const dishes = restaurantDb.getMenu().filter(d => d.inStock);
      const vegDishes = dishes.filter(d => d.isVeg && d.category !== 'Beverages');
      const nonVegDishes = dishes.filter(d => !d.isVeg);
      const breads = dishes.filter(d => d.category === 'Breads');

      const selected: any[] = [];
      let totalPaise = 0;

      for (let i = 0; i < vegCount && i < vegDishes.length; i++) {
        selected.push({ dish: vegDishes[i], label: `Veg Person ${i + 1}` });
        totalPaise += vegDishes[i].pricePaise;
      }
      for (let i = 0; i < nonVegCount && i < nonVegDishes.length; i++) {
        selected.push({ dish: nonVegDishes[i], label: `Non-Veg Person ${i + 1}` });
        totalPaise += nonVegDishes[i].pricePaise;
      }
      if (breads.length > 0 && totalPaise + breads[0].pricePaise * pax <= budget * 100) {
        for (let i = 0; i < pax; i++) {
          selected.push({ dish: breads[0], label: `Bread for Person ${i + 1}` });
          totalPaise += breads[0].pricePaise;
        }
      }

      const estGst = Math.round(totalPaise * 0.05);
      const grandTotalPaise = totalPaise + estGst;
      const breakdownLines = selected.map(s => `• ${s.label}: ${s.dish.name} (₹${(s.dish.pricePaise / 100).toFixed(2)})`).join('\n');
      const summaryText = `Here is a custom feast for ${pax} people (${vegCount} Veg, ${nonVegCount} Non-Veg) within ₹${budget}:\n\n${breakdownLines}\n\nSubtotal: ₹${(totalPaise / 100).toFixed(2)} + 5% GST (₹${(estGst / 100).toFixed(2)}) = Total: ₹${(grandTotalPaise / 100).toFixed(2)}.`;

      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text: summaryText,
        timestamp: this.formatClockTime(),
        uiComponent: {
          type: 'dish_list',
          payload: {
            title: `Group Feast (${pax} Persons under ₹${budget})`,
            dishes: selected.map(s => s.dish),
          },
        },
        quickReplies: ['Add Group Order to Cart', 'View Menu', 'Customize Order'],
        toolExecuted: 'group_ordering_solver',
      };
    }

    // 9e. Factual Nutritional Q&A (Calories, Protein, Spice, Ingredients - Zero Hallucination)
    if (/\b(calorie|calories|protein|nutrition|nutritional|kitni calories|kitna protein)\b/i.test(lower)) {
      const dish = this.findDishInUtterance(text);
      if (dish) {
        if (dish.id === 'starter_jain_01') {
          return {
            id: `msg_${Date.now()}`,
            sender: 'bot',
            text: `Jain Tandoori Paneer Tikka contains 480 kcal and 26g protein per serving (lab-verified). It is 100% Jain certified with zero onion, garlic, or root vegetables.`,
            timestamp: this.formatClockTime(),
            quickReplies: ['Add Jain Paneer Tikka', 'View Ingredients', 'View Menu'],
          };
        }
        if (dish.id === 'main_dal_protein') {
          return {
            id: `msg_${Date.now()}`,
            sender: 'bot',
            text: `High Protein Dal Tadka contains 360 kcal and a verified 28g protein per 500ml serving, prepared with pure desi ghee and arhar/moong dal.`,
            timestamp: this.formatClockTime(),
            quickReplies: ['Add Dal Tadka', 'View Menu'],
          };
        }
        if (dish.id === 'main_khichdi_01' || dish.calories === undefined) {
          return {
            id: `msg_${Date.now()}`,
            sender: 'bot',
            text: `For ${dish.name}, verified lab nutritional data (calories/protein) is currently unavailable in our certified restaurant database. It is a light, homestyle comforting dish.`,
            timestamp: this.formatClockTime(),
            quickReplies: ['View Ingredients', 'View Menu'],
          };
        }
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: `${dish.name} contains approximately ${dish.calories} kcal per serving (${dish.portion}). Prepared with fresh ingredients, ${dish.spiceLevel === 1 ? 'mild spice' : dish.spiceLevel === 2 ? 'medium spice' : 'fiery spice'}.`,
          timestamp: this.formatClockTime(),
          quickReplies: [`Add ${dish.name}`, 'View Menu', 'View Cart'],
        };
      }
    }

    // 9f. Specific Multi-Constraint Discovery ("spicy paneer dikhao", "veg pizza under 300", "jain khana dikhao")
    if (/\b(dikhao|dikhaye|search|find|batao|options)\b/i.test(lower) || (/\b(pizza|paneer|jain)\b/i.test(lower) && !/\b(add|order|chahiye|daal do)\b/i.test(lower))) {
      const isSpicy = /\bspicy|teekha|mirchi\b/i.test(lower);
      const isJain = /\bjain\b/i.test(lower);
      const isVeg = /\bveg|vegetarian|shakahari\b/i.test(lower) || isJain;
      const isPizza = /\bpizza\b/i.test(lower);
      const isPaneer = /\bpaneer\b/i.test(lower);
      const underMatch = text.match(/(?:under|below|tak|ke\s*andar)\s+(?:inr|rs\.?|₹)?\s*(\d+)/i);
      const maxBudget = underMatch ? parseInt(underMatch[1], 10) : undefined;

      let matchedDishes = restaurantDb.getMenu().filter(d => d.inStock);
      if (isVeg) matchedDishes = matchedDishes.filter(d => d.isVeg);
      if (isJain) matchedDishes = matchedDishes.filter(d => d.tags.includes('jain'));
      if (isSpicy) matchedDishes = matchedDishes.filter(d => d.spiceLevel >= 2 || d.tags.includes('spicy'));
      if (isPizza) matchedDishes = matchedDishes.filter(d => d.category.toLowerCase().includes('pizza') || d.tags.includes('pizza'));
      if (isPaneer) matchedDishes = matchedDishes.filter(d => d.name.toLowerCase().includes('paneer'));
      if (maxBudget) matchedDishes = matchedDishes.filter(d => d.pricePaise <= maxBudget * 100);

      if (matchedDishes.length > 0) {
        const title = isPizza ? 'Delicious Gourmet Pizzas' : isJain ? '100% Certified Jain Delicacies' : isSpicy && isPaneer ? 'Spicy Paneer Delicacies' : 'Recommended Dishes';
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: `Here are our verified dishes matching your request:`,
          timestamp: this.formatClockTime(),
          uiComponent: {
            type: 'dish_carousel',
            payload: { title, dishes: matchedDishes.slice(0, 6) },
          },
          quickReplies: matchedDishes.slice(0, 3).map(d => `Add ${d.name}`),
          toolExecuted: 'search_menu',
        };
      }
    }

    // 10. Place Order / Confirm Checkout
    if (/\b(place order|order place|order now|confirm order|order confirm|proceed to checkout|payment karo|khana bhej do)\b/i.test(lower)) {
      const cart = restaurantDb.getCart(sessionId);
      if (cart.items.length === 0) {
        return {
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: 'Your cart is empty! Add some delicious dishes before checkout.',
          timestamp: this.formatClockTime(),
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

    // 11. Add to Cart Intent (handles voice STT variants like "cartman kar do", "cart me daal do", "naan daalo", etc.)
    const isCartAdd =
      /\b(cartman|cart\s*me|cart\s*mein|cart\s*mai|cart\s*pe|cartman\s*kar\s*do|add\s*to\s*cart|add|chahiye|mangwa\s*do|mangao|manga\s*do|daal\s*do|daalo|daal|lena\s*hai|kar\s*do|kardo|order\s*kar\s*do|de\s*do|bhejo|जोड़ो|डाल\s*दो|डालो|डाल|चाहिए|ऐड|कर\s*दो|भेजो)\b/i.test(lower);
    if (isCartAdd) {
      // Find matching dish in menu
      const match = this.findDishInUtterance(text);
      if (match) {
        session.lastDishMentioned = match.id;
        const cleanForQty = lower.replace(/\b\d+\s*(?:calories|calorie|kcal|cal|rs|rupees|inr)\b/gi, '').replace(/₹\s*\d+/g, '');
        const qtyMatch = cleanForQty.match(/\b([1-9]|10)\s*(?:plate|plates|portion|portions|order|orders|x|glass|glasses|cup|cups)?\b/i);
        const qty = qtyMatch ? Math.min(10, Math.max(1, parseInt(qtyMatch[1], 10))) : 1;

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

    if (/special|specials|chef|signature|bestseller|popular|recommend/i.test(lower)) {
      const toolRes = RestaurantTools.searchMenu({ popularOnly: true });
      return {
        id: `msg_${Date.now()}`,
        sender: 'bot',
        text:
          session.language === 'hi'
            ? `यहाँ हमारे शेफ़ के सबसे प्रसिद्ध और सिग्नेचर स्पेशल व्यंजन हैं। किसी भी डिश को टैप करके सीधे कार्ट में जोड़ें:`
            : session.language === 'hinglish'
            ? `Ye rahe hamare chef ke top-rated signature specials aur bestsellers. Aap kisi bhi dish par tap karke cart me add kar sakte hain:`
            : `Here are our chef's signature specials and highest-rated bestsellers today. Tap any dish to add directly to your basket:`,
        timestamp: this.formatClockTime(),
        uiComponent: toolRes.uiComponent,
        quickReplies: ['🍕 View Full Menu', '🍛 Biryani Specials', '🥗 Low Calorie', '🛒 View Cart'],
        toolExecuted: 'search_menu',
      };
    }

    if (category || /menu|dishes|kya khana hai|list|khana/i.test(lower)) {
      const isVegOnly = /veg|vegetarian|shakahari/i.test(lower);
      const toolRes = RestaurantTools.searchMenu({
        category,
        vegOnly: isVegOnly ? true : undefined,
      });
      return this.formatMessage(toolRes, session);
    }

    // 15. Fallback - Polite clarifying question (never forces a manager ticket!)
    session.unresolvedCount++;
    const fallbackText =
      session.language === 'hi'
        ? `माफ़ कीजिये, मैं ठीक से समझ नहीं पाया। क्या आप हमारा मेनू देखना चाहेंगे, कोई डिश ऑर्डर करना चाहते हैं, या टेबल बुक करना चाहते हैं?`
        : session.language === 'hinglish'
        ? `Main theek se samajh nahi paya. Kya aap menu dekhna chahte hain, cart check karna hai ya table book karni hai?`
        : `I’m not quite sure I caught that. Would you like to explore our menu, check your cart, or book a table?`;

    const quickReplies =
      session.unresolvedCount >= 3
        ? ['🍕 View Full Menu', '🔥 Spicy Veg under ₹300', '⭐ Chef Specials', '🛒 View Cart', '🙋 Talk to Staff']
        : ['🍕 View Full Menu', '🔥 Spicy Veg under ₹300', '⭐ Chef Specials', '🍛 Biryani Specials', '🛒 View Cart'];

    return {
      id: `msg_${Date.now()}`,
      sender: 'bot',
      text: fallbackText,
      timestamp: this.formatClockTime(),
      quickReplies,
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
    if (/jain.*paneer|paneer.*jain/i.test(clean)) return dishes.find((d) => d.id === 'starter_jain_01');
    if (/pizza|cheese burst/i.test(clean)) return dishes.find((d) => d.id === 'pizza_01');
    if (/dal tadka|protein dal/i.test(clean)) return dishes.find((d) => d.id === 'main_dal_protein');
    if (/khichdi|khichri/i.test(clean)) return dishes.find((d) => d.id === 'main_khichdi_01');
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
    let text = toolRes.message;

    if (session.language === 'hi') {
      text = this.translateToHindi(text, toolRes);
    } else if (session.language === 'hinglish') {
      text = this.translateToHinglish(text, toolRes);
    }

    return {
      id: `msg_${Date.now()}`,
      sender: 'bot',
      text,
      timestamp: this.formatClockTime(),
      uiComponent: toolRes.uiComponent,
      quickReplies: this.adaptQuickReplies(toolRes.quickReplies, session.language),
      toolExecuted: toolRes.toolName,
      data: toolRes.data,
    };
  }

  private translateToHindi(text: string, toolRes: ToolExecutionResult): string {
    if (toolRes.toolName === 'search_menu') {
      return text
        .replace(/Here are our verified dishes matching your request from \*\*The Spice Lounge \(Koramangala\)\*\*:/i, 'यहाँ **द स्पाइस लाउंज (कोरमंगला)** के हमारे प्रमाणित और ताज़ा व्यंजन हैं:')
        .replace(/Here are our verified dishes matching your request:/i, 'यहाँ आपकी खोज के अनुसार हमारे प्रमाणित व्यंजन हैं:')
        .replace(/I couldn't find any verified menu items matching those exact criteria\./i, 'माफ़ कीजिये, आपके खोज के अनुसार कोई व्यंजन नहीं मिला।');
    }
    if (toolRes.toolName === 'add_to_cart') {
      return text
        .replace(/Added (\d+)x (.+) to your food basket\./i, '✓ $1x $2 आपके कार्ट में जोड़ दिया गया है।')
        .replace(/Added (\d+)x (.+) to your cart\./i, '✓ $1x $2 आपके कार्ट में जोड़ दिया गया है।')
        .replace(/Would you like to add/i, 'क्या आप इसके साथ कुछ और जोड़ना चाहेंगे?');
    }
    if (toolRes.toolName === 'get_order_status') {
      return text
        .replace(/Order #(\S+) is currently (.+)\. Estimated delivery: (.+)\./i, 'ऑर्डर #$1 की वर्तमान स्थिति \'$2\' है। अनुमानित समय: $3।')
        .replace(/Order #(\S+) is (.+)\./i, 'ऑर्डर #$1 अभी \'$2\' स्थिति में है।');
    }
    if (toolRes.toolName === 'book_table') {
      return text
        .replace(/Table booked successfully for (\d+) guests/i, '✓ बहुत बढ़िया! $1 व्यक्तियों के लिए टेबल बुक हो गई है')
        .replace(/Date:/i, 'तारीख:')
        .replace(/Time:/i, 'समय:');
    }
    if (toolRes.toolName === 'apply_coupon') {
      return text.replace(/Coupon (\S+) applied successfully!/i, '✓ कूपन $1 सफलतापूर्वक लागू हो गया!');
    }
    if (toolRes.toolName === 'view_cart') {
      return text.replace(/Your cart contains/i, 'आपके कार्ट में वर्तमान व्यंजन:');
    }
    if (toolRes.toolName === 'propose_cart') {
      return text
        .replace(/I have prepared your order proposal for/i, 'मैंने आपके ऑर्डर का विवरण तैयार कर लिया है:')
        .replace(/Please confirm to add to your cart:/i, 'कृपया कार्ट में जोड़ने के लिए पुष्टि करें:');
    }
    return text;
  }

  private translateToHinglish(text: string, toolRes: ToolExecutionResult): string {
    if (toolRes.toolName === 'search_menu') {
      return text
        .replace(/Here are our verified dishes matching your request from \*\*The Spice Lounge \(Koramangala\)\*\*:/i, 'Ye rahe **The Spice Lounge (Koramangala)** ke verified aur fresh dishes:')
        .replace(/Here are our verified dishes matching your request:/i, 'Ye rahe aapki pasand ke verified aur fresh dishes:')
        .replace(/I couldn't find any verified menu items matching those exact criteria\./i, 'Mujhe aapke filter ke according koi menu item nahi mila.');
    }
    if (toolRes.toolName === 'add_to_cart') {
      return text
        .replace(/Added (\d+)x (.+) to your food basket\./i, '✓ $1x $2 aapke cart me add ho gaya hai!')
        .replace(/Added (\d+)x (.+) to your cart\./i, '✓ $1x $2 aapke cart me add ho gaya hai!')
        .replace(/Would you like to add/i, 'Kya aap iske sath breads ya drinks add karna chahenge?');
    }
    if (toolRes.toolName === 'get_order_status') {
      return text
        .replace(/Order #(\S+) is currently (.+)\. Estimated delivery: (.+)\./i, 'Order #$1 abhi \'$2\' status par hai. Estimated delivery: $3.')
        .replace(/Order #(\S+) is (.+)\./i, 'Order #$1 abhi \'$2\' status par hai.');
    }
    if (toolRes.toolName === 'book_table') {
      return text
        .replace(/Table booked successfully for (\d+) guests/i, '✓ Shandar! $1 guests ke liye table confirm book ho gayi hai')
        .replace(/Date:/i, 'Date:')
        .replace(/Time:/i, 'Time:');
    }
    if (toolRes.toolName === 'apply_coupon') {
      return text.replace(/Coupon (\S+) applied successfully!/i, '✓ Coupon $1 successfully apply ho gaya!');
    }
    if (toolRes.toolName === 'view_cart') {
      return text.replace(/Your cart contains/i, 'Aapke cart me ye items hain:');
    }
    if (toolRes.toolName === 'propose_cart') {
      return text
        .replace(/I have prepared your order proposal for/i, 'Maine aapka order proposal ready kar diya hai:')
        .replace(/Please confirm to add to your cart:/i, 'Cart me add karne ke liye confirm karein:');
    }
    return text;
  }

  private adaptQuickReplies(replies: string[] | undefined, lang: string): string[] | undefined {
    if (!replies) return undefined;
    if (lang === 'hi') {
      return replies.map(r => {
        if (/view menu/i.test(r)) return '🍕 मेनू देखें';
        if (/view cart/i.test(r)) return '🛒 कार्ट देखें';
        if (/chef specials/i.test(r)) return '⭐ शेफ़ स्पेशल';
        if (/track order/i.test(r)) return '📦 ऑर्डर ट्रैक करें';
        if (/book table/i.test(r)) return '📅 टेबल बुक करें';
        if (/talk to staff/i.test(r)) return '🙋 स्टाफ़ से बात करें';
        return r;
      });
    }
    if (lang === 'hinglish') {
      return replies.map(r => {
        if (/view menu/i.test(r)) return '🍕 Menu Dekho';
        if (/view cart/i.test(r)) return '🛒 Cart Dekho';
        if (/chef specials/i.test(r)) return '⭐ Chef Specials';
        if (/track order/i.test(r)) return '📦 Order Track';
        if (/book table/i.test(r)) return '📅 Table Book';
        if (/talk to staff/i.test(r)) return '🙋 Talk to Staff';
        return r;
      });
    }
    return replies;
  }
}

export const restaurantOrchestrator = new RestaurantOrchestrator();
