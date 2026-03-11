import { describe, it, expect } from 'vitest';
import { validateCrawlerUrl } from '@/lib/connectors/crawler-engine';

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

  it('blocks IPv6 loopback and unique-local ranges', () => {
    expect(() => validateCrawlerUrl('http://[::1]/')).toThrow('Blocked private/internal IP');
    expect(() => validateCrawlerUrl('http://[fc00::1]/')).toThrow('Blocked private/internal IP');
    expect(() => validateCrawlerUrl('http://[fd12:3456::1]/')).toThrow('Blocked private/internal IP');
  });

  it('blocks IPv6 link-local ranges and allows public IPv6', () => {
    expect(() => validateCrawlerUrl('http://[fe80::1]/')).toThrow('Blocked private/internal IP');
    expect(() => validateCrawlerUrl('https://[2001:4860:4860::8888]/')).not.toThrow();
  });
});
