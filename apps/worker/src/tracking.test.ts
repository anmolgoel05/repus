import { describe, expect, it } from 'vitest';
import { decryptToken } from '@repus/token-security';
import { campaignTrackingUrls, instrumentTrackingHtml, instrumentTrackingText } from './tracking';

it('builds one unsubscribe path from a tracking origin with a trailing slash',()=>{
  expect(campaignTrackingUrls('https://track.test/','token')).toEqual({
    trackingBase:'https://track.test',unsubscribeUrl:'https://track.test/unsubscribe/token',
  });
});

const secret = 'repus-unit-test-secret-at-least-32-chars';

describe('email tracking markup', () => {
  it('creates opaque click and open capabilities for sanitized campaign links', () => {
    const html = instrumentTrackingHtml('<html><body><a href="https://example.test/path?a=1&amp;b=2">Shop</a></body></html>', 'tenant-id', 'recipient-id', 'https://track.example.test', secret);
    const clickToken = html.match(/\/t\/click\/([A-Za-z0-9_-]+)/)?.[1];
    const openToken = html.match(/\/t\/open\/([A-Za-z0-9_-]+)/)?.[1];
    expect(clickToken).toBeTruthy();
    expect(openToken).toBeTruthy();
    expect(decryptToken(clickToken!, secret)).toContain('https://example.test/path?a=1&b=2');
    expect(decryptToken(openToken!, secret)).toContain('"kind":"open"');
    expect(html).not.toContain('tenant-id');
    expect(html).not.toContain('recipient-id');
  });

  it('leaves Repus unsubscribe capabilities direct, tracks other unsubscribe paths, and excludes unsafe schemes', () => {
    const html = instrumentTrackingHtml('<a href="https://track.test/unsubscribe/token">Unsubscribe</a><a href="https://track.test/unsubscribe/token/extra">Nested</a><a href="/unsubscribe/preferences">Relative</a><a href="https://ok.test/unsubscribe/guide">Guide</a><a href="javascript:alert(1)">Unsafe</a><a href="https://ok.test">Safe</a>', 't', 'r', 'https://track.test', secret);
    expect(html).toContain('href="https://track.test/unsubscribe/token"');
    expect(html).not.toContain('href="https://track.test/unsubscribe/token/extra"');
    expect(html).toContain('href="/unsubscribe/preferences"');
    expect(html).not.toContain('href="https://ok.test/unsubscribe/guide"');
    expect(html).toContain('href="javascript:alert(1)"');
    expect(html.match(/\/t\/click\/[A-Za-z0-9_-]+/g)).toHaveLength(3);
  });

  it('rewrites only the real href and leaves inert attributes and comments intact', () => {
    const comment = '<!-- <a href="https://hidden.test">Hidden</a> -->';
    const attributes = `data-href="https://decoy.test" title='More > href="https://other.test"'`;
    const html = instrumentTrackingHtml(`${comment}<a ${attributes} HREF=https://real.test/path>Read</a>`, 't', 'r', 'https://track.test', secret);
    expect(html).toContain(comment);
    expect(html).toContain(attributes);
    const tokens = [...html.matchAll(/\/t\/click\/([A-Za-z0-9_-]+)/g)];
    expect(tokens).toHaveLength(1);
    expect(JSON.parse(decryptToken(tokens[0][1], secret)).target).toBe('https://real.test/path');
  });

  it('decodes escaped destinations once, including numeric character references', () => {
    const html = instrumentTrackingHtml('<a href="https://example.test/?a=1&#38;b=&amp;quot;">Read</a>', 't', 'r', 'https://track.test', secret);
    const token = html.match(/\/t\/click\/([A-Za-z0-9_-]+)/)![1];
    expect(JSON.parse(decryptToken(token, secret)).target).toBe('https://example.test/?a=1&b=&quot;');
  });

  it('tracks external unsubscribe-like paths while preserving the Repus capability and punctuation', () => {
    const text = instrumentTrackingText('Visit https://example.test/page. Unsubscribe: https://track.test/unsubscribe/token. Guide: https://example.test/unsubscribe/guide', 't', 'r', 'https://track.test', secret);
    expect(text).toMatch(/https:\/\/track\.test\/t\/click\/[A-Za-z0-9_-]+\./);
    expect(text).toContain('Unsubscribe: https://track.test/unsubscribe/token.');
    expect(text).not.toContain('https://example.test/unsubscribe/guide');
  });

  it('preserves balanced URL delimiters and leaves surrounding prose outside the tracked link', () => {
    const text = instrumentTrackingText('Read (https://example.test/wiki/Repus_(software)). Then [https://example.test/?a=[b]].', 't', 'r', 'https://track.test', secret);
    const tokens = [...text.matchAll(/\/t\/click\/([A-Za-z0-9_-]+)([)\]]\.)/g)];
    expect(tokens.map(([, token, punctuation]) => [JSON.parse(decryptToken(token, secret)).target, punctuation])).toEqual([
      ['https://example.test/wiki/Repus_(software)', ').'],
      ['https://example.test/?a=[b]', '].'],
    ]);
  });
});
