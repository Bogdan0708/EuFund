import { auth } from '@/lib/auth'
import { ProfileCard } from '@/components/settings/ProfileCard'
import { AIPreferencesCard } from '@/components/settings/AIPreferencesCard'
import { SubscriptionCard } from '@/components/settings/SubscriptionCard'
import { PrivacyCard } from '@/components/settings/PrivacyCard'
import { getTranslations } from 'next-intl/server'

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user) return null

  const t = await getTranslations('settings')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('title')}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ProfileCard user={{ name: session.user.name, email: session.user.email }} />
        <AIPreferencesCard />
        <SubscriptionCard tier={(session.user as { tier?: string }).tier || 'free'} />
        <PrivacyCard />
      </div>
    </div>
  )
}
