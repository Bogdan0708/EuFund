// Edge-safe auth config — no DB imports, JWT-only session reading
// Used by middleware which runs in Edge runtime
// NOTE: No Credentials provider here — it uses eval() which is blocked in Edge.
// Middleware only reads JWT sessions, never authenticates users.
import NextAuth from 'next-auth';

export const { auth } = NextAuth({
  providers: [],  // No providers needed — middleware only reads existing JWT sessions
  callbacks: {
    jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    session({ session, token }) {
      if (token?.userId && session.user) {
        (session.user as typeof session.user & { id: string }).id = token.userId as string;
      }
      return session;
    },
  },
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/ro/autentificare',
  },
  trustHost: true,
  // MUST match cookie names from full auth config (src/lib/auth/index.ts)
  // Otherwise middleware can't read the session JWT set by the login flow
  cookies: process.env.NODE_ENV === 'production'
    ? {
        sessionToken: {
          name: '__Secure-next-auth.session-token',
          options: {
            httpOnly: true,
            sameSite: 'lax' as const,
            path: '/',
            secure: true,
          },
        },
        csrfToken: {
          name: '__Host-next-auth.csrf-token',
          options: {
            httpOnly: true,
            sameSite: 'lax' as const,
            path: '/',
            secure: true,
          },
        },
      }
    : undefined,
});
