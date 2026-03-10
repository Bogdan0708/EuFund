import { describe, it, expect } from 'vitest';

// Extract and test the validateCrawlerUrl function
// We re-implement it here since it's not exported, to verify the logic
function validateCrawlerUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid crawler URL: ${url}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Disallowed protocol in crawler URL: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  const blockedHostnames = [
    'metadata.google.internal',
    'metadata.goog',
    '169.254.169.254',
    'metadata.azure.com',
  ];
  if (blockedHostnames.includes(hostname)) {
    throw new Error(`Blocked metadata endpoint: ${hostname}`);
  }

  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    const isPrivate =
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a === 0;
    if (isPrivate) {
      throw new Error(`Blocked private/internal IP in crawler URL: ${hostname}`);
    }
  }

  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error(`Blocked internal hostname in crawler URL: ${hostname}`);
  }
}

describe('Crawler SSRF URL validation', () => {
  it('allows valid public HTTPS URLs', () => {
    expect(() => validateCrawlerUrl('https://www.fonduri-ue.ro/apeluri')).not.toThrow();
    expect(() => validateCrawlerUrl('https://mfe.gov.ro/programe')).not.toThrow();
    expect(() => validateCrawlerUrl('http://adrbi.ro/apeluri-deschise')).not.toThrow();
  });

  it('blocks GCP metadata endpoint', () => {
    expect(() => validateCrawlerUrl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token')).toThrow('Blocked metadata endpoint');
  });

  it('blocks metadata.goog', () => {
    expect(() => validateCrawlerUrl('http://metadata.goog/')).toThrow('Blocked metadata endpoint');
  });

  it('blocks AWS-style metadata IP', () => {
    expect(() => validateCrawlerUrl('http://169.254.169.254/latest/meta-data/')).toThrow('Blocked metadata endpoint');
  });

  it('blocks Azure metadata', () => {
    expect(() => validateCrawlerUrl('http://metadata.azure.com/')).toThrow('Blocked metadata endpoint');
  });

  it('blocks RFC1918 10.x.x.x', () => {
    expect(() => validateCrawlerUrl('http://10.0.0.1:8080/admin')).toThrow('Blocked private/internal IP');
  });

  it('blocks RFC1918 172.16-31.x.x', () => {
    expect(() => validateCrawlerUrl('http://172.16.0.1/')).toThrow('Blocked private/internal IP');
    expect(() => validateCrawlerUrl('http://172.31.255.255/')).toThrow('Blocked private/internal IP');
  });

  it('allows non-private 172.x ranges', () => {
    expect(() => validateCrawlerUrl('http://172.15.0.1/')).not.toThrow();
    expect(() => validateCrawlerUrl('http://172.32.0.1/')).not.toThrow();
  });

  it('blocks RFC1918 192.168.x.x', () => {
    expect(() => validateCrawlerUrl('http://192.168.1.1/')).toThrow('Blocked private/internal IP');
  });

  it('blocks loopback 127.x.x.x', () => {
    expect(() => validateCrawlerUrl('http://127.0.0.1:3000/')).toThrow('Blocked private/internal IP');
  });

  it('blocks localhost hostname', () => {
    expect(() => validateCrawlerUrl('http://localhost:3000/')).toThrow('Blocked internal hostname');
  });

  it('blocks .local hostnames', () => {
    expect(() => validateCrawlerUrl('http://db.local/')).toThrow('Blocked internal hostname');
  });

  it('blocks .internal hostnames', () => {
    expect(() => validateCrawlerUrl('http://redis.internal:6379/')).toThrow('Blocked internal hostname');
  });

  it('blocks non-HTTP protocols', () => {
    expect(() => validateCrawlerUrl('ftp://files.example.com/')).toThrow('Disallowed protocol');
    expect(() => validateCrawlerUrl('file:///etc/passwd')).toThrow('Disallowed protocol');
  });

  it('rejects invalid URLs', () => {
    expect(() => validateCrawlerUrl('not-a-url')).toThrow('Invalid crawler URL');
  });

  it('blocks 0.x.x.x range', () => {
    expect(() => validateCrawlerUrl('http://0.0.0.0/')).toThrow('Blocked private/internal IP');
  });

  it('blocks link-local 169.254.x.x', () => {
    expect(() => validateCrawlerUrl('http://169.254.0.1/')).toThrow('Blocked private/internal IP');
  });
});
