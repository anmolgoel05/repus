import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { normalizeTemplateEditorJson, sanitizeEmailHtml } from './templates';

const db=vi.hoisted(()=>({template:{findFirst:vi.fn()}}));
vi.mock('@repus/database',()=>({prisma:db}));
import {TemplatesService} from './templates';

describe('template editor JSON', () => {
  it('normalizes supported blocks and ignores extra client properties', () => {
    expect(normalizeTemplateEditorJson({ version: 1, extra: true, blocks: [{ id: 900, kind: 'columns', text: 'Left', secondText: 'Right', extra: 'discard' }, { kind: 'image', text: 'Alt', assetId: '123e4567-e89b-12d3-a456-426614174001' }] })).toEqual({
      version: 1,
      blocks: [{ id: 1, kind: 'columns', text: 'Left', secondText: 'Right' }, { id: 2, kind: 'image', text: 'Alt', assetId: '123e4567-e89b-12d3-a456-426614174001' }],
    });
  });

  it('preserves a validated background color in version 2 editor data', () => {
    expect(normalizeTemplateEditorJson({ version: 2, backgroundColor: '#123abc', blocks: [{ kind: 'paragraph', text: 'Hello', bold: true, italic: false, textColor: '#aabbcc' }] })).toEqual({
      version: 2,
      backgroundColor: '#123abc',
      blocks: [{ id: 1, kind: 'paragraph', text: 'Hello', bold: true, italic: false, textColor: '#aabbcc' }],
    });
    expect(() => normalizeTemplateEditorJson({ version: 2, backgroundColor: 'red;position:fixed', blocks: [] })).toThrow(BadRequestException);
    expect(() => normalizeTemplateEditorJson({ version: 2, blocks: [{ kind: 'paragraph', text: 'Hello', bold: 'yes' }] })).toThrow(BadRequestException);
    expect(() => normalizeTemplateEditorJson({ version: 2, blocks: [{ kind: 'paragraph', text: 'Hello', textColor: 'red' }] })).toThrow(BadRequestException);
  });

  it('keeps safe email layout styles and strips executable or layout-breaking CSS', () => {
    const html = sanitizeEmailHtml('<div style="color:#17243b;position:fixed;background-image:url(javascript:alert(1))"><p style="font-size:16px;line-height:1.7">Hello</p><a style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:12px 18px">Read more</a></div>');
    expect(html).toContain('color:#17243b');
    expect(html).toContain('font-size:16px');
    expect(html).toContain('line-height:1.7');
    expect(html).toContain('background:#2563eb');
    expect(html).not.toMatch(/position|background-image|javascript:/i);
  });

  it('preserves presentation-table semantics and safe email table layout', () => {
    const html = sanitizeEmailHtml('<table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;border:0;border-collapse:collapse"><tr><td role="presentation" align="center" style="padding:12px 18px">Continue</td></tr></table>');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('width="600"');
    expect(html).toContain('cellpadding="0"');
    expect(html).toContain('border-collapse:collapse');
    expect(html).not.toMatch(/position|javascript:/i);
  });

  it('preserves responsive image sizing while removing an unsafe source URL', () => {
    const html = sanitizeEmailHtml('<img src="https://example.org/hero.png" width="560" alt="Hero &amp; team" style="display:block;width:100%;max-width:560px;height:auto;border:0">');
    expect(html).toContain('src="https://example.org/hero.png"');
    expect(html).toContain('width="560"');
    expect(html).toContain('display:block');
    expect(html).toContain('width:100%');
    expect(html).toContain('max-width:560px');
    expect(html).toContain('height:auto');
    const unsafe = sanitizeEmailHtml('<img src="javascript:alert(1)" width="560" alt="Hero">');
    expect(unsafe).not.toContain('javascript:');
    expect(unsafe).not.toContain('src=');
  });

  it('removes credential-bearing URLs from API-submitted links and images', () => {
    const html = sanitizeEmailHtml('<a href="https://reader:secret@example.org/read">Read</a><img src="https://user:pass@example.org/pixel.png" alt="Pixel"><a href="https://example.org/safe">Safe</a>');
    expect(html).not.toMatch(/reader:secret|user:pass/);
    expect(html).not.toContain('href="https://reader:secret@example.org/read"');
    expect(html).not.toContain('src="https://user:pass@example.org/pixel.png"');
    expect(html).toContain('href="https://example.org/safe"');
  });

  it('rejects unsupported formats and block kinds', () => {
    expect(() => normalizeTemplateEditorJson({ version: 3, blocks: [] })).toThrow(BadRequestException);
    expect(() => normalizeTemplateEditorJson({ version: 1, blocks: [{ kind: 'script', text: 'bad' }] })).toThrow(BadRequestException);
    expect(() => normalizeTemplateEditorJson({ version: 1, blocks: [{ kind: 'image', text: 'bad', assetId: 'not-a-uuid' }] })).toThrow(BadRequestException);
    expect(() => normalizeTemplateEditorJson({ version: 1, blocks: Array(101).fill({ kind: 'divider', text: '' }) })).toThrow(BadRequestException);
  });
});

describe('tenant-scoped template detail',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('returns only the authenticated tenant template',async()=>{
  db.template.findFirst.mockResolvedValue({id:'template-a',tenantId:'tenant-a',name:'Welcome'});
  const service=new TemplatesService({authenticate:vi.fn().mockResolvedValue({tenantId:'tenant-a'})} as any);
  await expect(service.get({cookies:{repus_session:'session'}} as any,'template-a')).resolves.toMatchObject({name:'Welcome'});
  expect(db.template.findFirst).toHaveBeenCalledWith({where:{id:'template-a',tenantId:'tenant-a'}});
 });
 it('does not disclose a template from another tenant',async()=>{
  db.template.findFirst.mockResolvedValue(null);
  const service=new TemplatesService({authenticate:vi.fn().mockResolvedValue({tenantId:'tenant-a'})} as any);
  await expect(service.get({cookies:{repus_session:'session'}} as any,'template-b')).rejects.toThrow('Template not found.');
  expect(db.template.findFirst).toHaveBeenCalledWith({where:{id:'template-b',tenantId:'tenant-a'}});
 });
});
