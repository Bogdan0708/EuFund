import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FondEU – Platforma de Finanțări Europene",
  description:
    "Platformă AI pentru pregătirea cererilor de finanțare europeană pentru organizații din România.",
  openGraph: {
    title: "FondEU – Platforma de Finanțări Europene",
    description:
      "Platformă AI pentru pregătirea cererilor de finanțare europeană pentru organizații din România.",
    url: "https://fondeu.ro",
    siteName: "FondEU",
    locale: "ro_RO",
    type: "website",
    images: [
      {
        url: "https://fondeu.ro/og-image.png",
        width: 1200,
        height: 630,
        alt: "FondEU – Finanțări Europene",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FondEU – Platforma de Finanțări Europene",
    description:
      "Platformă AI pentru pregătirea cererilor de finanțare europeană.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
