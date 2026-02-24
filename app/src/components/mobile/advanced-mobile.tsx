'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdvancedMobileProps {
  feature: 'analytics' | 'collaboration' | 'notifications' | 'approvals';
  offline: boolean;
}

interface Notification {
  id: string;
  title: string;
  body: string;
  type: 'deadline' | 'approval' | 'update' | 'risk' | 'partner';
  priority: 'high' | 'medium' | 'low';
  timestamp: string;
  read: boolean;
  actionUrl?: string;
}

interface ApprovalItem {
  id: string;
  title: string;
  requestedBy: string;
  organization: string;
  type: 'budget' | 'document' | 'milestone' | 'partner';
  amount?: number;
  description: string;
  deadline: string;
  status: 'pending' | 'approved' | 'rejected';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function OfflineBanner({ offline }: { offline: boolean }) {
  if (!offline) return null;
  return (
    <div className="bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 p-2 rounded-lg text-xs text-center" role="alert">
      📡 Mod offline — datele vor fi sincronizate la reconectare
    </div>
  );
}

function MobileAnalytics() {
  const quickStats = [
    { label: 'Succes', value: '68%', icon: '🎯' },
    { label: 'Buget', value: '42%', icon: '💰' },
    { label: 'Riscuri', value: '3', icon: '⚠️' },
    { label: 'Termen', value: '45z', icon: '📅' },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {quickStats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-3 flex items-center gap-3">
              <span className="text-2xl">{stat.icon}</span>
              <div>
                <p className="text-lg font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Trend Succes (7 zile)</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="flex items-end gap-1 h-20">
            {[62, 64, 63, 65, 67, 66, 68].map((v, i) => (
              <div key={i} className="flex-1 bg-primary/70 rounded-t transition-all hover:bg-primary" style={{ height: `${(v / 70) * 100}%` }} title={`${v}%`} />
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Lu</span><span>Ma</span><span>Mi</span><span>Jo</span><span>Vi</span><span>Sâ</span><span>Du</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MobileNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([
    { id: '1', title: 'Deadline apropiat', body: 'Propunerea trebuie finalizată în 5 zile', type: 'deadline', priority: 'high', timestamp: 'acum 10 min', read: false },
    { id: '2', title: 'Aprobare necesară', body: 'Ion Ionescu solicită aprobare buget WP3', type: 'approval', priority: 'high', timestamp: 'acum 30 min', read: false },
    { id: '3', title: 'Partener nou recomandat', body: 'TU Delft — scor potrivire 82%', type: 'partner', priority: 'medium', timestamp: 'acum 1 oră', read: true },
    { id: '4', title: 'Risc identificat', body: 'WP4 — întârziere estimată 2 săptămâni', type: 'risk', priority: 'high', timestamp: 'acum 2 ore', read: false },
    { id: '5', title: 'Document actualizat', body: 'Secțiunea Impact editată de Hans Mueller', type: 'update', priority: 'low', timestamp: 'acum 3 ore', read: true },
  ]);

  const typeIcons: Record<string, string> = { deadline: '📅', approval: '✅', update: '📝', risk: '⚠️', partner: '🤝' };
  const priorityColors: Record<string, string> = { high: 'border-l-red-500', medium: 'border-l-yellow-500', low: 'border-l-gray-300' };

  const markRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
  };

  return (
    <div className="space-y-2">
      {notifications.map((n) => (
        <Card key={n.id} className={`border-l-4 ${priorityColors[n.priority]} ${!n.read ? 'bg-accent/30' : ''}`} onClick={() => markRead(n.id)} role="button" tabIndex={0}>
          <CardContent className="p-3 flex items-start gap-3">
            <span className="text-lg">{typeIcons[n.type]}</span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start">
                <p className={`text-sm ${!n.read ? 'font-bold' : 'font-medium'}`}>{n.title}</p>
                <span className="text-xs text-muted-foreground flex-shrink-0">{n.timestamp}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MobileApprovals() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([
    { id: '1', title: 'Buget suplimentar WP3', requestedBy: 'Sophie Duval', organization: 'INRIA', type: 'budget', amount: 35000, description: 'Echipamente HPC suplimentare necesare', deadline: '2026-02-18', status: 'pending' },
    { id: '2', title: 'Aprobare Milestone M6', requestedBy: 'Hans Mueller', organization: 'Fraunhofer', type: 'milestone', description: 'Livrabil D2.1 finalizat, solicită aprobare formală', deadline: '2026-02-20', status: 'pending' },
    { id: '3', title: 'Adăugare partener TU Delft', requestedBy: 'Maria Popescu', organization: 'UPB', type: 'partner', description: 'Partener propus pentru WP4 sustenabilitate', deadline: '2026-02-25', status: 'pending' },
  ]);

  const typeIcons: Record<string, string> = { budget: '💰', document: '📄', milestone: '🏁', partner: '🤝' };

  const handleDecision = (id: string, decision: 'approved' | 'rejected') => {
    setApprovals((prev) => prev.map((a) => a.id === id ? { ...a, status: decision } : a));
  };

  return (
    <div className="space-y-3">
      {approvals.map((item) => (
        <Card key={item.id}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">{typeIcons[item.type]}</span>
              <div className="flex-1">
                <p className="font-medium text-sm">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.requestedBy} • {item.organization}</p>
                <p className="text-xs mt-1">{item.description}</p>
                {item.amount && <p className="text-sm font-bold mt-1">{item.amount.toLocaleString()}€</p>}
                <p className="text-xs text-muted-foreground mt-1">Termen: {item.deadline}</p>
              </div>
            </div>
            {item.status === 'pending' ? (
              <div className="flex gap-2 mt-3">
                <Button size="sm" className="flex-1" onClick={() => handleDecision(item.id, 'approved')}>✅ Aprobă</Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => handleDecision(item.id, 'rejected')}>❌ Respinge</Button>
              </div>
            ) : (
              <Badge variant={item.status === 'approved' ? 'default' : 'destructive'} className="mt-3">
                {item.status === 'approved' ? '✅ Aprobat' : '❌ Respins'}
              </Badge>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MobileCollaboration() {
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex -space-x-2">
              {['#3B82F6', '#EF4444', '#10B981'].map((c, i) => (
                <div key={i} className="w-8 h-8 rounded-full border-2 border-background" style={{ backgroundColor: c }} />
              ))}
            </div>
            <span className="text-sm">3 utilizatori online</span>
          </div>
          <div className="space-y-2">
            <Button variant="outline" className="w-full justify-start" size="sm">💬 Deschide Chat</Button>
            <Button variant="outline" className="w-full justify-start" size="sm">📝 Editor Documente</Button>
            <Button variant="outline" className="w-full justify-start" size="sm">📊 Gantt Chart</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Activitate Recentă</CardTitle>
        </CardHeader>
        <CardContent className="pb-3 space-y-2 text-xs">
          <p>✏️ <strong>Hans Mueller</strong> a editat Impact — acum 5 min</p>
          <p>💬 <strong>Sophie Duval</strong> a trimis un mesaj — acum 10 min</p>
          <p>📎 <strong>Ion Ionescu</strong> a încărcat D4.1 — acum 30 min</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AdvancedMobile({ feature, offline }: AdvancedMobileProps) {
  const featureLabels: Record<string, string> = {
    analytics: 'Analiză Rapidă',
    collaboration: 'Colaborare',
    notifications: 'Notificări',
    approvals: 'Aprobări',
  };

  return (
    <div className="max-w-md mx-auto space-y-4 p-4">
      <OfflineBanner offline={offline} />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{featureLabels[feature]}</h2>
        {offline && <Badge variant="outline" className="text-xs">Offline</Badge>}
      </div>

      {/* Bottom navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-2 flex justify-around max-w-md mx-auto z-50">
        {[
          { key: 'analytics', icon: '📊', label: 'Analiză' },
          { key: 'collaboration', icon: '👥', label: 'Colaborare' },
          { key: 'notifications', icon: '🔔', label: 'Notificări' },
          { key: 'approvals', icon: '✅', label: 'Aprobări' },
        ].map((nav) => (
          <button key={nav.key} className={`flex flex-col items-center gap-0.5 p-1 rounded ${feature === nav.key ? 'text-primary' : 'text-muted-foreground'}`} aria-label={nav.label} aria-current={feature === nav.key ? 'page' : undefined}>
            <span className="text-lg">{nav.icon}</span>
            <span className="text-xs">{nav.label}</span>
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="pb-20">
        {feature === 'analytics' && <MobileAnalytics />}
        {feature === 'collaboration' && <MobileCollaboration />}
        {feature === 'notifications' && <MobileNotifications />}
        {feature === 'approvals' && <MobileApprovals />}
      </div>
    </div>
  );
}
