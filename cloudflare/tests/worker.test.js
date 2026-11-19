import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {DAILY_LIMIT,MODEL,validateOutput} from '../src/index.js';
const valid={choices:[{message:{tool_calls:[{function:{name:'archive_no_action',arguments:JSON.stringify({category:'fyi',reason:'Informational',rationale:'No action is requested.'})}}]}}]};
function env(){
 const counts=new Map(); const state={calls:0};
 return {LIVE_ENABLED:'true',VISITOR_SALT:'test',ALLOWED_ORIGINS:'https://inbox-triage-womputer.vercel.app',
 DB:{prepare(sql){return {bind(key,day,limit){return {async first(){const n=counts.get(key)||0;if(n>=limit)return null;counts.set(key,n+1);return {used:n+1};},async run(){return {success:true};}};}};}},
 AI:{async run(model,args){state.calls++;assert.equal(model,MODEL);assert.equal(args.max_completion_tokens,1024);assert.equal(args.stream,false);return valid;}},state,counts};
}
function req(body={sender:'alex@example.com',subject:'FYI',body:'No action required.'},ip='1.2.3.4',origin='https://inbox-triage-womputer.vercel.app'){
 return new Request('https://demo.workers.dev/api/triage',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'CF-Connecting-IP':ip},body:JSON.stringify(body)});
}
test('valid output strips rationale from arguments',()=>{const [call]=validateOutput(valid);assert.equal(call.tool_name,'archive_no_action');assert.equal(call.rationale,'No action is requested.');assert.equal(call.arguments.rationale,undefined);});
test('rejects missing, unknown, invalid enum and blank rationale calls',()=>{
 for(const output of [{},{tool_calls:[]},{tool_calls:[{name:'send_money',arguments:{}}]},{tool_calls:[{name:'archive_no_action',arguments:{category:'x',reason:'x',rationale:'x'}}]},{tool_calls:[{name:'archive_no_action',arguments:{category:'fyi',reason:'x',rationale:' '}}]}]) assert.throws(()=>validateOutput(output));
});
test('valid request makes exactly one inference',async()=>{const e=env();const r=await worker.fetch(req(),e);assert.equal(r.status,200);assert.equal(e.state.calls,1);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://inbox-triage-womputer.vercel.app');});
test('disabled configuration fails closed',async()=>{for(const override of [{LIVE_ENABLED:'false'},{DB:null},{AI:null},{VISITOR_SALT:''}]){const e={...env(),...override};assert.equal((await worker.fetch(req(),e)).status,503);assert.equal(e.state.calls,0);}});
test('invalid origin cannot call model',async()=>{const e=env();assert.equal((await worker.fetch(req(undefined,undefined,'https://evil.example'),e)).status,403);assert.equal(e.state.calls,0);});
test('input bounds and extra fields rejected before quota reservation',async()=>{for(const body of [{sender:'a',subject:'b',body:'x'.repeat(2001)},{sender:'a',subject:'b',body:'hello',model:'paid-model'},null,{sender:'a',subject:'b',body:'   '},{sender:'a',subject:'x'.repeat(201),body:'x'.repeat(9000)}]){const e=env();assert.equal((await worker.fetch(req(body),e)).status,400);assert.equal(e.state.calls,0);assert.equal(e.counts.size,0);}});
test('three attempts per visitor, including concurrent requests',async()=>{const e=env();const results=await Promise.all(Array.from({length:10},()=>worker.fetch(req(),e)));assert.equal(results.filter(r=>r.status===200).length,3);assert.equal(e.state.calls,3);});
test('global hard cap holds under concurrent distinct visitors',async()=>{const e=env();const results=await Promise.all(Array.from({length:80},(_,i)=>worker.fetch(req(undefined,`ip-${i}`),e)));assert.equal(results.filter(r=>r.status===200).length,DAILY_LIMIT);assert.equal(e.state.calls,DAILY_LIMIT);});
test('provider failure is not retried and consumes reservation',async()=>{const e=env();e.AI.run=async()=>{e.state.calls++;throw new Error('secret provider detail');};for(let i=0;i<4;i++)await worker.fetch(req(),e);assert.equal(e.state.calls,3);const r=await worker.fetch(req(undefined,'other'),e);assert.equal(r.status,503);assert.ok(!(await r.text()).includes('secret'));});
test('quota database failure cannot reach inference',async()=>{const e=env();e.DB.prepare=()=>{throw new Error('database unavailable');};assert.equal((await worker.fetch(req(),e)).status,503);assert.equal(e.state.calls,0);});
test('preflight succeeds only for allowed origin',async()=>{const e=env();for(const [origin,status] of [['https://inbox-triage-womputer.vercel.app',204],['https://evil.example',403]])assert.equal((await worker.fetch(new Request('https://demo.workers.dev/api/triage',{method:'OPTIONS',headers:{Origin:origin}}),e)).status,status);assert.equal(e.state.calls,0);});
