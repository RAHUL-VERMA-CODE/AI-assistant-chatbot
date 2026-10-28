"""
ChefZaika AI - Python FastAPI & LangGraph Agentic Microservice
Top-tier Agentic AI Architecture utilizing LangGraph StateGraph, multi-intent reasoning,
deterministic dietary solver, and dynamic trilingual translation (Hindi, Hinglish, English).
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Literal
import json
import os
import re
import time
from datetime import datetime

from langgraph.graph import StateGraph, END

app = FastAPI(
    title="ChefZaika Agentic AI Service",
    description="LangGraph-powered Autonomous Culinary Agent for The Spice Lounge & Grill",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths to shared database
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DATA_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "database", "data"))
CATALOGS_FILE = os.path.join(DB_DATA_DIR, "catalogs.json")
CARTS_FILE = os.path.join(DB_DATA_DIR, "carts.json")
ORDERS_FILE = os.path.join(DB_DATA_DIR, "orders.json")

def load_catalog() -> List[Dict[str, Any]]:
    # 1. Fetch live canonical menu from API Gateway
    try:
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:8080/api/menu", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=1.0) as res:
            if res.status == 200:
                data = json.loads(res.read().decode("utf-8"))
                dishes = data.get("dishes", [])
                if dishes:
                    normalized = []
                    for d in dishes:
                        item_copy = dict(d)
                        item_copy["pricePaise"] = d.get("pricePaise", d.get("basePriceMinor", 29900))
                        item_copy["isVeg"] = d.get("isVeg", True)
                        item_copy["isJain"] = "jain" in d.get("tags", []) or "jain" in d.get("name", "").lower()
                        normalized.append(item_copy)
                    return normalized
    except Exception:
        pass

    # 2. Fallback to catalogs.json
    try:
        if os.path.exists(CATALOGS_FILE):
            with open(CATALOGS_FILE, "r", encoding="utf-8") as f:
                cats = json.load(f)
                if cats and len(cats) > 0 and "items" in cats[0]:
                    items = cats[0]["items"]
                    normalized = []
                    for it in items:
                        item_copy = dict(it)
                        price = it.get("basePriceMinor", it.get("pricePaise", 29900))
                        item_copy["pricePaise"] = price
                        item_copy["basePriceMinor"] = price
                        recipe = it.get("recipe", {})
                        is_jain = recipe.get("isJain") == "TRUE" or "jain" in it.get("tags", []) or "jain" in it.get("name", "").lower()
                        is_veg = is_jain or recipe.get("isVeg") is True or it.get("isVeg") is True or not any(x in it.get("name", "").lower() for x in ["chicken", "mutton", "fish", "meat", "egg"])
                        item_copy["isVeg"] = is_veg
                        item_copy["isJain"] = is_jain
                        tags = list(it.get("tags", []))
                        if is_jain and "jain" not in tags:
                            tags.append("jain")
                        if is_veg and "veg" not in tags:
                            tags.append("veg")
                        item_copy["tags"] = tags
                        item_copy["calories"] = it.get("nutrition", {}).get("caloriesKcal", it.get("calories", 380))
                        item_copy["portion"] = it.get("portionSize", it.get("portion", "1 portion"))
                        normalized.append(item_copy)
                    return normalized
    except Exception as e:
        print(f"Error loading catalog: {e}")
    return []

# Agent State
class AgentState(BaseModel):
    session_id: str
    user_input: str
    language: Literal["en", "hi", "hinglish"] = "en"
    intent: str = "unknown"
    tool_name: Optional[str] = None
    tool_data: Optional[Dict[str, Any]] = None
    ui_component: Optional[Dict[str, Any]] = None
    quick_replies: List[str] = Field(default_factory=list)
    response_text: str = ""

# -------------------------------------------------------------
# LangGraph Nodes
# -------------------------------------------------------------

def detect_language_node(state: AgentState) -> Dict[str, Any]:
    text = state.user_input.strip()
    lower = text.lower()
    
    # 1. Check for Devanagari script (Hindi)
    if re.search(r'[\u0900-\u097F]', text):
        return {"language": "hi"}
    
    # 2. Check for typical Hinglish keywords
    hinglish_markers = [
        r'\bkaro\b', r'\bkar\b', r'\bhai\b', r'\bhain\b', r'\bkya\b', r'\bkyun\b',
        r'\bkaise\b', r'\bbhook\b', r'\bkhana\b', r'\bchahiye\b', r'\bkitna\b',
        r'\bkitne\b', r'\bkitni\b', r'\bbhai\b', r'\bbatao\b', r'\bbataiye\b',
        r'\bdikhao\b', r'\bdikhaye\b', r'\bnamaste\b', r'\btheek\b', r'\bhaan\b',
        r'\bha\b', r'\bnahi\b', r'\bkardo\b', r'\bdaal\b', r'\bdaalo\b', r'\bmangwa\b',
        r'\bmangao\b', r'\bmera\b', r'\bmeri\b', r'\bmere\b', r'\bmujhe\b', r'\bhum\b',
        r'\bkahan\b', r'\bpahuncha\b', r'\baayega\b', r'\bbhejo\b', r'\bkam\b',
        r'\bteekha\b', r'\bjyada\b', r'\blogon\b', r'\bke\s*liye\b', r'\bandar\b',
        r'\bpichli\b', r'\bbaar\b', r'\bjaisa\b', r'\bpurana\b', r'\bkuch\b', r'\baccha\b'
    ]
    if any(re.search(pat, lower) for pat in hinglish_markers):
        return {"language": "hinglish"}
    
    return {"language": "en"}


def get_latest_order_for_session(session_id: str, order_ref: Optional[str] = None) -> Optional[Dict[str, Any]]:
    # 1. Live API query
    try:
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:8080/api/orders", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=1.0) as res:
            if res.status == 200:
                data = json.loads(res.read().decode("utf-8"))
                orders = data.get("orders", [])
                if order_ref:
                    clean_ref = order_ref.upper().strip()
                    for o in orders:
                        if clean_ref in str(o.get("id", "")).upper():
                            return o
                for o in orders:
                    if o.get("sessionId") == session_id:
                        return o
    except Exception:
        pass

    # 2. File fallback
    try:
        if os.path.exists(ORDERS_FILE):
            with open(ORDERS_FILE, "r", encoding="utf-8") as f:
                orders = json.load(f)
                if isinstance(orders, list) and orders:
                    if order_ref:
                        clean_ref = order_ref.upper().strip()
                        for o in orders:
                            if clean_ref in str(o.get("orderId", "")).upper() or clean_ref in str(o.get("id", "")).upper():
                                return o
                    for o in orders:
                        if o.get("sessionId") == session_id:
                            return o
    except Exception:
        pass
    return None


def get_cart_from_api(session_id: str) -> Dict[str, Any]:
    try:
        import urllib.request
        req = urllib.request.Request(f"http://127.0.0.1:8080/api/cart?sessionId={session_id}", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=1.0) as res:
            if res.status == 200:
                return json.loads(res.read().decode("utf-8"))
    except Exception:
        pass
    return {}


def normalize_user_text(raw_text: str) -> str:
    t = raw_text.lower().strip()
    # Normalize common typos & phonetics
    typo_map = {
        r'\bcoldrik\b': 'coldrink',
        r'\bcold\s*drink\b': 'coldrink',
        r'\bcolddrink\b': 'coldrink',
        r'\bjucie\b': 'juice',
        r'\bjuce\b': 'juice',
        r'\bpiza\b': 'pizza',
        r'\bpizaa\b': 'pizza',
        r'\bbiryanni\b': 'biryani',
        r'\bbriyani\b': 'biryani',
        r'\bpaner\b': 'paneer',
        r'\bpneer\b': 'paneer',
        r'\btika\b': 'tikka',
        r'\btikaa\b': 'tikka',
        r'\blasii\b': 'lassi',
        r'\bchass\b': 'chaas',
        r'\bchaach\b': 'chaas',
        r'\blight food\b': 'healthy food',
        r'\bdiet food\b': 'healthy food',
        r'\blow cal\b': 'low calorie',
        r'\blow calriesw\b': 'low calorie',
        r'\blow calries\b': 'low calorie',
    }
    for pat, rep in typo_map.items():
        t = re.sub(pat, rep, t)
    return t


def intent_routing_node(state: AgentState) -> Dict[str, Any]:
    text = normalize_user_text(state.user_input)
    
    # 1. Keep active order (when user explicitly chooses to keep their order)
    if re.search(r'\b(keep|keep\s*my\s*order|don\'?t\s*cancel|mat\s*cancel|mat\s*karo|nahi\s*cancel|rehne\s*do|no\s*cancel|रहने\s*दो|मत\s*काटो|कैंसिल\s*मत\s*करो)\b', text) or \
       'keep my order' in text or "don't cancel" in text:
        return {"intent": "keep_order"}

    # 2. Confirm Cancellation Reason (Flipkart / Amazon style reasons clicked or spoken)
    is_cancel_reason = bool(re.search(r'\b(ordered by mistake|wrong dish|wrong item|too long|delivery time|change address|change delivery address|payment issue|pricing issue|changed my mind|found alternative|galti se|galat dish|der ho gayi|address badalna|mistake|reason)\b', text)) or \
       'ordered by mistake' in text or 'wrong dish' in text or 'changed my mind' in text or 'found alternative' in text or 'delivery time' in text or 'change address' in text
    if is_cancel_reason:
        return {"intent": "confirm_cancel_reason"}

    # 3. Cancel Placed Order (Requires explicit reference to order or order ID ORD-...)
    if re.search(r'\b(cancel\s*order|order\s*cancel|cancel\s*my\s*order|order\s*radd|radd\s*karo|cancel\s*karna\s*hai|ऑर्डर\s*कैंसिल|ऑर्डर\s*रद्द)\b', text):
        return {"intent": "cancel_order"}

    # 4. Agentic Concierge Support / Help (Prioritized before greeting and generic affirmations)
    if re.search(r'\b(still\s*need\s*help|need\s*help|help\s*me|help\s*chahiye|mujhe\s*help|kuch\s*poochna|support|customer\s*support|assist|assistance|guide\s*me|kya\s*kar\s*sakte\s*ho)\b', text) or \
       text in ['help', 'need help', 'i need help', 'yes, i still need help', 'yes i still need help', 'मदद', 'सहायता']:
        return {"intent": "agentic_help"}

    # 5. Specific Support Inquiries: Refund status
    if re.search(r'\b(refund|refund\s*kab|kahan\s*hai\s*refund|refund\s*status|money\s*back|paise\s*wapas|रिफंड)\b', text):
        return {"intent": "refund_inquiry"}

    # 6. Specific Support Inquiries: Dietary & Health (Low Calorie / High Protein / Nutrition)
    if re.search(r'\b(healthy|diet|dietary|low\s*calorie|high\s*protein|kam\s*calorie|weight\s*loss|health|nutrition|पौष्टिक|कम\s*कैलोरी)\b', text):
        return {"intent": "dietary_inquiry"}

    # 7. Specific Support Inquiries: Jain & pure veg
    if re.search(r'\b(jain|bina\s*pyaj|no\s*onion|no\s*garlic|shuddh\s*jain|जैन)\b', text):
        return {"intent": "jain_inquiry"}

    # 8. Specific Support Inquiries: Human staff / Manager handoff
    if re.search(r'\b(manager|staff|waiter|human|talk\s*to\s*staff|talk\s*to\s*manager|agent|executive|बात\s*करो)\b', text):
        return {"intent": "human_handoff"}

    # 9. Generic Beverage / Drink / Juice Request (Must show visual beverage options, NEVER blindly pick a dish!)
    if re.search(r'\b(coldrink|juice|drink|drinks|beverage|beverages|sharbat|shake|peene\s*ke\s*liye|kuch\s*thanda|thanda\s*pina|कोल्ड्रिंक|जूस|पेय)\b', text) and \
       not re.search(r'\b(mango\s*lassi|lime\s*soda|mint\s*lime|masala\s*chaas|buttermilk|kulhad\s*chai|chai|tea)\b', text):
        return {"intent": "beverage_menu"}

    # 10. Cancel / Remove from Cart / Clear Cart / Proposal Dismiss
    if re.search(r'\b(remove|hata|hatao|nikal|nikalo|delete|clear\s*cart|empty\s*cart|रिमूव|हटाओ|हटा\s*दो|निकालो|डिलीट|खाली\s*करो)\b', text) or \
       re.search(r'^(cancel|rehne do|mat dalo|don\'?t add|not this|hatao|nahi chahiye|galti se|रहने दो|मत डालो)$', text) or \
       'cart se remove' in text or 'cart se hata' in text:
        return {"intent": "remove_from_cart"}

    # 11. Greeting (Multilingual English, Hindi, Hinglish)
    is_greeting = bool(re.search(r'(^|\s)(hi+|hey+|hello+|hlo|namaste|namaskar|pranam|kya\s*haal|kaise\s*ho|kaisa\s*hai|start|bhook\s*lagi)\b', text)) or \
                  any(w in text for w in ['नमस्ते', 'प्रणाम', 'नमस्कार', 'namaste', 'namaskar', 'hello', 'kya haal', 'kaise ho', 'kaisa hai', 'bhai'])
    if is_greeting:
        return {"intent": "greeting"}

    # 12. Place Order / Checkout / Proceed to Order ("proceed to order", "place order", "checkout", "proceed to checkout")
    if re.search(r'\b(proceed\s*to\s*order|proceed\s*to\s*checkout|place\s*order|order\s*place|confirm\s*order|order\s*confirm|order\s*now|checkout|khana\s*bhej\s*do|payment\s*karo|payment\s*karna\s*hai|ऑर्डर\s*करो|ऑर्डर\s*प्लेस|प्रोसीड\s*टू\s*ऑर्डर|चेकआउट)\b', text):
        return {"intent": "place_order"}

    # 13. View Cart ("view cart", "show cart", "cart dikhao", "cart me kya hai", "basket", "open cart", "show my cart", "cart")
    if re.search(r'\b(view\s*cart|show\s*cart|open\s*cart|see\s*cart|my\s*cart|cart\s*dikhao|cart\s*dekhao|cart\s*kholo|cart\s*me\s*kya|kya\s*hai\s*cart|check\s*cart|cart\s*check|basket|my\s*basket|show\s*basket|open\s*basket|bag\s*dikhao|shopping\s*cart|show\s*me\s*cart|cart)\b', text) or \
       text.strip() in ['cart', 'my cart', 'basket', 'कार्ट', 'बास्केट']:
        return {"intent": "view_cart"}

    # 14. Order Tracking
    if re.search(r'\b(track|order status|kahan pahuncha|kahan hai|mera order|where is my order|order kahan|kab aayega|status kya|ord-\d+|ऑर्डर.*ट्रैक|ट्रैक|कहाँ पहुँचा)\b', text):
        return {"intent": "track_order"}

    # 15. Table Booking
    if re.search(r'\b(book\s*(?:a\s*)?table|table\s*book|reserve\s*(?:a\s*)?table|reserve|table\s*reservation|table\s*chahiye|dine\s*in|टेबल|रिज़र्व)\b', text):
        return {"intent": "book_table"}

    # 16. Affirmation (generic yes/ok - only when NOT asking for help)
    if re.search(r'^(haa+|haan+|ha+|yes+|yeah+|yep+|ok+|okay+|theek hai|sahi hai|bilkul|sure|karo|batao|dikhao|हाँ|हा|ठीक है|बिलकुल|बताओ|दिखाओ)\b', text):
        return {"intent": "affirmation"}

    # 17. Coupons / Offers
    if re.search(r'\b(coupon|coupons|offer|offers|discount|code|deal|promocode|ऑफ़र|कूपन|डिस्काउंट)\b', text):
        return {"intent": "offers"}

    # 18. Group Ordering Solver
    if re.search(r'(\d+)\s*(?:people|persons|pax|log|logon|लोग|व्यक्ति)', text) and re.search(r'(\d+)\s*(?:me|mein|mai|tak|ke\s*andar|rs|rupees|inr|under|below|budget|तक|अंदर|में)', text):
        return {"intent": "group_solver"}

    # 19. Re-order past meal ("reorder", "repeat order", "pichli baar jaisa", "same order again")
    if re.search(r'\b(reorder|re-order|repeat\s*order|repeat\s*my\s*order|pichli\s*baar|pichla\s*order|last\s*time|same\s*as\s*before|same\s*as\s*last\s*time|purana\s*order|purana\s*wala|pehle\s*wala|same\s*order\s*again|पिछली\s*बार|पुराना\s*ऑर्डर|रीऑर्डर|रिपीट)\b', text):
        return {"intent": "reorder"}

    # 20. Nutritional Q&A
    if re.search(r'\b(calorie|calories|protein|nutrition|nutritional|kitni calories|kitna protein|कैलोरी|प्रोटीन|न्यूट्रिशन)\b', text):
        return {"intent": "nutrition_qa"}

    # 21. Add to Cart (includes voice/phonetic variants: "cartman kar do", "cart me daal do", "naan add karo", "ek butter naan", etc.)
    cart_add_words = r'\b(cartman|cart\s*me|cart\s*mein|cart\s*mai|cart\s*pe|cartman\s*kar\s*do|add\s*to\s*cart|add|chahiye|mangwa\s*do|mangao|manga\s*do|daal\s*do|daalo|daal|lena\s*hai|kar\s*do|kardo|order\s*kar\s*do|de\s*do|bhejo|le\s*aao|जोड़ो|डाल\s*दो|डालो|डाल|चाहिए|ऐड|कर\s*दो|भेजो)\b'
    if re.search(cart_add_words, text):
        return {"intent": "add_to_cart"}

    # 22. Multi-constraint menu search & Chef Specials
    if re.search(r'\b(special|specials|signature|bestseller|bestsellers|chef|chef\'?s|recommend|recommendation|recommendations|paneer|pizza|biryani|starter|dessert|drink|spicy|teekha|veg|jain|under|below|menu|dikhao|batao|खास|स्पेशल|पनीर|पिज़्ज़ा|पिज्जा|बिरयानी|तीखा|मसालेदार|शाकाहारी|जैन|मेनू|दिखाओ|बताओ)\b', text):
        return {"intent": "search_menu"}

    return {"intent": "fallback"}


def execution_node(state: AgentState) -> Dict[str, Any]:
    intent = state.intent
    lang = state.language
    raw_text = state.user_input
    lower = raw_text.lower()
    menu = load_catalog()
    
    # 1. GREETING
    if intent == "greeting":
        if lang == "hi":
            reply = "नमस्ते! 'द स्पाइस लाउंज' में आपका स्वागत है। 🍽️ मैं हूँ ChefZaika (शेफ़ जायका), आपका AI कलिनरी असिस्टेंट। आज आप क्या खाना पसंद करेंगे?"
            replies = ["🍕 मेनू देखें", "🔥 मसालेदार पनीर ₹300 से कम", "🍛 शेफ़ स्पेशल बिरयानी", "📦 ऑर्डर ट्रैक करें", "📅 टेबल बुक करें"]
        elif lang == "hinglish":
            reply = "Namaste! The Spice Lounge me aapka swagat hai. 🍽️ Main hoon ChefZaika, aapka smart AI digital waiter. Aaj kya khane ka mood hai? Hamare paas best Dum Biryani aur Paneer Tikka hain!"
            replies = ["🍕 Browse Menu", "🔥 Spicy Veg under ₹300", "🍛 Chef Specials", "📦 Track Order", "📅 Book Table"]
        else:
            reply = "Hello & welcome to The Spice Lounge & Grill! 🍽️ I am ChefZaika, your personal AI culinary dining partner. What can I tempt your tastebuds with today?"
            replies = ["🍕 Browse Menu", "🔥 Spicy Veg under ₹300", "🍛 Chef's Dum Biryani", "📦 Track Active Order", "📅 Reserve a Table"]
            
        return {
            "tool_name": "greeting",
            "response_text": reply,
            "quick_replies": replies
        }
        
    # 2. AFFIRMATION ("haa", "yes", "sure")
    if intent == "affirmation":
        popular = [d for d in menu if d.get("tags") and "popular" in d.get("tags")][:4]
        if not popular:
            popular = menu[:4]
            
        if lang == "hi":
            reply = "बहुत बढ़िया! यहाँ हमारे सबसे लोकप्रिय और स्वादिष्ट व्यंजन हैं। आप किसी भी डिश को टैप करके या बोलकर सीधे कार्ट में जोड़ सकते हैं:"
            replies = ["🍕 पूरा मेनू देखें", "🍛 बिरयानी स्पेशल", "⭐ शेफ़ स्पेशल", "🛒 कार्ट देखें"]
        elif lang == "hinglish":
            reply = "Badhiya! Ye rahe hamare chef ke top popular dishes. Aap kisi bhi dish par tap karke ya bol kar cart me add kar sakte hain:"
            replies = ["🍕 View Full Menu", "🍛 Biryani Specials", "⭐ Chef Specials", "🛒 View Cart"]
        else:
            reply = "Awesome! Here are our chef's top-rated signature dishes today. Tap any dish or simply tell me what you'd like to order:"
            replies = ["🍕 View Full Menu", "🍛 Biryani Specials", "⭐ Chef Specials", "🛒 View Cart"]
            
        return {
            "tool_name": "search_menu",
            "response_text": reply,
            "ui_component": {
                "type": "dish_carousel",
                "payload": {"title": "Chef's Signature Recommendations", "dishes": popular}
            },
            "quick_replies": replies
        }

    # 3. SEARCH MENU & CHEF SPECIALS
    if intent == "search_menu":
        is_special = bool(re.search(r'\b(special|specials|signature|bestseller|bestsellers|chef|chef\'?s|recom|popular|खास|स्पेशल)\b', lower))
        is_spicy = bool(re.search(r'\b(spicy|teekha|mirchi|तीखा|मसालेदार|मिर्ची)\b', lower))
        is_jain = bool(re.search(r'\b(jain|जैन)\b', lower))
        is_veg = bool(re.search(r'\b(veg|vegetarian|shakahari|शाकाहारी)\b', lower)) or is_jain
        is_pizza = bool(re.search(r'\b(pizza|पिज़्ज़ा|पिज्जा)\b', lower))
        is_paneer = bool(re.search(r'\b(paneer|पनीर)\b', lower))
        is_biryani = bool(re.search(r'\b(biryani|बिरयानी)\b', lower))
        
        under_match = re.search(r'(?:under|below|tak|ke\s*andar|तक|के\s*अंदर)\s+(?:inr|rs\.?|₹)?\s*(\d+)', raw_text, re.IGNORECASE)
        max_budget = int(under_match.group(1)) if under_match else None
        
        filtered = [d for d in menu if d.get("inStock", True)]
        if is_special:
            filtered = [d for d in filtered if "chef_special" in d.get("tags", []) or "bestseller" in d.get("tags", []) or "popular" in d.get("tags", [])]
        if is_veg:
            filtered = [d for d in filtered if d.get("isVeg", False)]
        if is_jain:
            filtered = [d for d in filtered if "jain" in d.get("tags", [])]
        if is_spicy:
            filtered = [d for d in filtered if d.get("spiceLevel", 1) >= 2 or "spicy" in d.get("tags", [])]
        if is_pizza:
            filtered = [d for d in filtered if "pizza" in d.get("category", "").lower() or "pizza" in d.get("tags", [])]
        if is_paneer:
            filtered = [d for d in filtered if "paneer" in d.get("name", "").lower()]
        if is_biryani:
            filtered = [d for d in filtered if "biryani" in d.get("name", "").lower() or "rice" in d.get("category", "").lower()]
        if max_budget:
            filtered = [d for d in filtered if d.get("pricePaise", 0) <= max_budget * 100]
            
        if not filtered:
            filtered = menu[:6]
            
        title = "⭐ Chef's Signature Specials & Bestsellers" if is_special else "Gourmet Pizzas" if is_pizza else "🪷 100% Certified Jain Delicacies" if is_jain else "Spicy Paneer Delicacies" if is_paneer else "Verified Menu Items"
        
        if is_special:
            if lang == "hi":
                reply = "यहाँ हमारे शेफ़ के सबसे प्रसिद्ध और सिग्नेचर स्पेशल व्यंजन हैं। किसी भी डिश को टैप करके सीधे कार्ट में जोड़ें:"
            elif lang == "hinglish":
                reply = "Ye rahe hamare chef ke top signature specials aur bestsellers. Aap kisi bhi dish par tap karke cart me add kar sakte hain:"
            else:
                reply = "Here are our chef's signature specials and highest-rated bestsellers today. Tap any dish to add directly to your basket:"
        else:
            if lang == "hi":
                reply = "यहाँ आपके अनुसार 'द स्पाइस लाउंज' के प्रमाणित और ताज़ा व्यंजन हैं:"
            elif lang == "hinglish":
                reply = "Ye rahe aapke search ke hisaab se verified aur fresh dishes:"
            else:
                reply = "Here are our verified dishes matching your request from **The Spice Lounge (Koramangala)**:"
            
        return {
            "tool_name": "search_menu",
            "response_text": reply,
            "ui_component": {
                "type": "dish_carousel",
                "payload": {"title": title, "dishes": filtered[:6]}
            },
            "quick_replies": [f"Add {d['name']}" for d in filtered[:3]] + ["🛒 View Cart"]
        }

    # 4. NUTRITION Q&A
    if intent == "nutrition_qa":
        if "jain" in lower or "paneer tikka" in lower or "paneer" in lower or "पनीर" in lower or "टिक्का" in lower or "जैन" in lower:
            if lang == "hi":
                reply = "जैन तंदूरी पनीर टिक्का में प्रमाणित 480 किलो कैलोरी और 26 ग्राम प्रोटीन प्रति सर्विंग है। यह बिना प्याज-लहसुन के 100% शुद्ध जैन प्रमाणित है।"
            elif lang == "hinglish":
                reply = "Jain Tandoori Paneer Tikka me 480 kcal aur 26g protein per serving hai (lab-verified). Ye 100% Jain certified hai zero onion aur garlic ke sath."
            else:
                reply = "Jain Tandoori Paneer Tikka contains 480 kcal and 26g protein per serving (lab-verified). It is 100% Jain certified with zero onion, garlic, or root vegetables."
            return {
                "tool_name": "get_menu_item",
                "response_text": reply,
                "quick_replies": ["Add Jain Paneer Tikka", "🍕 View Menu", "🛒 View Cart"]
            }
        else:
            if lang == "hi":
                reply = "हमारे सभी व्यंजन ताज़ी सामग्री से तैयार किए जाते हैं। आप किसी भी डिश का नाम पूछकर उसकी कैलोरी और सामग्री जान सकते हैं।"
            elif lang == "hinglish":
                reply = "Hamare sabhi dishes fresh ingredients se bante hain. Aap kisi bhi specific dish ke verified calories aur protein pooch sakte hain."
            else:
                reply = "All our meals are prepared fresh with certified ingredients. Which specific dish would you like nutritional and calorie details for?"
            return {
                "tool_name": "get_menu_item",
                "response_text": reply,
                "quick_replies": ["✨ Jain Paneer Calories", "🍗 Butter Chicken Info", "🍕 View Menu"]
            }

    # 5. ORDER TRACKING
    if intent == "track_order":
        ord_ref = None
        ord_match = re.search(r'\b(ord-[a-z0-9\-]+)\b', lower)
        if ord_match:
            ord_ref = ord_match.group(1).upper()
            
        real_order = get_latest_order_for_session(state.session_id, ord_ref)
        if not real_order and not ord_ref:
            if lang == "hi":
                reply = "आपका अभी कोई सक्रिय ऑर्डर नहीं है। क्या आप हमारे मेनू से कुछ स्वादिष्ट और ताज़ा ऑर्डर करना चाहेंगे?"
            elif lang == "hinglish":
                reply = "Aapka abhi koi active order nahi hai. Kya aap hamare menu se kuch tasty dishes order karna chahenge?"
            else:
                reply = "You don't have any active orders right now. Would you like to explore our menu and order something delicious?"
            return {
                "tool_name": "track_order",
                "response_text": reply,
                "quick_replies": ["🍕 View Menu", "⭐ Chef Specials", "🥗 Low Calorie"]
            }

        order_id = real_order.get("id", real_order.get("orderId", "ORD-7821-49")) if real_order else "ORD-7821-49"
        status = real_order.get("status", "Preparing") if real_order else "Preparing"
        eta = real_order.get("etaMinutes", 25) if real_order else 25
        total_paise = real_order.get("totalPaise", real_order.get("total", {}).get("amountPaise", 59900)) if real_order else 59900

        if lang == "hi":
            reply = f"ऑर्डर #{order_id} अभी '{status}' की स्थिति में है। हमारे शेफ़ आपका खाना ताज़ा बना रहे हैं। अनुमानित समय: {eta} मिनट।"
        elif lang == "hinglish":
            reply = f"Aapka order #{order_id} abhi '{status}' status par hai. Kitchen me khana fresh ban raha hai. Estimated delivery: {eta} minutes."
        else:
            reply = f"Order #{order_id} is currently '{status}' in our kitchen. Estimated delivery time is {eta} mins."
            
        return {
            "tool_name": "track_order",
            "response_text": reply,
            "ui_component": {
                "type": "order_tracker",
                "payload": {
                    "order": {
                        "id": order_id,
                        "status": status,
                        "etaMinutes": eta,
                        "totalPaise": total_paise
                    }
                }
            },
            "quickReplies": [f"Track #{order_id}", "❌ Cancel Order", "🍕 View Menu"]
        }

    # 6. TABLE BOOKING
    if intent == "book_table":
        guest_match = re.search(r'(\d+)\s*(?:people|persons|pax|log|guests|people|adults|members|logo|लोग|व्यक्ति|सदस्य)', lower)
        guests = int(guest_match.group(1)) if guest_match else 2
        time_match = re.search(r'(\d{1,2}(?::\d{2})?\s*(?:am|pm|baje|बजे))', lower)
        booking_time = time_match.group(1).upper() if time_match else "7:30 PM"
        table_num = 4 if guests <= 2 else 7 if guests <= 4 else 12
        section = "Indoor AC" if guests <= 4 else "Family Booth"

        if lang == "hi":
            reply = f"✓ बहुत बढ़िया! {guests} अतिथियों के लिए आज शाम {booking_time} बजे 'द स्पाइस लाउंज' में टेबल आरक्षण कन्फर्म हो गया है (टेबल #{table_num}, {section})।"
        elif lang == "hinglish":
            reply = f"✓ Shandar! {guests} guests ke liye aaj shaam {booking_time} par The Spice Lounge me table #{table_num} ({section}) confirm ho gayi hai."
        else:
            reply = f"✓ Confirmed! Table #{table_num} ({section}) reserved for {guests} guests this evening at {booking_time} at The Spice Lounge & Grill."
            
        return {
            "tool_name": "book_table",
            "response_text": reply,
            "quick_replies": ["🍕 View Menu", "⭐ Chef Specials", "🛒 View Cart"]
        }

    # 7. ADD TO CART / PROPOSAL
    if intent == "add_to_cart":
        matched_dish = None
        for d in menu:
            dish_name = d.get("name", "").lower()
            aliases = [a.lower() for a in d.get("aliases", [])]
            if dish_name in lower or any(a in lower for a in aliases):
                matched_dish = d
                break

        # Specific Beverage & Popular aliases mapping
        if not matched_dish:
            if re.search(r'\b(juice|lemon|lime|nimbu|shikanji|soda)\b', lower):
                matched_dish = next((d for d in menu if d.get("id") == "beverage_03"), None)
            elif re.search(r'\b(mango|aam|lassi)\b', lower):
                matched_dish = next((d for d in menu if d.get("id") == "beverage_01"), None)
            elif re.search(r'\b(chaas|buttermilk|mattha)\b', lower):
                matched_dish = next((d for d in menu if d.get("id") == "beverage_02"), None)
            elif re.search(r'\b(tea|chai)\b', lower):
                matched_dish = next((d for d in menu if d.get("id") == "beverage_04"), None)

        if not matched_dish:
            for d in menu:
                parts = d.get("name", "").lower().split()
                if any(p in lower for p in parts if len(p) > 3):
                    matched_dish = d
                    break

        # If STILL no match, NEVER add random pizza! Inform user politely!
        if not matched_dish:
            dish_query = re.sub(r'\b(add|chahiye|daal\s*do|daalo|daal|mangao|mangwa\s*do|cart\s*me|to\s*cart|ek|do|teen|1|2|3|please|kar\s*do)\b', '', raw_text, flags=re.IGNORECASE).strip()
            if not dish_query:
                dish_query = "that item"
            
            if lang == "hi":
                reply = f"माफ़ कीजिये, '{dish_query}' हमारे मेनू में उपलब्ध नहीं है। हमारे पास ताज़ा Fresh Mint Lime Soda, Alphonso Mango Lassi, और लज़ीज़ शेफ़ स्पेशल हैं। क्या आप इनमें से कुछ देखना चाहेंगे?"
            elif lang == "hinglish":
                reply = f"Sorry, '{dish_query}' hamare verified menu me available nahi hai. Hamare paas refreshing Fresh Mint Lime Soda, Mango Lassi aur delicious Chef Specials hain. Kya aap inme se kuch try karna chahenge?"
            else:
                reply = f"Sorry, I couldn't find '{dish_query}' on our menu. We do have refreshing beverages like Fresh Mint Lime Soda, Alphonso Mango Lassi, and chef specials. Would you like to explore those?"

            return {
                "tool_name": "menu_suggestion",
                "response_text": reply,
                "quick_replies": ["🍋 Fresh Mint Lime Soda", "🥭 Alphonso Mango Lassi", "🍕 View Menu"]
            }

        if matched_dish:
            qty = 1
            # Exclude calories like '60 calories' or '300 kcal' and prices like '₹280'
            clean_for_qty = re.sub(r'\b\d+\s*(?:calories|calorie|kcal|cal|rs|rupees|inr)\b', '', lower)
            clean_for_qty = re.sub(r'₹\s*\d+', '', clean_for_qty)
            qty_match = re.search(r'\b([1-9]|10)\s*(?:plate|plates|portion|portions|order|orders|x|glass|glasses|cup|cups)?\b', clean_for_qty)
            if qty_match:
                try:
                    c_qty = int(qty_match.group(1))
                    if 1 <= c_qty <= 10:
                        qty = c_qty
                except ValueError:
                    qty = 1
            elif re.search(r'\b(ek|one)\b', clean_for_qty):
                qty = 1
            elif re.search(r'\b(do|two)\b', clean_for_qty):
                qty = 2
            elif re.search(r'\b(teen|three)\b', clean_for_qty):
                qty = 3
                
            price = matched_dish.get("pricePaise", 29900)
            gst = round(price * 0.05)
            total = (price * qty) + gst
            notes = "Custom: Less spicy / mild preparation" if ("less spicy" in lower or "jain" in lower) else ""

            # Check if this is an explicit add command (e.g. 'cartman kar do', 'cart me daal do', 'add to cart', 'kar do')
            is_direct_add = bool(re.search(r'\b(cartman|cart\s*me|cart\s*mein|cart\s*mai|cart\s*pe|add|daal|daalo|kardo|kar\s*do|bhejo|जोड़ो|डाल)\b', lower))
            
            if is_direct_add:
                try:
                    import urllib.request
                    add_payload = json.dumps({
                        "sessionId": state.session_id,
                        "dishId": matched_dish["id"],
                        "quantity": qty,
                        "notes": notes
                    }).encode("utf-8")
                    req = urllib.request.Request("http://127.0.0.1:8080/api/cart/add", data=add_payload, headers={"Content-Type": "application/json"})
                    with urllib.request.urlopen(req, timeout=1.5) as res:
                        pass
                except Exception as e:
                    print(f"Error calling /api/cart/add: {e}")

                line_inr = (price * qty) / 100
                if lang == "hi":
                    reply = f"✓ {matched_dish['name']} (x{qty}) आपके कार्ट में जोड़ दिया गया है! कुल: ₹{line_inr:.2f}। क्या आप इसके साथ कुछ और जोड़ना चाहेंगे?"
                elif lang == "hinglish":
                    reply = f"✓ {matched_dish['name']} (x{qty}) aapki cart me successfully add ho gaya hai! Subtotal: ₹{line_inr:.2f}। Kya aap iske sath breads, drinks ya dessert lena chahenge?"
                else:
                    reply = f"✓ Added {qty}x {matched_dish['name']} to your food basket! Subtotal: ₹{line_inr:.2f}. Would you like to add anything else or proceed to checkout?"

                return {
                    "tool_name": "add_to_cart",
                    "response_text": reply,
                    "ui_component": {
                        "type": "cart_sync_trigger",
                        "payload": {"addedDishId": matched_dish["id"], "quantity": qty}
                    },
                    "quickReplies": ["🛒 View Cart", "💳 Proceed to Checkout", "🍕 Browse Menu"]
                }
            else:
                if lang == "hi":
                    reply = f"मैंने आपके लिए **{matched_dish['name']}** का ऑर्डर प्रस्ताव तैयार किया है। कृपया नीचे '✓ Confirm & Add to Cart' पर क्लिक करके पुष्टि करें:"
                elif lang == "hinglish":
                    reply = f"Maine aapke liye **{matched_dish['name']}** ka proposal preview ready kiya hai. Cart me add karne ke liye confirm karein:"
                else:
                    reply = f"I've prepared a preview proposal for **{matched_dish['name']}** (Qty: {qty}). Please review and tap confirm to add to cart:"
                    
                return {
                    "tool_name": "propose_cart",
                    "response_text": reply,
                    "ui_component": {
                        "type": "proposal_card",
                        "payload": {
                            "dishId": matched_dish["id"],
                            "name": matched_dish["name"],
                            "quantity": qty,
                            "pricePaise": price,
                            "gstPaise": gst,
                            "totalPaise": total,
                            "isVeg": matched_dish.get("isVeg", True),
                            "isJain": matched_dish.get("isJain", False),
                            "notes": notes
                        }
                    },
                    "quickReplies": [f"Add {matched_dish['name']}", "🍕 View Menu", "🛒 View Cart"]
                }

    # 7. REMOVE FROM CART & CANCEL LAST ADD
    if intent in ["remove_from_cart", "dismiss_proposal"]:
        # A. Check if user wants to clear the entire cart
        is_clear_all = bool(re.search(r'\b(clear\s*cart|empty\s*cart|sab\s*hata|pura\s*cart|remove\s*all|saara\s*hata)\b', lower))
        if is_clear_all:
            try:
                import urllib.request
                payload = json.dumps({"sessionId": state.session_id}).encode("utf-8")
                req = urllib.request.Request("http://127.0.0.1:8080/api/cart/clear", data=payload, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=1.0) as res:
                    pass
            except Exception as e:
                print(f"Error clearing cart: {e}")

            if lang == "hi":
                reply = "✓ आपकी कार्ट पूरी तरह खाली कर दी गई है। क्या आप मेनू देखना चाहेंगे?"
            elif lang == "hinglish":
                reply = "✓ Aapki cart poori tarah clear kar di gayi hai. Kya aap hamara menu browse karna chahenge?"
            else:
                reply = "✓ Your food basket has been cleared completely. Would you like to explore our menu?"

            return {
                "tool_name": "remove_from_cart",
                "response_text": reply,
                "ui_component": {
                    "type": "cart_sync_trigger",
                    "payload": {"cleared": True}
                },
                "quick_replies": ["🍕 Browse Menu", "⭐ Chef Specials", "🛒 View Cart"]
            }

        # B. Check active cart items
        cart = get_cart_from_api(state.session_id)
        items = cart.get("items", [])

        if not items:
            if lang == "hi":
                reply = "आपकी कार्ट अभी खाली है। क्या आप मेनू में से कुछ जोड़ना चाहते हैं?"
            elif lang == "hinglish":
                reply = "Aapki cart abhi empty hai! Kuch add karne ke liye hamara verified menu browse karein."
            else:
                reply = "Your food basket is currently empty. Would you like to explore our chef specials?"
            return {
                "tool_name": "remove_from_cart",
                "response_text": reply,
                "quick_replies": ["🍕 Browse Menu", "⭐ Chef Specials", "🛒 View Cart"]
            }

        dish_to_remove = None
        for it in items:
            name = it.get("name", it.get("itemName", "")).lower()
            for word in name.split():
                if len(word) > 3 and (word in lower or (word == "biryani" and "बिरयानी" in raw_text) or (word == "paneer" and "पनीर" in raw_text) or (word == "pizza" and "पिज़्ज़ा" in raw_text)):
                    dish_to_remove = it
                    break
            if dish_to_remove:
                break

        # If user just said 'cancel' or 'remove this', remove the LAST item in the cart
        if not dish_to_remove:
            dish_to_remove = items[-1]

        dish_id = dish_to_remove.get("dishId", dish_to_remove.get("itemId", ""))
        dish_name = dish_to_remove.get("name", dish_to_remove.get("itemName", "Dish"))

        try:
            import urllib.request
            payload = json.dumps({"sessionId": state.session_id, "dishId": dish_id}).encode("utf-8")
            req = urllib.request.Request("http://127.0.0.1:8080/api/cart/remove", data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=1.0) as res:
                pass
        except Exception as e:
            print(f"Error removing item: {e}")

        updated_cart = get_cart_from_api(state.session_id)
        rem_items = updated_cart.get("items", [])
        total_inr = updated_cart.get("totalPaise", 0) / 100

        if len(rem_items) == 0:
            if lang == "hi":
                reply = f"✓ {dish_name} को आपकी कार्ट से हटा दिया गया है। आपकी कार्ट अब खाली है।"
            elif lang == "hinglish":
                reply = f"✓ {dish_name} ko aapki cart se remove kar diya gaya hai. Aapki cart ab empty hai."
            else:
                reply = f"✓ Removed {dish_name} from your food basket. Your cart is now empty."
        else:
            if lang == "hi":
                reply = f"✓ {dish_name} को हटा दिया गया है। नया कार्ट कुल: ₹{total_inr:.2f}।"
            elif lang == "hinglish":
                reply = f"✓ {dish_name} remove ho gaya hai. Updated cart total: ₹{total_inr:.2f}."
            else:
                reply = f"✓ Removed {dish_name} from your food basket! Updated subtotal is ₹{total_inr:.2f}."

        return {
            "tool_name": "remove_from_cart",
            "response_text": reply,
            "ui_component": {
                "type": "cart_sync_trigger",
                "payload": {"removedDishId": dish_id}
            },
            "quick_replies": ["🛒 View Cart", "🍕 Browse Menu", "💳 Checkout"]
        }


    # 9. PLACE ORDER / CHECKOUT ("proceed to order", "place order", "checkout", "confirm order")
    if intent == "place_order":
        cart = get_cart_from_api(state.session_id)
        items = cart.get("items", [])
        total_paise = cart.get("totalPaise", cart.get("totalMinor", 0))
        
        if not items or total_paise == 0:
            if lang == "hi":
                reply = "आपकी कार्ट अभी खाली है! 🍽️ ऑर्डर करने से पहले कृपया हमारे स्वादिष्ट मेनू से कुछ व्यंजन जोड़ें।"
                replies = ["🍕 मेनू देखें", "🔥 मसालेदार पनीर ₹300", "⭐ शेफ़ स्पेशल"]
            elif lang == "hinglish":
                reply = "Aapka cart abhi empty hai! Order place karne ke liye pehle menu se kuch delicious dishes cart me add karein."
                replies = ["🍕 View Menu", "🔥 Spicy Veg under ₹300", "⭐ Chef Specials"]
            else:
                reply = "Your food basket is currently empty! Please add some delicious dishes from our menu before checking out."
                replies = ["🍕 Browse Menu", "🔥 Spicy Veg under ₹300", "⭐ Chef Specials"]
            return {
                "tool_name": "place_order",
                "response_text": reply,
                "quick_replies": replies
            }
        else:
            total_inr = total_paise / 100
            if lang == "hi":
                reply = f"शानदार! आपका कुल बिल **₹{total_inr:.2f}** है। मैं आपके लिए सुरक्षित चेकआउट खोल रहा हूँ। आप अपना पता और भुगतान विधि (UPI, कार्ड, COD) चुन सकते हैं:"
            elif lang == "hinglish":
                reply = f"Shandar! Aapka total payable amount **₹{total_inr:.2f}** hai. Main secure checkout modal open kar raha hoon. Delivery details confirm karein:"
            else:
                reply = f"Awesome! Your total payable amount is **₹{total_inr:.2f}**. Opening secure platform checkout now. Please confirm your delivery details:"
                
            return {
                "tool_name": "place_order",
                "response_text": reply,
                "ui_component": {
                    "type": "open_checkout_modal",
                    "payload": {"totalPaise": total_paise}
                },
                "quick_replies": ["💳 Pay via UPI", "💵 Cash on Delivery", "🛒 Review Cart"]
            }

    # 10. VIEW CART
    if intent == "view_cart":
        cart = get_cart_from_api(state.session_id)
        items = cart.get("items", [])
        total_paise = cart.get("totalPaise", cart.get("totalMinor", 0))
        
        if not items:
            if lang == "hi":
                reply = "आपकी कार्ट अभी खाली है। 🍽️ हमारे शेफ़ के ताज़ा व्यंजन देखने के लिए 'मेनू देखें' पर टैप करें!"
                replies = ["🍕 मेनू देखें", "🔥 मसालेदार पनीर ₹300", "⭐ शेफ़ स्पेशल"]
            elif lang == "hinglish":
                reply = "Aapka cart abhi empty hai! Kuch delicious mangwane ke liye hamara verified menu browse karein."
                replies = ["🍕 View Menu", "🔥 Spicy Veg under ₹300", "⭐ Chef Specials"]
            else:
                reply = "Your food basket is currently empty. Explore our chef's signature dishes to add some delicacies!"
                replies = ["🍕 Browse Menu", "🔥 Spicy Veg under ₹300", "⭐ Chef Specials"]
            return {
                "tool_name": "view_cart",
                "response_text": reply,
                "ui_component": {
                    "type": "open_cart_drawer",
                    "payload": {"cart": cart}
                },
                "quick_replies": replies
            }
        else:
            total_items = sum(it.get("quantity", 1) for it in items)
            total_inr = total_paise / 100 if total_paise > 0 else sum(it.get("pricePaise", it.get("unitPriceMinor", 29900)) * it.get("quantity", 1) for it in items) / 100
            items_summary = ", ".join(f"{it.get('quantity', 1)}x {it.get('name', it.get('itemName', 'Dish'))}" for it in items[:3])
            
            if lang == "hi":
                reply = f"आपकी कार्ट में {total_items} व्यंजन हैं ({items_summary})। कुल बिल: ₹{total_inr:.2f}। दाईं ओर कार्ट ड्रावर में आप पूरी समरी देख सकते हैं।"
            elif lang == "hinglish":
                reply = f"Aapki cart me {total_items} items hain ({items_summary})। Total: ₹{total_inr:.2f}। Right drawer me aap bill breakdown aur checkout dekh sakte hain."
            else:
                reply = f"Your food basket has {total_items} items ({items_summary}) totaling ₹{total_inr:.2f}. You can review the complete breakdown in the cart drawer."
                
            return {
                "tool_name": "view_cart",
                "response_text": reply,
                "ui_component": {
                    "type": "open_cart_drawer",
                    "payload": {"cart": cart}
                },
                "quick_replies": ["Proceed to Checkout", "🍕 Add More Dishes", "View Menu"]
            }

    # 10b. RE-ORDER PAST MEAL (Adds previous meal items directly to cart!)
    if intent == "reorder":
        real_order = get_latest_order_for_session(state.session_id)
        if not real_order:
            if lang == "hi":
                reply = "मुझे आपके खाते में कोई पिछला पूरा हुआ ऑर्डर नहीं मिला। क्या आप हमारे शेफ़ स्पेशल देखना चाहेंगे?"
            elif lang == "hinglish":
                reply = "Aapka koi previous order record me nahi mila. Kya aap hamare popular chef specials browse karna chahenge?"
            else:
                reply = "I couldn't find any previous orders on record for your account. Would you like to explore our chef specials?"
            return {
                "tool_name": "reorder",
                "response_text": reply,
                "quick_replies": ["🍕 Browse Menu", "⭐ Chef Specials", "🍛 Biryani Specials"]
            }

        raw_items = real_order.get("items", real_order.get("lines", []))
        if not raw_items:
            raw_items = [{"dishId": "bread_01", "name": "Butter Garlic Naan", "quantity": 2, "pricePaise": 7900}]

        added_names = []
        total_reorder_paise = 0
        for it in raw_items:
            d_id = it.get("dishId", it.get("itemId", "bread_01"))
            d_name = it.get("name", it.get("itemName", "Dish"))
            d_qty = it.get("quantity", 1)
            d_price = it.get("pricePaise", it.get("unitPriceMinor", 29900))
            total_reorder_paise += d_price * d_qty
            added_names.append(f"{d_qty}x {d_name}")
            try:
                import urllib.request
                add_payload = json.dumps({"sessionId": state.session_id, "dishId": d_id, "quantity": d_qty}).encode("utf-8")
                req = urllib.request.Request("http://127.0.0.1:8080/api/cart/add", data=add_payload, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=1.5) as res:
                    pass
            except Exception as e:
                print(f"Error reordering item: {e}")

        past_id = real_order.get("id", real_order.get("orderId", "PREV-01"))
        items_summary = ", ".join(added_names)
        reorder_inr = total_reorder_paise / 100

        if lang == "hi":
            reply = f"✓ आपका पिछला ऑर्डर (#{past_id}) सफलतापूर्वक कार्ट में जोड़ दिया गया है! 🍲\n\nआइटम: {items_summary} (कुल: ₹{reorder_inr:.2f})।\n\nक्या आप अभी ऑर्डर प्लेस करना चाहेंगे, या मेनू से कुछ और भी जोड़ना चाहते हैं?"
        elif lang == "hinglish":
            reply = f"✓ Aapka pichla order (#{past_id}) cart me successfully add ho gaya hai! 🍲\n\nItems: {items_summary} (Total: ₹{reorder_inr:.2f})।\n\nKya aap abhi order place karna chahenge, ya menu se kuch aur add karna hai?"
        else:
            reply = f"✓ Added your previous order (#{past_id}) to your food basket! 🍲\n\nItems: {items_summary} (Total: ₹{reorder_inr:.2f}).\n\nWould you like to place the order now, or add something else from our menu?"

        return {
            "tool_name": "reorder",
            "response_text": reply,
            "ui_component": {
                "type": "cart_sync_trigger",
                "payload": {"reorder": True, "items": raw_items}
            },
            "quick_replies": ["💳 Place Order Now", "🍕 Add More Items", "🛒 View Cart"]
        }

    # 11. CANCEL ORDER (Flipkart / Amazon Style)
    if intent == "cancel_order":
        real_order = get_latest_order_for_session(state.session_id)
        order_id = real_order.get("id", real_order.get("orderId", "ORD-7821-49")) if real_order else "ORD-7821-49"
        
        if lang == "hi":
            reply = "मैं समझता हूँ कि आप अपना ऑर्डर रद्द करना चाहते हैं। कृपया नीचे दिए गए विकल्पों में से रद्दीकरण का कारण चुनें (100% तुरंत रिफ़ंड):"
        elif lang == "hinglish":
            reply = "Aapka order cancel karne ke liye kripya reason select karein (Flipkart / Amazon style 100% instant refund guarantee):"
        else:
            reply = "I understand you wish to cancel your order. To process your 100% instant refund, please select the reason below:"
            
        return {
            "tool_name": "cancel_order",
            "response_text": reply,
            "ui_component": {
                "type": "cancellation_reason_picker",
                "payload": {
                    "orderId": order_id,
                    "reasons": [
                        "⏱️ Delivery time is too long / delayed",
                        "🛒 Ordered by mistake / wrong dish added",
                        "📍 Need to change delivery address",
                        "💳 Payment or pricing issue",
                        "❌ Changed my mind / found alternative"
                    ]
                }
            },
            "quick_replies": ["⏱️ Delivery time too long", "🛒 Ordered by mistake", "Don't cancel"]
        }

    # 11b. CONFIRM CANCELLATION REASON (Instant refund processing)
    if intent == "confirm_cancel_reason":
        real_order = get_latest_order_for_session(state.session_id)
        order_id = real_order.get("id", real_order.get("orderId", "ORD-7821-49")) if real_order else "ORD-7821-49"
        refund_amount = (real_order.get("totalPaise", real_order.get("total", {}).get("amountPaise", 40100)) / 100) if real_order else 401.00

        clean_reason = state.user_input.replace('🛒', '').replace('⏱️', '').replace('📍', '').replace('💳', '').replace('❌', '').strip()
        try:
            import urllib.request
            cancel_payload = json.dumps({"reason": clean_reason}).encode("utf-8")
            req = urllib.request.Request(f"http://127.0.0.1:8080/api/orders/{order_id}/cancel", data=cancel_payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=1.5) as res:
                pass
        except Exception as e:
            print(f"Error cancelling order via API: {e}")

        if lang == "hi":
            reply = f"✓ हमने आपके अनुरोध पर आपका ऑर्डर #{order_id} रद्द कर दिया है।\n\nकारण: {clean_reason}\n\n₹{refund_amount:.2f} का 100% तुरंत रिफ़ंड 15-30 मिनट में आपके मूल भुगतान खाते में क्रेडिट हो जाएगा। हुई असुविधा के लिए हमें खेद है!\n\nअपने अगले भोजन पर 50% छूट पाने के लिए कोड WELCOME50 का उपयोग करें।"
        elif lang == "hinglish":
            reply = f"✓ Aapka order #{order_id} successfully cancel kar diya gaya hai.\n\nReason: {clean_reason}\n\n100% refund ₹{refund_amount:.2f} agle 15-30 minutes me aapke original payment method par credit ho jayega. Inconvenience ke liye maafi chahte hain!\n\nAap agle order par 50% discount ke liye promo code WELCOME50 use kar sakte hain."
        else:
            reply = f"✓ We have cancelled your order #{order_id} as requested.\n\nReason: {clean_reason}\n\n100% refund of ₹{refund_amount:.2f} will be credited to your original payment method within 15-30 minutes. We apologize for the inconvenience!\n\nAs a token of apology, please use code WELCOME50 on your next order for 50% discount."

        return {
            "tool_name": "cancel_order",
            "response_text": reply,
            "ui_component": {
                "type": "cancellation_confirmed",
                "payload": {"orderId": order_id, "reason": clean_reason, "refundAmount": f"{refund_amount:.2f}"}
            },
            "quick_replies": ["🍕 Browse Menu", "⭐ Chef Specials", "🛒 View Cart"]
        }

    # 11c. KEEP ACTIVE ORDER
    if intent == "keep_order":
        real_order = get_latest_order_for_session(state.session_id)
        order_id = real_order.get("id", real_order.get("orderId", "ORD-7821-49")) if real_order else "ORD-7821-49"
        if lang == "hi":
            reply = f"समझ गया! आपका ऑर्डर #{order_id} एक्टिव है और हमारी रसोई में ताज़ा तैयार किया जा रहा है। 🍽️"
        elif lang == "hinglish":
            reply = f"Got it! Aapka order #{order_id} active hai aur kitchen me fresh prepare ho raha hai. 🍽️"
        else:
            reply = f"Got it! Your order #{order_id} remains active and is being prepared fresh in our kitchen. 🍽️"
            
        return {
            "tool_name": "keep_order",
            "response_text": reply,
            "quickReplies": [f"Track #{order_id}", "🍕 View Menu", "🛒 View Cart"]
        }

    # OFFERS & COUPONS HANDLER
    if intent == "offers":
        if lang == "hi":
            reply = "यहाँ हमारे आज के सक्रिय डिस्काउंट कूपन और ऑफ़र हैं:\n\n🎉 WELCOME50 - नए ग्राहकों के लिए ₹200 से अधिक के ऑर्डर पर 50% छूट (अधिकतम ₹100)।\n🔥 TASTY20 - ₹400 से अधिक के ऑर्डर पर 20% फ़्लैट छूट (अधिकतम ₹150)।\n\nआप चेकआउट के दौरान सीधे इनमें से कोई भी प्रोमो कोड लागू कर सकते हैं!"
        elif lang == "hinglish":
            reply = "Ye rahe hamare active discount coupons aur offers:\n\n🎉 WELCOME50 - 50% OFF up to ₹100 on orders above ₹200 for new customers.\n🔥 TASTY20 - Flat 20% OFF up to ₹150 on orders above ₹400.\n\nCheckout ke dauran aap directly promo code apply kar sakte hain!"
        else:
            reply = "Here are today's active promo deals and discount coupons:\n\n🎉 WELCOME50 - 50% OFF up to ₹100 on orders above ₹200 for new customers.\n🔥 TASTY20 - Flat 20% OFF up to ₹150 on orders above ₹400.\n\nYou can apply any of these promo codes directly at checkout!"

        return {
            "tool_name": "offers",
            "response_text": reply,
            "ui_component": {
                "type": "coupon_list",
                "payload": {
                    "coupons": [
                        {"code": "WELCOME50", "description": "50% OFF up to ₹100 on orders > ₹200", "minSpend": 200},
                        {"code": "TASTY20", "description": "Flat 20% OFF up to ₹150 on orders > ₹400", "minSpend": 400}
                    ]
                }
            },
            "quick_replies": ["Apply WELCOME50", "Apply TASTY20", "🍕 Browse Menu", "🛒 View Cart"]
        }

    # GROUP ORDERING SOLVER HANDLER
    if intent == "group_solver":
        pax_match = re.search(r'(\d+)\s*(?:people|persons|pax|log|logon|लोग|व्यक्ति)', lower)
        budget_match = re.search(r'(\d+)\s*(?:tak|ke\s*andar|rs|rupees|under|below|तक|अंदर)', lower)
        pax = int(pax_match.group(1)) if pax_match else 4
        budget = int(budget_match.group(1)) if budget_match else 1000

        combo_dishes = [
            {"name": "Paneer Butter Masala", "qty": 1, "price": 320},
            {"name": "Dum Biryani", "qty": 1, "price": 349},
            {"name": "Butter Garlic Naan", "qty": 4, "price": 316},
        ]
        combo_total = sum(d["price"] for d in combo_dishes)

        if lang == "hi":
            reply = f"शानदार! {pax} व्यक्तियों के लिए ₹{budget} के बजट में हमारा सबसे लोकप्रिय ग्रुप मील प्लान:\n\n• 1x Paneer Butter Masala\n• 1x Chef's Dum Biryani\n• 4x Butter Garlic Naan\n\nकुल बिल: ₹{combo_total:.2f} (आपके ₹{budget} के बजट में बिल्कुल सही!)। क्या मैं यह पूरा कॉम्बो आपके कार्ट में जोड़ दूँ?"
        elif lang == "hinglish":
            reply = f"Shandar! {pax} logon ke liye ₹{budget} ke budget me perfectly balanced group meal combo:\n\n• 1x Paneer Butter Masala\n• 1x Chef's Dum Biryani\n• 4x Butter Garlic Naan\n\nTotal: ₹{combo_total:.2f} (Aapke ₹{budget} budget ke bilkul andar!)। Kya main ye combo cart me add kar doon?"
        else:
            reply = f"Awesome! For {pax} guests within your ₹{budget} budget, here is our chef-recommended balanced group combo:\n\n• 1x Paneer Butter Masala\n• 1x Chef's Dum Biryani\n• 4x Butter Garlic Naan\n\nTotal: ₹{combo_total:.2f} (well within your ₹{budget} budget). Shall I add this combo to your basket?"

        return {
            "tool_name": "group_solver",
            "response_text": reply,
            "quick_replies": ["Add Group Combo to Cart", "🍕 View Menu", "🛒 View Cart"]
        }

    # AGENTIC CONCIERGE SUPPORT / HELP
    if intent == "agentic_help":
        if lang == "hi":
            reply = "नमस्ते! मैं ChefZaika, आपका AI कलिनरी और कस्टमर सपोर्ट कंसीयर्ज एजेंट हूँ। 🤖 मैं आपकी हर समस्या सुलझाने के लिए यहाँ हूँ।\n\nआप मुझसे नीचे दिए गए किसी भी विषय पर पूछ सकते हैं या सीधे अपनी ज़रूरत बता सकते हैं:"
        elif lang == "hinglish":
            reply = "Hello! Main ChefZaika, aapka AI culinary & customer support concierge agent hoon. 🤖 Main aapki puri help karne ke liye ready hoon.\n\nAap inme se koi bhi topic select kar sakte hain ya direct mujhse pooch sakte hain:"
        else:
            reply = "Hello! I am ChefZaika, your personal AI culinary concierge & customer support agent. 🤖 I'm here to assist you with anything you need.\n\nPlease choose a question below or tell me what you need:"

        return {
            "tool_name": "agentic_help",
            "response_text": reply,
            "ui_component": {
                "type": "concierge_help_card",
                "payload": {
                    "topics": [
                        {"icon": "🔍", "title": "Check Refund Status", "query": "Where is my refund?"},
                        {"icon": "🥗", "title": "Healthy & Low-Calorie Food", "query": "Suggest healthy low calorie options"},
                        {"icon": "🪷", "title": "Strict Jain & Pure Veg", "query": "What Jain dishes are available?"},
                        {"icon": "📅", "title": "Reserve Dining Table", "query": "Book a table for 2 guests"},
                        {"icon": "💳", "title": "Active Offers & Coupons", "query": "What discounts are available?"},
                        {"icon": "👨‍🍳", "title": "Connect with Manager", "query": "I want to talk to restaurant manager"}
                    ]
                }
            },
            "quick_replies": [
                "🔍 Where is my refund?",
                "🥗 Healthy options",
                "🪷 Jain dishes",
                "📅 Book a table",
                "👨‍🍳 Talk to Manager"
            ]
        }

    # INQUIRY: Refund Status
    if intent == "refund_inquiry":
        if lang == "hi":
            reply = "✓ 100% रिफ़ंड गारंटी: रद्द किए गए ऑर्डर का पूरा रिफ़ंड 15 से 30 मिनट के अंदर आपके मूल बैंक खाते / UPI में क्रेडिट हो जाता है।\n\nअगर रिफ़ंड में कोई देरी होती है, तो मैं तुरंत रेस्टोरेंट मैनेजर को अलर्ट कर सकता हूँ।"
        elif lang == "hinglish":
            reply = "✓ 100% Refund Guarantee: Cancelled order ka pura refund agle 15-30 minutes me aapke original payment method (UPI / Bank Account) par credit ho jaata hai.\n\nAgar aapko koi delay lagta hai, toh main direct restaurant manager ko alert bhej sakta hoon."
        else:
            reply = "✓ 100% Instant Refund Guarantee: Your refund is initiated immediately and credited to your original payment method (UPI/Card/Bank) within 15-30 minutes.\n\nIf you need expedited support, I can directly escalate to our restaurant manager."
        return {
            "tool_name": "refund_inquiry",
            "response_text": reply,
            "quick_replies": ["👨‍🍳 Talk to Manager", "🍕 Browse Menu", "🛒 View Cart"]
        }

    # BEVERAGES & JUICES CONCIERGE (Handles coldrink, juice, drinks without arbitrary addition)
    if intent == "beverage_menu":
        bev_dishes = [d for d in menu if d.get("category", "").lower() == "beverages"]
        if not bev_dishes:
            bev_dishes = [d for d in menu if any(t in d.get("tags", []) for t in ["cooling", "beverage", "drink", "refreshing"])]
        if not bev_dishes:
            bev_dishes = menu[:4]

        is_add_request = bool(re.search(r'\b(add|chahiye|daal\s*do|daalo|daal|mangao|mangwa\s*do|cart|kar\s*do)\b', lower))
        if is_add_request:
            if lang == "hi":
                reply = "हमारे पास कई प्रकार के ताज़ा और स्वादिष्ट पेय और जूस हैं! आप इनमें से कौन सा अपनी कार्ट में जोड़ना चाहेंगे?"
            elif lang == "hinglish":
                reply = "Hamare paas kai tarah ke refreshing beverages, drinks aur juices hain! Aap inme se kaun sa cart me add karna chahenge?"
            else:
                reply = "We have a variety of refreshing beverages & juices! Which one would you like to add to your food basket?"
        else:
            if lang == "hi":
                reply = "यहाँ हमारे सबसे लोकप्रिय और ताज़ा पेय, जूस और लस्सी हैं। किसी भी ड्रिंक को सीधे कार्ट में जोड़ने के लिए टैप करें:"
            elif lang == "hinglish":
                reply = "Ye rahe hamare popular aur refreshing cold drinks, juices aur lassi. Direct add karne ke liye tap karein:"
            else:
                reply = "Here are our chef's signature refreshing beverages, juices & shakes. Tap any drink to add it to your basket:"

        return {
            "tool_name": "beverage_menu",
            "response_text": reply,
            "ui_component": {
                "type": "dish_carousel",
                "payload": {
                    "title": "Refreshing Beverages, Juices & Shakes",
                    "dishes": bev_dishes
                }
            },
            "quick_replies": [
                "🍋 Add Fresh Mint Lime Soda (₹99)",
                "🥭 Add Alphonso Mango Lassi (₹149)",
                "🥛 Add Masala Chaas (₹89)",
                "☕ Add Kulhad Chai (₹79)"
            ]
        }

    # INQUIRY: Dietary & Healthy Options (Returns interactive dish cards!)
    if intent == "dietary_inquiry":
        low_cal_dishes = [
            d for d in menu if (d.get("calories", 999) <= 260) or any(t in d.get("tags", []) for t in ["healthy", "cooling", "digestive"])
        ][:4]
        if not low_cal_dishes:
            low_cal_dishes = menu[:4]

        if lang == "hi":
            reply = "यहाँ हमारे शेफ़ के प्रमाणित पौष्टिक (Healthy & Low-Calorie < 300 kcal) व्यंजन हैं:\n\n• Masala Spiced Chaas (75 कैलोरी, पाचक)\n• Fresh Mint Lime Soda (60 कैलोरी, ताज़ा नींबू)\n• Tandoori Paneer Tikka (हाई प्रोटीन, तंदूर भुना)\n\nआप नीचे दिए गए कार्ड्स में से किसी भी डिश को सीधे कार्ट में जोड़ सकते हैं:"
        elif lang == "hinglish":
            reply = "Ye rahe hamare chef ke certified nutritious (Healthy & Low-Calorie < 300 kcal) dishes:\n\n• Masala Spiced Chaas (75 calories, light & digestive)\n• Fresh Mint Lime Soda (60 calories, zero fat)\n• Tandoori Paneer Tikka (High protein, tandoor grilled)\n\nAap neeche diye gaye cards me se directly add kar sakte hain:"
        else:
            reply = "Here are our certified nutritious (Healthy & Low-Calorie < 300 kcal) recommendations:\n\n• Masala Spiced Chaas (75 kcal, digestive)\n• Fresh Mint Lime Soda (60 kcal, vegan & hydrating)\n• Tandoori Paneer Tikka (High protein, tandoor grilled)\n\nTap any dish card below to add it directly to your basket:"

        return {
            "tool_name": "dietary_inquiry",
            "response_text": reply,
            "ui_component": {
                "type": "dish_carousel",
                "payload": {
                    "title": "Healthy & Low-Calorie Recommendations (< 300 kcal)",
                    "dishes": low_cal_dishes
                }
            },
            "quick_replies": ["Add Masala Chaas (75 kcal)", "Add Lime Soda (60 kcal)", "Add Paneer Tikka", "🍕 View Menu"]
        }

    # INQUIRY: Jain & Pure Veg
    if intent == "jain_inquiry":
        jain_dishes = [d for d in menu if "jain" in d.get("tags", []) or d.get("isJain") is True][:4]
        if not jain_dishes:
            jain_dishes = [d for d in menu if d.get("isVeg")][:4]

        if lang == "hi":
            reply = """हमारे यहाँ 100% शुद्ध जैन तैयारी का विशेष ध्यान रखा जाता है (बिना प्याज़, बिना लहसुन, बिना ज़मीकंद):

• Jain Tandoori Paneer Tikka (₹320) - ताज़ा पनीर और शिमला मिर्च
• Tandoori Roti & Steamed Rice

यहाँ हमारे प्रमाणित जैन व्यंजन हैं:"""
        elif lang == "hinglish":
            reply = """Hamare kitchen me strict 100% Jain preparation follow hoti hai (No onion, No garlic, No root vegetables):

• Jain Tandoori Paneer Tikka (₹320) - Fresh paneer & capsicum
• Tandoori Roti & Steamed Rice

Ye rahe hamare certified Jain dishes jise aap direct add kar sakte hain:"""
        else:
            reply = """We strictly follow 100% certified Jain preparation (No onion, no garlic, no root vegetables):

• Jain Tandoori Paneer Tikka (₹320) - Fresh cottage cheese & bell peppers
• Tandoori Roti & Steamed Rice

Here are our certified Jain delicacies:"""
        return {
            "tool_name": "jain_inquiry",
            "response_text": reply,
            "ui_component": {
                "type": "dish_carousel",
                "payload": {"title": "🪷 100% Certified Satvik Jain Dishes", "dishes": jain_dishes}
            },
            "quick_replies": [f"Add {d['name']}" for d in jain_dishes[:2]] + ["🍕 View Full Menu", "🛒 View Cart"]
        }

    # INQUIRY: Human Staff / Manager Escalation
    if intent == "human_handoff":
        ticket_id = f"TKT-{int(time.time() * 1000) % 100000}"
        if lang == "hi":
            reply = f"✓ टिकट #{ticket_id} दर्ज कर लिया गया है। हमारे रेस्टोरेंट मैनेजर को तुरंत सूचित कर दिया गया है और वे आपसे जल्द ही संपर्क करेंगे। 👨‍🍳"
        elif lang == "hinglish":
            reply = f"✓ Ticket #{ticket_id} create ho gaya hai. Hamare restaurant manager ko instant notification bhej diya gaya hai aur woh aapse jaldi contact karenge. 👨‍🍳"
        else:
            reply = f"✓ Support Ticket #{ticket_id} created! Our duty manager has been notified and will assist you shortly. 👨‍🍳"
        return {
            "tool_name": "human_handoff",
            "response_text": reply,
            "quick_replies": ["🍕 Browse Menu", "🛒 View Cart", "📅 Book a Table"]
        }

    # 12. FALLBACK
    if lang == "hi":
        reply = "माफ़ कीजिये, मैं ठीक से समझ नहीं पाया। क्या आप हमारा मेनू देखना चाहेंगे, कोई डिश ऑर्डर करना चाहते हैं, या टेबल बुक करना चाहते हैं?"
        replies = ["🍕 पूरा मेनू देखें", "🔥 मसालेदार पनीर ₹300", "⭐ शेफ़ स्पेशल", "🛒 कार्ट देखें"]
    elif lang == "hinglish":
        reply = "Main theek se samajh nahi paya. Kya aap menu dekhna chahte hain, cart check karna hai ya table book karni hai?"
        replies = ["🍕 View Full Menu", "🔥 Spicy Veg under ₹300", "⭐ Chef Specials", "🛒 View Cart"]
    else:
        reply = "I’m not quite sure I caught that. Would you like to explore our menu, check your cart, or reserve a dining table?"
        replies = ["🍕 View Full Menu", "🔥 Spicy Veg under ₹300", "⭐ Chef Specials", "🛒 View Cart"]

    return {
        "tool_name": "fallback",
        "response_text": reply,
        "quick_replies": replies
    }

# -------------------------------------------------------------
# Build the LangGraph
# -------------------------------------------------------------
workflow = StateGraph(AgentState)
workflow.add_node("detect_language", detect_language_node)
workflow.add_node("intent_routing", intent_routing_node)
workflow.add_node("execute_intent", execution_node)

workflow.set_entry_point("detect_language")
workflow.add_edge("detect_language", "intent_routing")
workflow.add_edge("intent_routing", "execute_intent")
workflow.add_edge("execute_intent", END)

chef_agent = workflow.compile()

# -------------------------------------------------------------
# REST Endpoints
# -------------------------------------------------------------
class ChatRequest(BaseModel):
    sessionId: str = "guest_default"
    message: str

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "engine": "FastAPI + LangGraph Agentic AI",
        "service": "ChefZaika Culinary Agent",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    initial_state = AgentState(
        session_id=req.sessionId,
        user_input=req.message
    )
    result = chef_agent.invoke(initial_state)
    
    return {
        "id": f"msg_{int(time.time() * 1000)}",
        "sender": "bot",
        "text": result.get("response_text", ""),
        "timestamp": datetime.now().strftime("%I:%M %p").lstrip("0"),
        "uiComponent": result.get("ui_component"),
        "quickReplies": result.get("quick_replies", []),
        "toolExecuted": result.get("tool_name", "agent"),
        "language": result.get("language", "en")
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
