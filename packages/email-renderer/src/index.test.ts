import {describe,expect,it} from 'vitest';
import {htmlToPlainText,renderEmailHtml,renderEmailSubject,renderEmailText,renderEmailTextAlternative} from './index';
describe('email personalization',()=>{
 it('preserves subscriber values when deriving text from personalized HTML',()=>{
  const fields={first_name:'{{email}}',email:'subscriber@example.test',unsubscribe_url:'https://track.test/unsubscribe/token'};
  const html=renderEmailHtml('<p>Hello {{first_name}}</p>',fields);
  const generated=renderEmailTextAlternative('  ',html,fields);
  expect(generated).toContain('Hello {{email}}');
  expect(generated).toContain(fields.unsubscribe_url);
  expect(generated).not.toContain(fields.email);
  expect(renderEmailTextAlternative('Email: {{email}}',html,fields)).toContain(`Email: ${fields.email}`);
 });
 it('renders safe merge fields in subjects using the same sample values',()=>{
  expect(renderEmailSubject('Hi\r\nX-Injected: yes {{first_name}} {{last_name}} — {{email}}',{first_name:'Avery\r\nBcc:bad@example.com',last_name:'Morgan',email:'avery@example.com'})).toBe('Hi X-Injected: yes Avery Bcc:bad@example.com Morgan — avery@example.com');
 });
 it('escapes user-provided values before inserting them into HTML',()=>{expect(renderEmailHtml('<p>Hello {{first_name}}</p>',{first_name:'<img src=x onerror=alert(1)>',email:'a@example.com',unsubscribe_url:'https://track.example/u/abc'})).toContain('&lt;img src=x onerror=alert(1)&gt;')});
 it('adds a visible unsubscribe link when the template omitted one',()=>{expect(renderEmailHtml('<p>Hello</p>',{email:'a@example.com',unsubscribe_url:'https://track.example/u/abc'})).toContain('href="https://track.example/u/abc"')});
 it('inserts the unsubscribe footer before closing the email body and document',()=>{
  const html=renderEmailHtml('<html><body><p>Hello</p></body></html>',{email:'a@example.com',unsubscribe_url:'https://track.example/u/abc'});
  const footer=html.indexOf('You are receiving this because you subscribed to updates.');
  expect(footer).toBeGreaterThanOrEqual(0);
  expect(footer).toBeLessThan(html.indexOf('</body>'));
  expect(html.indexOf('</body>')).toBeLessThan(html.indexOf('</html>'));
  const footerTableStart=html.lastIndexOf('<table role="presentation"',footer);
  expect(footerTableStart).toBeGreaterThanOrEqual(0);
  expect(footer).toBeLessThan(html.indexOf('</table>',footer));
 });
 it('adds mobile column stacking styles in the document head for email clients',()=>{
  const html=renderEmailHtml('<html><head><title>Mail</title></head><body><td class="repus-email-column">Left</td></body></html>',{email:'a@example.com',unsubscribe_url:'https://track.example/u/abc'});
  const style=html.indexOf('@media only screen and (max-width:600px)');
  expect(style).toBeGreaterThan(html.indexOf('<head>'));
  expect(style).toBeLessThan(html.indexOf('</head>'));
  expect(html).toContain('width:100%!important');
 });
 it('adds the responsive style to email fragments containing editor columns',()=>{
  const html=renderEmailHtml('<table><tr><td class="repus-email-column">Left</td></tr></table>',{email:'a@example.com',unsubscribe_url:'https://track.example/u/abc'});
  expect(html.indexOf('<style')).toBeLessThan(html.indexOf('<table>'));
  expect(html).toContain('@media only screen and (max-width:600px)');
 });
 it('keeps the unsubscribe footer inside fragment content when no document body is present',()=>{
  const html=renderEmailHtml('<section><p>Hello</p></section>',{email:'a@example.com',unsubscribe_url:'https://track.example/u/abc'});
  expect(html).toMatch(/<section>[\s\S]*<table role="presentation"[\s\S]*<\/table>$/);
 });
 it('adds the recipient capability when a template has an unrelated unsubscribe-looking URL',()=>{
  const html=renderEmailHtml('<a href="https://unsubscribe.example.com/preferences">Preferences</a>',{email:'a@example.com',unsubscribe_url:'https://track.example/u/private-token'});
  expect(html).toContain('href="https://track.example/u/private-token"');
 });
 it.each([
  '<a data-href="{{unsubscribe_url}}">Text</a>',
  '<a title=\'fake href="{{unsubscribe_url}}"\'>Text</a>',
  '<!-- <a href="{{unsubscribe_url}}">Hidden</a> -->',
 ])('adds the fallback when an apparent unsubscribe target is inert',template=>{
  const unsubscribe='https://track.example/u/abc';
  const html=renderEmailHtml(template,{email:'a@example.com',unsubscribe_url:unsubscribe});
  expect(html).toContain(`You are receiving this because you subscribed to updates. <a href="${unsubscribe}"`);
 });
 it('recognizes a real unsubscribe link after a quoted greater-than character',()=>{
  const html=renderEmailHtml('<a title="More >" HREF="{{unsubscribe_url}}">Opt out</a>',{email:'a@example.com',unsubscribe_url:'https://track.example/u/abc'});
  expect(html).toBe('<a title="More >" HREF="https://track.example/u/abc">Opt out</a>');
 });
 it('places escaped campaign preview text at the start of the email body',()=>{
  const html=renderEmailHtml('<html><body><p>Hello</p></body></html>',{email:'a@example.com',unsubscribe_url:'https://track.example/u/abc',preview_text:'<img src=x onerror=alert(1)>'});
  expect(html.indexOf('<body>')).toBeLessThan(html.indexOf('display:none!important'));
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain('<img src=x');
 });
 it('includes the recipient unsubscribe URL in the text alternative without the HTML-only preheader',()=>{
  expect(renderEmailText('Hello {{first_name}}',{first_name:'A',email:'a@example.com',unsubscribe_url:'https://track.example/u/abc',preview_text:'Inbox preview'})).toBe('Hello A\n\nUnsubscribe: https://track.example/u/abc');
 });
 it('does not duplicate a recipient unsubscribe URL already present in the text',()=>{
  expect(renderEmailText('Unsubscribe: {{unsubscribe_url}}',{email:'a@example.com',unsubscribe_url:'https://track.example/u/abc'})).toBe('Unsubscribe: https://track.example/u/abc');
 });
 it('inserts plain-text subscriber values literally without expanding their own placeholders',()=>{
  const unsubscribe='https://track.example/u/abc';
  expect(renderEmailText('Hello {{first_name}} {{last_name}}',{first_name:'$& {{email}}',last_name:'$$',email:'a@example.com',unsubscribe_url:unsubscribe}))
   .toBe(`Hello $& {{email}} $$\n\nUnsubscribe: ${unsubscribe}`);
 });
 it('builds a readable text alternative from HTML with spacing, links, alt text, and entities',()=>{
  expect(htmlToPlainText('<p>Hello &amp; welcome</p><p><img src="product.png" alt="Product"> <a href="https://example.org/read?a=1&amp;b=2">Read more</a></p>')).toBe('Hello & welcome\n\nProduct Read more (https://example.org/read?a=1&b=2)');
 });
 it('omits the hidden inbox preheader from generated plain text',()=>{
  expect(htmlToPlainText('<div style="display:none!important;visibility:hidden">Inbox only</div><p>Main message</p>')).toBe('Main message');
 });
 it('decodes escaped text once and preserves literal entity-like text',()=>{
  expect(htmlToPlainText('<p>&amp;#39; &#39; &nbsp; &amp;quot;</p>')).toBe("&#39; ' &quot;");
 });
 it('uses actual link and image attributes and excludes comments from the text alternative',()=>{
  const html=`<!-- <a href="https://hidden.test">Hidden</a> --><p><img data-alt="Decoy" title="More >" alt="Product"> <a data-href="https://decoy.test" title="More >" HREF=https://real.test/read>Read</a></p>`;
  expect(htmlToPlainText(html)).toBe('Product Read (https://real.test/read)');
 });
});
