'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface MarketIntelData {
  overallReadiness?: number;
  keyRecommendations?: { ro: string; en: string }[];
  currencyVolatility?: { currentRate?: number; riskLevel?: string };
  publicProcurementRisks?: { category: string; riskLevel: string }[];
}

export default function RomanianMarketIntelligenceWidget() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<MarketIntelData | null>(null);

  const loadIntelligence = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ai/market-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectBudget: 500000,
          romanianPartnerCount: 2,
          hasPublicProcurement: true,
          projectDurationMonths: 24,
          sectorFocus: 'general',
          locale: 'ro',
        }),
      });

      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.error?.message || 'Nu s-a putut încărca inteligența de piață');
      setData(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eroare necunoscută');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">🇷🇴 Inteligență Piață România</CardTitle>
        <CardDescription>ANAF, riscuri achiziții, curs EUR/RON și recomandări operaționale</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={loadIntelligence} disabled={loading}>
          {loading ? 'Se analizează...' : 'Rulează analiza de piață'}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {data && (
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Readiness România: <span className="font-semibold text-foreground">{data.overallReadiness ?? 0}/100</span></p>
            <p>Curs EUR/RON: {data.currencyVolatility?.currentRate ?? '-'} ({data.currencyVolatility?.riskLevel ?? 'n/a'})</p>
            {data.publicProcurementRisks?.[0] && (
              <p>Risc major achiziții: {data.publicProcurementRisks[0].category} ({data.publicProcurementRisks[0].riskLevel})</p>
            )}
            {(data.keyRecommendations || []).slice(0, 2).map((rec, idx) => (
              <p key={idx}>• {rec.ro}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
