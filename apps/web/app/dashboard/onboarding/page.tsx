'use client';

import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowRight,CheckCircle2,Mail,Users,Globe,Layers,Send,Building2} from 'lucide-react';
import {buildOnboardingSnapshot,onboardingCompletion,type OnboardingSnapshot} from '../onboarding-progress';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000';
async function read(path:string){const response=await fetch(`${API}/api/v1${path}`,{credentials:'include'});const body=await response.json();if(!response.ok)throw new Error(body.message??'Could not load setup progress.');return body.data;}

export default function OnboardingPage(){
 const router=useRouter();
 const [snapshot,setSnapshot]=useState<OnboardingSnapshot|null>(null);
 const [error,setError]=useState('');
 const [dismissed,setDismissed]=useState(false);
 const [retryCount,setRetryCount]=useState(0);
 useEffect(()=>{let live=true;setError('');Promise.all([read('/organizations/current'),read('/domains'),read('/lists'),read('/analytics/overview'),read('/campaigns?view=summary&page=1')]).then(([workspace,domains,lists,analytics,campaigns])=>{if(live)setSnapshot(buildOnboardingSnapshot(workspace,domains,lists,analytics,campaigns));}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Could not load setup progress.');});return()=>{live=false;}},[retryCount]);
 useEffect(()=>{if(snapshot?.user?.id)setDismissed(localStorage.getItem(`repus:onboarding-dismissed:${snapshot.user.id}`)==='true');},[snapshot]);
 const signals=useMemo(()=>({workspaceReady:Boolean(snapshot?.organization?.name),senderDomainVerified:Boolean(snapshot?.domains?.some(domain=>domain.verificationStatus==='verified')),hasList:Boolean(snapshot?.lists?.length),hasContacts:Boolean((snapshot?.analytics?.contacts??0)>0),hasCampaign:Boolean(snapshot?.campaigns?.length)}),[snapshot]);
 const progress=onboardingCompletion(signals);
 const steps=[
  {title:'Name your workspace',detail:'Your workspace is ready. You can update its name and timezone in settings.',href:'/dashboard/settings',done:signals.workspaceReady,icon:Building2},
  {title:'Verify a sending domain',detail:'Authenticate your domain so subscribers recognize your emails and providers can trust them.',href:'/dashboard/domains',done:signals.senderDomainVerified,icon:Globe},
  {title:'Create a subscriber list',detail:'Use a list to choose exactly which permission-based subscribers receive a campaign.',href:'/dashboard/lists',done:signals.hasList,icon:Layers},
  {title:'Add subscribers',detail:'Import contacts who agreed to receive your marketing emails.',href:'/dashboard/contacts/import',done:signals.hasContacts,icon:Users},
  {title:'Create your first campaign',detail:'Choose your list, write your message, preview it, and decide when to send.',href:'/dashboard/campaigns/new',done:signals.hasCampaign,icon:Send},
 ];
 const firstIncomplete=steps.find(step=>!step.done);
 function skip(){if(snapshot?.user?.id)localStorage.setItem(`repus:onboarding-dismissed:${snapshot.user.id}`,'true');setDismissed(true);router.push('/dashboard');}
 if(!snapshot)return <div className="content">{error?<div className="error" role="alert"><p style={{margin:'0 0 12px'}}>{error}</p><button className="button secondary" onClick={()=>setRetryCount(count=>count+1)}>Try again</button></div>:<div className="muted" role="status">Preparing your setup guide…</div>}</div>;
 if(dismissed)return <div className="content"><div className="welcome"><div><div className="muted small">Getting started</div><h1 className="font-display" style={{fontSize:27}}>Setup guide paused</h1><p className="muted">Your progress is saved. Open the guide from the sidebar whenever you’re ready.</p></div><button className="button" onClick={()=>{localStorage.removeItem(`repus:onboarding-dismissed:${snapshot.user.id}`);setDismissed(false);}}>Continue setup</button></div></div>;
 return <div className="content" style={{maxWidth:900}}>
  <div className="welcome"><div><div className="muted small" style={{marginBottom:8}}>A simple path to your first send</div><h1 className="font-display" style={{fontSize:29,margin:'0 0 8px'}}>Welcome to {snapshot.organization.name}</h1><div className="muted">We’ll help you connect a sender domain, organize permission-based subscribers, and prepare a campaign.</div></div><button className="button secondary" onClick={skip}>I’ll do this later</button></div>
  {error&&<div className="error">{error}</div>}
  <section className="card" style={{marginBottom:16}}><div style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center'}}><div><div className="card-title">Setup progress</div><div className="muted small" style={{marginTop:5}}>{progress.completed} of {progress.total} essentials complete</div></div><b style={{color:'#2563eb'}}>{Math.round(progress.completed/progress.total*100)}%</b></div><div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed} style={{height:8,background:'#edf1f7',borderRadius:9,marginTop:14,overflow:'hidden'}}><div style={{height:'100%',width:`${progress.completed/progress.total*100}%`,background:'#3979e6',borderRadius:9,transition:'width .2s'}}/></div></section>
  <section className="card"><div className="card-title">Your setup checklist</div><div style={{marginTop:8}}>{steps.map((step,index)=>{const Icon=step.done?CheckCircle2:step.icon;return <div key={step.title} style={{display:'flex',gap:14,alignItems:'flex-start',padding:'17px 0',borderTop:'1px solid #eef1f5'}}><span style={{width:34,height:34,borderRadius:10,background:step.done?'#e9f8ef':'#eef4ff',color:step.done?'#17834f':'#3979e6',display:'grid',placeItems:'center',flexShrink:0}}><Icon size={17}/></span><div style={{flex:1}}><div style={{fontWeight:700,fontSize:14}}>{index+1}. {step.title}{step.done&&<span className="muted" style={{fontWeight:500,marginLeft:8}}>Done</span>}</div><p className="muted small" style={{margin:'5px 0 0',lineHeight:1.6}}>{step.detail}</p></div><Link className={step.done?'button secondary':'button'} href={step.href} style={{flexShrink:0}}>{step.done?'Review':'Start'}<ArrowRight size={14}/></Link></div>})}</div></section>
  {progress.complete?<section className="card" style={{marginTop:16,background:'#f0faf4',borderColor:'#d5efdf'}}><div style={{display:'flex',gap:12,alignItems:'center'}}><CheckCircle2 color="#17834f"/><div><b>You’re ready to send.</b><div className="muted small" style={{marginTop:4}}>Send yourself a test email from a campaign before choosing Send now or Schedule.</div></div></div><Link className="button" style={{marginTop:14}} href={snapshot.campaigns[0]?`/dashboard/campaigns/${snapshot.campaigns[0].id}`:'/dashboard/campaigns/new'}><Mail size={15}/>Open a campaign</Link><button className="button secondary" style={{marginLeft:8,marginTop:14}} onClick={skip}>Skip the test for now</button></section>:firstIncomplete&&<div className="muted small" style={{textAlign:'center',marginTop:15}}>You can pause this guide and come back to it from the sidebar.</div>}
 </div>;
}
