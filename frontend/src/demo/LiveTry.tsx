import {useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {Button} from '../components/ui/Button';
import {useUploadStore} from '../store/upload';
import {saveLiveEmail} from './api';
const endpoint=import.meta.env.VITE_TRIAGE_API_URL||'';
export function LiveTry(){
 const navigate=useNavigate(), queryClient=useQueryClient();
 const [form,setForm]=useState({sender:'alex@example.com',subject:'Quick review before Friday',body:'Could you review the launch checklist by Friday? Please assign the review to jordan@example.com and include any blockers.'});
 const [pending,setPending]=useState(false),[error,setError]=useState('');
 async function submit(event:React.FormEvent){
  event.preventDefault();if(pending)return;setError('');
  if(!endpoint){setError('Live triage is not connected yet. The sample inbox is ready to explore.');return;}
  setPending(true);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
  try{
   const r=await fetch(`${endpoint.replace(/\/$/,'')}/api/triage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form),signal:controller.signal});
   const result=await r.json();if(!r.ok)throw new Error(result.detail||'Live triage is unavailable.');
   if(!Array.isArray(result.tool_calls)||!result.tool_calls.length)throw new Error('No valid suggestions were returned. Explore the sample inbox instead.');
   const id=`live-${crypto.randomUUID()}`;
   saveLiveEmail({id,source_id:id,upload_id:'live',...form,recipients:'jordan@example.com',cc:'',sent_at:new Date().toISOString(),agent_status:'done',agent_error:null,tool_calls:result.tool_calls});
   useUploadStore.getState().setActiveUpload('sample');
   await queryClient.invalidateQueries({queryKey:['emails']});await queryClient.invalidateQueries({queryKey:['upload']});navigate(`/inbox/${id}`);
  }catch(e){setError(e instanceof Error&&e.name==='AbortError'?'This request took too long. The sample inbox still works; no automatic retry was sent.':e instanceof Error?e.message:'Could not connect. Explore the sample inbox instead.');}
  finally{clearTimeout(timer);setPending(false);}
 }
 const inputClass='mt-2 block w-full rounded-xl border border-line-strong bg-surface-1 px-4 py-3 text-base text-ink-50 focus:border-accent outline-none';
 return <div className="px-6 lg:px-16 py-12 max-w-4xl mx-auto">
  <h1 className="display-serif text-5xl md:text-6xl text-ink-50 mb-4">Try your own email</h1>
  <p className="text-ink-200 leading-relaxed mb-8 max-w-xl">A live model chooses the next steps and explains why. Actions are simulated—nothing is sent, scheduled, or archived.</p>
  <form onSubmit={submit} aria-busy={pending} className="glass rounded-2xl p-5 md:p-8 space-y-5">
   <label className="block text-sm text-ink-200">From<input className={inputClass} required maxLength={160} value={form.sender} onChange={e=>setForm({...form,sender:e.target.value})}/></label>
   <label className="block text-sm text-ink-200">Subject<input className={inputClass} required maxLength={200} value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})}/></label>
   <label className="block text-sm text-ink-200">Email<textarea className={inputClass} required maxLength={2000} rows={7} value={form.body} onChange={e=>setForm({...form,body:e.target.value})}/></label>
   <div className="flex flex-wrap justify-between gap-2 text-sm text-ink-400"><span>Use a fictional or non-sensitive email.</span><span>{form.body.length} / 2,000</span></div>
   <p className="text-sm text-ink-400 leading-relaxed">Processed by Cloudflare Workers AI. This app does not save your email to a server. Live results stay in this tab until you reload. Limit: three attempts per network each day.</p>
   {error&&<div role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-ink-50"><p>{error}</p><Link className="inline-block mt-2 text-accent underline" to="/inbox">Explore the sample inbox</Link></div>}
   <div className="flex items-center flex-wrap gap-4"><Button size="lg" type="submit" disabled={pending||!form.body.trim()}>{pending?'Reading your email…':'Triage this email'}</Button><span role="status" className="text-sm text-ink-400">{pending?'This can take a moment.':'50 live attempts shared across the demo each day.'}</span></div>
  </form>
  <p className="text-sm text-ink-400 mt-6">The precomputed sample inbox stays available when the live allowance runs out.</p>
 </div>;
}
