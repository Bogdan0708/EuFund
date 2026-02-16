import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { getRedis } from '@/lib/redis/client';

export async function GET(req: NextRequest) {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: 'checking...',
      redis: 'checking...',
      ai: 'checking...'
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };

  try {
    // Quick database check
    try {
      await db.execute(sql`SELECT 1`);
      healthCheck.services.database = 'healthy';
    } catch (error) {
      healthCheck.services.database = 'unhealthy';
      healthCheck.status = 'degraded';
    }

    // Redis check (if configured)
    try {
      const redis = getRedis();
      if (redis) {
        await redis.ping();
        healthCheck.services.redis = 'healthy';
      } else {
        healthCheck.services.redis = 'not_configured';
      }
    } catch (error) {
      healthCheck.services.redis = 'unhealthy';
      healthCheck.status = 'degraded';
    }

    // AI service check
    try {
      if (process.env.OPENAI_API_KEY) {
        healthCheck.services.ai = 'configured';
      } else {
        healthCheck.services.ai = 'not_configured';
      }
    } catch (error) {
      healthCheck.services.ai = 'error';
    }

    // Overall status
    const hasUnhealthyServices = Object.values(healthCheck.services)
      .some(status => status === 'unhealthy');
    
    if (hasUnhealthyServices) {
      healthCheck.status = 'unhealthy';
      return NextResponse.json(healthCheck, { status: 503 });
    }

    return NextResponse.json(healthCheck, { status: 200 });

  } catch (error) {
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}