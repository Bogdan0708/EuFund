'use client';

import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePartnerMatching } from '@/hooks/use-partner-matching';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  title: string;
  programme: string;
  topic: string;
  budget: number;
  requiredCapabilities: string[];
}

interface Partner {
  id: string;
  name: string;
  country: string;
  type: 'university' | 'research' | 'sme' | 'large_enterprise' | 'ngo' | 'public';
  capabilities: string[];
  matchScore?: number;
}

interface GeographicConstraint {
  region: string;
  minPartners?: number;
  required: boolean;
}

interface PartnerMatchingProps {
  currentProject: Project;
  existingPartners: Partner[];
  requiredCapabilities: string[];
  geographicRequirements: GeographicConstraint[];
}

interface RecommendedPartner extends Partner {
  matchScore: number;
  matchReasons: string[];
  budgetImpact: number;
  onrcStatus?: 'verified' | 'pending' | 'unknown';
  sicapScore?: number;
  pastProjects?: number;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function CapabilityGapMatrix({ required, existing }: { required: string[]; existing: string[] }) {
  const covered = useMemo(() => new Set(existing), [existing]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Matrice Capabilități</CardTitle>
        <CardDescription>Vizualizarea lacunelor de competențe în consorțiu</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2" role="list" aria-label="Capabilități necesare">
          {required.map((cap) => (
            <Badge key={cap} variant={covered.has(cap) ? 'default' : 'destructive'} className="text-xs" role="listitem">
              {covered.has(cap) ? '✓' : '✗'} {cap}
            </Badge>
          ))}
        </div>
        <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
          <span>Acoperite: {required.filter((c) => covered.has(c)).length}/{required.length}</span>
          <span>Lacune: {required.filter((c) => !covered.has(c)).length}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function GeographicMap({ partners, requirements }: { partners: Partner[]; requirements: GeographicConstraint[] }) {
  const countryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    partners.forEach((p) => { counts[p.country] = (counts[p.country] || 0) + 1; });
    return counts;
  }, [partners]);

  const euCountries = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Distribuție Geografică UE</CardTitle>
        <CardDescription>Acoperirea geografică a consorțiului</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-9 gap-1" role="grid" aria-label="Harta UE cu distribuția partenerilor">
          {euCountries.map((code) => {
            const count = countryCounts[code] || 0;
            const isRequired = requirements.some((r) => r.region === code && r.required);
            return (
              <div key={code} className={`flex flex-col items-center justify-center p-1 rounded text-xs ${count > 0 ? 'bg-primary/20 text-primary font-bold' : isRequired ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'}`} title={`${code}: ${count} parteneri`} role="gridcell">
                <span>{code}</span>
                {count > 0 && <span className="text-[10px]">{count}</span>}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-primary/20 rounded" /> Cu partener</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-destructive/20 rounded" /> Necesar</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-muted rounded" /> Disponibil</span>
        </div>
      </CardContent>
    </Card>
  );
}

function PartnerRecommendationCard({ partner, onAdd }: { partner: RecommendedPartner; onAdd: (p: RecommendedPartner) => void }) {
  const typeLabels: Record<string, string> = { university: 'Universitate', research: 'Cercetare', sme: 'IMM', large_enterprise: 'Companie Mare', ngo: 'ONG', public: 'Instituție Publică' };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{partner.name}</CardTitle>
          <div className="flex items-center gap-1">
            <span className="text-2xl font-bold text-primary">{partner.matchScore}%</span>
          </div>
        </div>
        <CardDescription className="flex items-center gap-2">
          <span>{partner.country}</span>
          <Badge variant="outline" className="text-xs">{typeLabels[partner.type] || partner.type}</Badge>
          {partner.onrcStatus === 'verified' && <Badge variant="default" className="text-xs">ONRC ✓</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-2">
        <div className="space-y-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Motive potrivire:</p>
            <ul className="text-xs space-y-0.5">
              {partner.matchReasons.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          </div>
          <div className="flex flex-wrap gap-1">
            {partner.capabilities.slice(0, 5).map((c) => <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>)}
            {partner.capabilities.length > 5 && <Badge variant="secondary" className="text-xs">+{partner.capabilities.length - 5}</Badge>}
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            {partner.pastProjects !== undefined && <span>Proiecte: {partner.pastProjects}</span>}
            {partner.sicapScore !== undefined && <span>SICAP: {partner.sicapScore}/100</span>}
            <span>Impact buget: +{partner.budgetImpact.toLocaleString()}€</span>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button size="sm" className="w-full" onClick={() => onAdd(partner)}>Adaugă în Consorțiu</Button>
      </CardFooter>
    </Card>
  );
}

function BudgetImpactCalculator({ partners }: { partners: Partner[] }) {
  const getBudgetImpact = (partner: Partner): number => ('budgetImpact' in partner ? Number(partner.budgetImpact || 0) : 150000);
  const totalBudget = useMemo(() => partners.reduce((sum, partner) => sum + getBudgetImpact(partner), 0), [partners]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Calculator Impact Buget</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {partners.map((p) => (
            <div key={p.id} className="flex justify-between text-sm">
              <span>{p.name} ({p.country})</span>
              <span className="font-mono">{getBudgetImpact(p).toLocaleString()}€</span>
            </div>
          ))}
          <hr />
          <div className="flex justify-between font-bold">
            <span>Total Consorțiu</span>
            <span className="font-mono">{totalBudget.toLocaleString()}€</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function PartnerMatching({ currentProject, existingPartners, requiredCapabilities, geographicRequirements }: PartnerMatchingProps) {
  const { data: matchResults, isLoading } = usePartnerMatching(currentProject.id, requiredCapabilities);
  const [selectedPartners, setSelectedPartners] = useState<Partner[]>(existingPartners);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCountry, setFilterCountry] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');

  const mockRecommendations: RecommendedPartner[] = useMemo(() => (matchResults?.recommendations ?? [
    { id: 'r1', name: 'Fraunhofer-Gesellschaft', country: 'DE', type: 'research', capabilities: ['AI', 'IoT', 'Industry 4.0', 'Machine Learning'], matchScore: 94, matchReasons: ['Completează lacuna AI/ML', 'Experiență H2020 extinsă', 'Prezență în Europa de Vest'], budgetImpact: 280000, pastProjects: 45 },
    { id: 'r2', name: 'Universitatea Politehnica București', country: 'RO', type: 'university', capabilities: ['Robotics', 'Software Engineering', 'Data Science'], matchScore: 88, matchReasons: ['Partener local România', 'Cost-eficient', 'Experiență POCIDIF'], budgetImpact: 120000, onrcStatus: 'verified', sicapScore: 87, pastProjects: 12 },
    { id: 'r3', name: 'TU Delft', country: 'NL', type: 'university', capabilities: ['Sustainability', 'Green Tech', 'Circular Economy'], matchScore: 82, matchReasons: ['Competențe sustenabilitate', 'Excelență academică', 'Rețea extinsă'], budgetImpact: 195000, pastProjects: 28 },
    { id: 'r4', name: 'INRIA', country: 'FR', type: 'research', capabilities: ['AI', 'Cybersecurity', 'HPC', 'Quantum Computing'], matchScore: 79, matchReasons: ['Capabilitate HPC', 'Experiență coordonare', 'Reputație excelentă'], budgetImpact: 245000, pastProjects: 38 },
  ]), [matchResults?.recommendations]);

  const filtered = useMemo(() => {
    return mockRecommendations.filter((p) => {
      if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterCountry && p.country !== filterCountry) return false;
      if (filterType && p.type !== filterType) return false;
      return true;
    });
  }, [mockRecommendations, searchQuery, filterCountry, filterType]);

  const handleAddPartner = useCallback((partner: RecommendedPartner) => {
    setSelectedPartners((prev) => [...prev, partner]);
  }, []);

  const existingCaps = useMemo(() => selectedPartners.flatMap((p) => p.capabilities), [selectedPartners]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Potrivire Inteligentă Parteneri</h2>
        <p className="text-muted-foreground">Descoperire AI-powered a partenerilor ideali pentru consorțiul dvs.</p>
      </div>

      <Tabs defaultValue="discover">
        <TabsList>
          <TabsTrigger value="discover">Descoperire</TabsTrigger>
          <TabsTrigger value="gaps">Analiză Lacune</TabsTrigger>
          <TabsTrigger value="map">Hartă UE</TabsTrigger>
          <TabsTrigger value="budget">Impact Buget</TabsTrigger>
        </TabsList>

        <TabsContent value="discover" className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="Caută parteneri..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="max-w-xs" aria-label="Caută parteneri" />
            <select className="border rounded px-2 text-sm" value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)} aria-label="Filtrează după țară">
              <option value="">Toate țările</option>
              <option value="RO">România</option>
              <option value="DE">Germania</option>
              <option value="FR">Franța</option>
              <option value="NL">Olanda</option>
              <option value="IT">Italia</option>
              <option value="ES">Spania</option>
            </select>
            <select className="border rounded px-2 text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)} aria-label="Filtrează după tip">
              <option value="">Toate tipurile</option>
              <option value="university">Universități</option>
              <option value="research">Institute Cercetare</option>
              <option value="sme">IMM-uri</option>
              <option value="large_enterprise">Companii Mari</option>
            </select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-40" role="status">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((partner) => (
                <PartnerRecommendationCard key={partner.id} partner={partner} onAdd={handleAddPartner} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="gaps">
          <CapabilityGapMatrix required={requiredCapabilities} existing={existingCaps} />
        </TabsContent>

        <TabsContent value="map">
          <GeographicMap partners={selectedPartners} requirements={geographicRequirements} />
        </TabsContent>

        <TabsContent value="budget">
          <BudgetImpactCalculator partners={selectedPartners} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
