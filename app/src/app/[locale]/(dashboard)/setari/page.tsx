'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

type UserRole = 'admin' | 'org_admin' | 'project_manager' | 'viewer';

interface ConsentRecord {
  id: string;
  consentType: string;
  status: string;
  version: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
}

const CONSENT_LABELS: Record<string, string> = {
  privacy_policy: 'Politica de confidențialitate',
  terms_of_service: 'Termeni și condiții',
  data_processing: 'Prelucrarea datelor',
  marketing: 'Comunicări marketing',
  analytics: 'Analize și statistici',
};

export default function SettingsPage() {
  const [role, setRole] = useState<UserRole>('project_manager');
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  const loadConsents = useCallback(async () => {
    try {
      const csrfToken = document.cookie
        .split('; ')
        .find((c) => c.startsWith('csrf-token='))
        ?.split('=')[1];

      const res = await fetch('/api/auth/consent', {
        headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setConsents(data.data ?? []);
      }
    } catch {
      // Silently fail — user can retry
    }
  }, []);

  useEffect(() => {
    loadConsents();
  }, [loadConsents]);

  async function handleWithdraw(consentType: string) {
    setWithdrawing(consentType);
    try {
      const csrfToken = document.cookie
        .split('; ')
        .find((c) => c.startsWith('csrf-token='))
        ?.split('=')[1];

      const res = await fetch('/api/auth/consent', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({ consentType }),
      });

      if (res.ok) {
        await loadConsents();
      }
    } finally {
      setWithdrawing(null);
    }
  }

  const withdrawable = ['marketing', 'analytics'];
  const activeConsents = consents.filter((c) => c.status === 'granted');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Setări"
        description="Personalizează setările implicite și gestionează consimțământurile GDPR."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Previzualizare rol</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Schimbarea rolului actualizează vizibilitatea în bara laterală pentru aprobări și secțiuni restricționate.
          </p>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consimțământuri GDPR</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Gestionați consimțământurile pentru prelucrarea datelor personale. Consimțământurile obligatorii
            (politica de confidențialitate, termeni) nu pot fi retrase fără ștergerea contului.
          </p>

          {activeConsents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Niciun consimțământ activ înregistrat.</p>
          ) : (
            <ul className="space-y-2">
              {activeConsents.map((consent) => (
                <li key={consent.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {CONSENT_LABELS[consent.consentType] ?? consent.consentType}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Acordat: {consent.grantedAt ? new Date(consent.grantedAt).toLocaleDateString('ro-RO') : '—'}
                      {' • '}Versiunea: {consent.version}
                    </p>
                  </div>
                  {withdrawable.includes(consent.consentType) && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={withdrawing === consent.consentType}
                      onClick={() => handleWithdraw(consent.consentType)}
                    >
                      {withdrawing === consent.consentType ? 'Se retrage...' : 'Retrage'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
