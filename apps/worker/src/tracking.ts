import { encryptToken } from '@repus/token-security';
import { decodeEmailHtmlEntities } from '@repus/email-renderer';

export function campaignTrackingUrls(base:string,unsubscribeToken:string){
  const trackingBase=base.replace(/\/$/,'');
  return {trackingBase,unsubscribeUrl:`${trackingBase}/unsubscribe/${encodeURIComponent(unsubscribeToken)}`};
}

function isRepusUnsubscribeCapability(target:string,trackingBase:string){
  try{
    const candidate=new URL(target);
    const base=new URL(trackingBase);
    const basePath=base.pathname.replace(/\/$/,'');
    const unsubscribePrefix=`${basePath}/unsubscribe/`;
    const capabilityPath=candidate.pathname.startsWith(unsubscribePrefix)?candidate.pathname.slice(unsubscribePrefix.length):'';
    return candidate.origin===base.origin&&capabilityPath.length>0&&!capabilityPath.includes('/');
  }catch{return false;}
}

/** Rewrite only absolute HTTP(S) links from the already-sanitized campaign HTML. */
export function instrumentTrackingHtml(html: string, tenantId: string, recipientId: string, trackingBase: string, secret: string) {
  const tracked = html.replace(/<!--[\s\S]*?-->|<a(?=\s|>)(?:[^'">]|"[^"]*"|'[^']*')*>/gi, tag => {
    if (tag.startsWith('<!--')) return tag;
    let seenHref = false;
    return tag.replace(/(\s+)([^\s=/>]+)(?:(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
      (whole, space: string, name: string, equals: string, doubleQuoted?: string, singleQuoted?: string, unquoted?: string) => {
        if (name.toLowerCase() !== 'href' || seenHref) return whole;
        seenHref = true;
        const rawHref = doubleQuoted ?? singleQuoted ?? unquoted;
        if (rawHref === undefined) return whole;
        const target = decodeEmailHtmlEntities(rawHref);
        if (isRepusUnsubscribeCapability(target,trackingBase)) return whole;
        let parsed: URL;
        try { parsed = new URL(target); } catch { return whole; }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return whole;
        const token = encryptToken(JSON.stringify({ v: 1, kind: 'click', tenantId, recipientId, target }), secret);
        const quote = singleQuoted === undefined ? '"' : "'";
        return `${space}${name}${equals}${quote}${trackingBase}/t/click/${token}${quote}`;
    });
  });
  const openToken = encryptToken(JSON.stringify({ v: 1, kind: 'open', tenantId, recipientId }), secret);
  const pixel = `<img src="${trackingBase}/t/open/${openToken}" width="1" height="1" alt="" style="display:none!important;width:1px;height:1px;border:0" />`;
  return /<\/body\s*>/i.test(tracked) ? tracked.replace(/<\/body\s*>/i, `${pixel}</body>`) : `${tracked}${pixel}`;
}

export function instrumentTrackingText(text: string, tenantId: string, recipientId: string, trackingBase: string, secret: string) {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, raw => {
    let extraParens = (raw.match(/\)/g)?.length ?? 0) - (raw.match(/\(/g)?.length ?? 0);
    let extraBrackets = (raw.match(/\]/g)?.length ?? 0) - (raw.match(/\[/g)?.length ?? 0);
    let end = raw.length;
    while (end > 0) {
      const last = raw[end - 1];
      if (last === ')' && extraParens > 0) extraParens--;
      else if (last === ']' && extraBrackets > 0) extraBrackets--;
      else if (!',.!?;:'.includes(last)) break;
      end--;
    }
    const target = raw.slice(0, end);
    const suffix = raw.slice(end);
    if (isRepusUnsubscribeCapability(target,trackingBase)) return raw;
    let parsed: URL;
    try { parsed = new URL(target); } catch { return raw; }
    if (parsed.username || parsed.password) return raw;
    const token = encryptToken(JSON.stringify({ v: 1, kind: 'click', tenantId, recipientId, target }), secret);
    return `${trackingBase}/t/click/${token}${suffix}`;
  });
}
