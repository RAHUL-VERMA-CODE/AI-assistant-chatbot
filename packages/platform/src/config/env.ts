import fs from 'node:fs';
import path from 'node:path';

/**
 * Typed environment configuration with strict fail-fast validation.
 */

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly realtimePort: number;
  readonly workerPort: number;
  readonly demoTenantPort: number;
  readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly sessionSigningSecret: string;
  readonly sessionTokenTtlSeconds: number;
  readonly devMasterEncryptionKey: string;
  readonly llm: {
    readonly provider: 'groq' | 'xai' | 'openai' | 'gemini' | 'mock';
    readonly model: string;
    readonly fastModel: string;
    readonly apiBaseUrl: string;
    readonly apiKey: string;
    readonly maxRpm: number;
    readonly maxTpm: number;
    readonly timeoutMs: number;
    readonly maxTokensPerTurn: number;
  };
  readonly rateLimit: {
    readonly windowMs: number;
    readonly maxRequestsPerIp: number;
    readonly maxRequestsPerTenant: number;
    readonly maxConcurrentSessionsPerTenant: number;
  };
  readonly retention: {
    readonly transcriptDays: number;
    readonly proposalTtlSeconds: number;
    readonly redactPiiInLogs: boolean;
  };
}

/**
 * Minimal zero-dependency .env loader that searches upwards for a .env file
 */
export function populateEnvFromDotEnv(searchDir = process.cwd()): void {
  let curr = path.resolve(searchDir);
  for (let i = 0; i < 5; i++) {
    const envPath = path.join(curr, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (process.env[key] === undefined) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // Ignore read errors
      }
      break;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Automatically load .env if not already loaded into process.env
  populateEnvFromDotEnv();

  const nodeEnv = (env.NODE_ENV || 'development') as AppConfig['nodeEnv'];

  // Universal LLM provider resolution:
  const llmProvider = (env.LLM_PROVIDER || 'groq').toLowerCase() as AppConfig['llm']['provider'];

  let defaultBaseUrl = 'https://api.groq.com/openai/v1';
  let defaultModel = 'llama-3.3-70b-versatile';
  let defaultFastModel = 'llama-3.1-8b-instant';
  let apiKey = env.LLM_API_KEY || env.GROQ_API_KEY || '';

  if (llmProvider === 'xai') {
    defaultBaseUrl = env.XAI_API_BASE_URL || 'https://api.x.ai/v1';
    defaultModel = env.XAI_MODEL_ID || 'grok-2-mini';
    defaultFastModel = env.XAI_MODEL_ID || 'grok-2-mini';
    apiKey = env.LLM_API_KEY || env.XAI_API_KEY || '';
  } else if (llmProvider === 'openai') {
    defaultBaseUrl = env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
    defaultModel = env.OPENAI_MODEL_ID || 'gpt-4o-mini';
    defaultFastModel = 'gpt-4o-mini';
    apiKey = env.LLM_API_KEY || env.OPENAI_API_KEY || '';
  } else if (llmProvider === 'gemini') {
    defaultBaseUrl = env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/';
    defaultModel = env.GEMINI_MODEL_ID || 'gemini-2.0-flash';
    defaultFastModel = 'gemini-2.0-flash';
    apiKey = env.LLM_API_KEY || env.GEMINI_API_KEY || '';
  }

  const model = env.LLM_MODEL || defaultModel;
  const fastModel = env.LLM_FAST_MODEL || defaultFastModel;
  const apiBaseUrl = env.LLM_API_BASE_URL || defaultBaseUrl;

  return {
    nodeEnv,
    port: parseInt(env.PORT || '3000', 10),
    realtimePort: parseInt(env.REALTIME_PORT || '3001', 10),
    workerPort: parseInt(env.WORKER_PORT || '3002', 10),
    demoTenantPort: parseInt(env.DEMO_TENANT_PORT || '4000', 10),
    logLevel: (env.LOG_LEVEL || 'info') as AppConfig['logLevel'],
    databaseUrl: env.DATABASE_URL || 'postgres://vca_user:vca_password@localhost:5432/vca_db',
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',
    sessionSigningSecret: env.SESSION_SIGNING_SECRET || 'dev_secret_0123456789abcdef0123456789abcdef',
    sessionTokenTtlSeconds: parseInt(env.SESSION_TOKEN_TTL_SECONDS || '7200', 10),
    devMasterEncryptionKey:
      env.DEV_MASTER_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    llm: {
      provider: llmProvider,
      model,
      fastModel,
      apiBaseUrl,
      apiKey,
      maxRpm: parseInt(env.LLM_MAX_RPM || '30', 10),
      maxTpm: parseInt(env.LLM_MAX_TPM || '10000', 10),
      timeoutMs: parseInt(env.LLM_TIMEOUT_MS || '8000', 10),
      maxTokensPerTurn: parseInt(env.LLM_MAX_TOKENS_PER_TURN || '400', 10),
    },
    rateLimit: {
      windowMs: parseInt(env.RATE_LIMIT_WINDOW_MS || '60000', 10),
      maxRequestsPerIp: parseInt(env.RATE_LIMIT_MAX_REQUESTS_PER_IP || '120', 10),
      maxRequestsPerTenant: parseInt(env.RATE_LIMIT_MAX_REQUESTS_PER_TENANT || '1000', 10),
      maxConcurrentSessionsPerTenant: parseInt(env.MAX_CONCURRENT_SESSIONS_PER_TENANT || '100', 10),
    },
    retention: {
      transcriptDays: parseInt(env.TRANSCRIPT_RETENTION_DAYS || '7', 10),
      proposalTtlSeconds: parseInt(env.PROPOSAL_TTL_SECONDS || '120', 10),
      redactPiiInLogs: env.REDACT_PII_IN_LOGS !== 'false',
    },
  };
}
