import { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://fondeu.ro';

export default function sitemap(): MetadataRoute.Sitemap {
  const locales = ['ro', 'en'];
  const pages = [
    '',
    '/finantari',
    '/finantari/live',
    '/finantari/potriviri',
    '/preturi',
    '/autentificare',
    '/inregistrare',
  ];

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    for (const page of pages) {
      entries.push({
        url: `${BASE_URL}/${locale}${page}`,
        lastModified: new Date(),
        changeFrequency: page === '' ? 'daily' : 'weekly',
        priority: page === '' ? 1 : 0.8,
      });
    }
  }

  return entries;
}
