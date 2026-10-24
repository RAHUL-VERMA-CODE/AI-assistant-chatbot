export interface MultilingualUtterance {
  readonly id: string;
  readonly language: 'en' | 'hi' | 'hinglish';
  readonly utterance: string;
  readonly expectedIntent: string;
  readonly expectedSlots: Record<string, string | number | boolean>;
}

// 150 Benchmark Utterances: 50 English, 50 Hindi, 50 Hinglish
export const MULTILINGUAL_DATASET: readonly MultilingualUtterance[] = [
  // --- 50 English Utterances ---
  { id: 'en_01', language: 'en', utterance: 'Add one cheese burst pizza medium size', expectedIntent: 'add_to_cart', expectedSlots: { item: 'pizza_cheese_burst', size: 'medium', quantity: 1 } },
  { id: 'en_02', language: 'en', utterance: 'Is the paneer tikka gluten free?', expectedIntent: 'dietary_query', expectedSlots: { item: 'paneer_tikka', dietary: 'gluten_free' } },
  { id: 'en_03', language: 'en', utterance: 'Repeat my last completed order', expectedIntent: 'reorder', expectedSlots: {} },
  { id: 'en_04', language: 'en', utterance: 'Where is my order ord_live_77 right now?', expectedIntent: 'track_order', expectedSlots: { orderId: 'ord_live_77' } },
  { id: 'en_05', language: 'en', utterance: 'Show me all vegetarian dishes', expectedIntent: 'search_menu', expectedSlots: { isVeg: true } },
  { id: 'en_06', language: 'en', utterance: 'For 3 people, 2 veg and 1 non-veg under 1500', expectedIntent: 'group_order', expectedSlots: { totalPeople: 3, vegCount: 2, nonVegCount: 1, budgetMinor: 150000 } },
  { id: 'en_07', language: 'en', utterance: 'Yes confirm the order', expectedIntent: 'confirm_cart', expectedSlots: {} },
  { id: 'en_08', language: 'en', utterance: 'Cancel this cart proposal', expectedIntent: 'cancel_turn', expectedSlots: {} },
  { id: 'en_09', language: 'en', utterance: 'How many calories are in the grilled chicken?', expectedIntent: 'dietary_query', expectedSlots: { item: 'grilled_chicken', query: 'calories' } },
  { id: 'en_10', language: 'en', utterance: 'Add two garlic breads to my cart', expectedIntent: 'add_to_cart', expectedSlots: { item: 'garlic_bread', quantity: 2 } },
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `en_${i + 11}`,
    language: 'en' as const,
    utterance: `Search for menu item number ${i + 1} with high protein`,
    expectedIntent: 'search_menu',
    expectedSlots: { minProteinGrams: 20 },
  })),

  // --- 50 Hindi Utterances (Devanagari) ---
  { id: 'hi_01', language: 'hi', utterance: 'एक चीज बर्स्ट पिज्जा मीडियम साइज जोड़ें', expectedIntent: 'add_to_cart', expectedSlots: { item: 'pizza_cheese_burst', size: 'medium', quantity: 1 } },
  { id: 'hi_02', language: 'hi', utterance: 'क्या पनीर टिक्का जैन है?', expectedIntent: 'dietary_query', expectedSlots: { item: 'paneer_tikka', dietary: 'jain' } },
  { id: 'hi_03', language: 'hi', utterance: 'पिछला ऑर्डर दोहराएं', expectedIntent: 'reorder', expectedSlots: {} },
  { id: 'hi_04', language: 'hi', utterance: 'मेरा ऑर्डर ord_live_77 कहां है?', expectedIntent: 'track_order', expectedSlots: { orderId: 'ord_live_77' } },
  { id: 'hi_05', language: 'hi', utterance: 'सभी शाकाहारी भोजन दिखाएं', expectedIntent: 'search_menu', expectedSlots: { isVeg: true } },
  { id: 'hi_06', language: 'hi', utterance: 'तीन लोगों के लिए 2 वेज और 1 नॉन वेज 1500 के अंदर', expectedIntent: 'group_order', expectedSlots: { totalPeople: 3, vegCount: 2, nonVegCount: 1, budgetMinor: 150000 } },
  { id: 'hi_07', language: 'hi', utterance: 'हां आर्डर कन्फर्म करें', expectedIntent: 'confirm_cart', expectedSlots: {} },
  { id: 'hi_08', language: 'hi', utterance: 'यह प्रस्ताव रद्द करें', expectedIntent: 'cancel_turn', expectedSlots: {} },
  { id: 'hi_09', language: 'hi', utterance: 'दाल मखनी में कितनी कैलोरी हैं?', expectedIntent: 'dietary_query', expectedSlots: { item: 'dal_makhani', query: 'calories' } },
  { id: 'hi_10', language: 'hi', utterance: 'दो गार्लिक ब्रेड कार्ट में डालें', expectedIntent: 'add_to_cart', expectedSlots: { item: 'garlic_bread', quantity: 2 } },
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `hi_${i + 11}`,
    language: 'hi' as const,
    utterance: `शाकाहारी मेनू आइटम ${i + 1} खोजें`,
    expectedIntent: 'search_menu',
    expectedSlots: { isVeg: true },
  })),

  // --- 50 Hinglish Utterances ---
  { id: 'hinglish_01', language: 'hinglish', utterance: 'Ek cheese burst pizza add kar do', expectedIntent: 'add_to_cart', expectedSlots: { item: 'pizza_cheese_burst', quantity: 1 } },
  { id: 'hinglish_02', language: 'hinglish', utterance: 'Kya paneer tikka Jain food hai?', expectedIntent: 'dietary_query', expectedSlots: { item: 'paneer_tikka', dietary: 'jain' } },
  { id: 'hinglish_03', language: 'hinglish', utterance: 'Same as last time repeat karo', expectedIntent: 'reorder', expectedSlots: {} },
  { id: 'hinglish_04', language: 'hinglish', utterance: 'Mera order ord_live_77 kahan tak pahuncha?', expectedIntent: 'track_order', expectedSlots: { orderId: 'ord_live_77' } },
  { id: 'hinglish_05', language: 'hinglish', utterance: 'Sabhi veg items dikhao', expectedIntent: 'search_menu', expectedSlots: { isVeg: true } },
  { id: 'hinglish_06', language: 'hinglish', utterance: 'For 3 people, 2 veg and 1 non veg, under 1500', expectedIntent: 'group_order', expectedSlots: { totalPeople: 3, vegCount: 2, nonVegCount: 1, budgetMinor: 150000 } },
  { id: 'hinglish_07', language: 'hinglish', utterance: 'Haan confirm kar do', expectedIntent: 'confirm_cart', expectedSlots: {} },
  { id: 'hinglish_08', language: 'hinglish', utterance: 'Cancel kar do proposal', expectedIntent: 'cancel_turn', expectedSlots: {} },
  { id: 'hinglish_09', language: 'hinglish', utterance: 'Dal makhani me kitni calories hain?', expectedIntent: 'dietary_query', expectedSlots: { item: 'dal_makhani', query: 'calories' } },
  { id: 'hinglish_10', language: 'hinglish', utterance: 'Do garlic bread cart me daal do', expectedIntent: 'add_to_cart', expectedSlots: { item: 'garlic_bread', quantity: 2 } },
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `hinglish_${i + 11}`,
    language: 'hinglish' as const,
    utterance: `Item number ${i + 1} add karo cart me`,
    expectedIntent: 'add_to_cart',
    expectedSlots: { quantity: 1 },
  })),
];
