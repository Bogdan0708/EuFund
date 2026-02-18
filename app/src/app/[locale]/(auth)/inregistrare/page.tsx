'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@/lib/validators';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function RegisterPage() {
  const t = useTranslations('auth');
  const params = useParams();
  const locale = (params.locale as string) || 'ro';
  const tv = useTranslations('validation');
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState(false);

  const {
    register: reg,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterInput) => {
    setServerError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        setSuccess(true);
      } else {
        const body = await res.json();
        setServerError(body.error?.message || t('invalidCredentials'));
      }
    } catch {
      setServerError('Eroare de conexiune. Vă rugăm să încercați din nou.');
    }
  };

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <AlertTitle className="text-2xl text-green-600">✓ {t('accountCreated')}</AlertTitle>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button asChild variant="link">
              <Link href={`/${locale}/autentificare`}>{t('login')}</Link>
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-primary">{t('register')}</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('fullName')}</Label>
              <Input {...reg('fullName')} />
              {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>{t('email')}</Label>
              <Input type="email" {...reg('email')} placeholder="email@exemplu.ro" />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>{t('password')}</Label>
              <Input type="password" {...reg('password')} />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>{t('confirmPassword')}</Label>
              <Input type="password" {...reg('confirmPassword')} />
              {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>Data nașterii</Label>
              <Input type="date" {...reg('dateOfBirth')} />
              {errors.dateOfBirth && <p className="text-sm text-destructive">{errors.dateOfBirth.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>{t('phone')}</Label>
              <Input type="tel" {...reg('phone')} placeholder="+40 7XX XXX XXX" />
              {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
            </div>

            <div className="space-y-3 rounded-lg bg-muted p-4">
              <h3 className="font-medium">Consimțăminte obligatorii</h3>
              <label className="flex items-start gap-2">
                <input type="checkbox" {...reg('ageConfirmed')} className="mt-1" />
                <span className="text-sm">{t('ageConfirmation')}</span>
              </label>
              {errors.ageConfirmed && <p className="text-sm text-destructive">{errors.ageConfirmed.message}</p>}

              <label className="flex items-start gap-2">
                <input type="checkbox" {...reg('privacyConsent')} className="mt-1" />
                <span className="text-sm">{t('privacyConsent')}</span>
              </label>
              {errors.privacyConsent && <p className="text-sm text-destructive">{errors.privacyConsent.message}</p>}

              <label className="flex items-start gap-2">
                <input type="checkbox" {...reg('termsConsent')} className="mt-1" />
                <span className="text-sm">{t('termsConsent')}</span>
              </label>
              {errors.termsConsent && <p className="text-sm text-destructive">{errors.termsConsent.message}</p>}

              <label className="flex items-start gap-2">
                <input type="checkbox" {...reg('gdprConsent')} className="mt-1" />
                <span className="text-sm">{t('gdprConsent')}</span>
              </label>
              {errors.gdprConsent && <p className="text-sm text-destructive">{errors.gdprConsent.message}</p>}
            </div>

            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Se procesează...' : t('register')}
            </Button>
            <p className="text-sm text-muted-foreground">
              <Link href={`/${locale}/autentificare`} className="text-primary hover:underline">
                Ai deja cont? Autentifică-te
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
