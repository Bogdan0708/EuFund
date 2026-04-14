// ─── AI Integration Test Endpoint ────────────────────────────────────
import { NextResponse } from 'next/server';
import { 
  getAIHealthStatus, 
  aiGenerate, 
  TaskType, 
  aiGenerateRomanian, 
  analyzeRomanianContent 
} from '@/lib/ai';

type GenerationTest = {
  success: boolean;
  error?: string;
  text?: string;
  provider?: string;
  tokensUsed?: number;
  cached?: boolean;
};

type RomanianDetectionTest = {
  success: boolean;
  error?: string;
  text?: string;
  analysis?: {
    isRomanian: boolean;
    confidence: number;
    culturalContext: string;
    features: {
      hasDiacritics: boolean;
      hasEUTerms: boolean;
      hasLegalTerms: boolean;
    };
    recommendations: string[];
  };
};

type RomanianGenerationTest = {
  success: boolean;
  error?: string;
  text?: string;
  provider?: string;
  tokensUsed?: number;
  romanianOptimization?: {
    detected: boolean;
    context: string;
    optimizations: string[];
  };
};

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    try {
    // Test 1: Health check
    const health = await getAIHealthStatus();
    
    // Test 2: Simple generation (with fallback to existing system)
    let generationTest: GenerationTest = { success: false, error: 'Not attempted' };
    
    try {
      const result = await aiGenerate({
        system: "You are a helpful assistant.",
        prompt: "Say hello in exactly 5 words.",
        taskType: TaskType.SIMPLE_TEXT_GENERATION,
        userTier: 'free',
        maxTokens: 50,
        priority: 'normal'
      });
      
      generationTest = {
        success: true,
        text: result.text,
        provider: result.provider,
        tokensUsed: result.tokensUsed,
        cached: result.cached
      };
    } catch (error: unknown) {
      generationTest = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Test 3: Romanian language detection
    let romanianTest: RomanianDetectionTest = { success: false, error: 'Not attempted' };
    
    try {
      const romanianText = 'Proiectul nostru vizează dezvoltarea unei platforme digitale pentru accesarea fondurilor europene în România prin programul PNRR.';
      const analysis = await analyzeRomanianContent(romanianText);
      
      romanianTest = {
        success: true,
        text: romanianText,
        analysis: {
          isRomanian: analysis.isRomanian,
          confidence: analysis.confidence,
          culturalContext: analysis.culturalContext,
          features: analysis.features,
          recommendations: analysis.recommendations.slice(0, 3) // Limit for response size
        }
      };
    } catch (error: unknown) {
      romanianTest = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Test 4: Romanian generation (if standard generation worked)
    let romanianGenerationTest: RomanianGenerationTest = { success: false, error: 'Skipped - standard generation failed' };
    
    if (generationTest.success) {
      try {
        const result = await aiGenerateRomanian({
          system: "Ești un asistent pentru fonduri europene.",
          prompt: "Explică beneficiile programului PNRR în 3 fraze.",
          taskType: TaskType.ROMANIAN_LOCALIZATION,
          userTier: 'pro',
          maxTokens: 100,
          priority: 'normal'
        });
        
        romanianGenerationTest = {
          success: true,
          text: result.text,
          provider: result.provider,
          tokensUsed: result.tokensUsed,
          romanianOptimization: result.romanianOptimization
        };
      } catch (error: unknown) {
        romanianGenerationTest = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      system: 'Multi-Provider AI Integration with Romanian Specialization',
      tests: {
        health: health,
        generation: generationTest,
        romanianDetection: romanianTest,
        romanianGeneration: romanianGenerationTest
      },
      status: generationTest.success && romanianTest.success ? 'healthy' : 'degraded',
      capabilities: {
        multiProvider: true,
        romanianSpecialization: romanianTest.success,
        intelligentRouting: true,
        costOptimization: true
      }
    });

  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: `Integration test failed: ${details}` },
    }, { status: 500 });
  }
}
