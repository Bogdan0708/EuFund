import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/helpers'
import { runDiscovery } from '@/lib/discovery/pipeline'
import { Errors, FondEUError } from '@/lib/errors'

export async function POST() {
  try {
    // Allow Cloud Scheduler (checked by header) or platform admin
    await requirePlatformAdmin()

    const result = await runDiscovery()
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('en'), { status: error.statusCode })
    }
    return NextResponse.json(Errors.internal().toResponse('en'), { status: 500 })
  }
}
