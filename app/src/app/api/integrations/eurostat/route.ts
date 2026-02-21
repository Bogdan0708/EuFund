import { requireAuth } from '@/lib/auth/helpers';
import { NextRequest, NextResponse } from 'next/server';
import {
  getRegionalGDP,
  getRegionalPopulation,
  getRegionalUnemployment,
  type EurostatRegionalData,
} from '@/lib/integrations/eurostat';
import { logger } from '@/lib/logger';

const AVAILABLE_INDICATORS = ['gdp', 'unemployment', 'population'] as const;
type IndicatorName = (typeof AVAILABLE_INDICATORS)[number];

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);

    const nutsCode = searchParams.get('nutsCode')?.trim().toUpperCase();
    if (!nutsCode) {
      return NextResponse.json({ error: 'Parametrul "nutsCode" este obligatoriu' }, { status: 400 });
    }
    // NUTS codes: 2-letter country (AT), NUTS1 (AT1), NUTS2 (AT12), NUTS3 (AT123)
    if (!/^[A-Z]{2}[A-Z0-9]{0,3}$/.test(nutsCode)) {
      return NextResponse.json({ error: 'Cod NUTS invalid. Format: RO, RO1, RO21, RO213' }, { status: 400 });
    }

    const requestedIndicators = parseIndicators(searchParams.get('indicators'));
    const years = parseYears(searchParams.get('years'));

    const data: Partial<Record<IndicatorName, EurostatRegionalData>> = {};

    const tasks = requestedIndicators.map(async (indicator) => {
      if (indicator === 'gdp') {
        data.gdp = await getRegionalGDP(nutsCode, years);
        return;
      }
      if (indicator === 'unemployment') {
        data.unemployment = await getRegionalUnemployment(nutsCode, years);
        return;
      }
      data.population = await getRegionalPopulation(nutsCode, years);
    });

    await Promise.all(tasks);

    return NextResponse.json({
      nutsCode,
      indicators: requestedIndicators,
      data,
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.name === 'AuthError')) {
      return NextResponse.json({ error: 'Neautorizat' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Eroare necunoscută';
    const status = error instanceof Error && error.name === 'CircuitOpenError' ? 503 : 500;
    logger.error({ error: error }, 'Eurostat integration error:');
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Eroare la obținerea indicatorilor Eurostat: ${message}` },
      },
      { status },
    );
  }
}

function parseIndicators(value: string | null): IndicatorName[] {
  if (!value?.trim()) return [...AVAILABLE_INDICATORS];

  const parsed = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is IndicatorName =>
      (AVAILABLE_INDICATORS as readonly string[]).includes(item),
    );

  return parsed.length > 0 ? Array.from(new Set(parsed)) : [...AVAILABLE_INDICATORS];
}

function parseYears(value: string | null): number[] | undefined {
  if (!value?.trim()) return undefined;

  const years = value
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((year) => Number.isFinite(year));

  return years.length > 0 ? years : undefined;
}
