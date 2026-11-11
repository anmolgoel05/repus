'use client';
import { useEffect, useState } from 'react';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000';
type Usage={usedBytes:number;limitBytes:number};
function formatBytes(bytes:number){if(bytes<1024)return `${bytes} B`;const units=['KB','MB','GB'];let size=bytes/1024,index=0;while(size>=1024&&index<units.length-1){size/=1024;index++;}return `${size.toFixed(size>=10?0:1)} ${units[index]}`;}
export default function MediaStorageMeter(){
 const[usage,setUsage]=useState<Usage|null>(null);
 useEffect(()=>{let active=true;const refresh=()=>fetch(`${API}/api/v1/media/images`,{credentials:'include'}).then(async response=>{const body=await response.json();if(response.ok&&active)setUsage(body.data.usage);}).catch(()=>{});const onChanged=(event:Event)=>{const detail=(event as CustomEvent<Usage>).detail;if(detail)setUsage(detail);else void refresh();};void refresh();window.addEventListener('repus:image-storage-changed',onChanged);return()=>{active=false;window.removeEventListener('repus:image-storage-changed',onChanged);};},[]);
 if(!usage)return null;
 const percent=usage.limitBytes===0?100:Math.min(100,usage.usedBytes/usage.limitBytes*100);
 return <div aria-label={`Image storage ${formatBytes(usage.usedBytes)} of ${formatBytes(usage.limitBytes)}`} style={{margin:'0 0 12px',padding:'10px 12px',background:'#f7f9fc',borderRadius:8}}><div className="muted small" style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:6}}><span>Workspace image storage</span><span>{formatBytes(usage.usedBytes)} of {formatBytes(usage.limitBytes)}</span></div><div role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} style={{height:5,borderRadius:8,background:'#e3e9f1',overflow:'hidden'}}><div style={{width:`${percent}%`,height:'100%',background:percent>=90?'#d68a32':'#527fc6',transition:'width .2s'}}/></div></div>;
}
