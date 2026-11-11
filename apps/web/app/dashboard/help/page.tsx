import Link from 'next/link';
import {ArrowRight,BookOpen,CheckCircle2,Mail,ShieldCheck,Users} from 'lucide-react';

const guides=[
 {title:'Set up your workspace',description:'Follow guided setup, add business details and invite your team.',href:'/dashboard/onboarding',Icon:CheckCircle2},
 {title:'Bring your subscribers',description:'Import a CSV with recorded permission, review rejected rows and organize lists.',href:'/dashboard/contacts/import',Icon:Users},
 {title:'Verify your sending domain',description:'Review the DNS records and check identity and DKIM verification before sending.',href:'/dashboard/domains',Icon:ShieldCheck},
 {title:'Create your first campaign',description:'Choose a template, design an email, send a test and review your audience.',href:'/dashboard/campaigns/new',Icon:Mail},
];
const answers=[
 ['Who can I email?','Only people who gave permission to receive your marketing. Record when and how they subscribed. Purchased, scraped and third-party lists are not allowed. An unsubscribe, hard bounce or complaint blocks future marketing sends.'],
 ['Why is a subscriber waiting for confirmation?','When double opt-in is enabled, a new contact must use the confirmation link before becoming eligible. You can resend confirmation from the contact profile. Resending replaces the previous link.'],
 ['Why can’t I send my campaign?','Check that the workspace can send, your sending domain and DKIM are verified, the campaign has eligible subscribers, and enough daily and monthly allowance remains. Your campaign page explains which check needs attention.'],
 ['How does scheduling work?','Choose a date and time in your workspace timezone. Repus reserves allowance for the selected audience and checks capacity again at launch. A delayed campaign may wait for the next available sending window. Cancel a scheduled campaign from its campaign page to release unused reservations.'],
 ['Does “accepted” mean the email reached the inbox?','Accepted means the provider accepted the request. Delivered means the receiving mail server accepted the message. Neither guarantees inbox placement. Delivery can be delayed, and bounces or complaints may arrive later.'],
 ['Why do opens and clicks differ from unique counts?','Total events include repeated activity. Unique counts count a recipient once per campaign. Email privacy features, image proxies and security scanners can create automated activity, so engagement is approximate.'],
 ['Can I email someone who unsubscribed?','An unsubscribe takes effect immediately for future marketing. A contact can return only after fresh, documented permission through the reactivation flow. Complaint and hard-bounce suppressions cannot be cleared by ordinary reactivation.'],
 ['What should I do about an uncertain send?','Repus avoids automatically retrying a request that the provider may already have accepted. It retains the reservation while waiting for an authenticated provider event or an operator review. Check the campaign report; ask your platform operator to investigate if the warning persists.'],
];

export default function HelpCenter(){
 return <div className="content">
  <div className="welcome"><div><div className="muted small" style={{marginBottom:8}}>A little guidance, whenever you need it</div><h1 className="font-display" style={{fontSize:27,margin:'0 0 7px'}}>Help Center</h1><p className="muted" style={{margin:0}}>Simple steps for sending useful email to people who want it.</p></div><BookOpen size={28} color="#2563eb"/></div>
  <div className="grid split">{guides.map(({title,description,href,Icon})=><Link key={href} href={href} className="card" style={{textDecoration:'none',color:'inherit',display:'flex',gap:16,alignItems:'flex-start'}}><Icon size={23} color="#2563eb" style={{flexShrink:0}}/><div><h2 className="card-title" style={{margin:'0 0 8px'}}>{title}</h2><p className="muted small" style={{lineHeight:1.7,margin:'0 0 12px'}}>{description}</p><span style={{color:'#2563eb',fontSize:13,fontWeight:600}}>Open guide <ArrowRight size={14} style={{verticalAlign:'middle'}}/></span></div></Link>)}</div>
  <section className="card" style={{marginTop:20}}><h2 className="card-title" style={{marginTop:0}}>Common questions</h2>{answers.map(([question,answer])=><details key={question} style={{borderTop:'1px solid #edf0f5',padding:'16px 0'}}><summary style={{cursor:'pointer',fontWeight:600,fontSize:14}}>{question}</summary><p className="muted" style={{lineHeight:1.8,fontSize:14,marginBottom:0,maxWidth:850}}>{answer}</p></details>)}</section>
  <p className="muted small" style={{lineHeight:1.8,marginTop:20}}>Manage your name and workspace in <Link href="/dashboard/settings">Settings</Link>. For spam or misuse, use <Link href="/abuse-report">Report abuse</Link>. See our <Link href="/privacy">Privacy Policy</Link> and <Link href="/acceptable-use">Acceptable Use Policy</Link>.</p>
 </div>;
}
