import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function HomePage() {
  const t = useTranslations();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-4xl text-center">
        <h1 className="mb-2 text-5xl font-bold text-primary">
          🇪🇺 FondEU
        </h1>
        <Badge variant="secondary" className="mb-6">Platformă AI pentru Finanțări Europene</Badge>
        <p className="mb-8 text-lg text-muted-foreground max-w-2xl mx-auto">
          Platformă inteligentă pentru pregătirea cererilor de finanțare europeană.
          Verificare automată a conformității, generare de propuneri și potrivire cu apeluri de proiecte.
        </p>
        <div className="flex gap-4 justify-center mb-12">
          <Button asChild size="lg">
            <Link href="/ro/autentificare">{t('auth.login')}</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/ro/inregistrare">{t('auth.register')}</Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">🤖 Generare AI</CardTitle>
              <CardDescription>Propuneri de proiect generate automat pe baza ghidului solicitantului</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">✅ Conformitate</CardTitle>
              <CardDescription>Verificare automată a eligibilității și conformității cu cerințele UE</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">🎯 Potrivire Granturi</CardTitle>
              <CardDescription>Identificarea automată a apelurilor de finanțare potrivite organizației</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </main>
  );
}
