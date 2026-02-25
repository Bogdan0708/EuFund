import { AlertTriangle, ExternalLink, Gavel, Info, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { RuleResult } from '@/lib/rules/eligibility';
import type { AIComplianceCheck, ComplianceSourceTrace } from '@/lib/ai/compliance-validator';

interface ComplianceExplainabilityData {
  overallScore: number;
  evaluatedAt?: string;
  aiResults: AIComplianceCheck[];
  deterministicResults: RuleResult[];
  sourceTrace: ComplianceSourceTrace[];
  recommendations: string[];
}

export function ComplianceExplainabilityPanel({ data }: { data: ComplianceExplainabilityData }) {
  const statusVariant = (status: 'pass' | 'warning' | 'fail') => {
    if (status === 'pass') return 'default';
    if (status === 'warning') return 'secondary';
    return 'destructive';
  };

  const sortedFindings = [...data.aiResults].sort((left, right) => {
    const severity = { fail: 0, warning: 1, pass: 2 };
    return severity[left.status] - severity[right.status];
  });
  const sourceByIndex = new Map(data.sourceTrace.map((source) => [source.sourceIndex, source]));

  return (
    <div className="space-y-4">
      <Card className="border-sky-200/80 bg-gradient-to-r from-sky-50/80 to-white">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-sky-700" />
            Explicabilitate verificare conformitate
            <Badge variant={data.overallScore >= 70 ? 'default' : data.overallScore >= 50 ? 'secondary' : 'destructive'}>
              Scor {data.overallScore}/100
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            Fiecare constatare include nivel de încredere, referință legală și sursa utilizată.
          </p>
          {data.evaluatedAt ? <p>Ultima analiză: {new Date(data.evaluatedAt).toLocaleString('ro-RO')}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Surse de adevăr (RAG)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.sourceTrace.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nu au fost găsite surse legislative pentru această analiză.</p>
          ) : (
            data.sourceTrace.map((source) => (
              <div id={`sursa-${source.sourceIndex}`} key={source.sourceId} className="rounded-xl border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">[Sursa {source.sourceIndex}] {source.title}</p>
                  <Badge variant="outline">Relevanță {Math.round(source.score * 100)}%</Badge>
                </div>
                <p className="mt-2 text-muted-foreground">{source.snippet}...</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ancoră citare: <code>#sursa-{source.sourceIndex}</code>
                </p>
                {source.sourceUrl ? (
                  <a
                    className="mt-2 inline-flex items-center gap-1 text-xs text-sky-700 hover:underline"
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Deschide documentul sursă
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Constatări AI explicate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedFindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nu există constatări AI în acest raport.</p>
          ) : (
            sortedFindings.map((item, index) => (
              <div key={`${item.area}-${index}`} className="rounded-xl border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{item.area}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(item.status)}>{item.status === 'pass' ? 'Conform' : item.status === 'warning' ? 'Atenție' : 'Neconform'}</Badge>
                    <Badge variant="outline">Încredere {Math.round((item.confidence || 0) * 100)}%</Badge>
                  </div>
                </div>
                <p className="mt-2 text-muted-foreground">{item.finding}</p>
                <p className="mt-1 font-medium text-foreground">Recomandare: {item.recommendation}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {item.legalReference ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">
                      <Gavel className="h-3.5 w-3.5" />
                      {item.legalReference}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Referință legală lipsă
                    </span>
                  )}
                  {(item.citations || []).map((citation) => {
                    const citedSource = sourceByIndex.get(citation);
                    return (
                      <a
                        key={citation}
                        className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700 hover:bg-sky-100 hover:underline"
                        href={`#sursa-${citation}`}
                        aria-label={`Navighează la sursa ${citation}`}
                        title={citedSource ? `${citedSource.title}` : `Sursa ${citation}`}
                      >
                        [Sursa {citation}]
                      </a>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verificări deterministe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.deterministicResults.map((rule) => (
            <div key={rule.ruleId} className="rounded-lg border p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{rule.ruleName}</p>
                <Badge variant={statusVariant(rule.status === 'fail' ? 'fail' : rule.status === 'warning' ? 'warning' : 'pass')}>
                  {rule.status}
                </Badge>
              </div>
              <p className="mt-1 text-muted-foreground">{rule.messageRo}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {data.recommendations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan scurt de remediere</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {data.recommendations.slice(0, 6).map((recommendation, index) => (
                <li key={`${recommendation}-${index}`}>• {recommendation}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
