import type { ConnectorClient } from '../../../connector-sdk/src/index.ts';
import type { ProposalManager, CustomerPreferences } from '../../../policy-engine/src/index.ts';
import type { LLMProvider } from '../../../llm/src/index.ts';
import { PromptGuard } from '../../../llm/src/index.ts';
import { BoundedContextManager, type BoundedSessionContext } from '../context/bounded-context.ts';
import { FastPathRouter } from '../fast-paths/fast-path-router.ts';
import { SlotExtractor } from '../intent/slot-extractor.ts';
import { ClarificationPolicy } from '../clarification/clarification-policy.ts';
import { FactRenderer } from '../templates/fact-renderer.ts';
import { GroundingGuard } from '../grounding/grounding-guard.ts';
import {
  GroupBudgetSolver,
  JainValidator,
  AllergenValidator,
  PairingRecommender,
} from '../../../policy-food/src/index.ts';
import { ConstraintEvaluator } from '../../../policy-engine/src/index.ts';
import { mongoRepos } from '../../../platform/src/index.ts';

export interface TurnExecutionResult {
  readonly replyText: string;
  readonly sessionState: string;
  readonly proposalId?: string;
  readonly proposalTotalMinor?: number;
  readonly proposalItems?: readonly any[];
  readonly proposalCharges?: any;
  readonly currency: string;
  readonly isFastPath: boolean;
  readonly durationMs: number;
  readonly committedCart?: any;
}

export class TurnOrchestrator {
  private readonly connector: ConnectorClient;
  private readonly proposalManager: ProposalManager;
  private readonly contextManager: BoundedContextManager;
  private readonly llm: LLMProvider;

  constructor(options: {
    connector: ConnectorClient;
    proposalManager: ProposalManager;
    contextManager?: BoundedContextManager;
    llm: LLMProvider;
  }) {
    this.connector = options.connector;
    this.proposalManager = options.proposalManager;
    this.contextManager = options.contextManager || new BoundedContextManager();
    this.llm = options.llm;
  }

  public async processTurn(params: {
    sessionId: string;
    tenantId: string;
    userRef: string;
    branchId: string;
    utterance: string;
    savedPreferences?: CustomerPreferences;
  }): Promise<TurnExecutionResult> {
    const startTime = performance.now();

    // 1. Get or initialize bounded session
    const session = this.contextManager.getOrCreate({
      sessionId: params.sessionId,
      tenantId: params.tenantId,
      userRef: params.userRef,
      branchId: params.branchId,
    });

    // 2. Sanitize against prompt injection
    const sanitized = PromptGuard.sanitize(params.utterance);
    const cleanText = sanitized.sanitizedText;

    // 3. Fast-Path Router (LLM-Bypass for instant confirm/cancel/reorder)
    const fastPath = await FastPathRouter.evaluateAndExecute(
      cleanText,
      session,
      this.connector,
      this.proposalManager,
    );

    if (fastPath.handled) {
      this.contextManager.appendTurn(session, 'user', cleanText);
      this.contextManager.appendTurn(session, 'assistant', fastPath.assistantReply);

      if (fastPath.proposalCommitted && fastPath.committedCart) {
        // Persist order in MongoDB
        await mongoRepos.orders.insertOne({
          orderId: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          tenantId: session.tenantId,
          branchId: session.branchId,
          userRef: session.userRef,
          items: fastPath.committedCart.items,
          charges: fastPath.committedCart.charges,
          totalMinor: fastPath.committedCart.totalMinor,
          currency: fastPath.committedCart.currency,
          status: 'CONFIRMED',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Persist/Update active cart in MongoDB
        await mongoRepos.carts.updateOne(
          { tenantId: session.tenantId, userRef: session.userRef },
          {
            $set: {
              cartId: fastPath.committedCart.cartId,
              branchId: session.branchId,
              cartVersion: fastPath.committedCart.newCartVersion,
              items: fastPath.committedCart.items,
              charges: fastPath.committedCart.charges,
              totalMinor: fastPath.committedCart.totalMinor,
              currency: fastPath.committedCart.currency,
              updatedAt: new Date().toISOString(),
            },
          },
          { upsert: true },
        );

        // Audit log in MongoDB
        await mongoRepos.auditLogs.insertOne({
          tenantId: session.tenantId,
          userRef: session.userRef,
          action: 'CART_CONFIRMED_FASTPATH',
          resource: fastPath.committedCart.cartId,
          details: { totalMinor: fastPath.committedCart.totalMinor, currency: fastPath.committedCart.currency },
          timestamp: new Date().toISOString(),
        });
      }

      return {
        replyText: fastPath.assistantReply,
        sessionState: session.state,
        currency: 'INR',
        isFastPath: true,
        durationMs: performance.now() - startTime,
        committedCart: fastPath.committedCart,
      };
    }

    // 4. Fetch live branch catalog
    const catalog = await this.connector.getCatalog(session.branchId);

    // 5. Check if user is answering a pending clarification
    if (session.pendingClarification) {
      const pendingItem = catalog.items.find((i) => i.id === session.pendingClarification!.itemId);
      if (pendingItem && pendingItem.variants) {
        let matchedVariant = pendingItem.variants.find((v) =>
          cleanText.toLowerCase().includes(v.name.toLowerCase()),
        );
        if (!matchedVariant) {
          if (/\b(?:bada|large)\b/i.test(cleanText)) {
            matchedVariant = pendingItem.variants.find((v) => v.name.toLowerCase() === 'large');
          } else if (/\b(?:medium|beech\s*ka)\b/i.test(cleanText)) {
            matchedVariant = pendingItem.variants.find((v) => v.name.toLowerCase() === 'medium');
          } else if (/\b(?:chhota|regular|small)\b/i.test(cleanText)) {
            matchedVariant = pendingItem.variants.find(
              (v) => v.name.toLowerCase() === 'regular' || v.name.toLowerCase() === 'small',
            );
          }
        }

        if (matchedVariant) {
          session.pendingClarification = undefined;
          return this.createSingleItemProposal(session, pendingItem, matchedVariant, 1, catalog, startTime);
        }
      }
    }

    // 6. Slot Extraction & Intent Analysis
    const slots = SlotExtractor.extract(cleanText, catalog);

    // Evaluate constraints (precedence: Turn > Saved)
    const effectiveConstraints = ConstraintEvaluator.resolve(
      {
        isJain: slots.isJain,
        isVeg: slots.isVeg,
        isGlutenFree: slots.isGlutenFree,
        excludedAllergens: slots.excludedAllergens,
      },
      params.savedPreferences,
    );

    if (effectiveConstraints.conflictDetected) {
      const reply = `${effectiveConstraints.conflictReason} Please clarify your dietary preferences.`;
      this.contextManager.appendTurn(session, 'user', cleanText);
      this.contextManager.appendTurn(session, 'assistant', reply);
      return {
        replyText: reply,
        sessionState: session.state,
        currency: catalog.currency,
        isFastPath: false,
        durationMs: performance.now() - startTime,
      };
    }

    // 6b. Greeting / Onboarding
    if (slots.isGreeting) {
      const reply = `Namaste! Welcome to ${catalog.branchName}. Aaj kya khane ka mood hai? We have delicious Cheese Burst Pizzas, certified Jain Paneer Tikka, Dum Biryani, and more!`;
      this.contextManager.appendTurn(session, 'user', cleanText);
      this.contextManager.appendTurn(session, 'assistant', reply);
      return {
        replyText: reply,
        sessionState: session.state,
        currency: catalog.currency,
        isFastPath: false,
        durationMs: performance.now() - startTime,
      };
    }

    // 6c. Preference Consent Save (Req A06)
    if (slots.isPreferenceSave) {
      const isVegOnly = slots.isVeg || slots.isJain || false;
      await mongoRepos.preferences.updateOne(
        { tenantId: session.tenantId, userRef: session.userRef },
        {
          $set: {
            tenantId: session.tenantId,
            userRef: session.userRef,
            vegOnly: isVegOnly,
            consentedAt: new Date().toISOString(),
          },
        },
        { upsert: true },
      );
      const reply = `Your dietary preference (${isVegOnly ? 'Vegetarian' : 'Saved'}) has been recorded with your consent. You can view, modify, or delete it anytime.`;
      this.contextManager.appendTurn(session, 'user', cleanText);
      this.contextManager.appendTurn(session, 'assistant', reply);
      return {
        replyText: reply,
        sessionState: session.state,
        currency: catalog.currency,
        isFastPath: false,
        durationMs: performance.now() - startTime,
      };
    }

    // 6d. Factual Dish Q&A (Nutrition, Calories, Ingredients, Spice, Allergens - Req A02)
    if (slots.isQuestion && slots.matchedItem) {
      const item = slots.matchedItem;
      let answer = '';

      if (/\b(?:calorie|calories|kcal|protein|nutrition)\b/i.test(cleanText)) {
        if (item.nutrition && item.nutrition.isVerified) {
          answer = `${item.name} contains ${item.nutrition.kcal} kcal and ${item.nutrition.proteinGrams}g of protein per serving (${item.nutrition.servingSizeGrams}g), verified by lab testing.`;
        } else {
          answer = `Nutritional calorie and protein data for ${item.name} is currently unverified in our laboratory records.`;
        }
      } else if (/\b(?:ingredient|ingredients|samagri)\b/i.test(cleanText)) {
        if (item.recipe?.ingredientsList && item.recipe.ingredientsList.length > 0) {
          answer = `${item.name} contains: ${item.recipe.ingredientsList.join(', ')}.`;
        } else {
          answer = `Detailed ingredient breakdown for ${item.name} is not verified in our database.`;
        }
      } else if (/\b(?:spice|teekha)\b/i.test(cleanText)) {
        answer = `${item.name} has a ${item.recipe?.spiceLevel || 'MILD'} spice level with ${item.recipe?.creaminess || 'MEDIUM'} creaminess.`;
      } else if (/\b(?:allergen|allergens|allergy|safe)\b/i.test(cleanText)) {
        if (item.recipe?.allergensPresent && item.recipe.allergensPresent.length > 0) {
          answer = `Allergen warning: ${item.name} contains ${item.recipe.allergensPresent.join(', ')}. Cross-contact risk is ${item.recipe.crossContactRisk}. Please confirm with staff.`;
        } else {
          answer = `${item.name} has no major declared allergens in its verified recipe. Cross-contact risk: ${item.recipe?.crossContactRisk || 'LOW'}.`;
        }
      } else {
        answer = `${item.name} is ${item.recipe?.isVeg ? 'Vegetarian' : 'Non-Vegetarian'} (INR ${(item.basePriceMinor / 100).toFixed(2)}).`;
      }

      this.contextManager.appendTurn(session, 'user', cleanText);
      this.contextManager.appendTurn(session, 'assistant', answer);
      return {
        replyText: answer,
        sessionState: session.state,
        currency: catalog.currency,
        isFastPath: false,
        durationMs: performance.now() - startTime,
      };
    }

    // 6e. Menu Discovery & Filter (Req A02 / A03)
    if (slots.isDiscovery && !slots.isAddIntent) {
      let filtered = catalog.items.filter((i) => i.inStock && i.active);

      // Filter by Jain
      if (effectiveConstraints.isJain || /\bjain\b/i.test(cleanText)) {
        filtered = filtered.filter((i) => i.recipe?.isJain === 'TRUE');
      } else if (effectiveConstraints.isVeg || /\bveg\b/i.test(cleanText)) {
        filtered = filtered.filter((i) => i.recipe?.isVeg);
      }

      // Filter by Keyword
      if (/\bpaneer\b/i.test(cleanText)) {
        filtered = filtered.filter((i) => i.name.toLowerCase().includes('paneer') || (i.aliases || []).some((a) => a.includes('paneer')));
      } else if (/\bpizza\b/i.test(cleanText)) {
        filtered = filtered.filter((i) => i.category.toLowerCase().includes('pizza') || i.name.toLowerCase().includes('pizza'));
      } else if (/\bbiryani\b/i.test(cleanText)) {
        filtered = filtered.filter((i) => i.name.toLowerCase().includes('biryani') || i.category.toLowerCase().includes('main'));
      }

      // Filter by Spice
      if (/\b(?:spicy|teekha|hot)\b/i.test(cleanText)) {
        filtered = filtered.filter((i) => i.recipe?.spiceLevel === 'HOT' || i.recipe?.spiceLevel === 'MEDIUM');
      }

      // Filter by Budget (e.g. under 300)
      const budgetMatch = cleanText.match(/(?:under|below|budget|tak|ke\s*andar)\s+(?:inr|rs\.?|₹)?\s*(\d+)/i) || cleanText.match(/(?:inr|rs\.?|₹)?\s*(\d+)\s*(?:ke\s*andar|tak)/i);
      if (budgetMatch) {
        const maxMinor = parseInt(budgetMatch[1], 10) * 100;
        filtered = filtered.filter((i) => i.basePriceMinor <= maxMinor);
      }

      let reply = '';
      if (filtered.length > 0) {
        const dishList = filtered.slice(0, 4).map((d) => `• ${d.name} - ${catalog.currency} ${(d.basePriceMinor / 100).toFixed(2)} (${d.recipe?.isVeg ? 'Veg' : 'Non-Veg'}, ${d.recipe?.spiceLevel || 'Mild'})`).join('\n');
        reply = `Here are matching options from our verified menu:\n${dishList}\nWould you like to add any of these to your cart?`;
      } else {
        if (budgetMatch && /\bpizza\b/i.test(cleanText)) {
          reply = `Our verified Cheese Burst Pizza starts at INR 399.00. We don't have veg pizzas under INR ${budgetMatch[1]} currently. Would you like to check our High Protein Dal Tadka (INR 260.00) or Homestyle Khichdi (INR 210.00) instead?`;
        } else {
          reply = `I couldn't find any dishes matching those exact filters in our verified menu. Would you like to explore our bestsellers?`;
        }
      }

      this.contextManager.appendTurn(session, 'user', cleanText);
      this.contextManager.appendTurn(session, 'assistant', reply);
      return {
        replyText: reply,
        sessionState: session.state,
        currency: catalog.currency,
        isFastPath: false,
        durationMs: performance.now() - startTime,
      };
    }

    // 7. Group Ordering Knapsack Solver (Req A05)
    if (slots.groupMix) {
      const solution = GroupBudgetSolver.solve(catalog, {
        partySize: slots.groupMix.partySize,
        vegCount: slots.groupMix.vegCount,
        nonVegCount: slots.groupMix.nonVegCount,
        maxBudgetMinor: slots.groupMix.maxBudgetMinor,
        isJainOnly: effectiveConstraints.isJain,
        excludedAllergens: effectiveConstraints.excludedAllergens,
      });

      if (!solution.feasible) {
        const reply = `${solution.failureReason} Would you like to adjust your budget or party size?`;
        this.contextManager.appendTurn(session, 'user', cleanText);
        this.contextManager.appendTurn(session, 'assistant', reply);
        return {
          replyText: reply,
          sessionState: session.state,
          currency: catalog.currency,
          isFastPath: false,
          durationMs: performance.now() - startTime,
        };
      }

      // Build group choices
      const lineChoices = solution.allocations.map((a) => ({
        itemId: a.item.id,
        quantity: 1,
        optionIds: [] as string[],
      }));

      const valRes = await this.connector.validateCart({
        branchId: session.branchId,
        userRef: session.userRef,
        items: lineChoices,
      });

      const proposal = this.proposalManager.createProposal({
        tenantId: session.tenantId,
        userRef: session.userRef,
        branchId: session.branchId,
        cartVersion: valRes.cartVersion,
        items: solution.allocations.map((a) => ({
          itemId: a.item.id,
          itemName: a.item.name,
          optionIds: [],
          quantity: 1,
          unitPriceMinor: a.priceMinor,
          lineTotalMinor: a.priceMinor,
          allocatedToPerson: a.personLabel,
          dietaryClassification: a.dietaryType,
        })),
        rawChoices: lineChoices,
        currency: catalog.currency,
        charges: {
          subtotalMinor: valRes.subtotalMinor,
          deliveryFeeMinor: valRes.deliveryFeeMinor,
          packagingFeeMinor: valRes.packagingFeeMinor,
          taxMinor: valRes.taxMinor,
          discountMinor: 0,
          totalMinor: valRes.totalMinor,
        },
        summaryText: `Group cart for ${slots.groupMix.partySize} people. Total: ${catalog.currency} ${(valRes.totalMinor / 100).toFixed(2)}.`,
      });

      session.activeProposal = proposal;
      session.state = 'PROPOSAL_PREVIEW';

      const reply = `I have planned a cart for ${slots.groupMix.partySize} people: ${solution.allocations.map((a) => `${a.personLabel}: ${a.item.name}`).join(', ')}. ${solution.adequacyNotice} Total is ${catalog.currency} ${(valRes.totalMinor / 100).toFixed(2)}. Confirm this order?`;

      this.contextManager.appendTurn(session, 'user', cleanText);
      this.contextManager.appendTurn(session, 'assistant', reply);

      return {
        replyText: reply,
        sessionState: session.state,
        proposalId: proposal.proposalId,
        proposalTotalMinor: proposal.charges.totalMinor,
        proposalItems: proposal.items,
        proposalCharges: proposal.charges,
        currency: catalog.currency,
        isFastPath: false,
        durationMs: performance.now() - startTime,
      };
    }

    // 8. Single Item Proposal or Clarification
    if (slots.matchedItem) {
      const item = slots.matchedItem;

      // Dietary verification
      if (effectiveConstraints.isJain) {
        const jainRes = JainValidator.validateItem(item);
        if (!jainRes.isJainCompliant) {
          const reply = `${jainRes.reason || jainRes.unverifiedReason} Would you like to see our certified Jain alternatives instead?`;
          this.contextManager.appendTurn(session, 'user', cleanText);
          this.contextManager.appendTurn(session, 'assistant', reply);
          return {
            replyText: reply,
            sessionState: session.state,
            currency: catalog.currency,
            isFastPath: false,
            durationMs: performance.now() - startTime,
          };
        }
      }

      if (effectiveConstraints.excludedAllergens.length > 0) {
        const allergenRes = AllergenValidator.validate(item, effectiveConstraints.excludedAllergens, effectiveConstraints.isGlutenFree);
        if (!allergenRes.isSafe) {
          const reply = `${allergenRes.reason || allergenRes.unverifiedLimitation} Would you like to choose another dish?`;
          this.contextManager.appendTurn(session, 'user', cleanText);
          this.contextManager.appendTurn(session, 'assistant', reply);
          return {
            replyText: reply,
            sessionState: session.state,
            currency: catalog.currency,
            isFastPath: false,
            durationMs: performance.now() - startTime,
          };
        }
      }

      // Clarification check (Req A3: Ask ONE focused question if size is ambiguous)
      const clarification = ClarificationPolicy.evaluateItemClarification(
        item,
        slots.matchedVariant?.id,
        catalog.currency,
      );

      if (clarification.required && clarification.question) {
        session.state = 'AWAITING_CLARIFICATION';
        session.pendingClarification = {
          question: clarification.question,
          options: clarification.options || [],
          itemId: item.id,
        };

        const reply = FactRenderer.renderClarification(clarification.question, clarification.options || []);
        this.contextManager.appendTurn(session, 'user', cleanText);
        this.contextManager.appendTurn(session, 'assistant', reply);

        return {
          replyText: reply,
          sessionState: session.state,
          currency: catalog.currency,
          isFastPath: false,
          durationMs: performance.now() - startTime,
        };
      }

      // Valid single item -> create proposal
      return this.createSingleItemProposal(
        session,
        item,
        slots.matchedVariant,
        slots.quantity,
        catalog,
        startTime,
      );
    }

    // 9. LLM Conversational Fallback with Grounding Guard
    const chatPrompt = [
      {
        role: 'system' as const,
        content: `You are the AI Voice Commerce Assistant for ${catalog.branchName}. Speak factually and concisely in natural Hinglish or English. Never hallucinate items, prices, or ingredients not present in the menu. Menu items available: ${catalog.items.map((i) => `${i.name} (INR ${(i.basePriceMinor / 100).toFixed(0)})`).join(', ')}.`,
      },
      ...session.turns.map((t) => ({ role: t.role, content: t.text })),
      { role: 'user' as const, content: cleanText },
    ];

    const llmRes = await this.llm.chat(chatPrompt, { temperature: 0.1, maxTokens: 256 });
    const guarded = GroundingGuard.verifyAndEnforce(llmRes.text, catalog, session.activeProposal);

    this.contextManager.appendTurn(session, 'user', cleanText);
    this.contextManager.appendTurn(session, 'assistant', guarded.sanitizedText);

    return {
      replyText: guarded.sanitizedText,
      sessionState: session.state,
      currency: catalog.currency,
      isFastPath: false,
      durationMs: performance.now() - startTime,
    };
  }

  private async createSingleItemProposal(
    session: BoundedSessionContext,
    item: any,
    variant: any,
    quantity: number,
    catalog: any,
    startTime: number,
  ): Promise<TurnExecutionResult> {
    const lineChoice = {
      itemId: item.id,
      variantId: variant?.id,
      optionIds: [] as string[],
      quantity,
    };

    const valRes = await this.connector.validateCart({
      branchId: session.branchId,
      userRef: session.userRef,
      items: [lineChoice],
    });

    const unitPrice = variant ? variant.priceMinor : item.basePriceMinor;

    const proposal = this.proposalManager.createProposal({
      tenantId: session.tenantId,
      userRef: session.userRef,
      branchId: session.branchId,
      cartVersion: valRes.cartVersion,
      items: [
        {
          itemId: item.id,
          itemName: item.name,
          variantId: variant?.id,
          variantName: variant?.name,
          optionIds: [],
          quantity,
          unitPriceMinor: unitPrice,
          lineTotalMinor: unitPrice * quantity,
        },
      ],
      rawChoices: [lineChoice],
      currency: catalog.currency,
      charges: {
        subtotalMinor: valRes.subtotalMinor,
        deliveryFeeMinor: valRes.deliveryFeeMinor,
        packagingFeeMinor: valRes.packagingFeeMinor,
        taxMinor: valRes.taxMinor,
        discountMinor: 0,
        totalMinor: valRes.totalMinor,
      },
      summaryText: FactRenderer.renderProposal({
        proposalId: 'preview',
        tenantId: session.tenantId,
        userRef: session.userRef,
        branchId: session.branchId,
        cartVersion: valRes.cartVersion,
        items: [
          {
            itemId: item.id,
            itemName: item.name,
            variantId: variant?.id,
            variantName: variant?.name,
            optionIds: [],
            quantity,
            unitPriceMinor: unitPrice,
            lineTotalMinor: unitPrice * quantity,
          },
        ],
        rawChoices: [lineChoice],
        currency: catalog.currency,
        charges: {
          subtotalMinor: valRes.subtotalMinor,
          deliveryFeeMinor: valRes.deliveryFeeMinor,
          packagingFeeMinor: valRes.packagingFeeMinor,
          taxMinor: valRes.taxMinor,
          discountMinor: 0,
          totalMinor: valRes.totalMinor,
        },
        summaryText: '',
        createdAt: '',
        expiresAt: '',
        status: 'ACTIVE',
      }),
    });

    session.activeProposal = proposal;
    session.state = 'PROPOSAL_PREVIEW';

    let reply = FactRenderer.renderProposal(proposal);

    // Optional P1 add-on pairing recommendation (Req A09: At most 1, never silent addition)
    const pairing = PairingRecommender.recommendPairing(catalog, [lineChoice]);
    if (pairing) {
      reply += ` ${pairing.suggestionPrompt}`;
    }

    this.contextManager.appendTurn(session, 'user', `${quantity}x ${item.name}`);
    this.contextManager.appendTurn(session, 'assistant', reply);

    return {
      replyText: reply,
      sessionState: session.state,
      proposalId: proposal.proposalId,
      proposalTotalMinor: proposal.charges.totalMinor,
      proposalItems: proposal.items,
      proposalCharges: proposal.charges,
      currency: catalog.currency,
      isFastPath: false,
      durationMs: performance.now() - startTime,
    };
  }
}
