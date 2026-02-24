'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DOMPurify from 'isomorphic-dompurify';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdvancedSearchProps {
  searchType: 'projects' | 'partners' | 'opportunities' | 'knowledge';
  aiPowered: boolean;
  semanticSearch: boolean;
}

interface SearchResult {
  id: string;
  title: string;
  type: 'project' | 'partner' | 'opportunity' | 'article';
  description: string;
  relevanceScore: number;
  metadata: Record<string, string>;
  highlights: string[];
  tags: string[];
}

interface OpportunityAlert {
  id: string;
  title: string;
  programme: string;
  deadline: string;
  budget: string;
  matchScore: number;
  status: 'new' | 'tracked' | 'applied';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SemanticSearchBar({ onSearch, aiPowered, semanticSearch }: { onSearch: (query: string) => void; aiPowered: boolean; semanticSearch: boolean }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mockSuggestions = useMemo(() => [
    'proiecte AI în Horizon Europe',
    'parteneri cercetare din Germania',
    'oportunități finanțare Green Deal',
    'cele mai bune practici management consorțiu',
    'buget eligibil echipamente HPC',
  ], []);

  useEffect(() => {
    if (query.length > 2) {
      const filtered = mockSuggestions.filter((s) => s.toLowerCase().includes(query.toLowerCase()));
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  }, [query, mockSuggestions]);

  const handleSearch = () => {
    onSearch(query);
    setShowSuggestions(false);
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder={semanticSearch ? 'Căutare în limbaj natural...' : 'Caută...'} className="pr-20" aria-label="Căutare avansată" />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
            {aiPowered && <Badge variant="outline" className="text-xs">🤖 AI</Badge>}
            {semanticSearch && <Badge variant="outline" className="text-xs">🧠 Semantic</Badge>}
          </div>
        </div>
        <Button onClick={handleSearch}>Caută</Button>
      </div>
      {showSuggestions && (
        <div className="absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg">
          {suggestions.map((s, i) => (
            <button key={i} className="w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors first:rounded-t-lg last:rounded-b-lg" onClick={() => { setQuery(s); onSearch(s); setShowSuggestions(false); }}>
              🔍 {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResultCard({ result }: { result: SearchResult }) {
  const typeIcons: Record<string, string> = { project: '📁', partner: '🏢', opportunity: '💡', article: '📚' };
  const typeLabels: Record<string, string> = { project: 'Proiect', partner: 'Partener', opportunity: 'Oportunitate', article: 'Articol' };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">{typeIcons[result.type]}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">{result.title}</h3>
              <Badge variant="outline" className="text-xs">{typeLabels[result.type]}</Badge>
              <span className="text-xs text-muted-foreground ml-auto">{result.relevanceScore}% relevant</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{result.description}</p>
            {result.highlights.length > 0 && (
              <div className="mt-2 text-xs bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
                {result.highlights.map((h, i) => {
                  const sanitizedHighlight = DOMPurify.sanitize(h);
                  return <p key={i} dangerouslySetInnerHTML={{ __html: sanitizedHighlight }} />;
                })}
              </div>
            )}
            <div className="flex flex-wrap gap-1 mt-2">
              {result.tags.map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
            </div>
            <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
              {Object.entries(result.metadata).map(([k, v]) => <span key={k}>{k}: <strong>{v}</strong></span>)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OpportunityMonitor({ alerts }: { alerts: OpportunityAlert[] }) {
  const statusColors: Record<string, string> = { new: 'bg-green-500', tracked: 'bg-blue-500', applied: 'bg-purple-500' };
  const statusLabels: Record<string, string> = { new: 'Nou', tracked: 'Urmărit', applied: 'Aplicat' };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">🔔 Monitorizare Oportunități</CardTitle>
        <CardDescription>Alerte în timp real pentru oportunități de finanțare UE</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/30 transition-colors">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColors[alert.status]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{alert.title}</p>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{alert.programme}</span>
                  <span>Buget: {alert.budget}</span>
                  <span>Deadline: {alert.deadline}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <span className="text-lg font-bold text-primary">{alert.matchScore}%</span>
                <p className="text-xs text-muted-foreground">potrivire</p>
              </div>
              <Badge variant="outline" className="text-xs">{statusLabels[alert.status]}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AdvancedSearch({ searchType, aiPowered, semanticSearch }: AdvancedSearchProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const mockResults: SearchResult[] = useMemo(() => [
    { id: '1', title: 'HORIZON-CL4-2024-DATA-01 — AI for Manufacturing', type: 'opportunity', description: 'Apel pentru proiecte de inteligență artificială aplicate în industria prelucrătoare', relevanceScore: 94, metadata: { Buget: '5M€', Deadline: '2026-04-15' }, highlights: ['<em>AI</em> aplicat în <em>manufacturing</em> cu focus pe sustenabilitate'], tags: ['AI', 'Industry 4.0', 'Horizon Europe'] },
    { id: '2', title: 'Fraunhofer-Gesellschaft', type: 'partner', description: 'Institut german de cercetare aplicată — lider european în AI și IoT', relevanceScore: 88, metadata: { Țara: 'DE', Tip: 'Cercetare', Proiecte: '45' }, highlights: [], tags: ['AI', 'IoT', 'Cercetare'] },
    { id: '3', title: 'SmartCity-RO: Orașe Inteligente România', type: 'project', description: 'Proiect POCIDIF pentru digitalizarea serviciilor publice din orașe românești', relevanceScore: 76, metadata: { Status: 'Activ', Buget: '2.1M€' }, highlights: ['Digitalizare servicii publice cu <em>AI</em>'], tags: ['Smart City', 'România', 'POCIDIF'] },
    { id: '4', title: 'Best Practices: Consortium Management in H2020', type: 'article', description: 'Ghid detaliat pentru managementul eficient al consorțiilor în programele cadru europene', relevanceScore: 71, metadata: { Autor: 'EC Guide', An: '2024' }, highlights: [], tags: ['Management', 'Best Practices', 'Consorțiu'] },
  ], []);

  const opportunities: OpportunityAlert[] = [
    { id: '1', title: 'HORIZON-CL4-2026-AI-01', programme: 'Horizon Europe', deadline: '2026-04-15', budget: '5-8M€', matchScore: 92, status: 'new' },
    { id: '2', title: 'Digital Europe — AI Testing', programme: 'DEP', deadline: '2026-05-20', budget: '2-4M€', matchScore: 85, status: 'tracked' },
    { id: '3', title: 'POCIDIF Acțiunea 1.2', programme: 'POCIDIF', deadline: '2026-06-30', budget: '500k-2M€', matchScore: 78, status: 'new' },
  ];

  const handleSearch = useCallback((query: string) => {
    if (!query.trim()) return;
    setIsSearching(true);
    setHasSearched(true);
    // Simulate API call
    setTimeout(() => {
      setResults(mockResults.filter((r) => {
        if (searchType === 'projects') return r.type === 'project' || r.type === 'opportunity';
        if (searchType === 'partners') return r.type === 'partner';
        if (searchType === 'opportunities') return r.type === 'opportunity';
        return true;
      }));
      setIsSearching(false);
    }, 800);
  }, [searchType, mockResults]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Căutare Avansată & Descoperire</h2>
        <p className="text-muted-foreground">Căutare inteligentă cu înțelegerea limbii române</p>
      </div>

      <SemanticSearchBar onSearch={handleSearch} aiPowered={aiPowered} semanticSearch={semanticSearch} />

      <Tabs defaultValue="results">
        <TabsList>
          <TabsTrigger value="results">Rezultate {results.length > 0 && `(${results.length})`}</TabsTrigger>
          <TabsTrigger value="opportunities">Oportunități ({opportunities.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="results" className="space-y-3">
          {isSearching ? (
            <div className="flex items-center justify-center h-40" role="status">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-muted-foreground">{semanticSearch ? 'Analiză semantică...' : 'Se caută...'}</span>
              </div>
            </div>
          ) : results.length > 0 ? (
            results.map((r) => <SearchResultCard key={r.id} result={r} />)
          ) : hasSearched ? (
            <div className="text-center py-10 text-muted-foreground">
              <p className="text-lg">Niciun rezultat găsit</p>
              <p className="text-sm">Încercați termeni diferiți sau extindeți căutarea</p>
            </div>
          ) : (
            <div className="text-center py-10 text-muted-foreground">
              <p className="text-lg">🔍 Începeți căutarea</p>
              <p className="text-sm">Folosiți limbaj natural sau termeni specifici</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="opportunities">
          <OpportunityMonitor alerts={opportunities} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
