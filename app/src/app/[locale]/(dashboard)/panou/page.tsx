import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import RomanianMarketIntelligenceWidget from '@/components/ai/RomanianMarketIntelligenceWidget';

export default function DashboardPage() {
  const t = useTranslations();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('nav.dashboard')}</h1>
        <Button asChild>
          <Link href="/ro/proiecte/nou">{t('project.create')}</Link>
        </Button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('nav.projects')}</CardDescription>
            <CardTitle className="text-3xl">0</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('grants.available')}</CardDescription>
            <CardTitle className="text-3xl">0</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('nav.documents')}</CardDescription>
            <CardTitle className="text-3xl">0</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('compliance.score')}</CardDescription>
            <CardTitle className="text-3xl">—</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Acțiuni rapide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/ro/proiecte/nou">📁 {t('project.create')}</Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/ro/proiecte/genereaza">🤖 Generează propunere AI</Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/ro/finantari/potriviri">🎯 Caută finanțări potrivite</Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/ro/documente/incarca">📄 Încarcă document</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Proiecte recente</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Nu aveți proiecte încă. Creați primul proiect pentru a începe.
            </p>
          </CardContent>
        </Card>

        <RomanianMarketIntelligenceWidget />
      </div>
    </div>
  );
}
