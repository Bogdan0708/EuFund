import { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://fondeu.ro';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/panou/', '/proiecte/', '/asistent/'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
