// ─── Root Layout with CSP Nonce Support ─────────────────────────
// Example showing how to integrate nonces for inline scripts/styles

import type { Metadata } from "next";
import localFont from "next/font/local";
import { getNonce } from "@/lib/security/nonce";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "EU Funding Platform",
  description: "Intelligent grant proposal generation and compliance checking",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Get CSP nonce for this request
  const nonce = await getNonce();

  return (
    <html lang="en">
      <head>
        {/* Example: Inline script with nonce */}
        {nonce && (
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `
                // Analytics or critical initialization scripts
                console.log('App initialized with CSP nonce');
              `,
            }}
          />
        )}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        
        {/* Example: Inline style with nonce (if needed) */}
        {nonce && (
          <style nonce={nonce}>
            {`
              /* Critical CSS that must be inline */
            `}
          </style>
        )}
      </body>
    </html>
  );
}
