import type { Adapter, AdapterUser, AdapterAccount } from 'next-auth/adapters';
import { db } from '@/lib/db';
import { users, authAccounts, authVerificationTokens } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Custom NextAuth adapter that maps to our existing users table.
 * Only implements what Email + OAuth providers need (no database sessions — we use JWT).
 */
export function FondEUAdapter(): Adapter {
  return {
    async createUser(data) {
      const [user] = await db
        .insert(users)
        .values({
          email: data.email,
          fullName: data.name || data.email?.split('@')[0] || 'User',
          emailVerified: !!data.emailVerified,
          avatarUrl: data.image || undefined,
        })
        .returning();
      return toAdapterUser(user);
    },

    async getUser(id) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
      });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByEmail(email) {
      const user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await db.query.authAccounts.findFirst({
        where: and(
          eq(authAccounts.provider, provider),
          eq(authAccounts.providerAccountId, providerAccountId),
        ),
      });
      if (!account) return null;
      const user = await db.query.users.findFirst({
        where: eq(users.id, account.userId),
      });
      return user ? toAdapterUser(user) : null;
    },

    async updateUser(data) {
      if (!data.id) throw new Error('User ID required for update');
      const [user] = await db
        .update(users)
        .set({
          ...(data.name && { fullName: data.name }),
          ...(data.email && { email: data.email }),
          ...(data.emailVerified !== undefined && {
            emailVerified: !!data.emailVerified,
          }),
          ...(data.image !== undefined && { avatarUrl: data.image || undefined }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, data.id))
        .returning();
      return toAdapterUser(user);
    },

    async linkAccount(data) {
      await db.insert(authAccounts).values({
        userId: data.userId,
        type: data.type,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
        refreshToken: data.refresh_token,
        accessToken: data.access_token,
        expiresAt: data.expires_at,
        tokenType: data.token_type,
        scope: data.scope,
        idToken: data.id_token,
        sessionState: data.session_state as string | undefined,
      });
      return data as AdapterAccount;
    },

    async createVerificationToken(data) {
      await db.insert(authVerificationTokens).values({
        identifier: data.identifier,
        token: data.token,
        expires: data.expires,
      });
      return data;
    },

    async useVerificationToken({ identifier, token }) {
      const row = await db.query.authVerificationTokens.findFirst({
        where: and(
          eq(authVerificationTokens.identifier, identifier),
          eq(authVerificationTokens.token, token),
        ),
      });
      if (!row) return null;
      await db
        .delete(authVerificationTokens)
        .where(
          and(
            eq(authVerificationTokens.identifier, identifier),
            eq(authVerificationTokens.token, token),
          ),
        );
      return { identifier: row.identifier, token: row.token, expires: row.expires };
    },

    // Not needed for JWT strategy, but required by the interface
    async deleteUser() { /* no-op */ },
    async unlinkAccount() { /* no-op */ },
    async createSession() { return { sessionToken: '', userId: '', expires: new Date() }; },
    async getSessionAndUser() { return null; },
    async updateSession() { return null; },
    async deleteSession() { /* no-op */ },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAdapterUser(user: any): AdapterUser {
  return {
    id: user.id,
    email: user.email,
    name: user.fullName,
    emailVerified: user.emailVerified ? new Date() : null,
    image: user.avatarUrl || null,
  };
}
