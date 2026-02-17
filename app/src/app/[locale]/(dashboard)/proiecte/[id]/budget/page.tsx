'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BudgetDashboard, type BudgetData } from '@/components/budget/budget-dashboard';
import { ExpenseTracking } from '@/components/budget/expense-tracking';

const DEMO_BUDGET: BudgetData = {
  totalBudget: 600000, euContribution: 480000, nationalContrib: 72000, ownContrib: 48000,
  currency: 'EUR', exchangeRate: 4.97,
  categories: [
    { id: 'personal', name: 'Staff costs', nameRo: 'Cheltuieli de personal', allocated: 250000, spent: 95000, euEligible: true },
    { id: 'deplasari', name: 'Travel', nameRo: 'Cheltuieli de deplasare', allocated: 40000, spent: 12000, euEligible: true },
    { id: 'echipamente', name: 'Equipment', nameRo: 'Echipamente', allocated: 80000, spent: 35000, euEligible: true },
    { id: 'subcontractare', name: 'Subcontracting', nameRo: 'Subcontractare', allocated: 100000, spent: 28000, euEligible: true },
    { id: 'alte', name: 'Other', nameRo: 'Alte bunuri și servicii', allocated: 80000, spent: 15000, euEligible: true },
    { id: 'indirecte', name: 'Indirect', nameRo: 'Costuri indirecte', allocated: 50000, spent: 7000, euEligible: true },
  ],
  monthlySpending: [
    { month: 'Ian', amount: 25000 }, { month: 'Feb', amount: 32000 },
    { month: 'Mar', amount: 28000 }, { month: 'Apr', amount: 38000 },
    { month: 'Mai', amount: 35000 }, { month: 'Iun', amount: 34000 },
  ],
};

export default function BudgetPage() {
  const params = useParams();
  const [tab, setTab] = useState('overview');
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
      <h1 className="text-2xl font-bold">💰 Management Bugetar</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Prezentare</TabsTrigger>
          <TabsTrigger value="expenses">Cheltuieli</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <BudgetDashboard data={DEMO_BUDGET} showForecast />
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <ExpenseTracking
            expenses={[]}
            categories={DEMO_BUDGET.categories.map(c => ({ id: c.id, name: c.nameRo }))}
            partners={[{ id: '1', name: 'UPB' }, { id: '2', name: 'TechStar' }]}
            budgetRemaining={DEMO_BUDGET.totalBudget - DEMO_BUDGET.categories.reduce((s, c) => s + c.spent, 0)}
            currency="EUR"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
