'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { Partner } from './partner-dashboard';

interface PartnerManagementProps {
  partners: Partner[];
  onAddPartner?: (data: AddPartnerData) => void;
  onRemovePartner?: (partnerId: string) => void;
  onRoleChange?: (partnerId: string, role: Partner['role']) => void;
  onBudgetChange?: (partnerId: string, amount: number) => void;
}

interface AddPartnerData {
  name: string;
  cui: string;
  country: string;
  role: Partner['role'];
  contactName: string;
  contactEmail: string;
  budgetAllocated: number;
}

const CAPABILITIES = [
  'Cercetare', 'Dezvoltare', 'Management', 'Diseminare', 'Formare',
  'IT & Digital', 'Juridic', 'Financiar', 'Comunicare',
];

export function PartnerManagement({
  partners, onAddPartner, onRemovePartner, onRoleChange, onBudgetChange,
}: PartnerManagementProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState<AddPartnerData>({
    name: '', cui: '', country: 'România', role: 'partner',
    contactName: '', contactEmail: '', budgetAllocated: 0,
  });

  const totalBudget = partners.reduce((s, p) => s + p.budgetAllocated, 0);

  const handleSubmit = () => {
    if (!formData.name.trim() || !formData.cui.trim()) return;
    onAddPartner?.(formData);
    setFormData({ name: '', cui: '', country: 'România', role: 'partner', contactName: '', contactEmail: '', budgetAllocated: 0 });
    setShowAddForm(false);
  };

  return (
    <div className="space-y-6">
      {/* Partner table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg">Managementul Partenerilor</CardTitle>
          <Button size="sm" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Anulează' : '➕ Adaugă Partener'}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {/* Add form */}
          {showAddForm && (
            <div className="p-6 border-b bg-muted/20">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs">Denumire organizație *</Label>
                  <Input value={formData.name} onChange={e => setFormData(d => ({ ...d, name: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">CUI *</Label>
                  <Input value={formData.cui} onChange={e => setFormData(d => ({ ...d, cui: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Țara</Label>
                  <Input value={formData.country} onChange={e => setFormData(d => ({ ...d, country: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Rol</Label>
                  <select
                    className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={formData.role}
                    onChange={e => setFormData(d => ({ ...d, role: e.target.value as Partner['role'] }))}
                  >
                    <option value="partner">Partener</option>
                    <option value="observer">Observator</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Persoană de contact</Label>
                  <Input value={formData.contactName} onChange={e => setFormData(d => ({ ...d, contactName: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Email contact</Label>
                  <Input type="email" value={formData.contactEmail} onChange={e => setFormData(d => ({ ...d, contactEmail: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Buget alocat (EUR)</Label>
                  <Input type="number" value={formData.budgetAllocated} onChange={e => setFormData(d => ({ ...d, budgetAllocated: Number(e.target.value) }))} />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleSubmit} className="w-full">Adaugă</Button>
                </div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organizație</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Țara</TableHead>
                  <TableHead className="text-right">Buget</TableHead>
                  <TableHead className="text-right">% din total</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Acțiuni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        {p.cui && <p className="text-[10px] text-muted-foreground">CUI: {p.cui}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {onRoleChange ? (
                        <select
                          className="h-7 rounded border bg-background px-2 text-xs"
                          value={p.role}
                          onChange={e => onRoleChange(p.id, e.target.value as Partner['role'])}
                        >
                          <option value="coordinator">Coordonator</option>
                          <option value="partner">Partener</option>
                          <option value="observer">Observator</option>
                        </select>
                      ) : (
                        <Badge variant={p.role === 'coordinator' ? 'default' : 'outline'}>
                          {p.role === 'coordinator' ? 'Coordonator' : p.role === 'partner' ? 'Partener' : 'Observator'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{p.country}</TableCell>
                    <TableCell className="text-right text-sm">
                      {new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(p.budgetAllocated)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {totalBudget > 0 ? ((p.budgetAllocated / totalBudget) * 100).toFixed(1) : 0}%
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.contactName || '-'}
                    </TableCell>
                    <TableCell>
                      {p.role !== 'coordinator' && onRemovePartner && (
                        <Button variant="ghost" size="sm" className="text-destructive text-xs"
                          onClick={() => onRemovePartner(p.id)}>
                          Elimină
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Capability Matrix */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Matricea Competențelor</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partener</TableHead>
                {CAPABILITIES.map(c => (
                  <TableHead key={c} className="text-center text-[10px] px-1">{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm font-medium">{p.name}</TableCell>
                  {CAPABILITIES.map(c => (
                    <TableCell key={c} className="text-center">
                      <div className="w-4 h-4 rounded-full mx-auto bg-muted border cursor-pointer hover:bg-primary/20" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
