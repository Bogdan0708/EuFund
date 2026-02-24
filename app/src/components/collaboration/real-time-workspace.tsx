'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ── Types ──────────────────────────────────────────────────────────────────────

type UserRole = 'coordinator' | 'partner' | 'evaluator' | 'observer';

interface Organization {
  id: string;
  name: string;
  country: string;
  role: 'lead' | 'partner';
}

interface RealTimeWorkspaceProps {
  projectId: string;
  userRole: UserRole;
  partnerOrganizations: Organization[];
}

interface ActiveUser {
  id: string;
  name: string;
  organization: string;
  avatar?: string;
  color: string;
  cursor?: { section: string; position: number };
  status: 'active' | 'idle' | 'away';
  language: 'ro' | 'en';
}

interface ChatMessage {
  id: string;
  author: string;
  authorOrg: string;
  content: string;
  originalContent?: string;
  originalLanguage?: string;
  translatedTo?: string;
  timestamp: string;
  type: 'message' | 'system' | 'file';
}

interface DocumentSection {
  id: string;
  title: string;
  content: string;
  lastEditedBy?: string;
  lastEditedAt?: string;
  lockedBy?: string;
  version: number;
}

interface GanttTask {
  id: string;
  name: string;
  workPackage: string;
  start: string;
  end: string;
  progress: number;
  assignedTo: string;
  dependencies: string[];
  status: 'on-track' | 'at-risk' | 'delayed';
}

interface DocumentChange {
  id: string;
  section: string;
  author: string;
  timestamp: string;
  type: 'add' | 'edit' | 'delete';
  summary: string;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ActiveUsersBar({ users }: { users: ActiveUser[] }) {
  return (
    <div className="flex items-center gap-2 p-2 border-b" role="status" aria-label={`${users.filter((u) => u.status === 'active').length} utilizatori activi`}>
      <span className="text-xs text-muted-foreground">Online:</span>
      <div className="flex -space-x-2">
        {users.map((user) => (
          <div key={user.id} className="relative" title={`${user.name} (${user.organization}) - ${user.language.toUpperCase()}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-background`} style={{ backgroundColor: user.color }}>
              {user.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
            </div>
            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${user.status === 'active' ? 'bg-green-500' : user.status === 'idle' ? 'bg-yellow-500' : 'bg-gray-400'}`} />
          </div>
        ))}
      </div>
      <Badge variant="secondary" className="text-xs ml-2">{users.filter((u) => u.status === 'active').length} activi</Badge>
    </div>
  );
}

function CollaborativeEditor({ sections, currentUserId, onEdit }: { sections: DocumentSection[]; currentUserId: string; onEdit: (sectionId: string, content: string) => void }) {
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const handleStartEdit = (section: DocumentSection) => {
    if (section.lockedBy && section.lockedBy !== currentUserId) return;
    setEditingSection(section.id);
    setEditContent(section.content);
  };

  const handleSave = () => {
    if (editingSection) {
      onEdit(editingSection, editContent);
      setEditingSection(null);
    }
  };

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <Card key={section.id} className={`${section.lockedBy && section.lockedBy !== currentUserId ? 'opacity-75' : ''}`}>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{section.title}</CardTitle>
              <div className="flex items-center gap-2">
                {section.lockedBy && (
                  <Badge variant="outline" className="text-xs">🔒 {section.lockedBy}</Badge>
                )}
                <span className="text-xs text-muted-foreground">v{section.version}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {editingSection === section.id ? (
              <div className="space-y-2">
                <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="min-h-[100px] font-mono text-sm" aria-label={`Editare ${section.title}`} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSave}>Salvează</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingSection(null)}>Anulează</Button>
                </div>
              </div>
            ) : (
              <div className="cursor-pointer hover:bg-accent/30 rounded p-2 transition-colors" onClick={() => handleStartEdit(section)} role="button" tabIndex={0} aria-label={`Editează secțiunea ${section.title}`} onKeyDown={(e) => e.key === 'Enter' && handleStartEdit(section)}>
                <p className="text-sm whitespace-pre-wrap">{section.content}</p>
                {section.lastEditedBy && (
                  <p className="text-xs text-muted-foreground mt-2">Editat de {section.lastEditedBy} • {section.lastEditedAt}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LiveGanttChart({ tasks }: { tasks: GanttTask[] }) {
  const statusColors: Record<string, string> = { 'on-track': 'bg-green-500', 'at-risk': 'bg-yellow-500', 'delayed': 'bg-red-500' };
  const statusLabels: Record<string, string> = { 'on-track': 'Pe drum', 'at-risk': 'La risc', 'delayed': 'Întârziat' };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Gantt Chart Interactiv</CardTitle>
        <CardDescription>Coordonare multi-utilizator a cronologiei</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 overflow-x-auto">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-3 min-w-[600px]">
              <div className="w-48 flex-shrink-0">
                <p className="text-sm font-medium truncate">{task.name}</p>
                <p className="text-xs text-muted-foreground">{task.workPackage} • {task.assignedTo}</p>
              </div>
              <div className="flex-1 h-6 bg-muted rounded relative">
                <div className={`h-full rounded ${statusColors[task.status]}`} style={{ width: `${task.progress}%`, opacity: 0.7 }}>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">{task.progress}%</span>
                </div>
              </div>
              <Badge variant={task.status === 'delayed' ? 'destructive' : task.status === 'at-risk' ? 'default' : 'secondary'} className="text-xs flex-shrink-0">
                {statusLabels[task.status]}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectChat({ messages, onSend, userLanguage }: { messages: ChatMessage[]; onSend: (msg: string) => void; userLanguage: 'ro' | 'en' }) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input);
    setInput('');
  };

  return (
    <Card className="flex flex-col h-[400px]">
      <CardHeader className="py-3 px-4 border-b">
        <CardTitle className="text-sm">Chat Proiect</CardTitle>
        <CardDescription className="text-xs">Traducere automată RO ↔ EN activă</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((msg) => (
          <div key={msg.id} className={msg.type === 'system' ? 'text-center' : ''}>
            {msg.type === 'system' ? (
              <span className="text-xs text-muted-foreground italic">{msg.content}</span>
            ) : (
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{msg.author}</span>
                  <span className="text-xs text-muted-foreground">{msg.authorOrg}</span>
                  <span className="text-xs text-muted-foreground">{msg.timestamp}</span>
                </div>
                <p className="text-sm">{msg.content}</p>
                {msg.originalContent && msg.originalLanguage !== userLanguage && (
                  <p className="text-xs text-muted-foreground italic">Original ({msg.originalLanguage?.toUpperCase()}): {msg.originalContent}</p>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </CardContent>
      <div className="p-3 border-t flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Scrieți un mesaj..." onKeyDown={(e) => e.key === 'Enter' && handleSend()} className="flex-1" aria-label="Mesaj chat" />
        <Button size="sm" onClick={handleSend}>Trimite</Button>
      </div>
    </Card>
  );
}

function VersionHistory({ changes }: { changes: DocumentChange[] }) {
  const typeIcons: Record<string, string> = { add: '➕', edit: '✏️', delete: '🗑️' };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Istoric Modificări</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {changes.map((change) => (
            <div key={change.id} className="flex items-start gap-2 p-2 rounded border text-sm">
              <span>{typeIcons[change.type]}</span>
              <div className="flex-1">
                <div className="flex justify-between">
                  <span className="font-medium">{change.author}</span>
                  <span className="text-xs text-muted-foreground">{change.timestamp}</span>
                </div>
                <p className="text-xs text-muted-foreground">{change.section}: {change.summary}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function RealTimeWorkspace({ projectId, userRole, partnerOrganizations }: RealTimeWorkspaceProps) {
  void projectId;
  void userRole;
  const [activeTab, setActiveTab] = useState('editor');
  const [userLanguage] = useState<'ro' | 'en'>('ro');

  const activeUsers: ActiveUser[] = [
    { id: '1', name: 'Maria Popescu', organization: 'UPB', color: '#3B82F6', status: 'active', language: 'ro' },
    { id: '2', name: 'Hans Mueller', organization: 'Fraunhofer', color: '#EF4444', status: 'active', language: 'en' },
    { id: '3', name: 'Sophie Duval', organization: 'INRIA', color: '#8B5CF6', status: 'idle', language: 'en' },
    { id: '4', name: 'Ion Ionescu', organization: 'ASE', color: '#10B981', status: 'active', language: 'ro' },
  ];

  const sections: DocumentSection[] = [
    { id: 's1', title: '1. Excelență', content: 'Proiectul propune o abordare inovatoare în domeniul inteligenței artificiale aplicate...', lastEditedBy: 'Maria Popescu', lastEditedAt: 'acum 5 min', version: 12 },
    { id: 's2', title: '2. Impact', content: 'Impactul proiectului se va manifesta pe multiple dimensiuni: economic, social și tehnologic...', lastEditedBy: 'Hans Mueller', lastEditedAt: 'acum 15 min', lockedBy: 'Hans Mueller', version: 8 },
    { id: 's3', title: '3. Implementare', content: 'Planul de implementare prevede 5 pachete de lucru distribuite pe 36 de luni...', version: 5 },
  ];

  const tasks: GanttTask[] = [
    { id: 't1', name: 'WP1: Management', workPackage: 'WP1', start: '2026-01-01', end: '2028-12-31', progress: 15, assignedTo: 'UPB', dependencies: [], status: 'on-track' },
    { id: 't2', name: 'WP2: Cercetare AI', workPackage: 'WP2', start: '2026-01-01', end: '2027-06-30', progress: 25, assignedTo: 'Fraunhofer', dependencies: [], status: 'on-track' },
    { id: 't3', name: 'WP3: Dezvoltare', workPackage: 'WP3', start: '2026-06-01', end: '2028-06-30', progress: 5, assignedTo: 'INRIA', dependencies: ['t2'], status: 'at-risk' },
    { id: 't4', name: 'WP4: Pilotare', workPackage: 'WP4', start: '2027-01-01', end: '2028-12-31', progress: 0, assignedTo: 'ASE', dependencies: ['t3'], status: 'delayed' },
    { id: 't5', name: 'WP5: Diseminare', workPackage: 'WP5', start: '2026-01-01', end: '2028-12-31', progress: 10, assignedTo: 'UPB', dependencies: [], status: 'on-track' },
  ];

  const chatMessages: ChatMessage[] = [
    { id: 'm1', author: 'Hans Mueller', authorOrg: 'Fraunhofer', content: 'Am actualizat secțiunea Impact cu noile KPI-uri.', originalContent: 'I updated the Impact section with new KPIs.', originalLanguage: 'en', translatedTo: 'ro', timestamp: '10:02', type: 'message' },
    { id: 'm2', author: 'Maria Popescu', authorOrg: 'UPB', content: 'Excelent! Trebuie să adăugăm și indicatorii pentru România.', timestamp: '10:05', type: 'message' },
    { id: 'm3', author: 'System', authorOrg: '', content: 'Sophie Duval s-a conectat', timestamp: '10:08', type: 'system' },
    { id: 'm4', author: 'Sophie Duval', authorOrg: 'INRIA', content: 'Am revizuit bugetul WP3, trebuie ajustat cu +15%.', originalContent: "J'ai revu le budget WP3, il faut l'ajuster de +15%.", originalLanguage: 'en', translatedTo: 'ro', timestamp: '10:10', type: 'message' },
  ];

  const changes: DocumentChange[] = [
    { id: 'c1', section: 'Impact', author: 'Hans Mueller', timestamp: '10:02', type: 'edit', summary: 'Adăugat KPI-uri cantitative' },
    { id: 'c2', section: 'Excelență', author: 'Maria Popescu', timestamp: '09:45', type: 'edit', summary: 'Revizuit obiective principale' },
    { id: 'c3', section: 'Buget WP3', author: 'Sophie Duval', timestamp: '09:30', type: 'edit', summary: 'Ajustare +15% echipamente' },
    { id: 'c4', section: 'Implementare', author: 'Ion Ionescu', timestamp: '09:15', type: 'add', summary: 'Adăugat milestone M18' },
  ];

  const handleSendMessage = useCallback((content: string) => {
    // Would send via WebSocket
    console.log('Sending message:', content);
  }, []);

  const handleEditSection = useCallback((sectionId: string, content: string) => {
    // Would sync via WebSocket
    console.log('Editing section:', sectionId, content);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Spațiu de Lucru Colaborativ</h2>
          <p className="text-muted-foreground">Editare în timp real cu traducere automată</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">🌐 Auto-traducere: RO ↔ EN</Badge>
          <Badge variant="default">{partnerOrganizations.length} organizații</Badge>
        </div>
      </div>

      <ActiveUsersBar users={activeUsers} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="editor">📝 Editor</TabsTrigger>
          <TabsTrigger value="gantt">📊 Gantt</TabsTrigger>
          <TabsTrigger value="chat">💬 Chat</TabsTrigger>
          <TabsTrigger value="history">📋 Istoric</TabsTrigger>
        </TabsList>

        <TabsContent value="editor">
          <CollaborativeEditor sections={sections} currentUserId="1" onEdit={handleEditSection} />
        </TabsContent>

        <TabsContent value="gantt">
          <LiveGanttChart tasks={tasks} />
        </TabsContent>

        <TabsContent value="chat">
          <ProjectChat messages={chatMessages} onSend={handleSendMessage} userLanguage={userLanguage} />
        </TabsContent>

        <TabsContent value="history">
          <VersionHistory changes={changes} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
