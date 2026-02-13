import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { loginSchema } from '@/lib/validators';

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

        // TODO: Replace with actual DB lookup + bcrypt comparison
        // This is a placeholder for Phase 4A
        const { email } = parsed.data;

        // Placeholder user
        return {
          id: 'placeholder-id',
          email,
          name: 'Test User',
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
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        (session.user as any).id = token.userId;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      // TODO: Log to audit_log table
      console.log(`[AUDIT] User signed in: ${user.email}`);
    },
    async signOut(message) {
      console.log(`[AUDIT] User signed out`);
    },
  },
});
