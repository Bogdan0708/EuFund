// ─── Project Files API ──────────────────────────────────────────
// GET  /api/v1/projects/[id]/files — List files for a project
// POST /api/v1/projects/[id]/files — Upload a file to a project

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, projectFiles } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/helpers';
import { putObject, buildObjectPath } from '@/lib/storage/gcs';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireAuth();
    const projectId = params.id;

    // Verify project ownership
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const files = await db
      .select({
        id: projectFiles.id,
        filename: projectFiles.filename,
        mimeType: projectFiles.mimeType,
        sizeBytes: projectFiles.sizeBytes,
        category: projectFiles.category,
        description: projectFiles.description,
        createdAt: projectFiles.createdAt,
      })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId))
      .orderBy(desc(projectFiles.createdAt));

    return NextResponse.json({ files });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireAuth();
    const projectId = params.id;

    // Verify project ownership
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const description = (formData.get('description') as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'File type not allowed. Supported: PDF, Word, Excel, PowerPoint, text, CSV, images.' },
        { status: 400 },
      );
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate storage path and upload
    const objectPath = `projects/${projectId}/${buildObjectPath(crypto.randomUUID(), file.name)}`;
    const storagePath = await putObject(objectPath, buffer, file.type);

    // Store metadata in DB
    const [record] = await db
      .insert(projectFiles)
      .values({
        projectId,
        userId: user.id,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        storagePath,
        category: 'uploaded',
        description,
      })
      .returning({
        id: projectFiles.id,
        filename: projectFiles.filename,
        mimeType: projectFiles.mimeType,
        sizeBytes: projectFiles.sizeBytes,
        category: projectFiles.category,
        createdAt: projectFiles.createdAt,
      });

    return NextResponse.json({ file: record }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
