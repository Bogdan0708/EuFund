import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type MappingRow = {
  label: string;
  sourcePath: string;
  targetPath: string;
  required: boolean;
};

const MAPPING_ROWS: MappingRow[] = [
  { label: 'Titlu proiect', sourcePath: 'projects.title', targetPath: 'Project.Title', required: true },
  { label: 'Rezumat proiect', sourcePath: 'projects.sectionSummary', targetPath: 'Project.Summary', required: true },
  { label: 'Buget total proiect', sourcePath: 'projects.totalBudget', targetPath: 'Project.Financials.TotalBudget', required: true },
  { label: 'Nume organizație', sourcePath: 'organizations.name', targetPath: 'Applicant.Name', required: true },
  { label: 'CUI organizație', sourcePath: 'organizations.cui', targetPath: 'Applicant.CUI', required: true },
  { label: 'Cod apel MySMIS', sourcePath: 'callsForProposals.callCode', targetPath: 'Call.CallCode', required: false },
  { label: 'Scor conformitate', sourcePath: 'complianceReports.overallScore', targetPath: 'ComplianceSnapshot.OverallScore', required: false },
  { label: 'Status DNSH', sourcePath: 'complianceReports.dnshAssessment.status', targetPath: 'ComplianceSnapshot.DNSHStatus', required: false },
];

export function MySMISFieldMapping({
  missingRequired,
  onResolve,
}: {
  missingRequired: string[];
  onResolve?: (fieldLabel: string) => void;
}) {
  const missingSet = new Set(missingRequired);

  return (
    <Card className="border-slate-200/80">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Mapare câmpuri MySMIS</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {MAPPING_ROWS.map((row) => {
          const isMissing = missingSet.has(row.label);
          return (
            <div key={row.label} className="rounded-lg border p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{row.label}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {row.required ? <Badge variant="outline">Obligatoriu</Badge> : <Badge variant="secondary">Opțional</Badge>}
                  <Badge variant={isMissing ? 'destructive' : 'default'}>
                    {isMissing ? 'Lipsă' : 'Mapat'}
                  </Badge>
                  {isMissing && onResolve ? (
                    <Button size="sm" variant="outline" onClick={() => onResolve(row.label)}>
                      Remediază
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Sursă: <code>{row.sourcePath}</code> → Țintă: <code>{row.targetPath}</code>
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
