import * as validators from './validators.js';
import catalog from './catalog.json' with { type: 'json' };
import { SYSTEM_PROMPT } from './prompt.js';

// Deliberately fixed: requests cannot choose a model, output budget, or tools.
export const MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const DAILY_LIMIT = 50;
export const VISITOR_LIMIT = 3;
export const MAX_BYTES = 8000;
export const RESERVE_SQL = `INSERT INTO quotas (key, used, day) VALUES (?, 1, ?)
 ON CONFLICT(key) DO UPDATE SET used = quotas.used + 1 WHERE quotas.used < ?
 RETURNING used`;

export function validateOutput(result) {
  const calls = result?.choices?.[0]?.message?.tool_calls ?? result?.tool_calls;
  if (!Array.isArray(calls) || !calls.length || calls.length > 6) throw new Error('Invalid tool calls');
  return calls.map((call, order_idx) => {
    const f = call.function ?? call;
    const args = typeof f.arguments === 'string' ? JSON.parse(f.arguments) : f.arguments;
    if (!validators[f.name]?.(args) || !args.rationale.trim()) throw new Error('Invalid arguments');
    const { rationale, ...arguments_ } = args;
    return {id:crypto.randomUUID(), tool_name:f.name, arguments:arguments_, rationale, order_idx};
  });
}

async function readInput(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Use JSON');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const chunks=[]; let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.byteLength;
      if(size>MAX_BYTES) {await reader.cancel(); throw new Error('Request is too large');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size); let offset=0;
  for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const input=JSON.parse(new TextDecoder().decode(bytes));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid email');
  const out={};
  for(const [key,max] of [['sender',160],['subject',200],['body',2000]]) {
    if(typeof input[key]!=='string' || !input[key].trim() || input[key].length>max) throw new Error(`Invalid ${key}`);
    out[key]=input[key].trim();
  }
  if(Object.keys(input).some(k=>!['sender','subject','body'].includes(k))) throw new Error('Unexpected field');
  return out;
}

export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    const origin=request.headers.get('Origin');
    const allowed=(env.ALLOWED_ORIGINS??'').split(',').includes(origin);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
      ...(allowed?{'Access-Control-Allow-Origin':origin}:{} )};
    const reply=(body,status=200)=>Response.json(body,{status,headers});
    if(request.method==='OPTIONS') return new Response(null,{status:allowed?204:403,headers:{...headers,
      'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
    if(url.pathname==='/healthz' && request.method==='GET') return reply({ok:true,live:env.LIVE_ENABLED==='true',model:MODEL});
    if(url.pathname!=='/api/triage') return reply({detail:'Not found.'},404);
    if(request.method!=='POST') return reply({detail:'Use POST.'},405);
    if(!allowed) return reply({detail:'Use the public Inbox Triage demo.'},403);
    if(env.LIVE_ENABLED!=='true' || !env.DB || !env.AI) return reply({detail:'Live triage is unavailable. Explore the sample inbox instead.'},503);
    let input;
    try { input=await readInput(request); } catch { return reply({detail:'Enter a sender, subject (up to 200 characters), and email (up to 2,000 characters).'},400); }
    try {
      const day=new Date().toISOString().slice(0,10);
      const ip=request.headers.get('CF-Connecting-IP');
      if(!ip || !env.VISITOR_SALT) return reply({detail:'Live triage is unavailable. The sample inbox still works.'},503);
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${env.VISITOR_SALT}:${day}:${ip}`));
      const visitor=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      // Atomic SQL reservations, shared across isolates and deployments. Count
      // failures too; never refund or retry an inference that may have started.
      const global=await env.DB.prepare(RESERVE_SQL).bind(`global:${day}`,day,DAILY_LIMIT).first();
      if(!global) return reply({detail:'Today’s live demo allowance is used up. Explore the sample inbox, or try again tomorrow (UTC).'},429);
      const personal=await env.DB.prepare(RESERVE_SQL).bind(`visitor:${day}:${visitor}`,day,VISITOR_LIMIT).first();
      if(!personal) return reply({detail:'You’ve reached the three-email daily demo limit. The sample inbox is always available.'},429);
      // Only at most 50 admitted requests/day reach cleanup or inference.
      await env.DB.prepare('DELETE FROM quotas WHERE day < ?').bind(day).run();
      const result=await env.AI.run(MODEL,{
        messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:JSON.stringify(input)}],
        tools:catalog.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.input_schema}})),
        tool_choice:'required',stream:false,temperature:0,max_completion_tokens:1024,
        chat_template_kwargs:{enable_thinking:false},
      });
      const tool_calls=validateOutput(result);
      return reply({model:MODEL,tool_calls});
    } catch {
      // No prompts, output, IPs, provider errors or credentials in public errors/logs.
      return reply({detail:'Live triage is temporarily unavailable. Your email has not been saved. Explore the sample inbox or try later.'},503);
    }
  }
};
