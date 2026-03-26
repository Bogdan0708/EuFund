import NextAuth from 'next-auth';
import Apple from 'next-auth/providers/apple';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import Facebook from 'next-auth/providers/facebook';
import EmailProvider from 'next-auth/providers/email';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { FondEUAdapter } from './adapter';

const log = logger.child({ component: 'auth' });

type SessionUserClaims = {
  id?: string;
  isPlatformAdmin?: boolean;
};

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  adapter: FondEUAdapter(),
  providers: [
    Apple({
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    MicrosoftEntraID({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    Facebook({
      clientId: process.env.FACEBOOK_CLIENT_ID!,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    EmailProvider({
      server: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM || 'noreply@platformafinantare.eu',
    }),
  ],
  pages: {
    signIn: '/ro/autentificare',
    error: '/ro/autentificare',
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  callbacks: {
    async signIn({ user, account }) {
      // For OAuth providers, link to existing user by email if one exists
      if (account?.type === 'oauth' && user.email) {
        const existing = await db.query.users.findFirst({
          where: eq(users.email, user.email),
        });
        if (existing) {
          user.id = existing.id;
        }
      }
      return true;
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        token.userId = user.id;
        // Look up actual DB flags (adapter gives us NextAuth-shaped user, not our full model)
        if (user.id) {
          const dbUser = await db.query.users.findFirst({
            where: eq(users.id, user.id),
            columns: { emailVerified: true, isPlatformAdmin: true, onboardingCompleted: true },
          });
          if (dbUser) {
            token.emailVerified = dbUser.emailVerified;
            token.isPlatformAdmin = dbUser.isPlatformAdmin;
            token.onboardingCompleted = dbUser.onboardingCompleted ?? false;
          }
        }
      }
      // Refresh flags from DB on session update
      if (trigger === 'update' && token.userId) {
        const dbUser = await db.query.users.findFirst({
          where: eq(users.id, String(token.userId)),
          columns: { emailVerified: true, isPlatformAdmin: true, onboardingCompleted: true },
        });
        if (dbUser) {
          token.emailVerified = dbUser.emailVerified;
          token.isPlatformAdmin = dbUser.isPlatformAdmin;
          token.onboardingCompleted = dbUser.onboardingCompleted ?? false;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        const sessionUser = session.user as SessionUserClaims;
        sessionUser.id = String(token.userId);
        sessionUser.isPlatformAdmin = !!token.isPlatformAdmin;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      log.info(`[AUDIT] User signed in: ${user.email}`);
    },
    async signOut() {
      log.info(`[AUDIT] User signed out`);
    },
  },
  trustHost: true,
  cookies: process.env.NODE_ENV === 'production'
    ? {
        sessionToken: {
          name: '__Secure-next-auth.session-token',
          options: {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secure: true,
          },
        },
        csrfToken: {
          name: '__Host-next-auth.csrf-token',
          options: {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secure: true,
          },
        },
      }
    : undefined, // Use next-auth defaults in dev (no __Secure/__Host prefixes over HTTP)
});
