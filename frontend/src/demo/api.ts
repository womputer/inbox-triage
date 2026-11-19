import type {EmailDetail, EmailListResponse, UploadStatus, ToolExecuteResponse, AgentRunResponse, UploadCreateResponse} from '../api/types';
import sample from './sample.json';
import {mockTool} from './mock';
const live:EmailDetail[]=[];
const samples=sample.emails as EmailDetail[];
export function saveLiveEmail(email:EmailDetail){live.unshift(email);}
const all=()=>[...live,...samples];
const status=():UploadStatus=>({upload_id:'sample',filename:'Sample inbox + this session',email_count:all().length,agent_status:'done',agent_progress:all().length,agent_total:all().length,agent_error_count:0,agent_started_at:null,agent_finished_at:null});
export const demoApi={
 async uploadCsv(_file:File):Promise<UploadCreateResponse>{throw new Error('Use live triage for one email, or explore the sample inbox.');},
 async uploadStatus(_id:string):Promise<UploadStatus>{return status();},
 async listUploads():Promise<UploadStatus[]>{return [status()];},
 async runAgent(_id:string):Promise<AgentRunResponse>{throw new Error('Samples are precomputed. Use live triage for a new email.');},
 async listEmails(params:{uploadId?:string;tool?:string;q?:string;limit?:number;offset?:number}={}):Promise<EmailListResponse>{
  const q=params.q?.toLowerCase()||'';
  const filtered=all().filter(e=>(!params.tool||e.tool_calls.some(t=>t.tool_name===params.tool))&&`${e.subject} ${e.sender}`.toLowerCase().includes(q));
  return {total:filtered.length,items:filtered.slice(params.offset||0,(params.offset||0)+(params.limit??100)).map(e=>({...e,tools:[...new Set(e.tool_calls.map(t=>t.tool_name))]}))};
 },
 async getEmail(id:string):Promise<EmailDetail>{const email=all().find(e=>e.id===id);if(!email)throw new Error('This live result is no longer in this tab. Return to the sample inbox.');return email;},
 async executeTool(name:string,args:Record<string,unknown>):Promise<ToolExecuteResponse>{
  const result=mockTool(name,args);
  return {tool:name,arguments:args,result:{...result,meeting_id:result.reference,task_id:result.reference,ticket_id:result.reference,assigned_to:args.suggested_owner||'Demo manager',sla_response_hours:24,folder:`Demo / ${args.category||'archive'}`,word_count:typeof args.body==='string'?args.body.split(/\s+/).length:0,duration_minutes:args.duration_minutes||30,calendar_link:'Simulation only — no event created',expires_at:args.deadline||'Not specified'}};
 },
 async listTools(){return {tools:[]};},
};
