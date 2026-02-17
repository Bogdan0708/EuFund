// Edge-safe auth config — no DB imports, JWT-only session reading
// Used by middleware which runs in Edge runtime
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

export const { auth } = NextAuth({
  providers: [
    // Minimal credentials provider — actual auth happens in the full config
    // This is only for Edge-compatible JWT session reading
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize() {
        return null; // Never called in middleware — just for type compat
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token?.id && session.user) {
        (session.user as typeof session.user & { id: string }).id = token.id as string;
      }
      return session;
    },
  },
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/ro/autentificare',
  },
});
