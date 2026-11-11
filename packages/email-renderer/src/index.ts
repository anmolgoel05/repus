export interface MergeFields { first_name?:string|null;last_name?:string|null;email:string;unsubscribe_url:string;preview_text?:string|null; }
export const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function htmlAttribute(tag:string,attribute:string){
 for(const [,name,doubleQuoted,singleQuoted,unquoted] of tag.matchAll(/\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)){
  if(name.toLowerCase()===attribute)return doubleQuoted??singleQuoted??unquoted;
 }
}
export function renderEmailSubject(template:string,fields:Pick<MergeFields,'first_name'|'last_name'|'email'>){
 const values:Record<string,string>={first_name:fields.first_name||'there',last_name:fields.last_name||'',email:fields.email};
// eslint-disable-next-line no-control-regex -- Remove unsafe control characters from email and CSV content.
 return template.replace(/\{\{(first_name|last_name|email)\}\}/g,(_match,key:string)=>values[key]).replace(/[\r\n\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
}
export function renderEmailHtml(template:string,fields:MergeFields){
 const values:Record<string,string>={first_name:fields.first_name||'there',last_name:fields.last_name||'',email:fields.email,unsubscribe_url:fields.unsubscribe_url};
 let html=template.replace(/\{\{(first_name|last_name|email|unsubscribe_url)\}\}/g,(_match,key:string)=>escapeHtml(values[key]));
 const preview=fields.preview_text?.trim();
 if(preview){
  const preheader=`<div style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(preview)}&#847;&#zwnj;&nbsp;</div>`;
  const bodyOpen=/<body\b[^>]*>/i.exec(html);
  html=bodyOpen?`${html.slice(0,bodyOpen.index+bodyOpen[0].length)}${preheader}${html.slice(bodyOpen.index+bodyOpen[0].length)}`:`${preheader}${html}`;
 }
 if(/\brepus-email-column\b/.test(html)){
  const responsiveColumns='<style type="text/css">@media only screen and (max-width:600px){.repus-email-column{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important}}</style>';
  const closeHead=/<\/head\s*>/i.exec(html),bodyOpen=/<body\b[^>]*>/i.exec(html);
  if(closeHead)html=`${html.slice(0,closeHead.index)}${responsiveColumns}${html.slice(closeHead.index)}`;
  else if(bodyOpen)html=`${html.slice(0,bodyOpen.index+bodyOpen[0].length)}${responsiveColumns}${html.slice(bodyOpen.index+bodyOpen[0].length)}`;
  else html=`${responsiveColumns}${html}`;
 }
 const safeUnsubscribeUrl=escapeHtml(fields.unsubscribe_url);
 const hasRecipientUnsubscribeLink=[...html.matchAll(/<!--[\s\S]*?-->|<a(?=\s|>)(?:[^'">]|"[^"]*"|'[^']*')*>/gi)]
  .some(([tag])=>!tag.startsWith('<!--')&&htmlAttribute(tag,'href')===safeUnsubscribeUrl);
 if(!hasRecipientUnsubscribeLink){
  const footer=`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr><td style="padding:18px 0;border-top:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b">You are receiving this because you subscribed to updates. <a href="${safeUnsubscribeUrl}" style="color:#475569;text-decoration:underline">Unsubscribe</a></td></tr></table>`;
  const closeBody=/<\/body\s*>/i.exec(html),closeHtml=closeBody?null:/<\/html\s*>/i.exec(html),closing=closeBody??closeHtml;
  html=closing?`${html.slice(0,closing.index)}${footer}${html.slice(closing.index)}`:`${html}${footer}`;
 }
 return html;
}
const namedEntities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'};
export function decodeEmailHtmlEntities(value:string){
 return value.replace(/&(amp|lt|gt|quot|apos|nbsp|#x[\da-f]+|#\d+);/gi,(_match,entity:string)=>{
  const key=entity.toLowerCase();
  if(key[0]!=='#')return namedEntities[key];
  const code=key[1]==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
  if(!code||code>0x10ffff||(code>=0xd800&&code<=0xdfff))return '\ufffd';
  return String.fromCodePoint(code);
 });
}
export function htmlToPlainText(html:string){
 const text=html
  .replace(/<!--[\s\S]*?-->/g,' ')
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
  .replace(/<div\b[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,' ')
  .replace(/<img(?=\s|\/?>)(?:[^'">]|"[^"]*"|'[^']*')*>/gi,tag=>htmlAttribute(tag,'alt')??' ')
  .replace(/(<a(?=\s|>)(?:[^'">]|"[^"]*"|'[^']*')*>)([\s\S]*?)<\/a\s*>/gi,(_tag,opening:string,label:string)=>{
   const url=htmlAttribute(opening,'href');
   return url?`${label} (${url})`:label;
  })
  .replace(/<br\s*\/?\s*>/gi,'\n')
  .replace(/<li\b[^>]*>/gi,'\n• ')
  .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|table|ul|ol)\s*>/gi,'\n')
  .replace(/<[^>]*>/g,' ');
// eslint-disable-next-line no-control-regex -- Remove unsafe control characters from email and CSV content.
 return decodeEmailHtmlEntities(text).split(/\n+/).map(line=>line.replace(/[\t \u00a0]+/g,' ').trim()).filter(Boolean).join('\n\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'');
}
export function renderEmailText(template:string,fields:MergeFields){
 const values:Record<string,string>={first_name:fields.first_name||'there',last_name:fields.last_name||'',email:fields.email,unsubscribe_url:fields.unsubscribe_url};
 const text=template.replace(/\{\{(first_name|last_name|email|unsubscribe_url)\}\}/g,(_match,key:string)=>values[key]);
 return ensureTextUnsubscribe(text,fields.unsubscribe_url);
}
function ensureTextUnsubscribe(text:string,url:string){
 if(text.includes(url))return text;
 return `${text}${text.trim()?'\n\n':''}Unsubscribe: ${url}`;
}
export function renderEmailTextAlternative(template:string|null|undefined,renderedHtml:string,fields:MergeFields){
 const explicitText=template?.trim();
 return explicitText?renderEmailText(explicitText,fields):ensureTextUnsubscribe(htmlToPlainText(renderedHtml),fields.unsubscribe_url);
}
