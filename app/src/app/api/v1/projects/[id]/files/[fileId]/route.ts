// ─── Single File API ────────────────────────────────────────────
// GET    /api/v1/projects/[id]/files/[fileId] — Download file
// DELETE /api/v1/projects/[id]/files/[fileId] — Delete file

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, projectFiles } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/helpers';
import { getObjectBuffer, deleteObject, getSignedDownloadUrl } from '@/lib/storage/gcs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; fileId: string } },
) {
  try {
    const user = await requireAuth();

    // Verify project ownership and file existence
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, params.id), eq(projects.userId, user.id)))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const [file] = await db
      .select()
      .from(projectFiles)
      .where(and(
        eq(projectFiles.id, params.fileId),
        eq(projectFiles.projectId, params.id),
      ))
      .limit(1);

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Try signed URL first (for GCS)
    const signedUrl = await getSignedDownloadUrl(
      file.storagePath,
      file.filename,
      file.mimeType,
    );

    if (signedUrl) {
      return NextResponse.redirect(signedUrl);
    }

    // Fall back to direct buffer response (local storage)
    const buffer = await getObjectBuffer(file.storagePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.filename)}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; fileId: string } },
) {
  try {
    const user = await requireAuth();

    // Verify ownership
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, params.id), eq(projects.userId, user.id)))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const [file] = await db
      .select({ id: projectFiles.id, storagePath: projectFiles.storagePath })
      .from(projectFiles)
      .where(and(
        eq(projectFiles.id, params.fileId),
        eq(projectFiles.projectId, params.id),
      ))
      .limit(1);

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Delete from storage
    await deleteObject(file.storagePath);

    // Delete from DB
    await db
      .delete(projectFiles)
      .where(eq(projectFiles.id, params.fileId));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
