'use client';
import Link from 'next/link';
import { usePathname,useRouter } from 'next/navigation';
import { useEffect,useRef,useState } from 'react';
import { BarChart3,BookTemplate,CircleHelp,ClipboardCheck,Home,UserRound,Mail,Menu,Send,Settings,Users,X } from 'lucide-react';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000';
export default function DashboardLayout({children}:{children:React.ReactNode}){
 const path=usePathname(),router=useRouter();const[user,setUser]=useState<{id:string;tenantId:string;name:string;organization:string;platformAdmin?:boolean}|null>(null);const[workspaces,setWorkspaces]=useState<Array<{id:string;name:string;role:string}>>([]);const[switching,setSwitching]=useState(false);
 const[mobileNavOpen,setMobileNavOpen]=useState(false);const mobileMenuButton=useRef<HTMLButtonElement>(null);const mobileCloseButton=useRef<HTMLButtonElement>(null);
 const[loadError,setLoadError]=useState(false);const[loadAttempt,setLoadAttempt]=useState(0);
 const[switchError,setSwitchError]=useState(false);
 useEffect(()=>{
  let active=true;
  async function loadUser(){
   const response=await fetch(`${API}/api/v1/auth/me`,{credentials:'include',signal:AbortSignal.timeout(10_000)});
   if(response.status===401){if(active)router.replace('/login');return;}
   if(!response.ok)throw new Error('Could not load your session.');
   const body=await response.json();
   const organizations=await fetch(`${API}/api/v1/organizations`,{credentials:'include',signal:AbortSignal.timeout(10_000)});
   if(organizations.status===401){if(active)router.replace('/login');return;}
   if(!organizations.ok)throw new Error('Could not load your workspaces.');
   const organizationBody=await organizations.json();if(active){setUser(body.data);setWorkspaces(organizationBody.data);}
  }
  const initial=setTimeout(()=>{void loadUser().catch(()=>{if(active)setLoadError(true)})},0);
  const interval=setInterval(()=>{
   void fetch(`${API}/api/v1/auth/refresh`,{method:'POST',credentials:'include',signal:AbortSignal.timeout(10_000)}).then(async response=>{
    if(response.status===401){const current=await fetch(`${API}/api/v1/auth/me`,{credentials:'include',signal:AbortSignal.timeout(10_000)});if(current.status===401&&active)router.replace('/login');}
   }).catch(()=>undefined);
  },6*60*60*1000);
  return()=>{active=false;clearTimeout(initial);clearInterval(interval)};
 },[router,loadAttempt]);
 useEffect(()=>{
  const updateProfileName=(event:Event)=>{const name=(event as CustomEvent<{name?:string}>).detail?.name;if(name)setUser(current=>current?{...current,name}:current)};
  window.addEventListener('repus:user-profile-updated',updateProfileName);
  return()=>window.removeEventListener('repus:user-profile-updated',updateProfileName);
 },[]);
 useEffect(()=>{setMobileNavOpen(false)},[path]);
 useEffect(()=>{
  if(!mobileNavOpen)return;
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  mobileCloseButton.current?.focus();
  const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMobileNavOpen(false);mobileMenuButton.current?.focus()}};
  document.addEventListener('keydown',closeOnEscape);
  return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',closeOnEscape)};
 },[mobileNavOpen]);
 async function logout(){await fetch(`${API}/api/v1/auth/logout`,{method:'POST',credentials:'include'});router.replace('/')}
 async function switchWorkspace(tenantId:string){
  if(!tenantId||tenantId===user?.tenantId||switching)return;
  setSwitchError(false);setSwitching(true);
  try{
   const response=await fetch(`${API}/api/v1/auth/switch-workspace`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId}),signal:AbortSignal.timeout(10_000)});
   if(!response.ok)throw new Error('Could not switch workspaces.');
   window.location.assign('/dashboard');
  }catch{setSwitchError(true);setSwitching(false);}
 }
 const nav:Array<[string,string,typeof Home]>=[['Overview','/dashboard',Home],['Getting started','/dashboard/onboarding',ClipboardCheck],['Contacts','/dashboard/contacts',Users],['Campaigns','/dashboard/campaigns',Send],['Templates','/dashboard/templates',BookTemplate],['Analytics','/dashboard/analytics',BarChart3],['Sending domains','/dashboard/domains',Mail],['Settings','/dashboard/settings',Settings]];if(user?.platformAdmin)nav.push(['Platform admin','/dashboard/admin',Settings]);
 const renderNavigation=(mobile=false)=>nav.map(([label,href,Icon])=><Link key={href} href={href} onClick={mobile?()=>{setMobileNavOpen(false);mobileMenuButton.current?.focus()}:undefined} className={`nav-link ${path===href?'active':''}`}><Icon size={17}/>{label}</Link>);
 function trapMobileFocus(event:React.KeyboardEvent<HTMLElement>){
  if(event.key!=='Tab')return;
  const focusable=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
 }
 if(!user)return <div className="auth-wrap">{loadError?<section className="auth-card"><p role="alert">We couldn’t load your workspace. Check your connection and try again.</p><button className="button" onClick={()=>{setLoadError(false);setLoadAttempt(attempt=>attempt+1)}}>Try again</button></section>:<div className="muted" role="status">Loading your workspace…</div>}</div>;
 return <div className="frame"><aside className="sidebar"><Link href="/dashboard" className="brand" style={{textDecoration:'none',color:'inherit'}}><span className="brand-icon"><Mail size={18}/></span>repus</Link><div style={{padding:'0 7px 18px'}}><label htmlFor="workspace-switcher" className="muted small" style={{display:'block',marginBottom:5}}>Workspace</label><select id="workspace-switcher" aria-label="Switch workspace" value={user.tenantId} disabled={switching} onChange={event=>void switchWorkspace(event.target.value)} style={{width:'100%',padding:'10px 9px',border:'1px solid #dce3ed',borderRadius:8,fontSize:12,background:'white'}}>{workspaces.map(workspace=><option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><Link href="/dashboard/workspaces/new" className="muted small" style={{display:'inline-block',marginTop:8}}>+ Create workspace</Link></div><div className="nav-label">Workspace</div><nav>{renderNavigation()}</nav><div style={{marginTop:'auto',borderTop:'1px solid #edf0f5',paddingTop:16}}><Link href="/dashboard/help" className="nav-link"><CircleHelp size={17}/>Help Center</Link><Link href="/dashboard/settings#profile" className="nav-link"><UserRound size={17}/>Your profile</Link><div className="nav-link" style={{cursor:'default'}}><span style={{background:'#e9effb',color:'#3765ba',borderRadius:18,width:29,height:29,display:'grid',placeItems:'center',fontSize:12,fontWeight:700}}>{user.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()}</span><span style={{flex:1}}>{user.name}</span></div><button onClick={logout} className="nav-link" style={{border:0,background:'none',width:'100%',cursor:'pointer'}}>Log out</button></div></aside>{mobileNavOpen&&<div className="mobile-nav-layer"><button className="mobile-nav-scrim" aria-label="Close navigation" onClick={()=>{setMobileNavOpen(false);mobileMenuButton.current?.focus()}}/><aside id="workspace-mobile-navigation" className="mobile-nav-drawer" role="dialog" aria-modal="true" aria-label="Workspace navigation" onKeyDown={trapMobileFocus}><div className="mobile-nav-heading"><Link href="/dashboard" className="brand" style={{textDecoration:'none',color:'inherit',padding:0}}><span className="brand-icon"><Mail size={18}/></span>repus</Link><button ref={mobileCloseButton} className="mobile-nav-close" onClick={()=>{setMobileNavOpen(false);mobileMenuButton.current?.focus()}} aria-label="Close navigation"><X size={20}/></button></div><div className="mobile-nav-workspace">{user.organization}</div><label htmlFor="mobile-workspace-switcher" className="muted small">Switch workspace</label><select id="mobile-workspace-switcher" aria-label="Switch workspace" value={user.tenantId} disabled={switching} onChange={event=>void switchWorkspace(event.target.value)} style={{width:'100%',padding:10,border:'1px solid #dce3ed',borderRadius:8,margin:'8px 0 16px'}}>{workspaces.map(workspace=><option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><Link href="/dashboard/workspaces/new" className="muted small" style={{display:'block',marginBottom:16}}>+ Create workspace</Link><div className="nav-label">Workspace</div><nav>{renderNavigation(true)}</nav><div className="mobile-nav-account"><Link href="/dashboard/help" className="nav-link"><CircleHelp size={17}/>Help Center</Link><Link href="/dashboard/settings#profile" className="nav-link"><UserRound size={17}/>Your profile</Link><div className="nav-link" style={{cursor:'default'}}><span className="mobile-avatar">{user.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()}</span><span style={{flex:1}}>{user.name}</span></div><button onClick={logout} className="nav-link" style={{border:0,background:'none',width:'100%',cursor:'pointer'}}>Log out</button></div></aside></div>}<main className="main"><header className="topbar"><button ref={mobileMenuButton} className="mobile-menu-button" aria-label="Open workspace navigation" aria-expanded={mobileNavOpen} aria-controls="workspace-mobile-navigation" onClick={()=>setMobileNavOpen(true)}><Menu size={20}/></button><div className="topbar-workspace">{user.organization}</div><div className="topbar-user">{user.name}</div></header>{switchError&&<div className="error" role="alert">We couldn’t switch workspaces. Select the workspace again to retry.</div>}{children}</main></div>
}

