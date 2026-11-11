import { describe, expect, it } from 'vitest';
import { renderEmailBlocks, renderEmailPreview, renderEmailText, safeEmailUrl, validateEmailBlockLinks, type EmailBlock } from './email-editor';

describe('email editor rendering', () => {
  it('previews the same responsive layout, inbox text, and unsubscribe footer used for delivery', () => {
    const html = renderEmailPreview([{ id: 1, kind: 'columns', text: 'Left', secondText: 'Right' }], '#ffffff', 'A helpful inbox preview');
    expect(html).toContain('@media only screen and (max-width:600px)');
    expect(html).toContain('A helpful inbox preview');
    expect(html).toContain('href="#unsubscribe-preview"');
    expect(html).toContain('You are receiving this because you subscribed to updates.');
  });

  it('renders an image with escaped alt text and a safe source URL', () => {
    const html = renderEmailBlocks([{ id: 1, kind: 'image', text: '<hero>', url: 'https://example.org/hero.png' }]);
    expect(html).toContain('src="https://example.org/hero.png"');
    expect(html).toContain('alt="&lt;hero&gt;"');
  });

  it('keeps invalid image URLs inert and asks the editor to resolve them', () => {
    const html = renderEmailBlocks([{ id: 1, kind: 'image', text: 'Hero', url: 'javascript:alert(1)' }]);
    expect(html).toContain('Add a safe image URL or upload an image.');
    expect(html).not.toContain('src=');
    expect(html).not.toContain('javascript:');
    expect(validateEmailBlockLinks([{ id: 1, kind: 'image', text: 'Hero', url: 'javascript:alert(1)' }])).toContain('image URL');
  });

  it('renders an incomplete button without a destination and requires one before save', () => {
    const html = renderEmailBlocks([{ id: 1, kind: 'button', text: 'Continue', url: '' }]);
    expect(html).toContain('<a style=');
    expect(html).not.toContain('<a href=');
    expect(validateEmailBlockLinks([{ id: 1, kind: 'button', text: 'Continue', url: '' }])).toContain('destination');
  });

  it('keeps image alt text plain while adding a fluid email-safe image width', () => {
    const html = renderEmailBlocks([{ id: 1, kind: 'image', text: 'Photo & <caption>\nsecond line', bold: true, italic: true, textColor: '#123abc', url: 'https://example.org/photo.png' }]);
    expect(html).toContain('width="560" alt="Photo &amp; &lt;caption&gt; second line"');
    expect(html).toContain('style="display:block;width:100%;max-width:560px;height:auto;border:0"');
    expect(html).not.toContain('alt="<strong>');
    expect(html).not.toContain('alt="<span');
  });

  it('renders two escaped, email-client-friendly table columns', () => {
    const block: EmailBlock = { id: 1, kind: 'columns', text: 'Left & <safe>', secondText: 'Right' };
    const html = renderEmailBlocks([block]);
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain('Left &amp; &lt;safe&gt;');
    expect(html).toContain('>Right</td>');
  expect((html.match(/class="repus-email-column"/g) ?? [])).toHaveLength(2);
    expect(renderEmailText([block])).toBe('Left & <safe>\nRight');
  });

  it('uses a fluid outer table, a 600px content table, and a table-based CTA', () => {
    const html = renderEmailBlocks([{ id: 1, kind: 'button', text: 'Continue', url: 'https://example.org' }]);
    expect(html).toContain('<table role="presentation" width="100%"');
    expect(html).toContain('<table role="presentation" width="600"');
    expect(html).toContain('border-collapse:collapse');
    expect(html).toContain('<td align="left" bgcolor="#2563eb"');
    expect(html).toContain('href="https://example.org/"');
  });

  it('converts user-entered newlines to HTML line breaks', () => {
    const html = renderEmailBlocks([{ id: 1, kind: 'paragraph', text: 'First\r\nSecond\nThird' }]);
    expect(html).toContain('First<br>Second<br>Third');
  });

  it('only allows HTTP and HTTPS links', () => {
    expect(safeEmailUrl('mailto:test@example.com')).toBe('');
    expect(safeEmailUrl('https://user:password@example.org/path')).toBe('');
    expect(safeEmailUrl('https://example.org/path')).toBe('https://example.org/path');
    expect(validateEmailBlockLinks([{ id: 1, kind: 'button', text: 'Continue', url: 'https://example.org/path' }])).toBeNull();
    expect(validateEmailBlockLinks([{ id: 2, kind: 'button', text: 'Continue', url: '' }])).toContain('destination');
  });

  it('includes safe call-to-action destinations in the plain-text alternative', () => {
    expect(renderEmailText([{ id: 1, kind: 'button', text: 'Read the guide', url: 'https://example.org/guide' }])).toBe('Read the guide\nhttps://example.org/guide');
    expect(renderEmailText([{ id: 2, kind: 'button', text: 'Unsafe link', url: 'javascript:alert(1)' }])).toBe('Unsafe link');
  });

  it('applies valid email background colors and rejects CSS injection', () => {
    const blocks: EmailBlock[] = [{ id: 1, kind: 'paragraph', text: 'Hello' }];
    expect(renderEmailBlocks(blocks, '#123abc')).toContain('background-color:#123abc');
    expect(renderEmailBlocks(blocks, 'red;position:fixed')).toContain('background-color:#ffffff');
  });

  it('renders accessible rich text formatting without trusting raw markup', () => {
    const html = renderEmailBlocks([{ id: 1, kind: 'paragraph', text: '<Hello>', bold: true, italic: true, textColor: '#123abc' }]);
    expect(html).toContain('<span style="color:#123abc"><em><strong>&lt;Hello&gt;</strong></em></span>');
    expect(renderEmailBlocks([{ id: 1, kind: 'paragraph', text: 'Hello', textColor: 'red;position:fixed' }])).not.toContain('position:fixed');
  });
});
