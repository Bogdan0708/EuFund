'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { FinancialReporting } from '@/components/budget/financial-reporting';

const DEMO_CATEGORIES = [
  { id: 'personal', name: 'Staff costs', nameRo: 'Cheltuieli de personal', allocated: 250000, spent: 95000, euEligible: true },
  { id: 'deplasari', name: 'Travel', nameRo: 'Deplasări', allocated: 40000, spent: 12000, euEligible: true },
  { id: 'echipamente', name: 'Equipment', nameRo: 'Echipamente', allocated: 80000, spent: 35000, euEligible: true },
  { id: 'subcontractare', name: 'Subcontracting', nameRo: 'Subcontractare', allocated: 100000, spent: 28000, euEligible: true },
];

const DEMO_ENTRIES = [
  { id: '1', date: '2025-03-15', category: 'personal', description: 'Salarii echipă cercetare', amount: 15000, currency: 'EUR' as const, amountEur: 15000, partnerName: 'UPB', euEligible: true, approved: true },
  { id: '2', date: '2025-03-20', category: 'deplasari', description: 'Conferință Bruxelles', amount: 2500, currency: 'EUR' as const, amountEur: 2500, partnerName: 'TechStar', euEligible: true, approved: true },
  { id: '3', date: '2025-04-01', category: 'echipamente', description: 'Servere de calcul', amount: 35000, currency: 'EUR' as const, amountEur: 35000, partnerName: 'Fraunhofer', euEligible: true, approved: false },
  { id: '4', date: '2025-04-10', category: 'personal', description: 'Consultanță externă', amount: 8000, currency: 'RON' as const, exchangeRate: 4.97, amountEur: 1609.66, partnerName: 'UPB', euEligible: true, approved: false },
];

export default function ReportsPage() {
  const params = useParams();
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!projectId) {
      setLoading(false);
      return;
    }

    fetch(`/api/v1/projects/${projectId}`)
      .then((response) => {
        setHasAccess(response.ok);
      })
      .catch(() => {
        setHasAccess(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [params.id]);

  if (loading) {
    return <div className="flex justify-center p-12 text-muted-foreground">Se încarcă...</div>;
  }

  if (!hasAccess) {
    return (
      <Card className="max-w-md mx-auto mt-12">
        <CardContent className="p-6 text-center text-destructive">
          Nu aveți acces la acest proiect.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <FinancialReporting
        entries={DEMO_ENTRIES}
        categories={DEMO_CATEGORIES}
        projectTitle="Proiect de Cercetare și Inovare"
        reportingPeriod={{ start: '2025-01-01', end: '2025-06-30' }}
        onExportExcel={() => alert('Export Excel - în dezvoltare')}
        onExportPdf={() => alert('Export PDF - în dezvoltare')}
        onGenerateAuditReport={() => alert('Raport audit UE - în dezvoltare')}
      />
    </div>
  );
}
