import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { loginSchema } from '@/lib/validators';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { compare } from 'bcryptjs';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'auth' });

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });

        if (!user || !user.passwordHash) return null;

        const isValid = await compare(password, user.passwordHash);
        if (!isValid) return null;

        // Update last login
        await db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, user.id));

        return {
          id: user.id,
          email: user.email,
          name: user.fullName,
          emailVerified: user.emailVerified ?? false,
          isPlatformAdmin: user.isPlatformAdmin ?? false,
        };
      },
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
    async jwt({ token, user, trigger }) {
      if (user) {
        token.userId = user.id;
        token.emailVerified = (user as any).emailVerified ?? false;
        token.isPlatformAdmin = (user as any).isPlatformAdmin ?? false;
      }
      // Refresh flags from DB on session update
      if (trigger === 'update' && token.userId) {
        const dbUser = await db.query.users.findFirst({
          where: eq(users.id, String(token.userId)),
          columns: { emailVerified: true, isPlatformAdmin: true },
        });
        if (dbUser) {
          token.emailVerified = dbUser.emailVerified;
          token.isPlatformAdmin = dbUser.isPlatformAdmin;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        (session.user as any).id = String(token.userId);
        (session.user as any).isPlatformAdmin = !!token.isPlatformAdmin;
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
