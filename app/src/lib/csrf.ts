export async function validateCSRFToken(
  request: NextRequest,
  sessionId: string
): Promise<boolean> {
  const headerToken = request.headers.get('X-CSRF-Token');
  const cookieToken = request.cookies.get('csrf-token')?.value;

  if (!headerToken || !cookieToken) {
    log.warn({
      hasHeader: !!headerToken,
      hasCookie: !!cookieToken,
    }, '[csrf] Token mismatch or missing');
    return false;
  }

  // SECURITY FIX: Use constant-time comparison to prevent timing attacks
  if (headerToken.length !== cookieToken.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < headerToken.length; i++) {
    mismatch |= headerToken.charCodeAt(i) ^ cookieToken.charCodeAt(i);
  }

  if (mismatch !== 0) {
    log.warn('[csrf] Token constant-time comparison failed');
    return false;
  }

  // ... existing code ...
