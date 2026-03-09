import { redirect } from 'next/navigation';

export default async function BillingSuccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const targetLocale = locale === 'en' ? 'en' : 'ro';
  redirect(`/${targetLocale}/billing?checkout=success`);
}
