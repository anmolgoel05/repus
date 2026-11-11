import {renderEmailHtml} from '@repus/email-renderer';

export type EmailBlock = {
  id: number;
  kind: 'heading' | 'paragraph' | 'button' | 'image' | 'columns' | 'divider';
  text: string;
  secondText?: string;
  bold?: boolean;
  italic?: boolean;
  textColor?: string;
  url?: string;
  assetId?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function safeEmailUrl(value?: string) {
  try {
    const url = new URL(value || '');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
}

export function validateEmailBlockLinks(blocks: EmailBlock[]) {
  if (blocks.some(block => block.kind === 'button' && !safeEmailUrl(block.url))) return 'Add a valid HTTP or HTTPS destination to each button.';
  if (blocks.some(block => block.kind === 'image' && !safeEmailUrl(block.url))) return 'Add a valid HTTP or HTTPS image URL or upload an image.';
  return null;
}

export function renderEmailBlocks(blocks: EmailBlock[], backgroundColor = '#ffffff') {
  const safeBackground = /^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor : '#ffffff';
  const format = (value: string, block: EmailBlock) => {
    let result = escapeHtml(value).replace(/\r\n?|\n/g, '<br>');
    if (block.bold) result = `<strong>${result}</strong>`;
    if (block.italic) result = `<em>${result}</em>`;
    if (/^#[0-9a-f]{6}$/i.test(block.textColor ?? '')) result = `<span style="color:${block.textColor}">${result}</span>`;
    return result;
  };
  const content = blocks.map(block => {
    const text = format(block.text, block);
    if (block.kind === 'heading') return `<h1 style="font-size:28px;line-height:1.25;margin:14px 0">${text}</h1>`;
    if (block.kind === 'paragraph') return `<p style="font-size:16px;line-height:1.7;margin:14px 0;white-space:pre-line">${text}</p>`;
    if (block.kind === 'button') { const url = safeEmailUrl(block.url); return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:24px 0;border:0;border-collapse:collapse"><tr><td align="left" bgcolor="#2563eb" style="background-color:#2563eb;border-radius:7px;padding:12px 18px"><a${url ? ` href="${escapeHtml(url)}"` : ''} style="display:inline-block;color:white;text-decoration:none;font-family:Arial,sans-serif;font-size:16px;font-weight:bold">${text}</a></td></tr></table>`; }
    if (block.kind === 'image') { const url = safeEmailUrl(block.url); if (!url) return `<p style="margin:18px 0;color:#667085;font-size:13px">Add a safe image URL or upload an image.</p>`; return `<p style="margin:18px 0"><img src="${escapeHtml(url)}" width="560" alt="${escapeHtml(block.text.replace(/[\r\n]+/g, ' '))}" style="display:block;width:100%;max-width:560px;height:auto;border:0"></p>`; }
    if (block.kind === 'columns') return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;margin:18px 0;border:0;border-collapse:collapse"><tr><td class="repus-email-column" width="50%" valign="top" style="width:50%;padding:8px;font-size:15px;line-height:1.6">${text}</td><td class="repus-email-column" width="50%" valign="top" style="width:50%;padding:8px;font-size:15px;line-height:1.6">${format(block.secondText ?? '', block)}</td></tr></table>`;
    return '<hr style="border:0;border-top:1px solid #e5eaf1;margin:22px 0">';
  }).join('');
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${safeBackground}" style="width:100%;border:0;border-collapse:collapse;background-color:${safeBackground}"><tr><td align="center" valign="top"><table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" bgcolor="${safeBackground}" style="width:100%;max-width:600px;border:0;border-collapse:collapse;background-color:${safeBackground}"><tr><td style="padding:28px 20px;font-family:Arial,sans-serif;color:#17243b;background-color:${safeBackground}">${content}</td></tr></table></td></tr></table>`;
}

export function renderEmailText(blocks: EmailBlock[]) {
  return blocks.flatMap(block => {
    if (block.kind === 'divider') return [];
    if (block.kind === 'button' && safeEmailUrl(block.url)) return [`${block.text}\n${safeEmailUrl(block.url)}`];
    return [block.text, ...(block.kind === 'columns' && block.secondText ? [block.secondText] : [])];
  }).join('\n');
}

export function renderEmailPreview(blocks:EmailBlock[],backgroundColor='#ffffff',previewText=''){
  return renderEmailHtml(renderEmailBlocks(blocks,backgroundColor),{
    first_name:'Avery',last_name:'Morgan',email:'preview@example.test',
    unsubscribe_url:'#unsubscribe-preview',preview_text:previewText,
  });
}
