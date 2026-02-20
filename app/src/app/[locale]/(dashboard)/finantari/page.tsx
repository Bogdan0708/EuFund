import { redirect } from 'next/navigation';

export default function FinantariPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  redirect(`/${locale}/finantari/live`);
}
