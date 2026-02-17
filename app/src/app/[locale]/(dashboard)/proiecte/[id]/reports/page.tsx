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

function formatCurrency(value: number, currency: 'EUR' | 'RON' = 'EUR'): string {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function toCsvCell(value: string | number | boolean): string {
  const raw = String(value ?? '');
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openPrintableHtml(title: string, htmlBody: string): void {
  const html = `<!doctype html>
<html lang="ro">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
      h1 { margin: 0 0 8px; font-size: 24px; }
      h2 { margin: 20px 0 8px; font-size: 18px; }
      p { margin: 0 0 8px; color: #374151; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; }
      th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 12px; text-align: left; }
      th { background: #f3f4f6; }
      .right { text-align: right; }
      .notes { background: #f9fafb; border: 1px solid #e5e7eb; padding: 12px; border-radius: 8px; }
      @media print {
        .no-print { display: none; }
        body { margin: 12mm; }
      }
    </style>
  </head>
  <body>
    <button class="no-print" onclick="window.print()" style="margin-bottom:12px;padding:8px 12px;">Tipărește / Salvează PDF</button>
    ${htmlBody}
  </body>
</html>`;

  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) {
    return;
  }

  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

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

  const categoryTotals = DEMO_CATEGORIES.map((category) => {
    const spent = DEMO_ENTRIES
      .filter((entry) => entry.category === category.id)
      .reduce((sum, entry) => sum + entry.amountEur, 0);
    const utilization = category.allocated > 0 ? (spent / category.allocated) * 100 : 0;
    return {
      ...category,
      spent,
      utilization,
      remaining: category.allocated - spent,
    };
  });

  const overallAllocated = DEMO_CATEGORIES.reduce((sum, category) => sum + category.allocated, 0);
  const overallSpent = DEMO_ENTRIES.reduce((sum, entry) => sum + entry.amountEur, 0);
  const overallEligible = DEMO_ENTRIES.filter((entry) => entry.euEligible).reduce((sum, entry) => sum + entry.amountEur, 0);
  const overallApproved = DEMO_ENTRIES.filter((entry) => entry.approved).reduce((sum, entry) => sum + entry.amountEur, 0);

  const handleExportExcel = () => {
    const lines: string[] = [];
    lines.push('Raport financiar proiect UE');
    lines.push(`Proiect,${toCsvCell('Proiect de Cercetare și Inovare')}`);
    lines.push(`Perioada,${toCsvCell('2025-01-01 - 2025-06-30')}`);
    lines.push('');
    lines.push('Categorii buget');
    lines.push([
      'ID categorie',
      'Categorie',
      'Alocat EUR',
      'Raportat EUR',
      'Diferență EUR',
      'Utilizare %',
      'Eligibil UE',
    ].map(toCsvCell).join(','));
    for (const category of categoryTotals) {
      lines.push([
        category.id,
        category.nameRo,
        category.allocated.toFixed(2),
        category.spent.toFixed(2),
        category.remaining.toFixed(2),
        category.utilization.toFixed(2),
        category.euEligible ? 'Da' : 'Nu',
      ].map(toCsvCell).join(','));
    }

    lines.push('');
    lines.push('Intrări financiare');
    lines.push([
      'ID',
      'Dată',
      'Categorie',
      'Descriere',
      'Partener',
      'Monedă',
      'Suma',
      'Curs',
      'Suma EUR',
      'Eligibil UE',
      'Aprobat',
    ].map(toCsvCell).join(','));
    for (const entry of DEMO_ENTRIES) {
      const categoryName = DEMO_CATEGORIES.find((category) => category.id === entry.category)?.nameRo || entry.category;
      lines.push([
        entry.id,
        entry.date,
        categoryName,
        entry.description,
        entry.partnerName || '-',
        entry.currency,
        entry.amount.toFixed(2),
        entry.exchangeRate ? entry.exchangeRate.toFixed(4) : '-',
        entry.amountEur.toFixed(2),
        entry.euEligible ? 'Da' : 'Nu',
        entry.approved ? 'Da' : 'Nu',
      ].map(toCsvCell).join(','));
    }

    triggerDownload(lines.join('\n'), 'raport-financiar.csv', 'text/csv;charset=utf-8;');
  };

  const handleExportPdf = () => {
    const categoryRows = categoryTotals.map((category) => `
      <tr>
        <td>${category.nameRo}</td>
        <td class="right">${formatCurrency(category.allocated)}</td>
        <td class="right">${formatCurrency(category.spent)}</td>
        <td class="right">${formatCurrency(category.remaining)}</td>
        <td class="right">${category.utilization.toFixed(1)}%</td>
      </tr>
    `).join('');

    const entryRows = DEMO_ENTRIES.map((entry) => `
      <tr>
        <td>${new Date(entry.date).toLocaleDateString('ro-RO')}</td>
        <td>${entry.description}</td>
        <td>${DEMO_CATEGORIES.find((category) => category.id === entry.category)?.nameRo || entry.category}</td>
        <td>${entry.partnerName || '-'}</td>
        <td class="right">${formatCurrency(entry.amount, entry.currency)}</td>
        <td class="right">${formatCurrency(entry.amountEur)}</td>
      </tr>
    `).join('');

    const body = `
      <h1>Raport financiar proiect UE</h1>
      <p>Proiect: Proiect de Cercetare și Inovare</p>
      <p>Perioada de raportare: 01.01.2025 - 30.06.2025</p>
      <p>Total alocat: ${formatCurrency(overallAllocated)} | Total raportat: ${formatCurrency(overallSpent)}</p>

      <h2>Rezumat categorii</h2>
      <table>
        <thead>
          <tr>
            <th>Categorie</th>
            <th class="right">Alocat</th>
            <th class="right">Raportat</th>
            <th class="right">Diferență</th>
            <th class="right">% Utilizare</th>
          </tr>
        </thead>
        <tbody>${categoryRows}</tbody>
      </table>

      <h2>Detalii cheltuieli</h2>
      <table>
        <thead>
          <tr>
            <th>Dată</th>
            <th>Descriere</th>
            <th>Categorie</th>
            <th>Partener</th>
            <th class="right">Sumă</th>
            <th class="right">EUR</th>
          </tr>
        </thead>
        <tbody>${entryRows}</tbody>
      </table>
    `;

    openPrintableHtml('Raport financiar UE', body);
  };

  const handleGenerateAuditReport = () => {
    const overBudgetCategories = categoryTotals.filter((category) => category.spent > category.allocated);
    const ineligibleEntries = DEMO_ENTRIES.filter((entry) => !entry.euEligible);
    const unapprovedEntries = DEMO_ENTRIES.filter((entry) => !entry.approved);
    const eligibleRate = overallSpent > 0 ? (overallEligible / overallSpent) * 100 : 0;
    const approvedRate = overallSpent > 0 ? (overallApproved / overallSpent) * 100 : 0;

    const complianceNotes = [
      overBudgetCategories.length === 0
        ? 'Nu există depășiri bugetare pe categorii.'
        : `Depășiri bugetare identificate: ${overBudgetCategories.map((category) => category.nameRo).join(', ')}.`,
      ineligibleEntries.length === 0
        ? 'Toate cheltuielile sunt marcate ca eligibile UE.'
        : `Cheltuieli neeligibile identificate: ${ineligibleEntries.length}.`,
      unapprovedEntries.length === 0
        ? 'Toate cheltuielile sunt aprobate.'
        : `Cheltuieli în așteptare aprobare: ${unapprovedEntries.length}.`,
    ];

    const summaryRows = categoryTotals.map((category) => `
      <tr>
        <td>${category.nameRo}</td>
        <td class="right">${formatCurrency(category.allocated)}</td>
        <td class="right">${formatCurrency(category.spent)}</td>
        <td class="right">${formatCurrency(category.remaining)}</td>
        <td class="right">${category.utilization.toFixed(1)}%</td>
      </tr>
    `).join('');

    const notesRows = complianceNotes.map((note) => `<li>${note}</li>`).join('');
    const generatedAt = new Date().toLocaleString('ro-RO');
    const body = `
      <h1>Raport Audit UE</h1>
      <p>Proiect: Proiect de Cercetare și Inovare</p>
      <p>Perioada: 01.01.2025 - 30.06.2025</p>
      <p>Generat la: ${generatedAt}</p>

      <h2>Tabel sumar financiar</h2>
      <table>
        <thead>
          <tr>
            <th>Categorie</th>
            <th class="right">Buget alocat</th>
            <th class="right">Cheltuit</th>
            <th class="right">Rămas</th>
            <th class="right">% utilizare</th>
          </tr>
        </thead>
        <tbody>${summaryRows}</tbody>
      </table>

      <h2>Indicatori de conformitate</h2>
      <table>
        <tbody>
          <tr><th>Cheltuieli totale raportate</th><td class="right">${formatCurrency(overallSpent)}</td></tr>
          <tr><th>Pondere cheltuieli eligibile</th><td class="right">${eligibleRate.toFixed(2)}%</td></tr>
          <tr><th>Pondere cheltuieli aprobate</th><td class="right">${approvedRate.toFixed(2)}%</td></tr>
          <tr><th>Număr intrări analizate</th><td class="right">${DEMO_ENTRIES.length}</td></tr>
        </tbody>
      </table>

      <h2>Note de conformitate</h2>
      <div class="notes">
        <ul>${notesRows}</ul>
      </div>
    `;

    openPrintableHtml('Raport audit UE', body);
    const textReport = [
      'Raport Audit UE',
      `Proiect: Proiect de Cercetare și Inovare`,
      `Perioada: 01.01.2025 - 30.06.2025`,
      `Generat la: ${generatedAt}`,
      '',
      `Total raportat: ${overallSpent.toFixed(2)} EUR`,
      `Pondere eligibilă: ${eligibleRate.toFixed(2)}%`,
      `Pondere aprobată: ${approvedRate.toFixed(2)}%`,
      '',
      'Note de conformitate:',
      ...complianceNotes.map((note, index) => `${index + 1}. ${note}`),
    ].join('\n');
    triggerDownload(textReport, 'raport-audit-ue.txt', 'text/plain;charset=utf-8;');
  };

  return (
    <div className="space-y-6">
      <FinancialReporting
        entries={DEMO_ENTRIES}
        categories={DEMO_CATEGORIES}
        projectTitle="Proiect de Cercetare și Inovare"
        reportingPeriod={{ start: '2025-01-01', end: '2025-06-30' }}
        onExportExcel={handleExportExcel}
        onExportPdf={handleExportPdf}
        onGenerateAuditReport={handleGenerateAuditReport}
      />
    </div>
  );
}
