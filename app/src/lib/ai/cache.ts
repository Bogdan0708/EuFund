// ─── AI Response Caching System ──────────────────────────────────────
// Redis-based caching for AI responses with intelligent cache keys

import { getRedis } from '../redis/client';
import { AIRequest, AIResponse, CacheEntry } from './types';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'ai-cache' });

export class AICache {
  private redis;
  private defaultTTL: number = 3600; // 1 hour default
  private enabled: boolean = true;

  constructor(options?: {
    defaultTTL?: number;
    enabled?: boolean;
  }) {
    this.redis = getRedis();
    this.defaultTTL = options?.defaultTTL || 3600;
    this.enabled = options?.enabled !== false && !!this.redis;
  }

  public async get(request: AIRequest): Promise<AIResponse | null> {
    if (!this.enabled || !this.redis) return null;

    try {
      const cacheKey = this.generateCacheKey(request);
      const cached = await this.redis.get(cacheKey);
      
      if (!cached) return null;

      const entry: CacheEntry = JSON.parse(cached);
      
      // Check if cache entry is expired
      if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
        await this.redis.del(cacheKey);
        return null;
      }

      // Increment hit count
      entry.hitCount = (entry.hitCount || 0) + 1;
      await this.redis.setex(cacheKey, this.getTTL(request), JSON.stringify(entry));

      // Mark response as cached
      const response = entry.response;
      response.cached = true;
      response.timestamp = new Date(response.timestamp); // Ensure Date object

      return response;

    } catch (error) {
      log.error({ error }, 'Cache get error');
      return null; // Fail gracefully
    }
  }

  public async set(request: AIRequest, response: AIResponse): Promise<void> {
    if (!this.enabled || !this.redis) return;

    try {
      const cacheKey = this.generateCacheKey(request);
      const ttl = this.getTTL(request);
      
      const entry: CacheEntry = {
        key: cacheKey,
        response: {
          ...response,
          cached: false // Store original cache status
        },
        expiresAt: new Date(Date.now() + ttl * 1000),
        hitCount: 0
      };

      await this.redis.setex(cacheKey, ttl, JSON.stringify(entry));

    } catch (error) {
      log.error({ error }, 'Cache set error');
      // Fail gracefully - don't throw
    }
  }

  public async invalidate(pattern: string): Promise<number> {
    if (!this.enabled || !this.redis) return 0;

    try {
      const keys = await this.redis.keys(`ai_cache:${pattern}*`);
      if (keys.length === 0) return 0;

      await this.redis.del(...keys);
      return keys.length;

    } catch (error) {
      log.error({ error }, 'Cache invalidation error');
      return 0;
    }
  }

  public async getStats(): Promise<{
    totalEntries: number;
    memoryUsage: string;
    hitRate: number;
  }> {
    if (!this.enabled || !this.redis) {
      return { totalEntries: 0, memoryUsage: '0B', hitRate: 0 };
    }

    try {
      const keys = await this.redis.keys('ai_cache:*');
      const totalEntries = keys.length;

      // Get memory usage (rough estimate)
      const info = await this.redis.info('memory');
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1].trim() : '0B';

      // Calculate hit rate from sample entries
      let totalHits = 0;
      let totalRequests = 0;
      
      const sampleKeys = keys.slice(0, Math.min(100, keys.length)); // Sample up to 100 entries
      
      for (const key of sampleKeys) {
        const cached = await this.redis.get(key);
        if (cached) {
          const entry: CacheEntry = JSON.parse(cached);
          totalHits += entry.hitCount || 0;
          totalRequests += (entry.hitCount || 0) + 1; // +1 for initial set
        }
      }

      const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;

      return {
        totalEntries,
        memoryUsage,
        hitRate: Math.round(hitRate * 100) / 100
      };

    } catch (error) {
      log.error({ error }, 'Cache stats error');
      return { totalEntries: 0, memoryUsage: '0B', hitRate: 0 };
    }
  }

  private generateCacheKey(request: AIRequest): string {
    // Create a cache key based on request content
    const keyData = {
      taskType: request.taskType,
      prompt: request.prompt,
      systemPrompt: request.systemPrompt || '',
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      language: request.language,
      structuredOutput: request.structuredOutput,
      schema: request.schema
    };

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(keyData))
      .digest('hex')
      .substring(0, 16); // Use first 16 chars of hash

    return `ai_cache:${request.taskType}:${hash}`;
  }

  private getTTL(request: AIRequest): number {
    // Different TTL based on task type and characteristics
    switch (request.taskType) {
      case 'web_research':
        return 300; // 5 minutes for web research (data changes quickly)
      
      case 'compliance_check':
      case 'legal_analysis':
        return 7200; // 2 hours for legal/compliance (relatively stable)
      
      case 'proposal_generation':
      case 'creative_writing':
        return 1800; // 30 minutes for creative tasks (less cacheable)
      
      case 'document_analysis':
      case 'grant_matching':
        return 3600; // 1 hour for analysis tasks
      
      case 'romanian_localization':
      case 'romanian_ner':
        return 7200; // 2 hours for language tasks (stable)
      
      default:
        return this.defaultTTL;
    }
  }

  public isEnabled(): boolean {
    return this.enabled && !!this.redis;
  }

  public disable(): void {
    this.enabled = false;
  }

  public enable(): void {
    this.enabled = !!this.redis;
  }
}

// ─── Global Cache Instance ───────────────────────────────────────────

let globalCache: AICache | null = null;

export function getAICache(options?: {
  defaultTTL?: number;
  enabled?: boolean;
}): AICache {
  if (!globalCache) {
    globalCache = new AICache(options);
  }
  return globalCache;
}

// ─── Cache Helper Functions ──────────────────────────────────────────

export function shouldCache(request: AIRequest): boolean {
  // Don't cache certain types of requests
  if (request.priority === 'high') return false; // High priority = fresh data needed
  if (request.userTier === 'enterprise' && !request.cacheKey) return false; // Enterprise wants fresh unless specified
  
  // Always cache expensive operations
  const expensiveTasks = [
    'proposal_generation',
    'document_analysis',
    'legal_analysis',
    'risk_assessment'
  ];
  
  if (expensiveTasks.includes(request.taskType)) return true;

  // Cache based on task characteristics
  const taskChars: Record<string, boolean> = {
    'simple_text_generation': true,
    'compliance_check': true,
    'grant_matching': true,
    'romanian_ner': true,
    'semantic_search': true,
    'budget_analysis': true,
    'timeline_optimization': false, // Time-sensitive
    'web_research': false, // Real-time data
    'creative_writing': false // Should be unique
  };

  return taskChars[request.taskType] !== false;
}

export async function warmCache(commonRequests: AIRequest[]): Promise<void> {
  const cache = getAICache();
  if (!cache.isEnabled()) return;

  log.info(`Warming AI cache with ${commonRequests.length} common requests...`);
  
  // This would be called with pre-computed responses for common requests
  // Implementation depends on having a way to generate responses
}

export async function cleanExpiredCache(): Promise<number> {
  const cache = getAICache();
  if (!cache.isEnabled()) return 0;

  // This would clean up expired entries
  // Redis handles TTL automatically, but we could clean up corrupted entries
  return 0;
}