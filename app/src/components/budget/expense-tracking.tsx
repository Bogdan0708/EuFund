'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Expense {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: 'EUR' | 'RON';
  category: string;
  partnerId?: string;
  partnerName?: string;
  receiptUrl?: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submittedBy: string;
  approvedBy?: string;
  notes?: string;
}

interface ExpenseTrackingProps {
  expenses: Expense[];
  categories: { id: string; name: string }[];
  partners: { id: string; name: string }[];
  budgetRemaining: number;
  currency: 'EUR' | 'RON';
  onSubmitExpense?: (data: NewExpenseData) => void;
  onApprove?: (expenseId: string) => void;
  onReject?: (expenseId: string, reason: string) => void;
  onUploadReceipt?: (expenseId: string, file: File) => void;
  canApprove?: boolean;
}

interface NewExpenseData {
  date: string;
  description: string;
  amount: number;
  currency: 'EUR' | 'RON';
  category: string;
  partnerId?: string;
  notes?: string;
}

function formatCurrency(n: number, c: string = 'EUR'): string {
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);
}

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Ciornă', variant: 'outline' },
  submitted: { label: 'Trimis', variant: 'secondary' },
  approved: { label: 'Aprobat', variant: 'default' },
  rejected: { label: 'Respins', variant: 'destructive' },
};

export function ExpenseTracking({
  expenses, categories, partners, budgetRemaining, currency,
  onSubmitExpense, onApprove, onReject, canApprove,
}: ExpenseTrackingProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewExpenseData>({
    date: new Date().toISOString().split('T')[0],
    description: '', amount: 0, currency, category: '', partnerId: '', notes: '',
  });

  const totalPending = expenses.filter(e => e.status === 'submitted').reduce((s, e) => s + e.amount, 0);
  const totalApproved = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0);
  const warningThreshold = budgetRemaining * 0.1;

  const handleSubmit = () => {
    if (!form.description || !form.amount || !form.category) return;
    onSubmitExpense?.(form);
    setForm({ date: new Date().toISOString().split('T')[0], description: '', amount: 0, currency, category: '', partnerId: '', notes: '' });
    setShowForm(false);
  };

  return (
    <div className="space-y-6">
      {/* Balance overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Sold disponibil</p>
            <p className={`text-xl font-bold ${budgetRemaining < warningThreshold ? 'text-red-600' : 'text-green-600'}`}>
              {formatCurrency(budgetRemaining, currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">În așteptare</p>
            <p className="text-xl font-bold text-orange-600">{formatCurrency(totalPending, currency)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Aprobate</p>
            <p className="text-xl font-bold">{formatCurrency(totalApproved, currency)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Cheltuieli totale</p>
            <p className="text-xl font-bold">{expenses.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Budget warning */}
      {budgetRemaining < warningThreshold && (
        <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/20">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="text-sm font-medium text-orange-800 dark:text-orange-200">Atenție: Buget aproape epuizat</p>
              <p className="text-xs text-orange-600 dark:text-orange-300">
                Mai aveți doar {formatCurrency(budgetRemaining, currency)} disponibil.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick entry form */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm">Înregistrare Cheltuială</CardTitle>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Anulează' : '➕ Adaugă Cheltuială'}
          </Button>
        </CardHeader>
        {showForm && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Data *</Label>
                <Input type="date" value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Suma *</Label>
                <div className="flex gap-2">
                  <Input type="number" step="0.01" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))}
                    className="flex-1" />
                  <select className="w-20 h-10 rounded-md border bg-background px-2 text-sm"
                    value={form.currency}
                    onChange={e => setForm(f => ({ ...f, currency: e.target.value as 'EUR' | 'RON' }))}>
                    <option value="EUR">EUR</option>
                    <option value="RON">RON</option>
                  </select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Categorie *</Label>
                <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="">Selectați...</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Descriere *</Label>
                <Input value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Descrierea cheltuielii..." />
              </div>
              <div>
                <Label className="text-xs">Partener</Label>
                <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.partnerId}
                  onChange={e => setForm(f => ({ ...f, partnerId: e.target.value }))}>
                  <option value="">Niciunul</option>
                  {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="md:col-span-3">
                <Label className="text-xs">Note</Label>
                <Textarea value={form.notes || ''} rows={2}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Note adiționale..." />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSubmit} disabled={!form.description || !form.amount || !form.category}>
                Salvează Cheltuiala
              </Button>
              {form.amount > 0 && (
                <p className="text-xs text-muted-foreground self-center">
                  Sold după: {formatCurrency(budgetRemaining - form.amount, currency)}
                  {form.amount > budgetRemaining && (
                    <span className="text-red-600 ml-1">⚠️ Depășire buget!</span>
                  )}
                </p>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Expenses list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cheltuieli Recente</CardTitle>
        </CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Nicio cheltuială înregistrată.</p>
          ) : (
            <div className="space-y-2">
              {expenses
                .sort((a, b) => b.date.localeCompare(a.date))
                .map(exp => {
                  const status = STATUS_MAP[exp.status] || STATUS_MAP.draft;
                  return (
                    <div key={exp.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{exp.description}</p>
                          <Badge variant={status.variant} className="text-[10px]">{status.label}</Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(exp.date).toLocaleDateString('ro-RO')} · {exp.category}
                          {exp.partnerName && ` · ${exp.partnerName}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{formatCurrency(exp.amount, exp.currency)}</p>
                        {exp.receiptUrl && <span className="text-[10px] text-muted-foreground">📎 Chitanță</span>}
                      </div>
                      {canApprove && exp.status === 'submitted' && (
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" className="text-xs text-green-600"
                            onClick={() => onApprove?.(exp.id)}>✓</Button>
                          <Button variant="outline" size="sm" className="text-xs text-red-600"
                            onClick={() => onReject?.(exp.id, '')}>✗</Button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
