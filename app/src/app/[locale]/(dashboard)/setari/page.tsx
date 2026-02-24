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
        title="Settings"
        description="Personalize workspace defaults and role-based navigation preview."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Changing role updates sidebar visibility for approvals and restricted sections.</p>
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
