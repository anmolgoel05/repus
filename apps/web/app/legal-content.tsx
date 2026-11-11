import Link from 'next/link';

type PolicySection = { title: string; paragraphs: string[]; bullets?: string[] };
const policies: Record<string, { title: string; summary: string; sections: PolicySection[] }> = {
  privacy: {
    title: 'Privacy notice',
    summary: 'This notice explains what Repus processes when you use the service. It is written for the current product and should be completed with the operator details shown below before public launch.',
    sections: [
      { title: 'Information processed', paragraphs: ['Workspace account information includes your name, email address, password hash, role, session records, and workspace settings. Repus processes contact details, consent source and date, list membership, campaign content, and delivery and engagement events that workspace users submit or generate.', 'Repus uses necessary cookies for authenticated sessions. Campaign opens and clicks are measured using recipient-specific capabilities. Open metrics are approximate and can include automated image proxy activity.'] },
      { title: 'How information is used', paragraphs: ['Repus uses this information to authenticate users, isolate workspaces, import and manage contacts, prepare and deliver campaigns, honor unsubscribes and suppressions, provide analytics, prevent abuse, and operate the service.', 'When Amazon SES is configured, campaign and service email content is transmitted to Amazon SES for delivery. Development mode records simulated delivery and does not send email. Production deployments also rely on the configured database, cache, and private object storage providers.'] },
      { title: 'Workspace responsibility and recipients', paragraphs: ['Workspace operators control the contact data and campaign content they add. They must have permission to use subscriber data and must honor removal requests. A recipient can use the unsubscribe link in any marketing email to stop future marketing messages from that workspace.', 'Repus does not sell subscriber lists. Service providers process data only as needed to operate the deployment. The specific operator, hosting regions, provider terms, and retention periods depend on the deployment and must be disclosed by the Repus operator.'] },
      { title: 'Security, retention, and your requests', paragraphs: ['Repus uses password hashing, tenant-scoped authorization, database row-level security, and private object storage controls. No internet service can guarantee absolute security.', 'Workspace records are retained while needed to provide the service and meet operational or legal requirements. Unsubscribe and suppression history is retained to prevent a removed address from being silently re-added. This release does not yet provide a self-service account deletion or privacy-request workflow; contact the service operator to make a privacy request.'] },
      { title: 'Operator details required before launch', paragraphs: ['The service operator must publish its legal name, contact address, applicable privacy contact, hosting and subprocessor details, retention schedule, and the rights and complaint process applicable to the regions it serves. This notice is product documentation, not a substitute for deployment-specific legal review.'] },
    ],
  },
  terms: {
    title: 'Terms of service',
    summary: 'These service terms describe the product rules. The service operator must add its legal identity, governing-law details, commercial terms, and support contact before accepting customers.',
    sections: [
      { title: 'Using Repus', paragraphs: ['Repus provides tools to manage permission-based contacts, create email campaigns, schedule delivery, and review delivery and engagement analytics. You are responsible for your account credentials and the actions taken by your workspace members.', 'You may use Repus only where you have authority to do so and in compliance with applicable laws and the Acceptable Use Policy. You remain responsible for the accuracy of your sender identity, subject lines, campaign content, consent records, and contact data.'] },
      { title: 'Email permission and recipient choices', paragraphs: ['Only import or message people when you have a valid basis and permission to do so. Do not upload purchased, scraped, or otherwise unauthorized lists. Include accurate sender information and honor unsubscribe requests promptly. A suppression record must not be bypassed by importing the same address again.', 'Repus may pause sending or restrict a workspace when abuse, complaints, bounces, security issues, or provider requirements make continued sending unsafe.'] },
      { title: 'Availability and data', paragraphs: ['The service depends on infrastructure and email providers and may be unavailable or delayed. Provider acceptance is not a guarantee of inbox placement. Analytics such as opens and clicks may be affected by privacy tools, proxies, and automated activity.', 'You are responsible for keeping appropriate copies of data you need. The operator must publish the service-specific plans, fees, data export and deletion rules, support commitments, liability terms, and governing law before commercial use.'] },
      { title: 'Operator details required before launch', paragraphs: ['The service operator must identify the contracting entity, provide a support and legal contact, set effective and revision dates, and obtain review of commercial, liability, termination, and jurisdiction terms. This page does not establish those deployment-specific terms.'] },
    ],
  },
  'acceptable-use': {
    title: 'Acceptable Use Policy',
    summary: 'Repus is for permission-based email communication. These rules apply to workspaces, their members, imports, campaigns, and use of Repus infrastructure.',
    sections: [
      { title: 'Allowed use', paragraphs: ['Use Repus to send relevant email to people who gave permission to receive it from your organization. Keep consent source and collection date accurate, use a recognizable sender, and make unsubscribe straightforward.'] },
      { title: 'Prohibited use', paragraphs: ['You must not use Repus to:'], bullets: ['Send to purchased, scraped, harvested, rented, or otherwise unauthorized contact lists.', 'Send deceptive, fraudulent, unlawful, threatening, harassing, or malicious content, or impersonate another person or organization.', 'Hide sender identity, use misleading subjects, evade unsubscribe or suppression controls, or re-add unsubscribed addresses without fresh documented permission.', 'Probe, disrupt, overload, or gain unauthorized access to Repus, its providers, or another workspace.', 'Upload malware or attempt to use campaigns, links, images, or imports to distribute malicious code.'] },
      { title: 'Enforcement and reporting', paragraphs: ['Repus may investigate reports, pause campaigns, restrict sending, or suspend access when needed to protect recipients, the service, or provider reputation. Reports can be submitted through the public abuse-report form. Include enough detail to identify the message; do not submit passwords or unrelated sensitive information.'] },
      { title: 'Sender obligations', paragraphs: ['Workspace operators are responsible for permission, lawful content, accurate sender identification, and honoring recipient requests. Repus provides tools and safeguards but cannot determine whether a particular workspace has permission to contact a particular recipient.'] },
    ],
  },
};

export function LegalPage({ policy }: { policy: keyof typeof policies }) {
  const content = policies[policy];
  return <main style={{ minHeight: '100vh', padding: '32px 20px 64px', background: 'radial-gradient(ellipse at 50% 0%,#e8f0ff,transparent 38%),#f8faff' }}>
    <nav style={{ maxWidth: 920, margin: '0 auto 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Link href="/" style={{ color: '#17243b', fontWeight: 800, fontSize: 21, textDecoration: 'none' }}>repus</Link><Link href="/abuse-report" style={{ color: '#53627a', fontSize: 14 }}>Report email abuse</Link></nav>
    <article style={{ maxWidth: 920, margin: 'auto', padding: 'clamp(24px,5vw,56px)', background: 'white', border: '1px solid #e8edf3', borderRadius: 18, boxShadow: '0 12px 42px #1831530b' }}>
      <p style={{ margin: '0 0 8px', color: '#3975df', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Repus policies</p>
      <h1 style={{ margin: '0 0 12px', font: '800 clamp(30px,5vw,42px) Manrope,sans-serif', letterSpacing: '-.04em' }}>{content.title}</h1>
      <p style={{ margin: '0 0 34px', color: '#68758b', lineHeight: 1.75 }}>{content.summary}</p>
      {content.sections.map(section => <section key={section.title} style={{ marginTop: 28 }}><h2 style={{ margin: '0 0 10px', font: '700 19px Manrope,sans-serif' }}>{section.title}</h2>{section.paragraphs.map(paragraph => <p key={paragraph} style={{ color: '#53627a', lineHeight: 1.8 }}>{paragraph}</p>)}{section.bullets&&<ul style={{ paddingLeft: 23, color: '#53627a', lineHeight: 1.8 }}>{section.bullets.map(item=><li key={item} style={{ margin: '8px 0' }}>{item}</li>)}</ul>}</section>)}
      <footer style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 42, paddingTop: 20, borderTop: '1px solid #e8edf3', fontSize: 13 }}><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/acceptable-use">Acceptable use</Link></footer>
    </article>
  </main>;
}
