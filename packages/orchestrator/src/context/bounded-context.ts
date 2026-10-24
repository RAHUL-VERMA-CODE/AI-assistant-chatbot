import type { CartProposal } from '../../../policy-engine/src/index.ts';

export type SessionState =
  | 'GREETING'
  | 'SEARCHING'
  | 'ITEM_SELECTION'
  | 'PROPOSAL_PREVIEW'
  | 'CONFIRMED'
  | 'AWAITING_CLARIFICATION'
  | 'TRACKING';

export interface ConversationTurnRecord {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly timestamp: string;
}

export interface BoundedSessionContext {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userRef: string;
  readonly branchId: string;
  cartVersion: number;
  activeProposal?: CartProposal;
  state: SessionState;
  readonly turns: ConversationTurnRecord[];
  pendingClarification?: {
    readonly question: string;
    readonly options: readonly string[];
    readonly itemId: string;
  };
}

export class BoundedContextManager {
  private readonly sessions = new Map<string, BoundedSessionContext>();
  private readonly maxTurns: number;

  constructor(maxTurns = 6) {
    this.maxTurns = maxTurns;
  }

  public getOrCreate(params: {
    sessionId: string;
    tenantId: string;
    userRef: string;
    branchId: string;
    initialCartVersion?: number;
  }): BoundedSessionContext {
    let session = this.sessions.get(params.sessionId);
    if (!session) {
      session = {
        sessionId: params.sessionId,
        tenantId: params.tenantId,
        userRef: params.userRef,
        branchId: params.branchId,
        cartVersion: params.initialCartVersion || 1,
        state: 'GREETING',
        turns: [],
      };
      this.sessions.set(params.sessionId, session);
    }
    return session;
  }

  public appendTurn(session: BoundedSessionContext, role: 'user' | 'assistant', text: string): void {
    session.turns.push({
      role,
      text,
      timestamp: new Date().toISOString(),
    });

    // Prune oldest turns if exceeding maxTurns
    while (session.turns.length > this.maxTurns) {
      session.turns.shift();
    }
  }

  public getSession(sessionId: string): BoundedSessionContext | undefined {
    return this.sessions.get(sessionId);
  }

  public clear(): void {
    this.sessions.clear();
  }
}
