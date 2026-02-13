import { NextRequest, NextResponse } from 'next/server';
import { createProjectSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createProjectSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        Errors.validation(
          firstError.path.join('.'),
          firstError.message,
          firstError.message,
        ).toResponse('ro'),
        { status: 400 },
      );
    }

    // TODO: Insert into database, log audit
    // For now, return success placeholder
    return NextResponse.json({
      success: true,
      data: {
        id: crypto.randomUUID(),
        ...parsed.data,
        status: 'ciorna',
        createdAt: new Date().toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    const err = Errors.internal();
    return NextResponse.json(err.toResponse('ro'), { status: 500 });
  }
}

export async function GET() {
  // TODO: Implement with DB query + RLS
  return NextResponse.json({
    success: true,
    data: [],
    meta: { page: 1, perPage: 20, total: 0, totalPages: 0 },
  });
}
