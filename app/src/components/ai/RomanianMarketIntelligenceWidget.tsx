'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  const [projectBudget, setProjectBudget] = useState(500000);
  const [romanianPartnerCount, setRomanianPartnerCount] = useState(2);
  const [hasPublicProcurement, setHasPublicProcurement] = useState(true);
  const [projectDurationMonths, setProjectDurationMonths] = useState(24);

  const loadIntelligence = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ai/market-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectBudget,
          romanianPartnerCount,
          hasPublicProcurement,
          projectDurationMonths,
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
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            min={0}
            value={projectBudget}
            onChange={(event) => setProjectBudget(Math.max(0, Number(event.target.value) || 0))}
            placeholder="Buget (EUR)"
            aria-label="Buget proiect"
          />
          <Input
            type="number"
            min={0}
            step={1}
            value={romanianPartnerCount}
            onChange={(event) => setRomanianPartnerCount(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
            placeholder="Parteneri RO"
            aria-label="Număr parteneri români"
          />
          <Input
            type="number"
            min={1}
            step={1}
            value={projectDurationMonths}
            onChange={(event) => setProjectDurationMonths(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
            placeholder="Durată (luni)"
            aria-label="Durata proiectului în luni"
          />
          <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={hasPublicProcurement}
              onChange={(event) => setHasPublicProcurement(event.target.checked)}
            />
            Achiziții publice
          </label>
        </div>

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
