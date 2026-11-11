'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CalendarClock, Send, Activity, Users, Pause, Play } from 'lucide-react';
import {dateTimeInZoneToUtc,formatDateTimeInZone} from '../schedule-time';
import {campaignCancellationPrompt,campaignCancellationResultMessage} from '../cancellation-messages';
import CampaignActivity from './campaign-activity';
import CampaignRecipients from './campaign-recipients';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
function scheduledLabel(value:string,timeZone:string){return `${new Intl.DateTimeFormat(undefined,{timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value))} (${timeZone})`;}
async function read(url: string, method = 'GET') {
  const response = await fetch(url, { method, credentials: 'include' });
  const body = await response.json();
  if (!response.ok) throw Error(body.message ?? 'Could not load campaign data.');
  return body.data;
}

function CampaignTextPreview({id}:{id:string}) {
  const [text,setText]=useState<string>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function loadText(){
    setBusy(true);
    setError('');
    try {
      const preview=await read(`${API}/api/v1/campaigns/${id}/preview`,'POST');
      setText(preview.textContent);
    } catch {
      setError('Could not load the plain-text preview. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return <div style={{marginTop:14}}>
    {text===undefined&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void loadText()}>{busy?'Loading preview…':'Preview plain text'}</button>}
    {error&&<p className="error" role="alert">{error}</p>}
    {text!==undefined&&<section aria-label="Plain-text email preview">
      <div className="muted small">Plain-text preview with sample subscriber details</div>
      <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{text}</pre>
    </section>}
  </div>;
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [activityRevision, setActivityRevision] = useState(0);
  const [error, setError] = useState('');
  const [reportError, setReportError] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);
  const [schedule, setSchedule] = useState('');
  const [scheduling,setScheduling]=useState(false);
  const [message, setMessage] = useState('');
  const [sendReviewOpen, setSendReviewOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting,setDeleting]=useState(false);
  const sendReviewRef=useRef<HTMLElement>(null);

  async function loadCampaign() {
    const current=await read(`${API}/api/v1/campaigns/${id}`);
    setCampaign(current);
    if(current.status==='SCHEDULED'&&current.scheduledAt)setSchedule(formatDateTimeInZone(current.scheduledAt,current.workspaceTimezone??'UTC'));
  }
  async function loadReport() {
    try {
      const stats = await read(`${API}/api/v1/campaigns/${id}/stats`);
      setReport(stats);
      setActivityRevision(revision => revision + 1);
      setReportError('');
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Could not load campaign results.');
    }
  }
  useEffect(() => {
    setError('');
    void loadCampaign().catch(e => setError(e.message));
    void loadReport();
    const reportRefresh=window.setInterval(()=>void loadReport(),60_000);
    return()=>window.clearInterval(reportRefresh);
  }, [id]);
  useEffect(()=>{
    if(!sendReviewOpen)return;
    const dialog=sendReviewRef.current;
    if(!dialog)return;
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])'));
    focusable()[0]?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();if(!sending)setSendReviewOpen(false);return;}
      if(event.key!=='Tab')return;
      const items=focusable();if(!items.length){event.preventDefault();return;}
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    dialog.addEventListener('keydown',onKeyDown);
    return()=>{dialog.removeEventListener('keydown',onKeyDown);previousFocus?.focus();};
  },[sendReviewOpen,sending]);

  async function act(path: string, body?: unknown):Promise<boolean> {
    setError(''); setMessage('');
    let testOutcomeUncertain=path==='test';
    try {
      const response = await fetch(`${API}/api/v1/campaigns/${id}/${path}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json();
      testOutcomeUncertain=path==='test'&&(response.status>=500||(response.ok&&result.data?.queued!==true));
      if(response.ok&&testOutcomeUncertain)throw Error('Test send acknowledgment missing.');
      if (!response.ok) throw Error(result.message ?? 'Campaign action failed.');
      const timezone=campaign?.workspaceTimezone??'UTC';
      setMessage(path === 'test' ? 'Your test email is queued.' : path === 'send' ? `${result.data.queued} emails queued for sending.` : path === 'schedule' ? `Campaign scheduled for ${scheduledLabel(result.data.scheduledAt,timezone)}.` : path === 'reschedule' ? `Campaign rescheduled for ${scheduledLabel(result.data.scheduledAt,timezone)}.` : path === 'pause' ? result.data.inFlightInterruptionPublished ? 'Campaign paused. Repus asked workers to interrupt active requests. SES may already have accepted a message; wait for its result before resending.' : 'Campaign paused, but Repus could not confirm the worker interrupt signal. An active provider request may still complete; wait for its result before resending.' : path === 'resume' ? `${result.data.queued} queued emails are ready to resume.` : path === 'cancel' ? campaignCancellationResultMessage(campaign?.status??'',Boolean(result.data.inFlightInterruptionPublished)) : 'Campaign action completed.');
      await loadCampaign();
      await loadReport();
      return true;
    } catch (e) {
      setError(testOutcomeUncertain?'Repus could not confirm that the test email was queued. Check the recipient’s inbox before sending another test.':e instanceof Error ? e.message : 'Campaign action failed.');
      return false;
    }
  }
  async function send() {
    setSending(true);
    try{if(await act('send'))setSendReviewOpen(false);}
    finally{setSending(false);}
  }
  async function test(e: FormEvent) {
    e.preventDefault();
    if(testing)return;
    setTesting(true);
    try{await act('test',{email:testEmail});}finally{setTesting(false);}
  }
  async function cancelCampaign(){
    if(window.confirm(campaignCancellationPrompt(campaign.status)))await act('cancel');
  }
  async function deleteDraft(){
    if(!window.confirm(`Delete the draft “${campaign.name}”? This permanently removes its content.`))return;
    setDeleting(true);setError('');setMessage('');
    try{
      const response=await fetch(`${API}/api/v1/campaigns/${id}`,{method:'DELETE',credentials:'include'});
      const result=await response.json();
      if(!response.ok)throw Error(Array.isArray(result.message)?result.message.join(' '):result.message??'Could not delete this draft.');
      window.location.href='/dashboard/campaigns';
    }catch(error){
      setError(error instanceof Error?error.message:'Could not delete this draft.');
      await loadCampaign().catch(()=>{});
    }finally{setDeleting(false);}
  }
  async function scheduleNow(e: FormEvent) {
    e.preventDefault(); if (!schedule||scheduling) return;
    setScheduling(true);
    try{
      const scheduledAt=dateTimeInZoneToUtc(schedule,campaign.workspaceTimezone??'UTC');
      if(scheduledAt.getTime()<=Date.now())throw new Error('Choose a future date and time.');
      await act(campaign.status==='SCHEDULED'?'reschedule':'schedule',{scheduledAt:scheduledAt.toISOString()});
    }
    catch(error){setError(error instanceof Error?error.message:'Choose a valid schedule time.');}
    finally{setScheduling(false);}
  }

  if (!campaign) return <div className="content"><div className="muted">{error || 'Loading campaign…'}</div></div>;
  const canManage=campaign.canManage===true;
  const metric = (label: string, value: string | number | null | undefined) => <div className="card" key={label}><div className="stat-label">{label}</div><div className="stat-number">{value ?? '—'}</div></div>;
  return <div className="content">
    <Link href="/dashboard/campaigns" className="muted small" style={{ display: 'inline-flex', gap: 7, alignItems: 'center', textDecoration: 'none', marginBottom: 22 }}><ArrowLeft size={15} />Campaigns</Link>
    <div className="welcome"><div><div className="muted small" style={{ marginBottom: 8 }}>Campaign</div><h1 className="font-display" style={{ fontSize: 27, margin: '0 0 7px' }}>{campaign.name}</h1><div className="muted">{campaign.subject || 'No subject yet'} · {campaign.status.toLowerCase()}</div></div><span className="pill">{campaign.status.toLowerCase()}</span></div>
    {error && <div className="error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
    {message && <div role="status" aria-live="polite" style={{ background: '#eaf7ef', color: '#167544', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{message}</div>}
    {canManage&&campaign.status==='DRAFT'&&<div style={{display:'flex',gap:10,marginBottom:16}}><Link className="button secondary" href={`/dashboard/campaigns/new?edit=${encodeURIComponent(id)}`}>Edit draft</Link><button type="button" className="button secondary" disabled={deleting||sending} onClick={()=>void deleteDraft()} style={{color:'#b42318'}}>{deleting?'Deleting…':'Delete draft'}</button></div>}
    <div className="grid split">
      <section className="card"><div className="card-title">Email preview</div><div style={{ border: '1px solid #edf0f5', borderRadius: 10, marginTop: 14, overflow: 'hidden', background: '#fff' }}><iframe title="Campaign email preview" sandbox="" srcDoc={campaign.htmlContent || '<p>Your email content will appear here.</p>'} style={{ display: 'block', width: '100%', height: 420, border: 0, background: '#fff' }} /></div><CampaignTextPreview key={id} id={id}/></section>
      {canManage?<section className="card">
        <div className="card-title">Send a test</div><p className="muted small">Preview the email in your inbox before sending to subscribers.</p>
        <label htmlFor="campaign-test-recipient" className="muted small" style={{display:'block',marginBottom:6}}>Test recipient email</label>
        <form onSubmit={test} style={{ display: 'flex', gap: 8 }}><input id="campaign-test-recipient" type="email" autoComplete="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} required placeholder="you@example.com" style={{ flex: 1, minWidth: 0, padding: 10, border: '1px solid #dce3ed', borderRadius: 8 }} /><button className="button secondary" disabled={testing}>{testing?'Queuing test…':'Send test'}</button></form>
        {['DRAFT','SCHEDULED'].includes(campaign.status) ? <><div className="card-title" style={{ marginTop: 28 }}>{campaign.status==='SCHEDULED'?'Reschedule':'Schedule'}</div><p className="muted small">Choose a time in your workspace timezone ({campaign.workspaceTimezone??'UTC'}). Repus stores the schedule in UTC and uses the earlier occurrence if clocks repeat. Its subscriber list stays reserved if you change the time.</p>
        <form onSubmit={scheduleNow}><label htmlFor="campaign-schedule-time" className="muted small" style={{display:'block',marginBottom:6}}>Send date and time</label><input id="campaign-schedule-time" type="datetime-local" value={schedule} onChange={e => setSchedule(e.target.value)} required style={{ width: '100%', padding: 10, border: '1px solid #dce3ed', borderRadius: 8 }} /><button className="button secondary" disabled={scheduling} style={{ marginTop: 8 }}><CalendarClock size={15} />{scheduling?'Saving schedule…':campaign.status==='SCHEDULED'?'Update schedule':'Schedule campaign'}</button></form></> : null}
        <div style={{ borderTop: '1px solid #eef1f5', marginTop: 22, paddingTop: 18 }}><button className="button" style={{ width: '100%', justifyContent: 'center' }} onClick={()=>setSendReviewOpen(true)} disabled={deleting||campaign.status !== 'DRAFT'}><Send size={15} />Send now</button><p className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>Before sending, Repus checks consent, suppression, sender domain verification, and available daily and monthly sending limits.</p></div>
        {['QUEUED', 'SENDING'].includes(campaign.status) && <button className="button secondary" onClick={() => act('pause')} style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}><Pause size={15} />Pause campaign</button>}
        {campaign.status === 'PAUSED' && <button className="button secondary" onClick={() => act('resume')} style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}><Play size={15} />Resume campaign</button>}
        {['SCHEDULED', 'QUEUED', 'PAUSED'].includes(campaign.status) && <button className="button secondary" onClick={() => void cancelCampaign()} style={{ color: '#b42318', marginTop: 10 }}>Cancel campaign</button>}
      </section>:<section className="card"><div className="card-title">Read-only access</div><p className="muted small">You can preview this campaign and view its results. A workspace member with editing access can make changes or send it.</p></section>}
    </div>
    {canManage&&sendReviewOpen&&<div role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!sending)setSendReviewOpen(false)}} style={{position:'fixed',inset:0,zIndex:1000,display:'grid',placeItems:'center',padding:20,background:'rgba(18,30,50,.48)'}}><section ref={sendReviewRef} role="dialog" aria-modal="true" aria-labelledby="send-review-title" aria-describedby="send-review-description" className="card" style={{width:'min(100%,480px)',boxShadow:'0 24px 80px rgba(10,24,45,.24)'}}><div style={{width:42,height:42,borderRadius:12,display:'grid',placeItems:'center',background:'#eef4ff',color:'#2563eb',marginBottom:16}}><Send size={19}/></div><h2 id="send-review-title" style={{fontSize:21,margin:'0 0 8px'}}>Ready to send?</h2><p id="send-review-description" className="muted" style={{lineHeight:1.6,margin:'0 0 18px'}}>Review the campaign details. Repus will include only subscribers who still have recorded permission and are not suppressed.</p><div style={{padding:14,border:'1px solid #e7ecf3',borderRadius:10,display:'grid',gap:12,marginBottom:16}}><div><div className="muted small">Campaign</div><strong>{campaign.name}</strong></div><div><div className="muted small">Subject</div><strong>{campaign.subject||'No subject line'}</strong></div><div><div className="muted small">Sender</div><strong>{campaign.fromName?`${campaign.fromName} · `:''}{campaign.fromEmail||'No sender address'}</strong></div></div><div style={{display:'flex',gap:9,alignItems:'flex-start',padding:12,borderRadius:9,background:'#f7f9fc',fontSize:12,lineHeight:1.55,color:'#53647b',marginBottom:20}}><Users size={16} style={{flex:'0 0 auto',marginTop:1}}/><span>The final audience and daily/monthly quota are checked when you confirm. Launch stops if the sender domain is not verified or the eligible audience has changed.</span></div>{error&&<div className="error" role="alert" style={{marginBottom:12}}>{error}</div>}<div style={{display:'flex',justifyContent:'flex-end',gap:9}}><button type="button" className="button secondary" disabled={sending} onClick={()=>setSendReviewOpen(false)}>Review later</button><button type="button" className="button" disabled={sending||campaign.status!=='DRAFT'} onClick={()=>void send()}><Send size={15}/>{sending?'Checking and queuing…':'Confirm and send'}</button></div></section></div>}

    <section className="card" style={{ marginTop: 18 }}>
      <div className="card-head"><div><div className="card-title">Campaign results</div><div className="muted small" style={{ marginTop: 4 }}>Provider-confirmed delivery and engagement activity.</div></div><Activity size={17} color="#7892bd" /></div>
      {reportError && <div className="error">{reportError}</div>}
      {report?.lastReputationPause && <p className="muted small">
        <strong>Last automatic pause.</strong> Repus paused sending after the {report.lastReputationPause.reason === 'complaint_rate' ? 'complaint rate' : 'bounce rate'} reached the safety threshold.{' '}
        <time dateTime={report.lastReputationPause.occurredAt}>{new Date(report.lastReputationPause.occurredAt).toLocaleString()}</time>
      </p>}
      {report?.uncertainSends > 0 && <div role="status" style={{padding:12,marginBottom:14,border:'1px solid #f0c978',borderRadius:9,background:'#fff8e7',color:'#72510d',fontSize:13,lineHeight:1.55}}><b>{report.uncertainSends} send{report.uncertainSends===1?' is':'s are'} awaiting provider review.</b> Repus has not retried these emails because SES may have accepted them. Sending quota stays reserved while an SES event is pending. Contact Repus support before attempting any manual resend.</div>}
      <div className="grid stats" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))' }}>
        {metric('Recipients', report?.recipients)}{metric('Accepted', report?.accepted)}{metric('Delivered', report?.delivered)}{metric('Awaiting review', report?.uncertainSends)}{metric('Delivery rate', report?.deliveryRate == null ? '—' : `${report.deliveryRate}%`)}{metric('Unique opens', report?.uniqueOpens)}{metric('Open rate', report?.uniqueOpenRate == null ? '—' : `${report.uniqueOpenRate}%`)}{metric('Total opens', report?.opens)}{metric('Unique clicks', report?.uniqueClicks)}{metric('Click rate', report?.uniqueClickRate == null ? '—' : `${report.uniqueClickRate}%`)}{metric('Total clicks', report?.clicks)}{metric('Bounces', report?.bounces)}{metric('Bounce rate', report?.bounceRate == null ? '—' : `${report.bounceRate}%`)}{metric('Complaints', report?.complaints)}{metric('Complaint rate', report?.complaintRate == null ? '—' : `${report.complaintRate}%`)}{metric('Unsubscribes', report?.unsubscribes)}{metric('Suppressed', report?.suppressed)}{metric('Failed', report?.failed)}
      </div>
      <p className="muted small">Open rates are approximate and may include automated activity. Provider acceptance does not mean inbox placement.</p>
    </section>

    <div className="grid split" style={{ marginTop: 18 }}>
      <CampaignRecipients key={id} campaignId={id} revision={activityRevision} />
      <CampaignActivity key={id} campaignId={id} revision={activityRevision} />
    </div>
  </div>;
}
