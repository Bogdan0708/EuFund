// ── MCP JWT Auth ─────────────────────────────────────────────────────────────
// Edge-compatible JWT sign/verify for MCP transport tokens.
// Uses the `jose` library (no Node crypto dependency).

import { SignJWT, jwtVerify } from 'jose'

// ── Payload ───────────────────────────────────────────────────────────────────

export interface McpTokenPayload {
  userId: string
  sessionId: string
  organizationId: string
  projectId?: string
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class McpAuthError extends Error {
  readonly httpStatus = 401

  constructor(message: string) {
    super(message)
    this.name = 'McpAuthError'
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSecret(): Uint8Array {
  const secret = process.env.MCP_TOKEN_SECRET
  if (!secret) {
    throw new McpAuthError('MCP_TOKEN_SECRET is not configured')
  }
  return new TextEncoder().encode(secret)
}

// ── Sign ──────────────────────────────────────────────────────────────────────

export async function signMcpToken(payload: McpTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('4h')
    .sign(getSecret())
}

// ── Verify ────────────────────────────────────────────────────────────────────

export async function verifyMcpToken(authHeader: string | null): Promise<McpTokenPayload> {
  if (!authHeader) {
    throw new McpAuthError('Missing Authorization header')
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new McpAuthError('Authorization header must use Bearer scheme')
  }

  const token = authHeader.slice('Bearer '.length)

  try {
    const { payload } = await jwtVerify(token, getSecret())

    const { userId, sessionId, organizationId, projectId } = payload as Record<string, unknown>

    if (typeof userId !== 'string' || !userId) {
      throw new McpAuthError('Token missing userId claim')
    }
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new McpAuthError('Token missing sessionId claim')
    }
    if (typeof organizationId !== 'string' || !organizationId) {
      throw new McpAuthError('Token missing organizationId claim')
    }

    return {
      userId,
      sessionId,
      organizationId,
      ...(typeof projectId === 'string' ? { projectId } : {}),
    }
  } catch (err) {
    if (err instanceof McpAuthError) throw err
    throw new McpAuthError(`Invalid or expired MCP token: ${(err as Error).message}`)
  }
}
