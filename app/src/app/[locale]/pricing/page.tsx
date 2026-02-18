import { redirect } from 'next/navigation';
import { PricingPage } from '@/components/billing/pricing-page';

export default function PricingLocalizedPage({ params }: { params: { locale: string } }) {
  if (params.locale === 'ro') {
    redirect('/ro/preturi');
  }

  return <PricingPage locale="en" />;
}
