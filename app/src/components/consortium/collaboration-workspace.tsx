'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SharedDocument {
  id: string;
  name: string;
  type: string;
  uploadedBy: string;
  uploadedAt: string;
  size: string;
  workPackageId?: string;
  accessLevel: 'all' | 'coordinators' | 'restricted';
}

interface DiscussionThread {
  id: string;
  title: string;
  workPackageId?: string;
  workPackageName?: string;
  author: string;
  createdAt: string;
  lastReplyAt: string;
  replyCount: number;
  resolved: boolean;
}

interface Meeting {
  id: string;
  title: string;
  date: string;
  duration: string;
  attendees: string[];
  notes?: string;
  status: 'scheduled' | 'completed' | 'cancelled';
}

interface Decision {
  id: string;
  title: string;
  description: string;
  decidedAt: string;
  decidedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  relatedWorkPackage?: string;
}

interface Notification {
  id: string;
  type: 'info' | 'warning' | 'action';
  message: string;
  date: string;
  read: boolean;
}

interface CollaborationWorkspaceProps {
  documents?: SharedDocument[];
  discussions?: DiscussionThread[];
  meetings?: Meeting[];
  decisions?: Decision[];
  notifications?: Notification[];
  onUploadDocument?: () => void;
  onCreateThread?: (title: string, content: string) => void;
  onScheduleMeeting?: () => void;
}

export function CollaborationWorkspace({
  documents = [], discussions = [], meetings = [], decisions = [], notifications = [],
  onUploadDocument, onCreateThread, onScheduleMeeting,
}: CollaborationWorkspaceProps) {
  const [activeTab, setActiveTab] = useState('documents');
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadContent, setNewThreadContent] = useState('');
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Spațiu de Colaborare</h2>
        {unreadCount > 0 && (
          <Badge variant="destructive">{unreadCount} notificări noi</Badge>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="documents">📄 Documente ({documents.length})</TabsTrigger>
          <TabsTrigger value="discussions">💬 Discuții ({discussions.length})</TabsTrigger>
          <TabsTrigger value="meetings">📅 Întâlniri ({meetings.length})</TabsTrigger>
          <TabsTrigger value="decisions">⚖️ Decizii ({decisions.length})</TabsTrigger>
          <TabsTrigger value="notifications">
            🔔 Notificări {unreadCount > 0 && `(${unreadCount})`}
          </TabsTrigger>
        </TabsList>

        {/* Documents */}
        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Bibliotecă de Documente</CardTitle>
              {onUploadDocument && (
                <Button size="sm" onClick={onUploadDocument}>📤 Încarcă</Button>
              )}
            </CardHeader>
            <CardContent>
              {documents.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Niciun document partajat.</p>
              ) : (
                <div className="space-y-2">
                  {documents.map(doc => (
                    <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                      <span className="text-xl">
                        {doc.type === 'pdf' ? '📕' : doc.type === 'xlsx' ? '📊' : doc.type === 'docx' ? '📝' : '📄'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {doc.uploadedBy} · {new Date(doc.uploadedAt).toLocaleDateString('ro-RO')} · {doc.size}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {doc.accessLevel === 'all' ? 'Toți' : doc.accessLevel === 'coordinators' ? 'Coord.' : 'Restricționat'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Discussions */}
        <TabsContent value="discussions" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Discuție nouă</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input
                placeholder="Titlul discuției..."
                value={newThreadTitle}
                onChange={e => setNewThreadTitle(e.target.value)}
              />
              <Textarea
                placeholder="Mesajul..."
                value={newThreadContent}
                onChange={e => setNewThreadContent(e.target.value)}
                rows={3}
              />
              <Button
                size="sm"
                disabled={!newThreadTitle.trim()}
                onClick={() => {
                  onCreateThread?.(newThreadTitle, newThreadContent);
                  setNewThreadTitle('');
                  setNewThreadContent('');
                }}
              >
                Publică
              </Button>
            </CardContent>
          </Card>
          {discussions.map(thread => (
            <Card key={thread.id} className="cursor-pointer hover:shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-sm">{thread.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {thread.author} · {new Date(thread.createdAt).toLocaleDateString('ro-RO')}
                      {thread.workPackageName && ` · WP: ${thread.workPackageName}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">💬 {thread.replyCount}</span>
                    {thread.resolved && <Badge variant="secondary" className="text-[10px]">Rezolvat</Badge>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Meetings */}
        <TabsContent value="meetings" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Întâlniri</CardTitle>
              {onScheduleMeeting && (
                <Button size="sm" onClick={onScheduleMeeting}>📅 Programează</Button>
              )}
            </CardHeader>
            <CardContent>
              {meetings.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nicio întâlnire programată.</p>
              ) : (
                <div className="space-y-3">
                  {meetings
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map(m => (
                      <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border">
                        <div className={`w-2 h-2 rounded-full ${
                          m.status === 'scheduled' ? 'bg-blue-500' :
                          m.status === 'completed' ? 'bg-green-500' : 'bg-gray-400'
                        }`} />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{m.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(m.date).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                            · {m.duration} · {m.attendees.length} participanți
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {m.status === 'scheduled' ? 'Programat' : m.status === 'completed' ? 'Finalizat' : 'Anulat'}
                        </Badge>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Decisions */}
        <TabsContent value="decisions" className="mt-4">
          <Card>
            <CardContent className="p-6">
              {decisions.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nicio decizie înregistrată.</p>
              ) : (
                <div className="space-y-3">
                  {decisions.map(d => (
                    <div key={d.id} className="p-3 rounded-lg border">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium">{d.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">{d.description}</p>
                        </div>
                        <Badge variant={d.status === 'approved' ? 'default' : d.status === 'rejected' ? 'destructive' : 'outline'}>
                          {d.status === 'approved' ? 'Aprobat' : d.status === 'rejected' ? 'Respins' : 'În așteptare'}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">
                        {d.decidedBy} · {new Date(d.decidedAt).toLocaleDateString('ro-RO')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications" className="mt-4">
          <Card>
            <CardContent className="p-6">
              {notifications.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nicio notificare.</p>
              ) : (
                <div className="space-y-2">
                  {notifications
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map(n => (
                      <div key={n.id} className={`flex gap-3 p-3 rounded-lg border ${!n.read ? 'bg-primary/5' : ''}`}>
                        <span className="text-lg">
                          {n.type === 'warning' ? '⚠️' : n.type === 'action' ? '🔔' : 'ℹ️'}
                        </span>
                        <div className="flex-1">
                          <p className={`text-sm ${!n.read ? 'font-medium' : ''}`}>{n.message}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(n.date).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-primary mt-1.5" />}
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
