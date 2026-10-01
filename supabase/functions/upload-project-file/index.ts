import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const MAX_BYTES=10*1024*1024;
const allowedTypes=new Set(['image/jpeg','image/png','image/webp','application/pdf']);
const safeName=(value:string)=>value.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-100)||'file';
const hex=(bytes:Uint8Array,start:number,length:number)=>[...bytes.slice(start,start+length)].map(value=>value.toString(16).padStart(2,'0')).join('');
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validSignature(bytes:Uint8Array,type:string){
  if(type==='image/jpeg')return hex(bytes,0,3)==='ffd8ff';
  if(type==='image/png')return hex(bytes,0,8)==='89504e470d0a1a0a';
  if(type==='image/webp')return new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
  if(type==='application/pdf')return new TextDecoder().decode(bytes.slice(0,5))==='%PDF-';
  return false;
}
function hasActivePdfContent(bytes:Uint8Array){
  const text=new TextDecoder('latin1').decode(bytes);
  return /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/i.test(text);
}

Deno.serve(async request=>{
  const configuredSite=Deno.env.get('PUBLIC_SITE_URL');
  const allowedOrigins=new Set(['http://localhost:4173','http://127.0.0.1:4173']);
  if(configuredSite)try{allowedOrigins.add(new URL(configuredSite).origin)}catch{}
  const origin=request.headers.get('Origin')||'';
  const cors={'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(request.method==='OPTIONS')return allowedOrigins.has(origin)?new Response('ok',{headers:cors}):json({error:'origin not allowed'},403);
  if(origin&&!allowedOrigins.has(origin))return json({error:'origin not allowed'},403);
  if(request.method!=='POST')return json({error:'method not allowed'},405);
  const authorization=request.headers.get('Authorization');
  const url=Deno.env.get('SUPABASE_URL'),publishable=Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!authorization)return json({error:'authentication required'},401);
  if(!url||!publishable||!secret)return json({error:'function environment is incomplete'},503);
  const userClient=createClient(url,publishable,{global:{headers:{Authorization:authorization}}});
  const {data:{user},error:userError}=await userClient.auth.getUser();
  if(userError||!user)return json({error:'invalid session'},401);
  const admin=createClient(url,secret,{auth:{persistSession:false}});

  if(request.headers.get('Content-Type')?.includes('application/json')){
    const body=await request.json().catch(()=>null) as {action?:unknown,paths?:unknown}|null;
    if(body?.action!=='delete')return json({error:'invalid action'},400);
    const paths=Array.isArray(body?.paths)?body.paths.filter((value):value is string=>typeof value==='string'&&value.length<=500):[];
    if(!paths.length||paths.length>20)return json({error:'invalid paths'},400);
    const projectIds=[...new Set(paths.map(path=>path.split('/')[0]))];
    if(projectIds.length!==1||!uuidPattern.test(projectIds[0])||paths.some(path=>path.startsWith('/')||path.includes('..')))return json({error:'invalid project path'},400);
    const {data:member}=await userClient.from('project_members').select('role').eq('project_id',projectIds[0]).eq('user_id',user.id).in('role',['owner','editor']).maybeSingle();
    if(!member)return json({error:'editor permission required'},403);
    const {error}=await admin.storage.from('project-files').remove(paths);if(error)return json({error:'file removal failed'},500);
    return json({removed:paths.length});
  }

  const form=await request.formData().catch(()=>null);
  const projectId=form?.get('projectId'),taskId=form?.get('taskId'),file=form?.get('file');
  if(typeof projectId!=='string'||!uuidPattern.test(projectId)||typeof taskId!=='string'||!taskId||!(file instanceof File))return json({error:'invalid upload payload'},400);
  const {data:member}=await userClient.from('project_members').select('role').eq('project_id',projectId).eq('user_id',user.id).in('role',['owner','editor']).maybeSingle();
  if(!member)return json({error:'editor permission required'},403);
  if(!allowedTypes.has(file.type)||file.size<1||file.size>MAX_BYTES)return json({error:'unsupported file'},400);
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!validSignature(bytes,file.type))return json({error:'file content does not match its type'},400);
  if(file.type==='application/pdf'&&hasActivePdfContent(bytes))return json({error:'active PDF content is not allowed'},400);
  const cleanTask=taskId.replace(/[^a-zA-Z0-9-]+/g,'-').slice(0,100);
  const path=`${projectId}/${cleanTask}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const {error}=await admin.storage.from('project-files').upload(path,bytes,{contentType:file.type,upsert:false,cacheControl:'3600'});
  if(error)return json({error:'file upload failed'},500);
  return json({storage_path:path,original_name:file.name,mime_type:file.type,byte_size:file.size},201);
});
