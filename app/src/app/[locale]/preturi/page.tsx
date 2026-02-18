import { redirect } from 'next/navigation';
import { PricingPage } from '@/components/billing/pricing-page';

export default function PreturiPage({ params }: { params: { locale: string } }) {
  if (params.locale === 'en') {
    redirect('/en/pricing');
  }

  return <PricingPage locale="ro" />;
}
