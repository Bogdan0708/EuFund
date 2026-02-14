'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdvancedReportsProps {
  reportType: 'executive' | 'financial' | 'predictive' | 'competitive';
  audienceType: 'internal' | 'ec_audit' | 'partner' | 'government';
  language: 'ro' | 'en';
}

interface ReportSection {
  id: string;
  title: string;
  titleEn: string;
  status: 'complete' | 'draft' | 'pending';
  aiGenerated: boolean;
  lastUpdated: string;
  wordCount: number;
}

interface ExportFormat {
  id: string;
  label: string;
  icon: string;
  available: boolean;
}

interface AuditEntry {
  id: string;
  action: string;
  user: string;
  timestamp: string;
  section: string;
  detail: string;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ExecutiveSummary({ language }: { language: 'ro' | 'en' }) {
  const metrics = [
    { label: language === 'ro' ? 'Progres General' : 'Overall Progress', value: '68%', trend: '+5%' },
    { label: language === 'ro' ? 'Buget Utilizat' : 'Budget Used', value: '42%', trend: '+8%' },
    { label: language === 'ro' ? 'Riscuri Active' : 'Active Risks', value: '3', trend: '-1' },
    { label: language === 'ro' ? 'Livrabile Finalizate' : 'Deliverables Complete', value: '7/20', trend: '+2' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{language === 'ro' ? 'Rezumat Executiv' : 'Executive Summary'}</CardTitle>
        <CardDescription>{language === 'ro' ? 'Perspectivă de nivel înalt cu posibilitatea de detaliere' : 'High-level overview with drill-down capability'}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metrics.map((m) => (
            <div key={m.label} className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{m.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{m.label}</p>
              <p className="text-xs text-green-600 font-medium">{m.trend}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ReportBuilder({ sections, language, onGenerate }: { sections: ReportSection[]; language: 'ro' | 'en'; onGenerate: (sectionId: string) => void }) {
  const statusLabels: Record<string, Record<string, string>> = {
    ro: { complete: 'Complet', draft: 'Ciornă', pending: 'În așteptare' },
    en: { complete: 'Complete', draft: 'Draft', pending: 'Pending' },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{language === 'ro' ? 'Constructor Raport AI' : 'AI Report Builder'}</CardTitle>
        <CardDescription>{language === 'ro' ? 'Generare automată de rapoarte cu secțiuni personalizabile' : 'Automated report generation with customizable sections'}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sections.map((section) => (
            <div key={section.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/30 transition-colors">
              <div className="flex items-center gap-3">
                <input type="checkbox" defaultChecked className="rounded" aria-label={`Include ${section.title}`} />
                <div>
                  <p className="text-sm font-medium">{language === 'ro' ? section.title : section.titleEn}</p>
                  <p className="text-xs text-muted-foreground">{section.wordCount} cuvinte • {section.lastUpdated}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {section.aiGenerated && <Badge variant="outline" className="text-xs">🤖 AI</Badge>}
                <Badge variant={section.status === 'complete' ? 'default' : section.status === 'draft' ? 'secondary' : 'outline'} className="text-xs">
                  {statusLabels[language][section.status]}
                </Badge>
                {section.status !== 'complete' && (
                  <Button size="sm" variant="outline" onClick={() => onGenerate(section.id)}>
                    {language === 'ro' ? 'Generează' : 'Generate'}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ExportPanel({ formats, language }: { formats: ExportFormat[]; language: 'ro' | 'en' }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{language === 'ro' ? 'Export Raport' : 'Export Report'}</CardTitle>
        <CardDescription>{language === 'ro' ? 'Exportați în formatul dorit cu template-uri profesionale românești' : 'Export in desired format with professional templates'}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {formats.map((fmt) => (
            <Button key={fmt.id} variant="outline" className="h-20 flex flex-col items-center gap-2" disabled={!fmt.available}>
              <span className="text-2xl">{fmt.icon}</span>
              <span className="text-xs">{fmt.label}</span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AuditTrail({ entries, language }: { entries: AuditEntry[]; language: 'ro' | 'en' }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{language === 'ro' ? 'Jurnal de Audit' : 'Audit Trail'}</CardTitle>
        <CardDescription>{language === 'ro' ? 'Documentație completă de conformitate' : 'Complete compliance documentation'}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-3 p-2 text-xs border-b last:border-0">
              <span className="font-mono text-muted-foreground w-32 flex-shrink-0">{entry.timestamp}</span>
              <span className="font-medium w-24 flex-shrink-0">{entry.user}</span>
              <span className="text-muted-foreground w-20 flex-shrink-0">{entry.section}</span>
              <span>{entry.detail}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AdvancedReports({ reportType, audienceType, language }: AdvancedReportsProps) {
  const [activeTab, setActiveTab] = useState('summary');
  const [generating, setGenerating] = useState(false);

  const sections: ReportSection[] = [
    { id: '1', title: 'Rezumat Executiv', titleEn: 'Executive Summary', status: 'complete', aiGenerated: true, lastUpdated: '14 feb 2026', wordCount: 850 },
    { id: '2', title: 'Progres Tehnic', titleEn: 'Technical Progress', status: 'complete', aiGenerated: false, lastUpdated: '13 feb 2026', wordCount: 2400 },
    { id: '3', title: 'Analiză Financiară', titleEn: 'Financial Analysis', status: 'draft', aiGenerated: true, lastUpdated: '12 feb 2026', wordCount: 1200 },
    { id: '4', title: 'Analiză Riscuri', titleEn: 'Risk Analysis', status: 'complete', aiGenerated: true, lastUpdated: '14 feb 2026', wordCount: 900 },
    { id: '5', title: 'Analiză Predictivă', titleEn: 'Predictive Analysis', status: 'draft', aiGenerated: true, lastUpdated: '11 feb 2026', wordCount: 1600 },
    { id: '6', title: 'Benchmarking Competitiv', titleEn: 'Competitive Benchmarking', status: 'pending', aiGenerated: false, lastUpdated: '-', wordCount: 0 },
    { id: '7', title: 'Recomandări', titleEn: 'Recommendations', status: 'pending', aiGenerated: true, lastUpdated: '-', wordCount: 0 },
  ];

  const exportFormats: ExportFormat[] = [
    { id: 'pdf', label: 'PDF', icon: '📄', available: true },
    { id: 'excel', label: 'Excel', icon: '📊', available: true },
    { id: 'pptx', label: 'PowerPoint', icon: '📽️', available: true },
    { id: 'docx', label: 'Word', icon: '📝', available: true },
  ];

  const auditEntries: AuditEntry[] = [
    { id: '1', action: 'edit', user: 'Maria P.', timestamp: '2026-02-14 10:05', section: 'Rezumat', detail: 'Actualizat KPI-uri principale' },
    { id: '2', action: 'generate', user: 'AI Engine', timestamp: '2026-02-14 09:30', section: 'Riscuri', detail: 'Regenerat analiza riscurilor cu date actualizate' },
    { id: '3', action: 'review', user: 'Ion I.', timestamp: '2026-02-13 16:45', section: 'Financiar', detail: 'Revizuit și aprobat cifrele bugetare' },
    { id: '4', action: 'export', user: 'Maria P.', timestamp: '2026-02-13 15:00', section: 'Complet', detail: 'Exportat raport PDF pentru audit EC' },
  ];

  const handleGenerate = async (sectionId: string) => {
    setGenerating(true);
    // Would call AI generation API
    setTimeout(() => setGenerating(false), 2000);
  };

  const labels = {
    ro: { title: 'Rapoarte Avansate', desc: 'Generare inteligentă de rapoarte pentru toate audiențele', summary: 'Rezumat', builder: 'Constructor', export: 'Export', audit: 'Audit' },
    en: { title: 'Advanced Reports', desc: 'Intelligent report generation for all audiences', summary: 'Summary', builder: 'Builder', export: 'Export', audit: 'Audit' },
  };

  const l = labels[language];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{l.title}</h2>
          <p className="text-muted-foreground">{l.desc}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">{audienceType === 'ec_audit' ? 'Audit EC' : audienceType === 'government' ? 'Guvern' : audienceType === 'partner' ? 'Parteneri' : 'Intern'}</Badge>
          <Badge variant="secondary">{language.toUpperCase()}</Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="summary">{l.summary}</TabsTrigger>
          <TabsTrigger value="builder">{l.builder}</TabsTrigger>
          <TabsTrigger value="export">{l.export}</TabsTrigger>
          <TabsTrigger value="audit">{l.audit}</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <ExecutiveSummary language={language} />
        </TabsContent>

        <TabsContent value="builder">
          <ReportBuilder sections={sections} language={language} onGenerate={handleGenerate} />
        </TabsContent>

        <TabsContent value="export">
          <ExportPanel formats={exportFormats} language={language} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditTrail entries={auditEntries} language={language} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
