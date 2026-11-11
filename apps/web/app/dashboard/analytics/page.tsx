'use client';
import {useEffect,useState} from 'react';
import {Area,AreaChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {BarChart3} from 'lucide-react';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000';
type Metrics={accepted:number;uniqueOpens:number;uniqueClicks:number;campaigns:number;activeSubscribers:number;sentToday:number;delivered:number;bounces:number;complaints:number;deliveryRate:number|null;bounceRate:number|null;complaintRate:number|null;uniqueOpenRate:number|null;totalOpens:number;uniqueClickRate:number|null;totalClicks:number;unsubscribed:number;contacts:number;daily:{date:string;sent:number;delivered:number;bounces:number;complaints:number;opens:number;clicks:number;uniqueOpens:number;uniqueClicks:number}[]};
const percent=(value:number|null)=>value===null?'—':`${value}%`;

export default function AnalyticsPage(){
 const[data,setData]=useState<Metrics|null>(null),[error,setError]=useState('');
 useEffect(()=>{fetch(`${API}/api/v1/analytics/overview`,{credentials:'include'}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.message??'Could not load analytics.');setData(body.data)}).catch(reason=>setError(reason instanceof Error?reason.message:'Could not load analytics.'))},[]);
 const stats:[string,string|number][]=[['Campaigns',data?.campaigns??'—'],['Active subscribers',data?.activeSubscribers??'—'],['Accepted today',data?.sentToday??'—'],['Accepted total',data?.accepted??'—'],['Delivered',data?.delivered??'—'],['Delivery rate',percent(data?.deliveryRate??null)],['Bounced',data?.bounces??'—'],['Bounce rate',percent(data?.bounceRate??null)],['Complaints',data?.complaints??'—'],['Complaint rate',percent(data?.complaintRate??null)],['Unique open rate',percent(data?.uniqueOpenRate??null)],['Unique opens',data?.uniqueOpens??'—'],['Total opens',data?.totalOpens??'—'],['Unique click rate',percent(data?.uniqueClickRate??null)],['Unique clicks',data?.uniqueClicks??'—'],['Total clicks',data?.totalClicks??'—'],['Unsubscribed',data?.unsubscribed??'—'],['Total contacts',data?.contacts??'—']];
 return <div className="content">
  <div className="welcome"><div><div className="muted small" style={{marginBottom:8}}>Performance</div><h1 className="font-display" style={{fontSize:27,margin:'0 0 7px'}}>Analytics</h1><div className="muted">Understand delivery and subscriber engagement.</div></div></div>
  {error&&<div className="error" role="alert">{error}</div>}
  <div className="grid stats">{stats.map(([label,value])=><div key={label} className="card"><div className="stat-label">{label}<BarChart3 size={15} color="#7892bd"/></div><div className="stat-number">{value}</div></div>)}</div>
  <div className="card"><div className="card-title">Daily sending and engagement</div><p className="muted small">Provider accepted sends, delivery confirmations, bounces, complaints, opens, and clicks for the last 14 days. Rates above use provider-accepted messages as the denominator.</p>
   <div style={{height:340}}>{data&&<ResponsiveContainer width="100%" height="100%"><AreaChart data={data.daily} margin={{top:12,right:12,bottom:0,left:-16}}><CartesianGrid stroke="#edf0f5" vertical={false}/><XAxis dataKey="date" tickFormatter={value=>value.slice(5)} tickLine={false} axisLine={false}/><YAxis allowDecimals={false} tickLine={false} axisLine={false}/><Tooltip/><Area type="monotone" dataKey="sent" name="Accepted" stroke="#3979e6" fill="#3979e622"/><Area type="monotone" dataKey="delivered" name="Delivered" stroke="#22a06b" fill="#22a06b22"/><Area type="monotone" dataKey="bounces" name="Bounces" stroke="#dc4b4b" fill="#dc4b4b22"/><Area type="monotone" dataKey="complaints" name="Complaints" stroke="#ea8b20" fill="#ea8b2022"/><Area type="monotone" dataKey="uniqueOpens" name="Unique opens" stroke="#8b5cf6" fill="#8b5cf622"/><Area type="monotone" dataKey="uniqueClicks" name="Unique clicks" stroke="#0891b2" fill="#0891b222"/></AreaChart></ResponsiveContainer>}</div>
   <p className="muted small">Open metrics are approximate because image proxies and privacy features can create automated opens. Click events may also include automated activity. Delivery is a provider confirmation, not inbox placement.</p>
  </div>
 </div>;
}

