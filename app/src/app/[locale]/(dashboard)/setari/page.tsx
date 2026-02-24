'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

type UserRole = 'admin' | 'org_admin' | 'project_manager' | 'viewer';

export default function SettingsPage() {
  const [role, setRole] = useState<UserRole>('project_manager');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Setări"
        description="Personalizează setările implicite și previzualizarea navigării pe rol."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Previzualizare rol</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Schimbarea rolului actualizează vizibilitatea în bara laterală pentru aprobări și secțiuni restricționate.</p>
          <div className="flex flex-wrap gap-2">
            {(['admin', 'org_admin', 'project_manager', 'viewer'] as UserRole[]).map((item) => (
              <Button
                key={item}
                variant={item === role ? 'default' : 'outline'}
                onClick={() => {
                  setRole(item);
                  localStorage.setItem('eufund:user-role', item);
                }}
              >
                {item}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
