import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { Errors } from '@/lib/errors'
import { logAudit } from '@/lib/legal/audit'

const updatePreferencesSchema = z.object({
  defaultModel: z.enum(['auto', 'claude-sonnet', 'gemini-pro', 'gpt-4o', 'perplexity']).optional(),
  responseStyle: z.enum(['concise', 'detailed', 'technical']).optional(),
  autoApprove: z.boolean().optional(),
})

export async function GET() {
  const user = await requireAuth()

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .limit(1)

  if (!prefs) {
    return NextResponse.json({
      defaultModel: 'auto',
      responseStyle: 'detailed',
      autoApprove: false,
    })
  }

  return NextResponse.json({
    defaultModel: prefs.defaultModel,
    responseStyle: prefs.responseStyle,
    autoApprove: prefs.autoApprove,
  })
}

export async function PUT(request: Request) {
  const user = await requireAuth()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Errors.validation('body', 'Format JSON invalid', 'Invalid JSON body').toResponse('ro')
  }

  const parsed = updatePreferencesSchema.safeParse(body)
  if (!parsed.success) {
    return Errors.validation('preferences', 'Preferințe invalide', 'Invalid preferences').toResponse('ro')
  }

  const { defaultModel, responseStyle, autoApprove } = parsed.data

  await db
    .insert(userPreferences)
    .values({
      userId: user.id,
      defaultModel: defaultModel || 'auto',
      responseStyle: responseStyle || 'detailed',
      autoApprove: autoApprove ?? false,
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        ...(defaultModel && { defaultModel }),
        ...(responseStyle && { responseStyle }),
        ...(autoApprove !== undefined && { autoApprove }),
        updatedAt: new Date(),
      },
    })

  await logAudit({
    userId: user.id,
    action: 'user.update_preferences',
    resourceType: 'user_preferences',
    resourceId: user.id,
    metadata: parsed.data,
  })

  return NextResponse.json({ success: true })
}
