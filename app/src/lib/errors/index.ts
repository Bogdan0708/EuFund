// ─── Structured Error Framework ─────────────────────────────────
// All errors follow a consistent pattern with Romanian + English messages

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'LEGAL_COMPLIANCE_ERROR';

export interface AppError {
  code: ErrorCode;
  messageRo: string;
  messageEn: string;
  statusCode: number;
  field?: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

export class FondEUError extends Error {
  public readonly code: ErrorCode;
  public readonly messageRo: string;
  public readonly messageEn: string;
  public readonly statusCode: number;
  public readonly field?: string;
  public readonly details?: Record<string, unknown>;
  public readonly retryable: boolean;
  public readonly timestamp: string;

  constructor(error: AppError) {
    super(error.messageEn);
    this.name = 'FondEUError';
    this.code = error.code;
    this.messageRo = error.messageRo;
    this.messageEn = error.messageEn;
    this.statusCode = error.statusCode;
    this.field = error.field;
    this.details = error.details;
    this.retryable = error.retryable;
    this.timestamp = new Date().toISOString();
  }

  toResponse(locale: 'ro' | 'en' = 'ro') {
    return {
      success: false,
      error: {
        code: this.code,
        message: locale === 'ro' ? this.messageRo : this.messageEn,
        field: this.field,
        details: this.details,
        timestamp: this.timestamp,
      },
    };
  }
}

// ─── Error Factories ─────────────────────────────────────────────

export const Errors = {
  validation(field: string, messageRo: string, messageEn: string) {
    return new FondEUError({
      code: 'VALIDATION_ERROR',
      messageRo,
      messageEn,
      statusCode: 400,
      field,
      retryable: false,
    });
  },

  notFound(resourceType: string, resourceId?: string) {
    return new FondEUError({
      code: 'NOT_FOUND',
      messageRo: `Resursa ${resourceType} nu a fost găsită.`,
      messageEn: `Resource ${resourceType} not found.`,
      statusCode: 404,
      details: resourceId ? { resourceId } : undefined,
      retryable: false,
    });
  },

  unauthorized() {
    return new FondEUError({
      code: 'UNAUTHORIZED',
      messageRo: 'Nu sunteți autentificat.',
      messageEn: 'Not authenticated.',
      statusCode: 401,
      retryable: false,
    });
  },

  forbidden() {
    return new FondEUError({
      code: 'FORBIDDEN',
      messageRo: 'Nu aveți permisiunea necesară.',
      messageEn: 'Insufficient permissions.',
      statusCode: 403,
      retryable: false,
    });
  },

  rateLimited(retryAfterMs?: number) {
    return new FondEUError({
      code: 'RATE_LIMITED',
      messageRo: 'Prea multe cereri. Vă rugăm să așteptați.',
      messageEn: 'Too many requests. Please wait.',
      statusCode: 429,
      details: retryAfterMs ? { retryAfterMs } : undefined,
      retryable: true,
    });
  },

  internal(details?: string) {
    return new FondEUError({
      code: 'INTERNAL_ERROR',
      messageRo: 'A apărut o eroare internă. Vă rugăm să încercați din nou.',
      messageEn: 'An internal error occurred. Please try again.',
      statusCode: 500,
      details: details ? { info: details } : undefined,
      retryable: true,
    });
  },

  serviceUnavailable(service: string) {
    return new FondEUError({
      code: 'SERVICE_UNAVAILABLE',
      messageRo: `Serviciul ${service} nu este disponibil momentan.`,
      messageEn: `Service ${service} is currently unavailable.`,
      statusCode: 503,
      retryable: true,
    });
  },

  legalCompliance(messageRo: string, messageEn: string, details?: Record<string, unknown>) {
    return new FondEUError({
      code: 'LEGAL_COMPLIANCE_ERROR',
      messageRo,
      messageEn,
      statusCode: 422,
      details,
      retryable: false,
    });
  },
};

// ─── Retry Logic ─────────────────────────────────────────────────

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, backoffMultiplier } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (error instanceof FondEUError && !error.retryable) {
        throw error;
      }

      if (attempt === maxRetries) break;

      const delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }

  throw lastError;
}

// ─── Circuit Breaker ─────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly name: string,
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 60000,
    private readonly halfOpenMaxAttempts: number = 3,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        throw Errors.serviceUnavailable(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxAttempts) {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
