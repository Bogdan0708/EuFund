'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PartnerDashboard, type Partner } from '@/components/consortium/partner-dashboard';
import { CollaborationWorkspace } from '@/components/consortium/collaboration-workspace';
import { PartnerManagement } from '@/components/consortium/partner-management';

// Demo data - in production, fetch from API
const DEMO_PARTNERS: Partner[] = [
  {
    id: '1', name: 'Universitatea Politehnică București', cui: 'RO12345678',
    role: 'coordinator', country: 'România', budgetAllocated: 250000, budgetSpent: 85000,
    contactName: 'Prof. Dr. Ion Popescu', contactEmail: 'ion.popescu@upb.ro',
    workPackages: ['wp1', 'wp2', 'wp3'], performanceScore: 92, joinedAt: '2024-01-15',
  },
  {
    id: '2', name: 'TechStar SRL', cui: 'RO87654321',
    role: 'partner', country: 'România', budgetAllocated: 150000, budgetSpent: 42000,
    contactName: 'Maria Ionescu', contactEmail: 'maria@techstar.ro',
    workPackages: ['wp2', 'wp4'], performanceScore: 78, joinedAt: '2024-02-01',
  },
  {
    id: '3', name: 'Fraunhofer Institute', cui: 'DE99887766',
    role: 'partner', country: 'Germania', budgetAllocated: 200000, budgetSpent: 65000,
    contactName: 'Dr. Hans Müller', contactEmail: 'h.muller@fraunhofer.de',
    workPackages: ['wp3', 'wp5'], performanceScore: 88, joinedAt: '2024-01-20',
  },
];

export default function ConsortiumPage() {
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">🤝 Consorțiu & Parteneri</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Prezentare</TabsTrigger>
          <TabsTrigger value="workspace">Colaborare</TabsTrigger>
          <TabsTrigger value="management">Management</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <PartnerDashboard partners={DEMO_PARTNERS} />
        </TabsContent>

        <TabsContent value="workspace" className="mt-4">
          <CollaborationWorkspace />
        </TabsContent>

        <TabsContent value="management" className="mt-4">
          <PartnerManagement partners={DEMO_PARTNERS} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
