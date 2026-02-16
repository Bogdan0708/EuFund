// ─── Romanian AI Specialization Engine ───────────────────────────────
// Advanced Romanian language and cultural context optimization

import { AIRequest, AIResponse, TaskType } from './types';

// ═══════════════════════════════════════════════════════════════════
// Romanian Language Detection & Context Analysis
// ═══════════════════════════════════════════════════════════════════

interface RomanianContext {
  isRomanian: boolean;
  confidence: number;
  culturalContext: 'formal' | 'academic' | 'bureaucratic' | 'business' | 'casual';
  linguisticFeatures: {
    hasRomanianDiacritics: boolean;
    hasRomanianKeywords: boolean;
    hasLegalTerminology: boolean;
    hasEUTerminology: boolean;
  };
  recommendations: {
    useRomanianProvider: boolean;
    culturalAdaptations: string[];
    terminologyPreferences: string[];
  };
}

// Romanian diacritics and character patterns
const ROMANIAN_DIACRITICS = /[ăâîşșţțĂÂÎŞȘŢȚ]/g;
const ROMANIAN_KEYWORDS = [
  // Common Romanian words
  'este', 'sunt', 'pentru', 'prin', 'către', 'asupra', 'dintre', 'printre',
  // Business terms
  'companie', 'societate', 'firma', 'organizație', 'instituție',
  // EU/Legal terms
  'proiect', 'finanțare', 'fonduri', 'program', 'obiectiv', 'indicator',
  'implementare', 'dezvoltare', 'sustenabilitate', 'inovare',
  // Bureaucratic terms
  'cerere', 'solicitare', 'document', 'anexă', 'declarație', 'formular',
  'aprobare', 'autorizație', 'licență', 'certificat'
];

const ROMANIAN_EU_TERMS = [
  'uniunea europeană', 'UE', 'horizon', 'erasmus', 'pnrr', 'por', 'pop',
  'fedr', 'fse', 'regio', 'cohesiune', 'convergență', 'competitivitate',
  'inovare', 'digitalizare', 'tranziție verde', 'next generation eu',
  'mecanismul de redresare', 'fonduri europene'
];

const ROMANIAN_LEGAL_TERMS = [
  'articol', 'punct', 'litera', 'alineat', 'capitol', 'secțiune',
  'hotărâre', 'ordonanță', 'lege', 'regulament', 'directivă',
  'conform', 'potrivit', 'în baza', 'în sensul', 'prin derogare'
];

/**
 * Advanced Romanian language and context detection
 */
export function analyzeRomanianContext(text: string): RomanianContext {
  const textLower = text.toLowerCase();
  const words = textLower.split(/\s+/);
  const totalWords = words.length;

  // 1. Diacritic analysis
  const diacriticMatches = (text.match(ROMANIAN_DIACRITICS) || []).length;
  const hasRomanianDiacritics = diacriticMatches > 0;

  // 2. Keyword analysis
  const keywordMatches = ROMANIAN_KEYWORDS.filter(keyword => 
    textLower.includes(keyword)
  ).length;
  const keywordDensity = keywordMatches / Math.max(totalWords, 1);
  const hasRomanianKeywords = keywordDensity > 0.05; // 5% threshold

  // 3. Specialized terminology
  const legalTerms = ROMANIAN_LEGAL_TERMS.filter(term => 
    textLower.includes(term)
  ).length;
  const hasLegalTerminology = legalTerms > 0;

  const euTerms = ROMANIAN_EU_TERMS.filter(term => 
    textLower.includes(term)
  ).length;
  const hasEUTerminology = euTerms > 0;

  // 4. Confidence calculation
  let confidence = 0;
  confidence += diacriticMatches * 0.1; // 10% per diacritic
  confidence += keywordDensity * 100; // Keyword density weight
  confidence += legalTerms * 0.05; // Legal term weight
  confidence += euTerms * 0.1; // EU term weight

  confidence = Math.min(confidence, 1.0); // Cap at 100%
  
  const isRomanian = confidence > 0.3 || 
                     hasRomanianDiacritics || 
                     (hasRomanianKeywords && keywordDensity > 0.1);

  // 5. Cultural context detection
  let culturalContext: RomanianContext['culturalContext'] = 'casual';
  
  if (legalTerms > 2 || textLower.includes('conform') || textLower.includes('hotărâre')) {
    culturalContext = 'bureaucratic';
  } else if (euTerms > 1 || textLower.includes('proiect') || textLower.includes('finanțare')) {
    culturalContext = 'formal';
  } else if (textLower.includes('universitate') || textLower.includes('cercetare')) {
    culturalContext = 'academic';
  } else if (textLower.includes('companie') || textLower.includes('afaceri')) {
    culturalContext = 'business';
  }

  // 6. Generate recommendations
  const recommendations = generateRomanianRecommendations({
    confidence,
    culturalContext,
    hasEUTerminology,
    hasLegalTerminology,
    hasRomanianKeywords
  });

  return {
    isRomanian,
    confidence: Math.round(confidence * 100) / 100,
    culturalContext,
    linguisticFeatures: {
      hasRomanianDiacritics,
      hasRomanianKeywords,
      hasLegalTerminology,
      hasEUTerminology
    },
    recommendations
  };
}

function generateRomanianRecommendations(context: {
  confidence: number;
  culturalContext: string;
  hasEUTerminology: boolean;
  hasLegalTerminology: boolean;
  hasRomanianKeywords: boolean;
}): RomanianContext['recommendations'] {
  const culturalAdaptations = [];
  const terminologyPreferences = [];

  // Cultural adaptations based on context
  switch (context.culturalContext) {
    case 'bureaucratic':
      culturalAdaptations.push(
        'Use formal Romanian bureaucratic language',
        'Include proper legal references and structures',
        'Maintain official tone throughout'
      );
      terminologyPreferences.push(
        'Prefer official Romanian administrative terms',
        'Use standardized EU terminology in Romanian'
      );
      break;

    case 'formal':
      culturalAdaptations.push(
        'Use polite and respectful Romanian forms',
        'Include appropriate formal greetings',
        'Structure content in formal Romanian style'
      );
      break;

    case 'academic':
      culturalAdaptations.push(
        'Use academic Romanian terminology',
        'Include scholarly references if appropriate',
        'Maintain objective academic tone'
      );
      break;

    case 'business':
      culturalAdaptations.push(
        'Use professional Romanian business language',
        'Include Romanian business etiquette considerations',
        'Focus on practical business outcomes'
      );
      break;
  }

  // EU-specific recommendations
  if (context.hasEUTerminology) {
    culturalAdaptations.push(
      'Use official Romanian translations of EU terms',
      'Reference Romanian EU context and benefits',
      'Include Romania-specific EU program details'
    );
    terminologyPreferences.push(
      'Use Romanian names for EU programs (e.g., "Orizont Europa" for Horizon Europe)',
      'Reference Romanian national contact points',
      'Include Romanian regulatory context'
    );
  }

  // Legal content recommendations
  if (context.hasLegalTerminology) {
    terminologyPreferences.push(
      'Use Romanian legal terminology consistently',
      'Reference Romanian legal framework',
      'Include appropriate Romanian legal disclaimers'
    );
  }

  return {
    useRomanianProvider: context.confidence > 0.6,
    culturalAdaptations,
    terminologyPreferences
  };
}

// ═══════════════════════════════════════════════════════════════════
// Romanian Task Optimization
// ═══════════════════════════════════════════════════════════════════

export interface RomanianOptimizedRequest extends AIRequest {
  romanianContext?: RomanianContext;
  culturalAdaptation?: boolean;
  useRomanianProvider?: boolean;
}

/**
 * Optimize AI request for Romanian content and context
 */
export function optimizeForRomanianContext(request: AIRequest): RomanianOptimizedRequest {
  // Analyze the prompt for Romanian context
  const fullText = `${request.systemPrompt || ''} ${request.prompt}`.trim();
  const romanianContext = analyzeRomanianContext(fullText);

  const optimized: RomanianOptimizedRequest = {
    ...request,
    romanianContext,
    culturalAdaptation: romanianContext.isRomanian,
    useRomanianProvider: romanianContext.recommendations.useRomanianProvider
  };

  // Enhance system prompt with Romanian context
  if (romanianContext.isRomanian && request.language !== 'en') {
    optimized.systemPrompt = enhanceSystemPromptForRomanian(
      request.systemPrompt || '',
      romanianContext
    );
  }

  // Adjust task type for Romanian specialization
  if (romanianContext.isRomanian) {
    optimized.taskType = mapToRomanianTaskType(request.taskType, romanianContext);
  }

  return optimized;
}

function enhanceSystemPromptForRomanian(
  originalPrompt: string, 
  context: RomanianContext
): string {
  let enhanced = originalPrompt;

  if (!enhanced) {
    enhanced = 'You are a helpful assistant specialized in Romanian language and cultural context.';
  }

  // Add Romanian-specific instructions
  const romanianInstructions = [
    '\n\nROMANIAN CONTEXT INSTRUCTIONS:',
    '- Respond in clear, natural Romanian language',
    '- Use appropriate Romanian diacritics (ă, â, î, ș, ț)',
    `- Adapt tone for ${context.culturalContext} context`
  ];

  // Add cultural adaptations
  if (context.recommendations.culturalAdaptations.length > 0) {
    romanianInstructions.push(
      '- Cultural adaptations:',
      ...context.recommendations.culturalAdaptations.map(adaptation => `  • ${adaptation}`)
    );
  }

  // Add terminology preferences
  if (context.recommendations.terminologyPreferences.length > 0) {
    romanianInstructions.push(
      '- Terminology preferences:',
      ...context.recommendations.terminologyPreferences.map(pref => `  • ${pref}`)
    );
  }

  enhanced += romanianInstructions.join('\n');

  return enhanced;
}

function mapToRomanianTaskType(
  originalType: TaskType, 
  context: RomanianContext
): TaskType {
  // Map generic tasks to Romanian-specialized variants when appropriate
  if (context.linguisticFeatures.hasEUTerminology) {
    switch (originalType) {
      case TaskType.SIMPLE_TEXT_GENERATION:
        return TaskType.ROMANIAN_LOCALIZATION;
      case TaskType.DOCUMENT_ANALYSIS:
        return TaskType.COMPLIANCE_CHECK; // EU compliance focus
      case TaskType.PROPOSAL_GENERATION:
        return TaskType.PROPOSAL_GENERATION; // Keep specialized
    }
  }

  if (context.linguisticFeatures.hasLegalTerminology) {
    switch (originalType) {
      case TaskType.SIMPLE_TEXT_GENERATION:
        return TaskType.COMPLIANCE_CHECK;
      case TaskType.DOCUMENT_ANALYSIS:
        return TaskType.COMPLIANCE_CHECK;
    }
  }

  return originalType; // Keep original if no specific mapping
}

// ═══════════════════════════════════════════════════════════════════
// Romanian Performance Metrics
// ═══════════════════════════════════════════════════════════════════

export interface RomanianPerformanceMetrics {
  languageDetectionAccuracy: number;
  culturalContextAccuracy: number;
  romanianProviderUsage: number;
  costSavingsFromOptimization: number;
  averageLatencyImprovement: number;
}

let performanceMetrics: RomanianPerformanceMetrics = {
  languageDetectionAccuracy: 0,
  culturalContextAccuracy: 0,
  romanianProviderUsage: 0,
  costSavingsFromOptimization: 0,
  averageLatencyImprovement: 0
};

export function recordRomanianPerformance(
  request: RomanianOptimizedRequest,
  response: AIResponse,
  actuallyUsedRomanianProvider: boolean
): void {
  // Track Romanian provider usage
  if (actuallyUsedRomanianProvider) {
    performanceMetrics.romanianProviderUsage++;
  }

  // Estimate cost savings (Romanian providers typically 60% cheaper)
  if (actuallyUsedRomanianProvider && response.cost > 0) {
    const estimatedSavings = response.cost * 0.6; // 60% savings estimate
    performanceMetrics.costSavingsFromOptimization += estimatedSavings;
  }

  // Track language detection accuracy would require human feedback
  // For now, we track usage patterns
}

export function getRomanianPerformanceMetrics(): RomanianPerformanceMetrics {
  return { ...performanceMetrics };
}

// ═══════════════════════════════════════════════════════════════════
// Romanian Knowledge Base
// ═══════════════════════════════════════════════════════════════════

export const ROMANIAN_EU_KNOWLEDGE = {
  programs: {
    'PNRR': {
      fullName: 'Planul Național de Redresare și Reziliență',
      budget: '29.2 miliarde EUR',
      focus: ['digitalizare', 'tranziție verde', 'sănătate', 'educație'],
      deadline: '2026'
    },
    'POR': {
      fullName: 'Programul Operațional Regional',
      budget: '6.7 miliarde EUR', 
      focus: ['dezvoltare regională', 'infrastructură', 'competitivitate'],
      deadline: '2029'
    },
    'HORIZON_EUROPA': {
      fullName: 'Orizont Europa',
      budget: '95.5 miliarde EUR (total EU)',
      focus: ['cercetare', 'inovare', 'știință excelentă'],
      romanianParticipation: 'Peste 400 proiecte până în 2024'
    }
  },
  institutions: {
    'MIPE': 'Ministerul Investițiilor și Proiectelor Europene',
    'ADR': 'Agențiile pentru Dezvoltare Regională',
    'UEFISCDI': 'Unitatea Executivă pentru Finanțarea Învățământului Superior',
    'ANCED': 'Agenția Națională pentru Cercetare și Dezvoltare'
  },
  culturalNotes: [
    'Romanian bureaucratic language tends to be very formal',
    'EU terminology should use official Romanian translations',
    'Business proposals should emphasize regional development benefits',
    'Academic proposals should reference Romanian research institutions'
  ]
};

/**
 * Get Romanian-specific EU knowledge for enhanced responses
 */
export function getRomanianEUContext(topic: string): string[] {
  const context = [];
  
  if (topic.toLowerCase().includes('pnrr')) {
    const pnrr = ROMANIAN_EU_KNOWLEDGE.programs.PNRR;
    context.push(`PNRR (${pnrr.fullName}) cu buget de ${pnrr.budget}`);
    context.push(`Domenii prioritare: ${pnrr.focus.join(', ')}`);
  }
  
  if (topic.toLowerCase().includes('horizon')) {
    const horizon = ROMANIAN_EU_KNOWLEDGE.programs.HORIZON_EUROPA;
    context.push(`${horizon.fullName} - program UE pentru cercetare și inovare`);
    context.push(`Participarea României: ${horizon.romanianParticipation}`);
  }

  return context;
}