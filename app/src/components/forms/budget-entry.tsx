'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

interface BudgetEntryProps {
  categories: { id: string; name: string; euEligible: boolean; maxAmount?: number }[];
  partners: { id: string; name: string }[];
  exchangeRate?: number;
  onSubmit: (data: BudgetEntryData) => void;
  onCancel: () => void;
}

interface BudgetEntryData {
  description: string;
  amount: number;
  currency: 'EUR' | 'RON';
  categoryId: string;
  partnerId?: string;
  date: string;
  notes?: string;
  justification?: string;
}

const EU_COST_CATEGORIES: BudgetEntryProps['categories'] = [
  { id: 'personal', name: 'Cheltuieli de personal', euEligible: true },
  { id: 'deplasari', name: 'Cheltuieli de deplasare', euEligible: true },
  { id: 'echipamente', name: 'Echipamente', euEligible: true },
  { id: 'subcontractare', name: 'Subcontractare', euEligible: true },
  { id: 'alte_bunuri', name: 'Alte bunuri și servicii', euEligible: true },
  { id: 'costuri_indirecte', name: 'Costuri indirecte', euEligible: true },
  { id: 'neeligibile', name: 'Cheltuieli neeligibile', euEligible: false },
];

export function BudgetEntry({ categories, partners, exchangeRate = 4.97, onSubmit, onCancel }: BudgetEntryProps) {
  const allCategories = categories.length > 0 ? categories : EU_COST_CATEGORIES;
  const [data, setData] = useState<BudgetEntryData>({
    description: '', amount: 0, currency: 'EUR', categoryId: '',
    partnerId: '', date: new Date().toISOString().split('T')[0], notes: '', justification: '',
  });
  const [errors, setErrors] = useState<string[]>([]);

  const selectedCat = allCategories.find(c => c.id === data.categoryId);
  const amountEur = data.currency === 'EUR' ? data.amount : data.amount / exchangeRate;
  const amountRon = data.currency === 'RON' ? data.amount : data.amount * exchangeRate;

  const validate = (): boolean => {
    const errs: string[] = [];
    if (!data.description.trim()) errs.push('Descrierea este obligatorie');
    if (data.amount <= 0) errs.push('Suma trebuie să fie pozitivă');
    if (!data.categoryId) errs.push('Selectați o categorie');
    if (!data.date) errs.push('Data este obligatorie');
    if (selectedCat && !selectedCat.euEligible && !data.justification?.trim()) {
      errs.push('Justificarea este obligatorie pentru cheltuieli neeligibile UE');
    }
    if (selectedCat?.maxAmount && amountEur > selectedCat.maxAmount) {
      errs.push(`Suma depășește plafonul maxim (€${selectedCat.maxAmount.toLocaleString()})`);
    }
    setErrors(errs);
    return errs.length === 0;
  };

  const handleSubmit = () => {
    if (validate()) onSubmit(data);
  };

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle className="text-lg">Înregistrare Cheltuială Bugetară</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Descriere *</Label>
          <Input value={data.description}
            onChange={e => setData(d => ({ ...d, description: e.target.value }))}
            placeholder="Descrierea cheltuielii..." />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Suma *</Label>
            <Input type="number" step="0.01" value={data.amount || ''}
              onChange={e => setData(d => ({ ...d, amount: Number(e.target.value) }))} />
          </div>
          <div>
            <Label>Monedă</Label>
            <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={data.currency}
              onChange={e => setData(d => ({ ...d, currency: e.target.value as 'EUR' | 'RON' }))}>
              <option value="EUR">EUR (€)</option>
              <option value="RON">RON (lei)</option>
            </select>
          </div>
        </div>

        {/* Currency conversion display */}
        {data.amount > 0 && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            💱 Conversie: {data.currency === 'EUR'
              ? `€${data.amount.toFixed(2)} = ${amountRon.toFixed(2)} RON`
              : `${data.amount.toFixed(2)} RON = €${amountEur.toFixed(2)}`}
            <span className="ml-1">(curs: 1 EUR = {exchangeRate} RON)</span>
          </div>
        )}

        <div>
          <Label>Categorie de cost UE *</Label>
          <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={data.categoryId}
            onChange={e => setData(d => ({ ...d, categoryId: e.target.value }))}>
            <option value="">Selectați categoria...</option>
            {allCategories.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} {!c.euEligible ? '(neeligibil UE)' : ''}
              </option>
            ))}
          </select>
          {selectedCat && !selectedCat.euEligible && (
            <Badge variant="destructive" className="mt-1 text-[10px]">
              ⚠️ Această categorie nu este eligibilă pentru finanțare UE
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Data *</Label>
            <Input type="date" value={data.date}
              onChange={e => setData(d => ({ ...d, date: e.target.value }))} />
          </div>
          <div>
            <Label>Partener</Label>
            <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={data.partnerId || ''}
              onChange={e => setData(d => ({ ...d, partnerId: e.target.value }))}>
              <option value="">Niciunul</option>
              {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {selectedCat && !selectedCat.euEligible && (
          <div>
            <Label>Justificare cheltuială neeligibilă *</Label>
            <Textarea value={data.justification || ''} rows={3}
              onChange={e => setData(d => ({ ...d, justification: e.target.value }))}
              placeholder="Motivați necesitatea acestei cheltuieli..." />
          </div>
        )}

        <div>
          <Label>Note adiționale</Label>
          <Textarea value={data.notes || ''} rows={2}
            onChange={e => setData(d => ({ ...d, notes: e.target.value }))}
            placeholder="Informații suplimentare..." />
        </div>

        {/* Validation errors */}
        {errors.length > 0 && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 rounded-md p-3">
            {errors.map((err, i) => (
              <p key={i} className="text-sm text-red-600">• {err}</p>
            ))}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={onCancel} className="flex-1">Anulează</Button>
          <Button onClick={handleSubmit} className="flex-1">Salvează</Button>
        </div>
      </CardContent>
    </Card>
  );
}
