// app/src/lib/api/agent-action-envelope.ts
//
// Converts service errors raised by action routes into UI-friendly JSON
// responses of shape:
//   { error: { code, messageRo, messageEn, ... } }
//
// Internal POLICY_* codes are mapped to UI-facing codes via POLICY_TO_UI_CODE.
// Bilingual messages are sourced from the agent.errors i18n namespace, with
// a fallback English/Romanian message when a key is not registered.

import { NextResponse } from 'next/server'
import {
  ValidationError,
  ConcurrencyError,
  NotFoundError,
  AuthorizationError,
} from '@/lib/ai/agent/services/errors'
import { getTranslations } from 'next-intl/server'
import { isFeatureEnabled } from '@/lib/feature-flags'

const POLICY_TO_UI_CODE: Record<string, string> = {
  POLICY_OUTLINE_NOT_READY: 'OUTLINE_NOT_READY',
  POLICY_OUTLINE_NOT_FROZEN: 'OUTLINE_NOT_FROZEN',
  POLICY_OUTLINE_ALREADY_FROZEN: 'OUTLINE_ALREADY_FROZEN',
  POLICY_SECTION_NOT_IN_OUTLINE: 'SECTION_NOT_IN_OUTLINE',
  POLICY_SESSION_NOT_ACTIVE: 'SESSION_NOT_ACTIVE',
  POLICY_NO_CALL_SELECTED: 'NO_CALL_SELECTED',
  POLICY_ELIGIBILITY_NOT_PASSED: 'ELIGIBILITY_NOT_PASSED',
  POLICY_SECTION_WRONG_STATE: 'SECTION_WRONG_STATE',
  POLICY_BLUEPRINT_PHASE_GATE: 'BLUEPRINT_PHASE_GATE',
}

function uiCodeFor(internal: string | undefined): string {
  if (!internal) return 'UNKNOWN'
  return POLICY_TO_UI_CODE[internal] ?? internal
}

async function getMessage(
  locale: 'ro' | 'en',
  code: string,
  fallback: string,
): Promise<string> {
  try {
    const t = await getTranslations({ locale, namespace: 'agent.errors' })
    // next-intl `t(key)` returns the key itself when the key is missing
    // (per the locale's MISSING_TRANSLATION_BEHAVIOR). Treat that as a
    // miss and fall back to the provided fallback string.
    const m = t(code)
    return m && m !== code ? m : fallback
  } catch {
    return fallback
  }
}

export async function errorToResponse(err: unknown): Promise<NextResponse> {
  if (err instanceof ValidationError) {
    const code = uiCodeFor(err.policyCode ?? err.code)
    return NextResponse.json(
      {
        error: {
          code,
          messageRo: await getMessage('ro', code, err.message),
          messageEn: await getMessage('en', code, err.message),
        },
      },
      { status: 409 },
    )
  }
  if (err instanceof ConcurrencyError) {
    return NextResponse.json(
      {
        error: {
          code: 'CONCURRENCY_CONFLICT',
          messageRo: await getMessage('ro', 'CONCURRENCY_CONFLICT', 'Cererea este învechită.'),
          messageEn: await getMessage('en', 'CONCURRENCY_CONFLICT', 'Request is stale.'),
          currentStateVersion: err.actual,
        },
      },
      { status: 409 },
    )
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          messageRo: await getMessage('ro', 'NOT_FOUND', 'Resursă inexistentă.'),
          messageEn: await getMessage('en', 'NOT_FOUND', 'Resource not found.'),
        },
      },
      { status: 404 },
    )
  }
  if (err instanceof AuthorizationError) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          messageRo: await getMessage('ro', 'FORBIDDEN', 'Acces interzis.'),
          messageEn: await getMessage('en', 'FORBIDDEN', 'Forbidden.'),
        },
      },
      { status: 403 },
    )
  }
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL',
        messageRo: 'Eroare internă.',
        messageEn: 'Internal error.',
      },
    },
    { status: 500 },
  )
}

export async function requireDeterministicActionsEnabled(
  userId: string,
): Promise<NextResponse | null> {
  const enabled = await isFeatureEnabled('deterministic_actions_enabled', {
    userId,
    bypassCache: true,
  })

  if (enabled) return null

  const code = 'DETERMINISTIC_ACTIONS_DISABLED'
  return NextResponse.json(
    {
      error: {
        code,
        messageRo: await getMessage('ro', code, 'Acțiunile deterministe nu sunt active.'),
        messageEn: await getMessage('en', code, 'Deterministic actions are not enabled.'),
      },
    },
    { status: 404 },
  )
}
